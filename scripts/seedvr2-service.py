import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1] / "extras" / "SeedVR2"
WORK = ROOT / "canvas-jobs"
MODEL = "seedvr2_ema_3b_fp8_e4m3fn.safetensors"
PORT = int(os.environ.get("SEEDVR2_PORT", "17372"))
JOBS = {}
LOCK = threading.Lock()
STATE_LOCK = threading.RLock()
PROCESS = {}
ACTIVE = {"uploading", "queued", "running", "cancelling"}


def save(job):
    target = WORK / job["id"] / "job.json"
    temporary = target.with_suffix(".tmp")
    with STATE_LOCK:
        temporary.write_text(json.dumps(dict(job), ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(target)


def public(job):
    return {key: value for key, value in job.items() if key not in {"input", "result", "diagnostic"}}


def check_cancel(job):
    if job.get("cancelRequested"):
        raise InterruptedError("视频超分任务已取消")


def quality_settings(query):
    try:
        settings = {key: int(query.get(key, [default])[0]) for key, default in {
            "resolution": 1080, "batchSize": 5, "temporalOverlap": 0, "seed": 42,
        }.items()}
    except (ValueError, TypeError):
        raise ValueError("超分参数必须为整数")
    settings["colorCorrection"] = query.get("colorCorrection", ["lab"])[0]
    if settings["resolution"] not in {720, 1080, 1440, 2160}:
        raise ValueError("输出短边请选择 720、1080、1440 或 2160")
    if settings["batchSize"] not in {5, 9, 13}:
        raise ValueError("每批帧数请选择 5、9 或 13")
    if settings["temporalOverlap"] not in {0, 2, 4}:
        raise ValueError("重叠帧数请选择 0、2 或 4")
    if settings["colorCorrection"] not in {"lab", "wavelet"}:
        raise ValueError("色彩校正请选择 LAB 或 Wavelet")
    if not 0 <= settings["seed"] <= 2147483647:
        raise ValueError("随机种子超出范围")
    return settings


def inference_command(job, raw_output):
    return [
        sys.executable, "-u", "-X", "utf8", str(ROOT / "inference_cli.py"), job["input"],
        "--resolution", str(job["resolution"]), "--batch_size", str(job.get("batchSize", 5)), "--uniform_batch_size",
        "--temporal_overlap", str(job.get("temporalOverlap", 0)), "--color_correction", job.get("colorCorrection", "lab"), "--seed", str(job.get("seed", 42)),
        "--dit_model", MODEL, "--model_dir", str(ROOT / "models" / "verified"),
        "--blocks_to_swap", "16", "--vae_encode_tiled", "--vae_decode_tiled", "--dit_offload_device", "cpu", "--vae_offload_device", "cpu",
        "--vae_decode_tile_size", "512", "--vae_decode_tile_overlap", "128",
        "--output", str(raw_output), "--output_format", "mp4", "--video_backend", "ffmpeg",
    ]


def inference_stage(line):
    # Percentages in CLI output refer to individual loads/tiles, not the video.
    for marker, stage in (("Phase 1:", "正在编码原视频"), ("Phase 2:", "正在修复视频细节"), ("Phase 3:", "正在解码超分画面"), ("Phase 4:", "正在融合批次与校正色彩")):
        if marker in line and "complete" not in line.lower():
            return stage
    return None


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path.strip("/").split("/")
        if path == ["health"]:
            with STATE_LOCK:
                busy = any(job["status"] in ACTIVE for job in JOBS.values())
            return self._json(200, {"ready": models_ready(), "model": MODEL, "busy": busy, "qualitySettings": True})
        if len(path) >= 2 and path[0] == "jobs":
            job = JOBS.get(path[1])
            if not job:
                return self._json(404, {"error": "任务不存在"})
            if len(path) == 3 and path[2] == "result":
                result = Path(job.get("result", ""))
                if job["status"] != "complete" or not result.exists():
                    return self._json(409, {"error": "结果尚未完成"})
                return self._file(result, path[1])
            return self._json(200, public(job))
        self._json(404, {"error": "接口不存在"})

    def do_POST(self):
        path = urlparse(self.path).path
        if re.fullmatch(r"/jobs/[0-9a-f]{32}/cancel", path):
            job_id = path.split("/")[2]
            with STATE_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    job_dir = WORK / job_id
                    job_dir.mkdir(parents=True, exist_ok=True)
                    job = {"id": job_id, "status": "cancelled", "progress": 0, "createdAt": time.time(), "completedAt": time.time(), "cancelRequested": True, "input": str(job_dir / "input.mp4"), "result": str(job_dir / "result.mp4")}
                    JOBS[job_id] = job
                    save(job)
                if job["status"] in ACTIVE:
                    job.update(cancelRequested=True, status="cancelling")
                    save(job)
                    process = PROCESS.get(job["id"])
                    if process and process.poll() is None:
                        if os.name == "nt":
                            stopped = subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True)
                            if stopped.returncode and process.poll() is None:
                                process.terminate()
                        else:
                            process.terminate()
            return self._json(200, public(job))
        if path != "/jobs":
            return self._json(404, {"error": "接口不存在"})
        query = parse_qs(urlparse(self.path).query)
        job_id = query.get("id", [uuid.uuid4().hex])[0]
        if not re.fullmatch(r"[0-9a-f]{32}", job_id):
            return self._json(400, {"error": "无效的任务编号"})
        with STATE_LOCK:
            if job_id in JOBS:
                return self._json(202, {"id": job_id})
        if not models_ready():
            return self._json(503, {"error": "SeedVR2 模型尚未安装完成"})
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return self._json(400, {"error": "没有收到视频文件"})
        if length > 2 * 1024**3:
            return self._json(400, {"error": "视频文件不能超过 2GB"})
        try:
            settings = quality_settings(query)
        except ValueError as error:
            return self._json(400, {"error": str(error)})
        job_dir = WORK / job_id
        source = job_dir / "input.mp4"
        with STATE_LOCK:
            if job_id in JOBS:
                return self._json(202, {"id": job_id})
            if any(job["status"] in ACTIVE for job in JOBS.values()):
                return self._json(409, {"error": "SeedVR2 已有任务正在运行"})
            job_dir.mkdir(parents=True, exist_ok=True)
            job = {"id": job_id, "status": "uploading", "progress": 0, **settings, "createdAt": time.time(), "input": str(source), "result": str(job_dir / "result.mp4")}
            JOBS[job_id] = job
            save(job)
        try:
            with source.open("wb") as file:
                remaining = length
                while remaining:
                    check_cancel(job)
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("视频上传中断，请重新发起超分")
                    file.write(chunk)
                    remaining -= len(chunk)
            check_cancel(job)
            ffmpeg = ensure_ffmpeg()
            check = subprocess.run([str(ffmpeg), "-v", "error", "-i", str(source), "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"], capture_output=True)
            if check.returncode:
                raise ValueError("原视频无法解码，请检查文件后重新上传")
            check_cancel(job)
            job.update(status="queued", progress=1)
            save(job)
        except InterruptedError as error:
            job.update(status="cancelled", error=str(error), completedAt=time.time())
            save(job)
            return self._json(409, {"error": str(error)})
        except Exception as error:
            job.update(status="error", error=str(error), completedAt=time.time())
            save(job)
            return self._json(400, {"error": str(error)})
        threading.Thread(target=run_job, args=(job,), daemon=True).start()
        self._json(202, {"id": job_id})

    def _json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path, job_id):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(path.stat().st_size))
        self.end_headers()
        with path.open("rb") as file:
            shutil.copyfileobj(file, self.wfile)
        # Keep local results until the user chooses to remove them.

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:"):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, *_args):
        return


def models_ready():
    model_dir = ROOT / "models" / "verified"
    return (model_dir / MODEL).exists() and (model_dir / "ema_vae_fp16.safetensors").exists()


def run_job(job):
    with LOCK:
        try:
            check_cancel(job)
        except InterruptedError as error:
            job.update(status="cancelled", error=str(error), completedAt=time.time())
            save(job)
            return
        job.update(status="running", progress=0, stage="正在准备 SeedVR2 模型", progressIndeterminate=True, startedAt=time.time())
        save(job)
        output = Path(job["result"])
        raw_output = output.with_name("result-silent.mp4")
        try:
            opener = build_opener(ProxyHandler({}))
            with opener.open("http://127.0.0.1:8188/queue", timeout=5) as response:
                queue = json.load(response)
            if queue.get("queue_running") or queue.get("queue_pending"):
                raise RuntimeError("ComfyUI 正在生成，请等待完成后再超分")
            try:
                with opener.open("http://127.0.0.1:8189/queue", timeout=3) as response:
                    qwen_queue = json.load(response)
            except OSError:
                qwen_queue = None
            if qwen_queue is not None:
                if qwen_queue.get("queue_running") or qwen_queue.get("queue_pending"):
                    raise RuntimeError("千问图片模型正在生成，请等待完成后再超分")
                with opener.open(Request("http://127.0.0.1:8189/free", data=b'{"unload_models":true,"free_memory":true}', headers={"Content-Type": "application/json"}), timeout=10):
                    pass
            with opener.open(Request("http://127.0.0.1:17373/status", headers={"Origin": "http://localhost:3000"}), timeout=5) as response:
                if json.load(response).get("running"):
                    raise RuntimeError("本地提示词模型正在运行，请等待完成后再超分")
            with opener.open(Request("http://127.0.0.1:8188/free", data=b'{"unload_models":true,"free_memory":true}', headers={"Content-Type": "application/json"}), timeout=10):
                pass
            try:
                with opener.open("http://127.0.0.1:17374/health", timeout=2) as response:
                    if json.load(response).get("busy"):
                        raise RuntimeError("画布视频工具正在运行，请等待任务完成")
            except OSError:
                pass
            ffmpeg = ensure_ffmpeg()
            env = os.environ.copy()
            env["PATH"] = str(Path(ffmpeg).parent) + os.pathsep + env.get("PATH", "")
            env["PYTHONUTF8"] = "1"
            env["PYTHONIOENCODING"] = "utf-8"
            command = inference_command(job, raw_output)
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            with STATE_LOCK:
                PROCESS[job["id"]] = process
                if job.get("cancelRequested") and process.poll() is None:
                    process.terminate()
            log_tail = []
            with process.stdout, output.with_name("inference.log").open("w", encoding="utf-8") as log:
                for line in process.stdout:
                    log.write(line)
                    log.flush()
                    log_tail.append(line.strip())
                    log_tail = log_tail[-12:]
                    stage = inference_stage(line)
                    if stage and job["stage"] != stage:
                        job["stage"] = stage
                        save(job)
            check_cancel(job)
            if process.wait() != 0 or not raw_output.exists():
                raise RuntimeError("SeedVR2 执行失败：" + "\n".join(log_tail))
            check_cancel(job)
            job.update(stage="正在保存视频与音轨")
            save(job)
            probe = ROOT.parent / "video-suite" / "LosslessCut" / "resources" / "ffprobe.exe"
            duration = float(subprocess.check_output([str(probe), "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(raw_output)], timeout=30))
            # Bound padded audio to the actual generated video duration. Using
            # shortest alone can hang with copied video on the bundled FFmpeg.
            mux = subprocess.Popen([str(ffmpeg), "-y", "-i", str(raw_output), "-i", job["input"], "-map", "0:v:0", "-map", "1:a?", "-c:v", "copy", "-c:a", "aac", "-af", "apad", "-t", str(duration), str(output)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            with STATE_LOCK:
                PROCESS[job["id"]] = mux
                if job.get("cancelRequested"):
                    mux.terminate()
            try:
                _, mux_error = mux.communicate(timeout=max(120, duration * 2))
            except subprocess.TimeoutExpired:
                mux.kill()
                mux.communicate()
                raise RuntimeError("超分音轨合成超时")
            check_cancel(job)
            if mux.returncode != 0:
                raise RuntimeError("超分音轨合成失败：" + mux_error.decode("utf-8", errors="replace")[-2000:])
            with STATE_LOCK:
                check_cancel(job)
                job.update(status="complete", stage="视频超分完成", progress=100, progressIndeterminate=False, completedAt=time.time())
        except InterruptedError as error:
            job.update(status="cancelled", stage="视频超分已取消", error=str(error), completedAt=time.time())
        except Exception as error:
            detail = str(error)
            hint = "显存不足，请减少每批帧数或降低输出短边后重试" if "out of memory" in detail.lower() else detail if "请等待" in detail else "SeedVR2 视频超分失败，请重试；详情见本地任务日志"
            job.update(status="error", stage="视频超分失败", error=hint, diagnostic=detail, completedAt=time.time())
            # Preserve failed-job logs and inputs for troubleshooting.
        finally:
            with STATE_LOCK:
                PROCESS.pop(job["id"], None)
            save(job)


def ensure_ffmpeg():
    import imageio_ffmpeg
    source = Path(imageio_ffmpeg.get_ffmpeg_exe())
    target = ROOT / "tools" / "ffmpeg.exe"
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.stat().st_size != source.stat().st_size:
        shutil.copy2(source, target)
    return target


def cleanup_job(job_id):
    job = JOBS.pop(job_id, None)
    if not job:
        return
    job_dir = Path(job["input"]).resolve().parent
    if WORK.resolve() in job_dir.parents:
        shutil.rmtree(job_dir, ignore_errors=True)


def load_jobs():
    for path in WORK.glob("*/job.json"):
        try:
            job = json.loads(path.read_text(encoding="utf-8"))
            if job["status"] in ACTIVE:
                job.update(status="error", error="服务曾中断，请从原视频重新发起超分", completedAt=time.time())
                save(job)
            elif job["status"] == "complete" and not Path(job["result"]).exists():
                job.update(status="error", error="超分结果文件已丢失，请从原视频重新发起超分")
                save(job)
            JOBS[job["id"]] = job
        except (ValueError, KeyError, OSError):
            pass
    for result in WORK.glob("*/result.mp4"):
        job_id = result.parent.name
        if job_id in JOBS or not re.fullmatch(r"[0-9a-f]{32}", job_id) or result.stat().st_size == 0:
            continue
        try:
            check = subprocess.run([str(ensure_ffmpeg()), "-v", "error", "-i", str(result), "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"], capture_output=True)
            if check.returncode:
                continue
        except OSError:
            continue
        job = {"id": job_id, "status": "complete", "progress": 100, "createdAt": result.stat().st_mtime, "completedAt": result.stat().st_mtime, "input": str(result.parent / "input.mp4"), "result": str(result)}
        JOBS[job_id] = job
        save(job)


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    load_jobs()
    print(f"SeedVR2 canvas service: http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
