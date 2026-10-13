"""Loopback-only lifecycle and memory guard for this installation of Ollama."""
import csv
import ctypes
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1] / "extras" / "Ollama"
MODEL = "qwen3:8b"
ORIGINS = {"http://localhost:3000", "http://127.0.0.1:3000"}
LOCK = threading.RLock()
PROCESS = None
LEASE = None
STARTED = 0
LAST_ERROR = ""
OPENER = build_opener(ProxyHandler({}))


class Memory(ctypes.Structure):
    _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
        (name, ctypes.c_ulonglong) for name in ("total", "available", "page_total", "page_available", "virtual_total", "virtual_available", "extended")
    ]


def memory_status():
    output = subprocess.check_output(
        ["nvidia-smi", "--id=0", "--query-gpu=memory.free,memory.total", "--format=csv,noheader,nounits"],
        timeout=5, creationflags=subprocess.CREATE_NO_WINDOW, text=True,
    )
    free, total = [int(value.strip()) for value in next(csv.reader(output.splitlines()))]
    memory = Memory()
    memory.length = ctypes.sizeof(memory)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
        raise RuntimeError("无法读取物理内存，已阻止加载模型")
    return {"gpuFreeMiB": free, "gpuTotalMiB": total, "ramFreeMiB": memory.available // 1024 ** 2}


def stop_owned():
    global PROCESS, LEASE
    if PROCESS is not None and PROCESS.poll() is None:
        stopped = subprocess.run(["taskkill", "/PID", str(PROCESS.pid), "/T", "/F"], capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        if stopped.returncode and PROCESS.poll() is None:
            raise RuntimeError("未能结束本地写作进程，请暂勿启动视频")
        PROCESS.wait(timeout=5)
    PROCESS = None
    LEASE = None


def start_owned():
    global PROCESS, LEASE, STARTED, LAST_ERROR
    if LEASE:
        raise RuntimeError("已有本地写作任务，请等待或停止原任务")
    with OPENER.open("http://127.0.0.1:8188/queue", timeout=5) as response:
        queue = json.load(response)
    if queue.get("queue_running") or queue.get("queue_pending"):
        raise RuntimeError("ComfyUI 正在生成，请等待任务完成后再写提示词")
    try:
        with OPENER.open("http://127.0.0.1:17372/health", timeout=2) as response:
            if json.load(response).get("busy"):
                raise RuntimeError("视频超分正在运行，请等待任务完成")
    except OSError:
        pass
    try:
        with OPENER.open("http://127.0.0.1:17374/health", timeout=2) as response:
            if json.load(response).get("busy"):
                raise RuntimeError("画布视频工具正在运行，请等待任务完成")
    except OSError:
        pass
    stats = memory_status()
    if stats["gpuFreeMiB"] < 8192 or stats["ramFreeMiB"] < 16384:
        raise RuntimeError(f'资源不足，已阻止加载：空闲显存 {stats["gpuFreeMiB"] / 1024:.1f} GB、内存 {stats["ramFreeMiB"] / 1024:.1f} GB，显存需至少 8 GB、内存需至少 16 GB')
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 11434)) == 0:
            raise RuntimeError("11434 已有其他 Ollama 服务，本功能不会接管或结束它，请先手动关闭")
    env = dict(os.environ, OLLAMA_HOST="127.0.0.1:11434", OLLAMA_MODELS=str(ROOT / "models"),
               OLLAMA_ORIGINS=",".join(sorted(ORIGINS)), OLLAMA_NO_CLOUD="1", OLLAMA_KEEP_ALIVE="0",
               OLLAMA_NUM_PARALLEL="1", OLLAMA_MAX_LOADED_MODELS="1", OLLAMA_FLASH_ATTENTION="1",
               OLLAMA_KV_CACHE_TYPE="q8_0", OLLAMA_LOAD_TIMEOUT="120s", CUDA_VISIBLE_DEVICES="0")
    with (ROOT / "server.log").open("ab") as out, (ROOT / "server-error.log").open("ab") as err:
        PROCESS = subprocess.Popen([str(ROOT / "runtime" / "ollama.exe"), "serve"], cwd=ROOT, env=env,
                                   stdout=out, stderr=err, creationflags=subprocess.CREATE_NO_WINDOW)
    LEASE = secrets.token_hex(16)
    STARTED = time.monotonic()
    LAST_ERROR = ""
    try:
        for _ in range(40):
            if PROCESS.poll() is not None:
                raise RuntimeError("Ollama 启动失败，请检查本地日志")
            try:
                with OPENER.open("http://127.0.0.1:11434/api/tags", timeout=1) as response:
                    models = json.load(response)["models"]
                if not any(model["name"] == MODEL for model in models):
                    raise RuntimeError("尚未安装 Qwen3 8B 模型")
                return {"lease": LEASE, **stats}
            except OSError:
                time.sleep(0.25)
        raise RuntimeError("Ollama 启动超时")
    except Exception:
        stop_owned()
        raise


def watchdog():
    global LAST_ERROR
    while True:
        time.sleep(3)
        with LOCK:
            if not LEASE:
                continue
            try:
                stats = memory_status()
                if stats["gpuFreeMiB"] < 2048 or stats["ramFreeMiB"] < 6144 or time.monotonic() - STARTED > 600:
                    LAST_ERROR = "资源余量过低或任务超过 10 分钟，保护服务已停止本地模型"
                    stop_owned()
            except Exception:
                LAST_ERROR = "显存监控不可用，保护服务已停止本地模型"
                stop_owned()


class Handler(BaseHTTPRequestHandler):
    def allowed(self):
        return self.headers.get("Host") in {"127.0.0.1:17373", "localhost:17373"} and self.headers.get("Origin") in ORIGINS

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        if self.headers.get("Origin") in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        self.reply(200 if self.allowed() else 403, {})

    def do_GET(self):
        if not self.allowed():
            return self.reply(403, {"error": "仅允许本机画布访问"})
        try:
            if self.path != "/status":
                return self.reply(404, {})
            manifest = ROOT / "models" / "manifests" / "registry.ollama.ai" / "library" / "qwen3" / "8b"
            self.reply(200, {"installed": manifest.is_file(), "running": bool(LEASE), "error": LAST_ERROR, **memory_status()})
        except Exception as error:
            self.reply(503, {"error": str(error)})

    def do_POST(self):
        if not self.allowed() or self.headers.get_content_type() != "application/json":
            return self.reply(403, {"error": "仅允许本机画布 JSON 请求"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 1024:
                return self.reply(400, {"error": "请求大小无效"})
            payload = json.loads(self.rfile.read(length))
            with LOCK:
                if self.path == "/start":
                    return self.reply(200, start_owned())
                if self.path == "/stop":
                    if LEASE and not secrets.compare_digest(str(payload.get("lease", "")), LEASE):
                        return self.reply(409, {"error": "不是当前写作任务，拒绝结束其他任务"})
                    stop_owned()
                    return self.reply(200, {"stopped": True, "error": LAST_ERROR})
                self.reply(404, {})
        except Exception as error:
            self.reply(409, {"error": str(error)})

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    threading.Thread(target=watchdog, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", 17373), Handler).serve_forever()
