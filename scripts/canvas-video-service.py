"""Local canvas video jobs. Inputs/results stay in an isolated directory."""
import json
import math
import shutil
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, ProxyHandler, build_opener
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[1]
SUITE = ROOT / 'extras/video-suite'
WORK = SUITE / 'canvas-jobs'
ASSETS = SUITE / 'ComfyUI/input/h3_refs/canvas'
FF = SUITE / 'LosslessCut/resources/ffmpeg.exe'
FP = SUITE / 'LosslessCut/resources/ffprobe.exe'
V2 = SUITE / 'Video2X/video2x.exe'
COMFY = 'http://127.0.0.1:8188'
OPENER = build_opener(ProxyHandler({}))
JOBS = {}
LOCK = threading.RLock()
PROCESS = {}
ACTIVE = {'queued', 'running', 'cancelling'}
OPERATIONS = {'continuum', 'handtie', 'interpolate', 'upscale', 'trim', 'audio'}


def api(path, data=None):
    req = Request(COMFY + path, data=None if data is None else json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    with OPENER.open(req, timeout=30) as response:
        body = response.read()
        return json.loads(body) if body else {}


def save(job):
    p = WORK / job['id'] / 'job.json'
    temp = p.with_suffix('.tmp')
    with LOCK:
        temp.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding='utf-8')
        temp.replace(p)


def asset(asset_id):
    if not isinstance(asset_id, str) or len(asset_id) != 32 or any(c not in '0123456789abcdef' for c in asset_id):
        raise ValueError('无效素材编号')
    files = list(ASSETS.glob(asset_id + '.*'))
    if len(files) != 1:
        raise ValueError('素材不存在，请重新上传')
    return files[0]


def probe(path):
    try:
        return json.loads(subprocess.check_output([str(FP), '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)], stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW))
    except (subprocess.CalledProcessError, ValueError) as error:
        raise ValueError('视频无法读取，请检查文件是否完整或换一个视频') from error


def duration(meta):
    return float(meta.get('format', {}).get('duration', 0))


def check_cancel(job):
    if job.get('cancelRequested'):
        raise InterruptedError('任务已取消，缓存和原素材保留')


def command(job, args, allow_failure=False):
    check_cancel(job)
    with (WORK / job['id'] / 'process.log').open('ab') as log:
        child = subprocess.Popen([str(a) for a in args], stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        PROCESS[job['id']] = child
        try:
            while child.poll() is None:
                if job.get('cancelRequested'):
                    child.terminate()
                    child.wait()
                    check_cancel(job)
                time.sleep(.2)
            code = child.returncode
        finally:
            PROCESS.pop(job['id'], None)
    if code and not allow_failure:
        tail = (WORK / job['id'] / 'process.log').read_bytes()[-1800:].decode('utf-8', 'replace')
        raise RuntimeError('视频处理失败：' + tail)
    return code


def gpu_idle():
    q = api('/queue')
    if not isinstance(q, dict) or not all(isinstance(q.get(key), list) for key in ['queue_running', 'queue_pending']):
        raise ValueError('无法确认 H3 任务状态，请检查服务后重试')
    if q.get('queue_running') or q.get('queue_pending'):
        raise ValueError('H3 已有生成任务，请完成后再提交视频工具任务')
    for port, endpoint, key, label in [(8189, 'queue', None, '千问'), (17372, 'health', 'busy', 'SeedVR2'), (17373, 'status', 'running', '提示词服务')]:
        try:
            req = Request(f'http://127.0.0.1:{port}/{endpoint}', headers={'Origin': 'http://localhost:3000'})
            with OPENER.open(req, timeout=3) as response:
                state = json.load(response)
        except (OSError, ValueError) as error:
            # A service that is not listening is idle; timeout/HTTP/invalid JSON is unknown.
            reason = error.reason if isinstance(error, URLError) else error
            if isinstance(reason, ConnectionRefusedError):
                continue
            raise ValueError(f'无法确认{label}任务状态，请检查服务后重试') from error
        if not isinstance(state, dict):
            raise ValueError(f'无法确认{label}任务状态，请检查服务后重试')
        if key is None:
            if not all(isinstance(state.get(k), list) for k in ['queue_running', 'queue_pending']):
                raise ValueError(f'无法确认{label}任务状态，请检查服务后重试')
            busy = bool(state['queue_running'] or state['queue_pending'])
        else:
            if not isinstance(state.get(key), bool):
                raise ValueError(f'无法确认{label}任务状态，请检查服务后重试')
            busy = state[key]
        if busy:
            raise ValueError(f'{label}已有任务运行或排队，请完成后再提交视频工具任务')


def bounded(value, low, high, name):
    value = float(value)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{name}必须在 {low}–{high} 之间')
    return value


def validate(p):
    if p.get('operation') not in OPERATIONS:
        raise ValueError('未知操作')
    if not str(p.get('projectId', '')).strip():
        raise ValueError('缺少画布项目')
    for key in ['source', 'firstImage', 'audio', 'voice']:
        if p.get(key):
            asset(p[key])
    if len(p.get('references', [])) > 3:
        raise ValueError('最多三张角色参考图')
    for item in p.get('references', []):
        asset(item)
    if p['operation'] in {'continuum', 'handtie'}:
        if not str(p.get('prompt', '')).strip() or len(p['prompt']) > 16000:
            raise ValueError('请填写 1–16000 字的分段描述')
        bounded(p.get('chunks', 2), 1, 8, '段数')
        if p.get('seconds', 5) not in [5, 8, 10, 15]:
            raise ValueError('不支持该分段时长')
        if p.get('resolution', 480) not in [480, 720, 1080] or p.get('orientation', 'landscape') not in ['landscape', 'portrait']:
            raise ValueError('不支持的尺寸')
    elif not p.get('source'):
        raise ValueError('请先选择视频')
    if p.get('source'):
        source = asset(p['source'])
        meta = probe(source)
        if not any(stream.get('codec_type') == 'video' for stream in meta.get('streams', [])):
            raise ValueError('文件中没有可用的视频画面，请换一个视频')
        check = subprocess.run([str(FF), '-v', 'error', '-i', str(source), '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        if check.returncode:
            raise ValueError('视频画面无法解码，请检查文件是否完整或换一个视频')
    if p['operation'] == 'audio' and p.get('audioMode') != 'mute' and not p.get('audio'):
        raise ValueError('请选择音轨')
    if p['operation'] == 'trim':
        start = bounded(p.get('start', 0), 0, 86400, '起点')
        end = bounded(p.get('end', 0), 0, 86400, '终点')
        if end <= start:
            raise ValueError('终点必须晚于起点')


def build_graph(job):
    p = job['params']
    name = '03-H3-Continuum-续生成' if p['operation'] == 'continuum' else '04-H3-HandTie-角色音轨串联'
    g = json.loads((SUITE / 'workflows' / (name + '.api.json')).read_text(encoding='utf-8'))
    short = p.get('resolution', 480)
    width, height = {480: (854, 480), 720: (1280, 720), 1080: (1920, 1080)}[short]
    if p.get('orientation') == 'portrait':
        width, height = height, width
    g['canvas_output_size']['inputs'].update(width=width, height=height)
    g['92']['inputs']['filename_prefix'] = 'canvas-tools/' + job['id']
    def load(key, kind, input_key):
        file = asset(p[key]).relative_to(SUITE / 'ComfyUI/input').as_posix()
        g[key] = {'class_type': kind, 'inputs': {input_key: file}}
        return [key, 0]
    if p['operation'] == 'continuum':
        n = g['continuum']['inputs']
        g['138']['inputs']['value'] = p['prompt']
        # 1080p is an export size; cap internal generation at 720p on this 16GB GPU.
        internal_w, internal_h = (width, height) if short <= 720 else ((1280, 720) if width > height else (720, 1280))
        n.update(chunks=int(p.get('chunks', 2)), chunk_seconds=p.get('seconds', 5), width=math.ceil(internal_w / 32)*32,
                 height=math.ceil(internal_h / 32)*32, base_seed=p['seed'], run_name=job['runName'],
                 generation_mode='Review Each Chunk' if p.get('review', True) else 'Full Run',
                 review_action=p.get('reviewAction', 'Continue / Next'))
        if p.get('firstImage'):
            n['first_frame'] = load('firstImage', 'LoadImage', 'image')
        if p.get('audio'):
            n['driving_audio'] = load('audio', 'LoadAudio', 'audio')
        if p.get('references'):
            g['127']['inputs']['unet_name'] = 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'
            g['turbo']['inputs']['lora_name'] = 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors'
            g['shift']['inputs']['shift_video'] = 12
            g['124']['inputs']['steps'] = 4
            for i, ref in enumerate(p['references']):
                k = 'ref' + str(i)
                g[k] = {'class_type': 'LoadImage', 'inputs': {'image': asset(ref).relative_to(SUITE / 'ComfyUI/input').as_posix()}}
                n['reference_image_' + str(i+1)] = [k, 0]
    else:
        n = g['hand']['inputs']
        n.update(prompt=p['prompt'], chains=str(p.get('chunks', 2)), duration=str(p.get('seconds', 5)) + ' s', seed=p['seed'],
                 aspect='9:16 portrait' if p.get('orientation') == 'portrait' else '16:9 landscape',
                 resolution='448p (0.34 MP)' if short == 480 else '640p (0.70 MP)', pin_mech='motion_context', hop_script='next')
        for key, target in [('firstImage', 'start_image_file'), ('audio', 'master_audio_file'), ('voice', 'voice_file'), ('source', 'reference_video_file')]:
            if p.get(key):
                n[target] = 'canvas/' + asset(p[key]).name
        n['ref_plan'] = json.dumps({'refs': [{'tag': 'role' + str(i+1), 'file': 'canvas/' + asset(ref).name, 'subject': i+1, 'retention': 'fully_preserved'} for i, ref in enumerate(p.get('references', []))]})
    return g


def run_comfy(job):
    g = build_graph(job)
    (WORK / job['id'] / 'workflow.api.json').write_text(json.dumps(g, ensure_ascii=False, indent=2), encoding='utf-8')
    check_cancel(job)
    result = api('/prompt', {'prompt': g, 'client_id': 'canvas-tools-' + job['id']})
    job['promptId'] = result['prompt_id']
    save(job)
    job['stage'] = 'H3 正在生成；首次加载参考模型可能需要数分钟'
    missing_checks = 0
    while True:
        if job.get('cancelRequested'):
            q = api('/queue')
            if any(row[1] == job['promptId'] for row in q.get('queue_running', [])):
                api('/interrupt', {'prompt_id': job['promptId']})
            api('/queue', {'delete': [job['promptId']]})
            # Wait for this prompt to release the GPU before exposing the service as idle.
            while any(row[1] == job['promptId'] for row in api('/queue').get('queue_running', [])):
                time.sleep(1)
            check_cancel(job)
        history = api('/history/' + job['promptId']).get(job['promptId'])
        if not history:
            queue = api('/queue')
            if not isinstance(queue, dict) or not all(isinstance(queue.get(key), list) for key in ['queue_running', 'queue_pending']):
                raise RuntimeError(f"无法确认 H3 状态，已保留任务编号 {job['promptId']}，请检查服务后取回")
            active = any(len(row) > 1 and row[1] == job['promptId'] for row in queue['queue_running'] + queue['queue_pending'])
            missing_checks = 0 if active else missing_checks + 1
            if missing_checks >= 3:
                # Completion can move from queue to history between the two reads.
                history = api('/history/' + job['promptId']).get(job['promptId'])
                if not history:
                    raise RuntimeError(f"后台未找到原任务 {job['promptId']}，请检查 H3 是否曾重启；确认后再重试")
        if history:
            (WORK / job['id'] / 'comfy-result.json').write_text(json.dumps(history, ensure_ascii=False), encoding='utf-8')
            if history['status']['status_str'] != 'success':
                errors = [x[1].get('exception_message', '') for x in history['status'].get('messages', []) if x[0] == 'execution_error']
                raise RuntimeError('H3 生成失败：' + ('; '.join(errors) or history['status']['status_str']))
            media = history.get('outputs', {}).get('92', {}).get('images', [])
            if not media:
                raise RuntimeError('H3 本轮未返回视频；请查看本地任务日志')
            with OPENER.open(COMFY + '/view?' + urlencode(media[0]), timeout=120) as response, Path(job['result']).open('wb') as output:
                shutil.copyfileobj(response, output)
            break
        time.sleep(2)


def run_video2x(job, source):
    p = job['params']; folder = WORK / job['id']
    meta = probe(source); v = next(s for s in meta['streams'] if s['codec_type'] == 'video')
    a, b = v['avg_frame_rate'].split('/'); fps = float(a) / float(b); secs = duration(meta)
    if not 0 < fps <= 240 or secs <= 0:
        raise ValueError('无法识别视频时长或帧率')
    padded = folder / 'padded.mp4'; raw = folder / 'processed.mp4'
    job['stage'] = '准备视频，补足末尾帧'; job['progress'] = 10
    command(job, [FF, '-v', 'error', '-i', source, '-vf', f'fps={a}/{b},tpad=stop_mode=clone:stop_duration=0.5', '-an', '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', padded])
    interpolate = p['operation'] == 'interpolate'
    args = ['-p', 'rife', '-m', '2', '--rife-model', 'rife-v4.6'] if interpolate else ['-p', 'realesrgan', '-s', '2' if p.get('anime') else '4', '--realesrgan-model', 'realesr-animevideov3' if p.get('anime') else 'realesrgan-plus']
    job['stage'] = '正在补帧（2 倍帧率）' if interpolate else '正在放大（2 倍尺寸）'; job['progress'] = 25
    code = command(job, [V2, '-i', padded, '-o', raw, *args, '-d', '0', '--no-progress', '--log-level', 'error'], True)
    if not raw.exists() or raw.stat().st_size == 0:
        raise RuntimeError('Video2X 未输出视频：' + (folder/'process.log').read_bytes()[-1200:].decode('utf-8', 'replace'))
    if duration(probe(raw)) + .02 < secs:
        raise RuntimeError('输出时长不足，已保留缓存')
    command(job, [FF, '-v', 'error', '-xerror', '-i', raw, '-f', 'null', '-'])
    if code:
        job['video2xExitCode'] = code
    job['stage'] = '恢复原时长与音轨'; job['progress'] = 90
    resize = [] if interpolate else ['-vf', f"scale={v['width']*2}:{v['height']*2}:flags=lanczos"]
    command(job, [FF, '-v', 'error', '-i', raw, '-i', source, '-map', '0:v:0', '-map', '1:a?', '-t', secs, '-frames:v', round(secs*fps*(2 if interpolate else 1)), *resize, '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-c:a', 'aac', '-b:a', '192k', job['result']])


def run_edit(job, source):
    p = job['params']; out = job['result']; secs = duration(probe(source))
    if p['operation'] == 'trim':
        if p['end'] > secs + .1:
            raise ValueError(f'终点超过视频长度（{secs:.2f} 秒）')
        job['stage'] = '正在剪切视频'; job['progress'] = 30
        if p.get('cutMode') == 'lossless':
            command(job, [FF, '-v', 'error', '-ss', p['start'], '-i', source, '-t', p['end']-p['start'], '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', out])
            job['notice'] = '无损剪切起点对齐关键帧，实际起止时间可能偏移。'
        else:
            command(job, [FF, '-v', 'error', '-i', source, '-ss', p['start'], '-t', p['end']-p['start'], '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-c:a', 'aac', out])
    else:
        job['stage'] = '正在整理音轨'; job['progress'] = 30
        mode = p.get('audioMode', 'replace')
        if mode == 'mute':
            command(job, [FF, '-v', 'error', '-i', source, '-map', '0:v:0', '-c:v', 'copy', '-an', out])
        else:
            audio = asset(p['audio']); gain = bounded(p.get('gain', -6), -40, 12, '音轨音量')
            has_audio = any(s['codec_type'] == 'audio' for s in probe(source)['streams'])
            filt = f'[1:a:0]volume={gain}dB,apad[bed]'
            if mode == 'mix' and has_audio:
                filt += ';[0:a:0][bed]amix=inputs=2:duration=first:normalize=0,alimiter=level=false[a]'
            else:
                filt += ';[bed]anull[a]'
            command(job, [FF, '-v', 'error', '-i', source, '-i', audio, '-filter_complex', filt, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', secs, out])


def run_job(job):
    try:
        job.update(status='running', stage='准备本地任务', progress=3); save(job)
        p = job['params']
        if p['operation'] in {'continuum', 'handtie', 'interpolate', 'upscale'}:
            gpu_idle()
            check_cancel(job)
        if p['operation'] in {'continuum', 'handtie'}:
            run_comfy(job)
        elif p['operation'] in {'interpolate', 'upscale'}:
            api('/free', {'unload_models': True, 'free_memory': True})
            run_video2x(job, asset(p['source']))
        else:
            run_edit(job, asset(p['source']))
        check_cancel(job)
        job['stage'] = '检查成片'; job['progress'] = 97
        meta = probe(job['result'])
        command(job, [FF, '-v', 'error', '-xerror', '-i', job['result'], '-f', 'null', '-'])
        job.update(status='complete', progress=100, stage='已完成', media=meta)
    except InterruptedError as error:
        job.update(status='cancelled', stage=str(error))
    except Exception as error:
        job.update(status='error', error=str(error), stage='任务失败，输入和缓存已保留')
    finally:
        job['finishedAt'] = time.time(); save(job)


class Handler(BaseHTTPRequestHandler):
    def allowed(self):
        origin = self.headers.get('Origin')
        host = urlparse(origin or '').hostname
        return not origin or (host in {'localhost', '127.0.0.1', '::1'} and urlparse(origin).scheme == 'http')

    def headers_out(self, code, content_type, length):
        self.send_response(code)
        origin = self.headers.get('Origin')
        if origin and self.allowed():
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(length))
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def reply(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.headers_out(code, 'application/json; charset=utf-8', len(body))
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.allowed():
            return self.reply(403, {'error': '仅允许本机画布访问'})
        self.headers_out(204, 'text/plain', 0)

    def do_GET(self):
        if not self.allowed():
            return self.reply(403, {'error': '仅允许本机画布访问'})
        parts = urlparse(self.path).path.strip('/').split('/')
        if parts == ['health']:
            return self.reply(200, {'ready': True, 'busy': any(j['status'] in ACTIVE for j in JOBS.values())})
        if parts == ['jobs']:
            project = parse_qs(urlparse(self.path).query).get('projectId', [''])[0]
            return self.reply(200, [self.public(j) for j in sorted(JOBS.values(), key=lambda x: x['createdAt'], reverse=True) if j['params']['projectId'] == project][:100])
        job = JOBS.get(parts[1]) if len(parts) >= 2 and parts[0] == 'jobs' else None
        if not job:
            return self.reply(404, {'error': '任务不存在'})
        if len(parts) == 3 and parts[2] == 'result':
            if job['status'] != 'complete':
                return self.reply(409, {'error': '视频尚未完成'})
            p = Path(job['result']); self.headers_out(200, 'video/mp4', p.stat().st_size)
            with p.open('rb') as f:
                shutil.copyfileobj(f, self.wfile)
            return
        return self.reply(200, self.public(job))

    def public(self, job):
        data = {k: v for k, v in job.items() if k not in {'result', 'workflow', 'video2xExitCode'}}
        if job.get('status') == 'complete' and data.get('notice') == 'Video2X 保存后退出异常，但输出已通过完整解码与时长校验。':
            data.pop('notice')
        return data

    def do_POST(self):
        if not self.allowed():
            return self.reply(403, {'error': '仅允许本机画布访问'})
        try:
            path = urlparse(self.path).path
            length = int(self.headers.get('Content-Length', 0))
            if path == '/assets':
                if not 0 < length <= 2*1024**3 or shutil.disk_usage(ASSETS).free < length + 2*1024**3:
                    raise ValueError('素材需小于 2GB，且磁盘需留足空间')
                name = parse_qs(urlparse(self.path).query).get('name', ['input.mp4'])[0]
                suffix = Path(name).suffix.lower()
                if suffix not in {'.mp4', '.webm', '.mov', '.mkv', '.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3', '.m4a', '.flac', '.ogg'}:
                    raise ValueError('不支持该素材格式')
                asset_id = uuid.uuid4().hex; target = ASSETS / (asset_id + suffix)
                with target.open('xb') as f:
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(1024*1024, remaining))
                        if not chunk:
                            raise ValueError('素材上传中断，请重试')
                        f.write(chunk); remaining -= len(chunk)
                return self.reply(201, {'id': asset_id, 'name': name, 'bytes': length})
            if length > 128*1024:
                raise ValueError('请求过大')
            data = json.loads(self.rfile.read(length) or b'{}')
            if path.endswith('/cancel'):
                job = JOBS.get(path.split('/')[2])
                if not job:
                    raise ValueError('任务不存在')
                if job['status'] in ACTIVE:
                    job.update(cancelRequested=True, status='cancelling', stage='正在停止本次任务'); save(job)
                return self.reply(200, self.public(job))
            if path != '/jobs':
                return self.reply(404, {'error': '接口不存在'})
            with LOCK:
                if any(j['status'] in ACTIVE for j in JOBS.values()):
                    return self.reply(409, {'error': '视频工具已有任务运行，请完成或取消后再提交'})
                if data.get('resumeFrom'):
                    previous = JOBS.get(data['resumeFrom'])
                    if not previous or previous['params']['projectId'] != data.get('projectId'):
                        raise ValueError('无法找到本画布的续接任务')
                    params = dict(previous['params'])
                    params['reviewAction'] = data.get('reviewAction', 'Continue / Next')
                    run_name = previous['runName']
                else:
                    params = data; params['seed'] = int(data.get('seed') or int(time.time()*1000) % 2**32)
                    run_name = 'canvas-' + uuid.uuid4().hex
                validate(params)
                job_id = uuid.uuid4().hex; folder = WORK / job_id; folder.mkdir()
                job = {'id': job_id, 'params': params, 'runName': run_name, 'status': 'queued', 'progress': 0, 'stage': '等待启动', 'createdAt': time.time(), 'result': str(folder/'result.mp4')}
                JOBS[job_id] = job; save(job)
                threading.Thread(target=run_job, args=(job,), daemon=True).start()
            self.reply(202, self.public(job))
        except Exception as error:
            self.reply(400, {'error': str(error)})

    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    WORK.mkdir(exist_ok=True); ASSETS.mkdir(parents=True, exist_ok=True)
    for p in WORK.glob('*/job.json'):
        try:
            job = json.loads(p.read_text(encoding='utf-8'))
            if job['status'] in ACTIVE:
                job.update(status='error', error='服务曾中断，可使用任务记录重试或恢复')
            JOBS[job['id']] = job
        except (ValueError, KeyError):
            pass
    print('Canvas video tools: http://127.0.0.1:17374', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 17374), Handler).serve_forever()
