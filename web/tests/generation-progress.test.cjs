const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, globals, dependencies = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src/services/api', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
        id => {
            if (!(id in dependencies)) throw new Error(`Unmocked import: ${id}`);
            return dependencies[id];
        }, module, module.exports, ...Object.values(globals),
    );
    return module.exports;
}

test('ComfyUI image upscale reports only its own task events and never a timed percentage', async () => {
    const events = [];
    let socket;
    class Socket extends EventTarget {
        constructor() {
            super();
            socket = this;
            this.readyState = 0;
            queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
        }
        close() { this.readyState = 3; }
        send(type, data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type, data }) })); }
    }
    const fetch = async url => {
        const route = String(url);
        if (route === 'blob:source') return { ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) };
        if (route.endsWith('/upload/image')) return { ok: true, text: async () => JSON.stringify({ name: 'source.png' }) };
        if (route.endsWith('/prompt')) {
            socket.send('progress', { prompt_id: 'another-task', node: '3', value: 9, max: 10 });
            socket.send('executing', { prompt_id: 'own-task', node: '2' });
            return { ok: true, text: async () => JSON.stringify({ prompt_id: 'own-task' }) };
        }
        if (route.endsWith('/history/own-task')) {
            socket.send('progress', { prompt_id: 'own-task', node: '3', value: 2, max: 8 });
            return { ok: true, text: async () => JSON.stringify({ 'own-task': { outputs: { '4': { images: [{ filename: 'result.png' }] } } } }) };
        }
        if (route.includes('/view?')) return { ok: true, blob: async () => new Blob(['result']) };
        throw new Error(`Unexpected request: ${route}`);
    };
    const api = load('comfy-image-upscale.ts', { fetch, WebSocket: Socket, crypto: { randomUUID: () => 'client-1' } }, { './local-prompt': { checkLocalGpuIdle: async () => {} } });
    const result = await api.requestComfyImageUpscale('blob:source', 'http://canvas.test/api/comfyui', 'model.pth', (percent, detail) => events.push({ percent, ...detail }));
    assert.equal(await result.text(), 'result');
    assert.ok(events.some(event => event.stage === '正在加载超分模型' && event.indeterminate));
    assert.deepEqual(events.find(event => !event.indeterminate), { percent: 25, stage: '正在执行图片超分 2/8', indeterminate: false });
    assert.equal(events.filter(event => !event.indeterminate).length, 1);
    assert.equal(socket.readyState, 3);
});

test('ComfyUI image upscale keeps polling when live progress is unavailable', async () => {
    const events = [];
    const fetch = async url => {
        const route = String(url);
        if (route === 'blob:source') return { ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) };
        if (route.endsWith('/upload/image')) return { ok: true, text: async () => JSON.stringify({ name: 'source.png' }) };
        if (route.endsWith('/prompt')) return { ok: true, text: async () => JSON.stringify({ prompt_id: 'own-task' }) };
        if (route.endsWith('/history/own-task')) return { ok: true, text: async () => JSON.stringify({ 'own-task': { outputs: { '4': { images: [{ filename: 'result.png' }] } } } }) };
        if (route.includes('/view?')) return { ok: true, blob: async () => new Blob(['result']) };
        throw new Error(`Unexpected request: ${route}`);
    };
    const api = load('comfy-image-upscale.ts', { fetch, WebSocket: undefined, crypto: { randomUUID: () => 'client-1' } }, { './local-prompt': { checkLocalGpuIdle: async () => {} } });
    await api.requestComfyImageUpscale('blob:source', 'http://canvas.test/api/comfyui', 'model.pth', (percent, detail) => events.push({ percent, ...detail }));
    assert.ok(events.some(event => event.stage === '已提交，正在等待后台执行'));
    assert.ok(events.every(event => event.indeterminate));
});

test('SeedVR2 distinguishes queue, model output progress, and result retrieval', async () => {
    const events = [];
    const states = [
        { status: 'queued', progress: 1 },
        { status: 'running', progress: 3 },
        { status: 'running', progress: 47 },
        { status: 'complete', progress: 100 },
    ];
    const fetch = async url => {
        const route = String(url);
        if (route === 'blob:video') return { ok: true, blob: async () => new Blob(['source'], { type: 'video/mp4' }) };
        if (route.includes('/jobs?')) return { ok: true, json: async () => ({ id: 'seed-job' }) };
        if (route.endsWith('/jobs/seed-job')) return { ok: true, json: async () => states.shift() };
        if (route.endsWith('/jobs/seed-job/result')) return { ok: true, blob: async () => new Blob(['result']) };
        throw new Error(`Unexpected request: ${route}`);
    };
    const api = load('seedvr2-video.ts', { fetch, setTimeout: fn => queueMicrotask(fn) }, { './local-prompt': { checkLocalGpuIdle: async () => {} } });
    const result = await api.requestSeedVr2Video('blob:video', 1080, (percent, detail) => events.push({ percent, ...detail }), { jobId: 'seed-job' });
    assert.equal(await result.text(), 'result');
    assert.ok(events.some(event => event.stage.includes('排队') && event.indeterminate));
    assert.deepEqual(events.find(event => !event.indeterminate), { percent: 47, stage: 'SeedVR2 模型处理进度', indeterminate: false });
    assert.ok(events.at(-1).stage.includes('读取超分结果'));
});

test('SeedVR2 recovery fetches only the saved task, and cancel targets only its ID', async () => {
    const requests = [];
    const fetch = async (url, options = {}) => {
        const route = String(url);
        requests.push({ route, method: options.method || 'GET' });
        if (route.endsWith('/jobs/saved-task')) return { ok: true, json: async () => ({ status: 'complete', progress: 100 }) };
        if (route.endsWith('/jobs/saved-task/result')) return { ok: true, blob: async () => new Blob(['saved-result']) };
        if (route.endsWith('/jobs/saved-task/cancel')) return { ok: true, json: async () => ({ status: 'cancelled' }) };
        throw new Error(`Unexpected request: ${route}`);
    };
    const api = load('seedvr2-video.ts', { fetch, setTimeout: fn => queueMicrotask(fn) }, { './local-prompt': { checkLocalGpuIdle: async () => { throw new Error('Recovery must not check GPU'); } } });
    assert.equal(await (await api.waitSeedVr2Video('saved-task')).text(), 'saved-result');
    await api.cancelSeedVr2Video('saved-task');
    assert.deepEqual(requests.map(request => request.method), ['GET', 'GET', 'POST']);
    assert.ok(requests.every(request => request.route.includes('/jobs/saved-task')));
});

test('SeedVR2 missing recovery task points back to the original video', async () => {
    const fetch = async () => ({ status: 404, ok: false, json: async () => ({ error: '任务不存在' }) });
    const api = load('seedvr2-video.ts', { fetch }, { './local-prompt': { checkLocalGpuIdle: async () => {} } });
    await assert.rejects(api.waitSeedVr2Video('missing-task'), /从原视频重新发起超分/);
});
