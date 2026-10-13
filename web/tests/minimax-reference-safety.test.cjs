const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/services/api/templates/comfyui-minimax-h3.js'), 'utf8');
const template = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/workflows/minimax-h3-local-api.json'), 'utf8'));
const run = new (Object.getPrototypeOf(async function() {}).constructor)('prompt', 'images', 'videos', 'audios', 'baseUrl', 'params', 'signal', 'request', 'fetch', 'window', 'poll', 'http', source);

async function scenario(options = {}) {
    let workflow, id, checkpoint, polls = 0, histories = 0;
    const calls = [], controller = new AbortController();
    const output = () => ({ [id]: { status: { completed: true }, outputs: { '92': { videos: [{ filename: 'out.mp4' }] } } } });
    const request = async ({ url }) => {
        calls.push(url);
        if (url.endsWith('/system_stats')) return {};
        if (url.includes('/object_info/')) return options.oldBackend ? {} : { CanvasH3ReferenceVideo: { input: {} } };
        if (url.endsWith('/upload/image')) return { subfolder: 'infinite-canvas', name: `ref${calls.length}.mp4` };
        if (url.includes('/history/')) {
            histories++;
            if (options.offline) throw new Error('connection refused');
            if (options.completeAfterHistory && histories >= options.completeAfterHistory) return output();
            return options.missing || options.queued ? {} : output();
        }
        if (url.endsWith('/queue')) {
            if (options.badQueue) return {};
            return { queue_running: [], queue_pending: options.queued ? [[1, id]] : [] };
        }
        if (url.includes('/view?')) return new Blob(['video']);
        throw new Error(url);
    };
    const fetch = async (url, init = {}) => {
        calls.push(String(url));
        if (String(url).includes('/workflows/')) return { ok: true, json: async () => structuredClone(template) };
        if (String(url).endsWith('/prompt')) { const body = JSON.parse(init.body); workflow = body.prompt; id = body.prompt_id; return { ok: true, json: async () => ({ prompt_id: id }) }; }
        if (String(url).endsWith('/cancel')) return { ok: true };
        throw new Error(String(url));
    };
    const poll = async (request, extract) => {
        for (polls = 1; polls <= 6; polls++) {
            const result = extract(await request());
            if (result) return result;
        }
        throw new Error('test limit: task kept waiting');
    };
    let result, error;
    try {
        result = await run('test', [], (options.durations || []).map(durationMs => ({ name: 'ref.mp4', durationMs, blob: new Blob(['ref']) })), [], 'http://comfy.test',
            { seconds: 5, h3Mode: 'turbo', h3SageAttention: false, outputDimensions: { width: 854, height: 480 }, onTaskSubmitted: task => { checkpoint = task; } },
            controller.signal, request, fetch, { location: { origin: 'http://canvas.test' } }, poll, { url: u => u });
    } catch (e) { error = e; }
    return { result, error, workflow, checkpoint, calls, polls };
}

test('reference graph uses bounded 24 fps preparation and paired audio before H3', async () => {
    const r = await scenario({ durations: [5000] });
    assert.ifError(r.error);
    const prep = r.workflow.canvas_video_parts_0;
    assert.equal(prep.class_type, 'CanvasH3ReferenceVideo');
    assert.equal(prep.inputs.width, 854);
    assert.equal(prep.inputs.height, 480);
    assert.deepEqual(prep.inputs.length, r.workflow['136'].inputs.length);
    assert.equal(JSON.parse(prep.inputs.reference_files).length, 1);
    assert.deepEqual(r.workflow['136'].inputs['ref_video_audios.ref_video_audio_0'], ['canvas_video_parts_0', 1]);
    assert.equal(Object.values(r.workflow).some(n => n.class_type === 'GetVideoComponents'), false);
});
for (const durations of [[60000], [1000], [8000, 8000]]) {
    test(`invalid reference duration ${durations} is rejected before upload`, async () => {
        const r = await scenario({ durations });
        assert.match(r.error?.message || '', /参考视频.*(时长|秒)/);
        assert.equal(r.calls.some(u => /\/(upload\/image|prompt)$/.test(u)), false);
    });
}
test('old backend cannot silently fall back to unbounded video decoding', async () => {
    const r = await scenario({ durations: [5000], oldBackend: true });
    assert.match(r.error?.message || '', /参考视频.*(更新|重启)/);
    assert.equal(r.calls.some(u => /\/(upload\/image|prompt)$/.test(u)), false);
});
test('missing metadata is passed to authoritative backend preflight', async () => {
    const r = await scenario({ durations: [undefined] });
    assert.ifError(r.error);
    assert.equal(r.workflow.canvas_video_parts_0.class_type, 'CanvasH3ReferenceVideo');
});
test('missing task ends promptly, retains checkpoint, and does not cancel an unknown task', async () => {
    const r = await scenario({ missing: true });
    assert.match(r.error?.message || '', /找不到|未找到/);
    assert.ok(r.polls <= 4);
    assert.ok(r.checkpoint.id);
    assert.equal(r.calls.some(u => u.endsWith('/cancel')), false);
});
test('queued task remains pending and can finish later', async () => {
    const r = await scenario({ queued: true, completeAfterHistory: 5 });
    assert.ifError(r.error);
    assert.ok(r.result.blob.size);
});
test('history is rechecked after a queue-to-history completion race', async () => {
    const r = await scenario({ missing: true, completeAfterHistory: 4 });
    assert.ifError(r.error);
});
for (const mode of ['offline', 'badQueue']) {
    test(`uncertain backend state (${mode}) retains task without cancellation`, async () => {
        const r = await scenario({ missing: true, [mode]: true });
        assert.match(r.error?.message || '', /查询|状态|连接/);
        assert.equal(r.calls.some(u => u.endsWith('/cancel')), false);
    });
}
