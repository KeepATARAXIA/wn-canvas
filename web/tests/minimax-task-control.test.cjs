const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/services/api/templates/comfyui-minimax-h3.js'), 'utf8');
const template = JSON.parse(fs.readFileSync(path.join(root, 'public/workflows/minimax-h3-local-api.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('prompt', 'images', 'videos', 'audios', 'baseUrl', 'params', 'signal', 'request', 'fetch', 'window', 'poll', 'http', source);

async function harness(options = {}) {
    const controller = new AbortController();
    const calls = [];
    let workflow;
    let jobId;
    const endpoint = 'http://comfy.test';
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    async function dispatch(method, url, body, requestSignal) {
        calls.push({ method, url, body, signal: requestSignal });
        if (url.endsWith('/system_stats')) {
            if (options.abortBeforeSubmit) controller.abort();
            return {};
        }
        if (url.includes('/object_info/')) return options.sageAvailable ? { MiniMaxH3MemoryEfficientSageAttentionPatch: { input: {} } } : {};
        if (url.endsWith('/upload/image')) return { name: 'isolated.png' };
        if (url.endsWith('/prompt')) {
            workflow = body.prompt;
            jobId = body.prompt_id || 'legacy-job';
            if (options.abortDuringSubmit) {
                controller.abort();
                if (requestSignal === controller.signal) throw new DOMException('Aborted', 'AbortError');
            }
            return { prompt_id: jobId };
        }
        if (url.endsWith('/cancel')) {
            assert.equal(requestSignal.aborted, false, 'cancellation must outlive the aborted generation request');
            if (options.cancelFails) throw new Error('backend unavailable');
            return { cancelled: !options.alreadyFinished };
        }
        if (url.includes('/view?')) return new Blob(['isolated-video']);
        throw new Error('Unexpected request ' + url);
    }
    const request = ({ method, url, data }) => dispatch(method, url, data, controller.signal);
    const mockFetch = async (url, init = {}) => {
        url = String(url);
        if (url.includes('/workflows/')) return { ok: true, json: async () => structuredClone(template) };
        if (url.startsWith('data:')) return { ok: true, blob: async () => new Blob(['isolated-image']) };
        return json(await dispatch(init.method?.toLowerCase() || 'get', url, init.body ? JSON.parse(init.body) : undefined, init.signal));
    };
    const poll = async () => {
        if (options.abortDuringPoll) controller.abort();
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return { filename: 'isolated.mp4' };
    };
    let result, error;
    try {
        result = await run('isolated regression', Array(options.images || 0).fill('data:image/png;base64,YQ=='), [], [], endpoint,
            { seconds: 5, h3Mode: options.mode || 'te', h3SageAttention: Boolean(options.sage), h3TeSpeed: true, outputDimensions: { width: 854, height: 480 }, onTaskSubmitted: options.onTaskSubmitted ? task => options.onTaskSubmitted(task, calls) : undefined },
            controller.signal, request, mockFetch, { location: { origin: 'http://canvas.test' } }, poll, { url: value => 'http://proxy.test/' + value });
    } catch (caught) { error = caught; }
    return { calls, workflow, jobId, result, error };
}

for (const phase of ['abortDuringPoll', 'abortDuringSubmit']) {
    test(`cancel only the owned job: ${phase}`, async () => {
        const r = await harness({ [phase]: true });
        assert.equal(r.error?.name, 'AbortError');
        const cancels = r.calls.filter(c => c.url.endsWith('/cancel'));
        assert.equal(cancels.length, 1);
        assert.equal(cancels[0].url, `http://proxy.test/http://comfy.test/api/jobs/${r.jobId}/cancel`);
        assert.equal(r.calls.some(c => /\/(interrupt|queue)$/.test(c.url)), false);
    });
}
test('abort before submission never queues a job', async () => {
    const r = await harness({ abortBeforeSubmit: true });
    assert.equal(r.error?.name, 'AbortError');
    assert.equal(r.calls.some(c => c.url.endsWith('/prompt')), false);
});
test('missing Sage node fails before upload or submission', async () => {
    const r = await harness({ sage: true, images: 1 });
    assert.match(r.error?.message || '', /SageAttention.*关闭/);
    assert.equal(r.calls.some(c => /\/(prompt|upload\/image)$/.test(c.url)), false);
});
test('available Sage node keeps the selected patch', async () => {
    const r = await harness({ sage: true, sageAvailable: true });
    assert.ifError(r.error);
    assert.ok(r.workflow.canvas_h3_sage_attention);
});
test('cancellation failure is actionable, not silently treated as success', async () => {
    const r = await harness({ abortDuringPoll: true, cancelFails: true });
    assert.equal(r.error?.name, 'Error');
    assert.match(r.error.message, /后台.*取消|取消.*后台/);
    assert.ok(r.error.message.includes(r.jobId));
});
test('cancelling an already finished job is harmless', async () => {
    const r = await harness({ abortDuringPoll: true, alreadyFinished: true });
    assert.equal(r.error?.name, 'AbortError');
});
test('successful generation returns video without cancellation', async () => {
    const r = await harness();
    assert.ifError(r.error);
    assert.ok(r.result.blob instanceof Blob);
    assert.equal(r.calls.filter(c => c.url.endsWith('/cancel')).length, 0);
});
test('Turbo retains 8-step FL2VA and 4-step reference workflows', async () => {
    const fl = await harness({ mode: 'turbo' });
    const ref = await harness({ mode: 'turbo', images: 3 });
    for (const r of [fl, ref]) {
        assert.ifError(r.error);
        assert.equal(r.workflow['123'].inputs.sampler_name, 'euler');
        assert.equal(r.workflow.canvas_h3_te_speed, undefined);
        assert.equal(r.workflow['136'].inputs.width, 864);
        assert.equal(r.workflow.canvas_h3_output_size.inputs.width, 854);
    }
    assert.equal(fl.workflow['124'].inputs.steps, 8);
    assert.equal(fl.workflow.canvas_h3_shift.inputs.shift_video, 6);
    assert.equal(ref.workflow['124'].inputs.steps, 4);
    assert.equal(ref.workflow['136'].class_type, 'MiniMaxH3ReferenceToVideo');
    assert.equal(ref.workflow.canvas_h3_shift.inputs.shift_video, 12);
});


test('checkpoint is durable before POST and owns the submitted ID', async () => {
    let checkpoint;
    const r = await harness({ onTaskSubmitted: async (task, calls) => {
        assert.equal(calls.some(call => call.url.endsWith('/prompt')), false);
        await new Promise(resolve => setTimeout(resolve, 10));
        checkpoint = task;
    } });
    assert.ifError(r.error);
    assert.equal(checkpoint.id, r.jobId);
    assert.equal(checkpoint.baseUrl, 'http://comfy.test');
    assert.equal(checkpoint.outputNodeId, '92');
});

test('failed checkpoint blocks submission', async () => {
    const r = await harness({ onTaskSubmitted: async () => { throw new Error('storage quota exceeded'); } });
    assert.match(r.error.message, /quota/);
    assert.equal(r.calls.some(call => /\/(prompt|cancel)$/.test(call.url)), false);
});
