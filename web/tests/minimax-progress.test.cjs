const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const source = fs.readFileSync(process.env.COMFY_PROGRESS_SOURCE || path.join(__dirname, '../src/services/api/templates/comfyui-minimax-h3.js'), 'utf8');
const template = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/workflows/minimax-h3-local-api.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('prompt', 'images', 'videos', 'audios', 'baseUrl', 'params', 'signal', 'request', 'fetch', 'window', 'poll', 'http', 'onProgress', 'WebSocket', source);

async function harness(drive, options = {}) {
    const events = [], sockets = [], cancels = [], pollOptions = [];
    const controller = new AbortController();
    let promptId;
    class Socket extends EventTarget {
        constructor(url) {
            super(); this.url = url; this.readyState = 0; sockets.push(this);
            queueMicrotask(() => {
                if (options.abortConnecting) { controller.abort(); return; }
                this.readyState = 1; this.dispatchEvent(new Event('open'));
            });
        }
        close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
        send(type, data = {}, own = true) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type, data: { prompt_id: own ? promptId : 'foreign-task', ...data } }) })); }
    }
    const onProgress = (percent, detail) => events.push({ percent, ...detail });
    const mockFetch = async (url, init = {}) => {
        url = String(url);
        if (url.includes('/workflows/')) return { ok: true, json: async () => structuredClone(template) };
        if (url.endsWith('/cancel')) { cancels.push(url); return { ok: true }; }
        if (url.endsWith('/prompt')) {
            promptId = JSON.parse(init.body).prompt_id;
            options.onSubmit?.(sockets.at(-1), promptId);
            if (options.submitFails) return { ok: false, status: 400, text: async () => 'invalid workflow' };
            return { ok: true, json: async () => ({ prompt_id: promptId }) };
        }
        throw new Error('Unexpected fetch ' + url);
    };
    const request = async ({ url }) => {
        if (url.endsWith('/system_stats')) return {};
        if (url.includes('/view?')) return new Blob(['video']);
        throw new Error('Unexpected request ' + url);
    };
    let result, error;
    try {
        result = await run('isolated progress', [], [], [], 'http://canvas.test/api/comfyui',
            { seconds: 5, h3Mode: options.mode || 'te', h3SageAttention: false, h3TeSpeed: true, outputDimensions: { width: 480, height: 480 } },
            controller.signal, request, mockFetch, { location: { origin: 'http://canvas.test' } }, async (_request, _extract, settings) => {
                pollOptions.push(settings);
                await drive({ events, sockets, controller, promptId });
                if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                if (options.pollFails) throw new Error('backend execution failed');
                return { filename: 'isolated.mp4' };
            }, { url: value => value }, onProgress, options.noSocket ? undefined : Socket);
    } catch (e) { error = e; }
    return { events, sockets, controller, promptId, result, error, cancels, pollOptions };
}

test('step progress matches 2/20 and stays unchanged without a backend event', async () => {
    const r = await harness(async ({ events, sockets }) => {
        const socket = sockets[0];
        assert.ok(socket, 'real progress must subscribe to backend events');
        assert.match(socket.url, /^ws:\/\/canvas.test\/api\/comfyui\/ws\?clientId=/);
        socket.send('executing', { node: '125' });
        assert.match(events.at(-1).stage, /准备采样/);
        socket.send('progress', { node: '125', value: 2, max: 20 });
        assert.deepEqual(events.at(-1), { percent: 10, stage: '正在采样 2/20 步', indeterminate: false });
        const count = events.length;
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(events.length, count);
        socket.send('progress', { node: '125', value: 20, max: 20 });
        assert.equal(events.at(-1).percent, 100);
    });
    assert.ifError(r.error);
    assert.equal(r.pollOptions[0].timeoutMs, 10800000);
    assert.equal(r.sockets[0].readyState, 3);
});

test('model, conditioning, audio/video VAE and saving stages do not invent a percent', async () => {
    const r = await harness(({ events, sockets }) => {
        for (const [node, label] of [['127', '加载视频生成模型'], ['128', '加载文本编码模型'], ['119', '加载视频 VAE'], ['120', '加载音频 VAE'], ['136', '编码提示词与参考图片'], ['121', '解码音频 VAE'], ['122', '解码视频 VAE'], ['canvas_h3_output_size', '调整视频分辨率'], ['130', '合成视频与音频'], ['92', '编码并保存视频']]) {
            sockets[0].send('executing', { node });
            assert.equal(events.at(-1).stage, '正在' + label);
            assert.equal(events.at(-1).indeterminate, true);
        }
    });
    assert.ifError(r.error);
    assert.equal(r.events.at(-1).stage, '正在传回视频到画布');
});

test('foreign tasks, malformed frames and invalid progress never update the canvas', async () => {
    const r = await harness(({ events, sockets }) => {
        const socket = sockets[0], count = events.length;
        socket.send('progress', { node: '125', value: 18, max: 20 }, false);
        socket.send('executing', { node: '122' }, false);
        socket.send('progress', { node: '125', value: 2, max: 0 });
        socket.send('progress', { node: '125', value: '2', max: 20 });
        socket.send('progress', { node: 'unknown', value: 1, max: 2 });
        socket.dispatchEvent(new MessageEvent('message', { data: '{bad json' }));
        socket.dispatchEvent(new MessageEvent('message', { data: new Blob(['preview']) }));
        assert.equal(events.length, count);
    });
    assert.ifError(r.error);
});

test('events before POST acknowledgement are retained; Turbo uses its reported denominator', async () => {
    const r = await harness(({ events, sockets }) => {
        assert.ok(events.some(e => e.stage === '正在加载视频生成模型'));
        sockets[0].send('progress', { node: '125', value: 2, max: 8 });
        assert.equal(events.at(-1).percent, 25);
    }, { mode: 'turbo', onSubmit: socket => socket.send('executing', { node: '127' }) });
    assert.ifError(r.error);
});

test('connection loss is explicit, reconnect uses the same client, cleanup blocks late events', async () => {
    const r = await harness(async ({ events, sockets }) => {
        sockets[0].close();
        assert.match(events.at(-1).stage, /连接中断/);
        assert.equal(events.at(-1).indeterminate, true);
        await new Promise(resolve => setTimeout(resolve, 1600));
        assert.equal(sockets.length, 2);
        assert.equal(sockets[0].url, sockets[1].url);
        sockets[1].send('progress', { node: '125', value: 7, max: 20 });
        assert.equal(events.at(-1).percent, 35);
    });
    assert.ifError(r.error);
    const count = r.events.length;
    r.sockets[1].send('progress', { node: '125', value: 19, max: 20 });
    assert.equal(r.events.length, count);
    assert.ok(r.sockets.every(s => s.readyState === 3));
});

for (const failure of ['abort', 'pollFails', 'submitFails']) {
    test(`socket closes on ${failure} and cancellation remains task-scoped`, async () => {
        const r = await harness(({ sockets, controller }) => {
            sockets[0].send('progress', { node: '125', value: 2, max: 20 });
            if (failure === 'abort') controller.abort();
        }, { [failure]: true });
        assert.ok(r.error);
        assert.ok(r.sockets.every(s => s.readyState === 3));
        assert.equal(r.cancels.length, failure === 'submitFails' ? 0 : 1);
        if (failure !== 'submitFails') assert.ok(r.cancels[0].includes(r.promptId));
    });
}

test('unavailable WebSocket keeps generation working with explicit unknown progress', async () => {
    const r = await harness(({ events }) => {
        assert.match(events.at(-1).stage, /无法连接实时进度/);
        assert.equal(events.at(-1).indeterminate, true);
    }, { noSocket: true });
    assert.ifError(r.error);
});

test('aborting while connecting does not submit or cancel a nonexistent backend job', async () => {
    const r = await harness(() => assert.fail('must not poll'), { abortConnecting: true });
    assert.equal(r.error?.name, 'AbortError');
    assert.equal(r.promptId, undefined);
    assert.equal(r.cancels.length, 0);
    assert.equal(r.sockets[0].readyState, 3);
});
