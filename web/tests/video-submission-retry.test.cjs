const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.join(__dirname, '../src');
const templateSource = fs.readFileSync(path.join(root, 'services/api/templates/comfyui-minimax-h3.js'), 'utf8');
const template = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/workflows/minimax-h3-local-api.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runTemplate = new AsyncFunction('prompt', 'images', 'videos', 'audios', 'baseUrl', 'params', 'signal', 'request', 'fetch', 'window', 'poll', 'http', templateSource);
const rejection = () => Object.assign(new Error('workflow validation failed'), { name: 'VideoTaskSubmissionRejected' });
const isRejected = error => error instanceof Error && error.name === 'VideoTaskSubmissionRejected';

async function submit(status) {
    const calls = [];
    let checkpoint;
    try {
        await runTemplate('test prompt', [], [], [], 'http://comfy.test', {
            seconds: 5, h3Mode: 'turbo', h3SageAttention: false, outputDimensions: { width: 854, height: 480 },
            onTaskSubmitted: async task => { checkpoint = task; },
        }, new AbortController().signal, async () => ({}), async (url, options = {}) => {
            url = String(url); calls.push({ url, method: options.method || 'GET' });
            if (url.includes('/workflows/')) return Response.json(structuredClone(template));
            if (url.endsWith('/prompt')) {
                assert.ok(checkpoint?.id, 'checkpoint is persisted before the request');
                if (status === 'network') throw new TypeError('Failed to fetch');
                if (status === 'invalid-json') return new Response('{invalid', { status: 200 });
                if (status === 'no-id') return Response.json({ number: 0 });
                if (status === 'number-id') return Response.json({ prompt_id: 123 });
                if (status === 'object-id') return Response.json({ prompt_id: {} });
                if (status === 'blank-id') return Response.json({ prompt_id: '   ' });
                return new Response('{"error":"prompt_outputs_failed_validation"}', { status });
            }
            if (url.endsWith('/cancel')) return Response.json({ cancelled: false });
            throw new Error('Unexpected request ' + url);
        }, { location: { origin: 'http://canvas.test' } }, () => assert.fail('rejected submit cannot poll'), { url: v => v });
    } catch (error) { return { error, checkpoint, calls }; }
    assert.fail('submission must fail');
}

for (const status of [400, 401, 403, 404, 405, 413, 415, 422]) {
    test(`explicit HTTP ${status} rejection is typed and does not cancel a nonexistent task`, async () => {
        const result = await submit(status);
        assert.equal(result.error.name, 'VideoTaskSubmissionRejected');
        assert.match(result.error.message, new RegExp('HTTP ' + status));
        assert.equal(result.calls.filter(call => call.url.endsWith('/cancel')).length, 0);
    });
}
for (const status of ['network', 408, 409, 429, 500, 503, 'invalid-json', 'no-id', 'number-id', 'object-id', 'blank-id']) {
    test(`${status} submission remains unknown and must not be marked safe to resubmit`, async () => {
        const result = await submit(status);
        assert.equal(isRejected(result.error), false);
        assert.ok(result.checkpoint?.id);
        assert.match(result.error.message, /无法确认.*受理/);
        assert.equal(result.calls.filter(call => call.url.endsWith('/cancel')).length, 0, 'unknown accepted jobs continue until explicit stop');
    });
}

function loadPlugin() {
    const source = fs.readFileSync(path.join(root, 'services/api/model-plugin.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    const dependencies = {
        axios: { default: { isCancel: () => false } }, '@/i18n': { default: { t: (_key, options) => 'script: ' + options?.message } },
        '@/stores/use-config-store': {}, './templates/comfyui-minimax-h3.js?raw': {}, './auth-headers': {},
    };
    new Function('exports', 'require', code)(exports, name => dependencies[name]);
    return exports;
}
test('plugin error wrapper preserves explicit submission rejection through the API boundary', async () => {
    const plugin = loadPlugin();
    await assert.rejects(plugin.runModelPlugin({ capability: 'video', config: {}, script: 'const error = new Error("validation"); error.name = "VideoTaskSubmissionRejected"; throw error;' }), error => isRejected(error) && error.message.includes('validation'));
});
test('ordinary plugin errors cannot acquire the explicit-rejection marker', async () => {
    const plugin = loadPlugin();
    await assert.rejects(plugin.runModelPlugin({ capability: 'video', config: {}, script: 'throw new Error("network unknown")' }), error => !isRejected(error) && error.message.includes('network unknown'));
});

function callback(name, bindings) {
    const source = fs.readFileSync(path.join(root, 'pages/canvas/project.tsx'), 'utf8');
    const file = ts.createSourceFile('project.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let fn;
    const visit = part => {
        if (ts.isVariableDeclaration(part) && part.name.getText(file) === name) fn = part.initializer.arguments[0].getText(file);
        if (ts.isFunctionDeclaration(part) && part.name?.text === name) fn = part.getText(file);
        ts.forEachChild(part, visit);
    };
    visit(file); assert.ok(fn);
    const code = ts.transpileModule('return (' + fn + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

const CanvasNodeType = { Image: 'image', Video: 'video', Text: 'text', Audio: 'audio' };
function loadGenerationHelpers() {
    const source = fs.readFileSync(path.join(root, 'lib/canvas/canvas-generation-helpers.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    new Function('exports', 'require', code)(exports, name => name === '@/types/canvas' ? { CanvasNodeType } : name === '@/i18n' ? { default: { t: key => key } } : {});
    return exports;
}

function retryHarness(metadata = {}) {
    const helpers = loadGenerationHelpers();
    const nodesRef = { current: [{ id: 'a', type: 'video', title: 'Saved video', position: { x: 0, y: 0 }, width: 400, height: 300, metadata: {
        content: 'blob:old-success', storageKey: 'video:old-success', status: 'success', model: 'MiniMax-H3', prompt: 'original', seconds: '5', ...metadata,
    } }] };
    const submitted = [], queried = [], imported = [];
    let submission = 'unknown', recovery = 'success';
    const bindings = {
        ...helpers, CanvasNodeType, nodesRef, connectionsRef: { current: [] }, generationRequestsRef: { current: new Map() }, videoPollIdsRef: { current: new Set() },
        setNodes: fn => { nodesRef.current = fn(nodesRef.current); }, setRunningNodeId: () => {},
        NODE_STATUS_LOADING: 'loading', NODE_STATUS_ERROR: 'error', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_IDLE: 'idle',
        effectiveConfig: { model: 'MiniMax-H3' }, buildGenerationConfig: () => ({ model: 'MiniMax-H3', videoSeconds: '5' }), isAiConfigReady: () => true,
        openConfigDialog: () => assert.fail('configuration is already complete'), findRetrySourceNode: () => null, nanoid: () => 'unused-image-id',
        hydrateNodeGenerationContext: async context => context, buildNodeGenerationContext: () => ({ prompt: 'original', referenceImages: [], referenceVideos: [], referenceAudios: [] }),
        flushSync: fn => fn(), updateProject: () => {}, projectId: 'test-project', flushStateWrites: async () => {}, getStateStorageStatus: () => ({}),
        isVideoTaskSubmissionRejected: isRejected, isVideoTaskFailed: error => error?.name === 'VideoTaskFailed',
        message: { error: () => {}, warning: text => assert.fail(text) }, t: key => key,
        createVideoGenerationTask: async (_config, _prompt, _images, options) => {
            const task = { id: `new-task-${submitted.length + 1}`, baseUrl: 'http://fixture.invalid', outputNodeId: '92' };
            submitted.push(task);
            if (submission === 'preflight') throw new Error('preflight failed before submitting');
            await options.onTaskSubmitted(task);
            if (submission.startsWith('cancel-')) {
                bindings.stopGenerationByRunningId('a');
                assert.equal(options.signal.aborted, true);
                throw submission === 'cancel-confirmed' ? new DOMException('Aborted', 'AbortError') : new Error('cannot confirm cancellation');
            }
            throw submission === 'rejected' ? rejection() : new Error('unknown submission response');
        },
        waitForVideoGenerationTask: async (_config, task) => {
            queried.push(task.id);
            assert.equal(nodesRef.current[0].metadata.content, 'blob:old-success', 'old media remains available while querying');
            if (recovery === 'unknown') throw new Error('original task is still unavailable');
            return { url: 'mock-result' };
        },
        storeGeneratedVideo: async result => { imported.push(result); return { url: 'blob:new-success', storageKey: 'video:new-success', width: 400, height: 300 }; },
    };
    bindings.startGenerationRequest = id => { const controller = new AbortController(); bindings.generationRequestsRef.current.set(id, { controller, targetNodeId: id, originNodeId: id, runningNodeId: id }); return controller; };
    bindings.finishGenerationRequest = id => bindings.generationRequestsRef.current.delete(id);
    bindings.stopGenerationByRunningId = callback('stopGenerationByRunningId', bindings);
    bindings.applyGeneratedVideo = callback('applyGeneratedVideo', {
        VIDEO_NODE_MAX_WIDTH: 420, VIDEO_NODE_MAX_HEIGHT: 420, fitNodeSize: (width, height) => ({ width, height }),
        videoMetadata: video => ({ content: video.url, storageKey: video.storageKey, status: 'success' }),
    });
    bindings.completeVideoNodeTask = callback('completeVideoNodeTask', bindings);
    bindings.pollVideoNodeTask = callback('pollVideoNodeTask', bindings);
    const retry = callback('executeRetryNode', bindings);
    return {
        helpers, nodesRef, submitted, queried, imported, bindings,
        node: () => nodesRef.current[0], retry: () => retry(nodesRef.current[0]), poll: () => bindings.pollVideoNodeTask(nodesRef.current[0], true),
        reload: () => { nodesRef.current = helpers.resetInterruptedGeneration(JSON.parse(JSON.stringify(nodesRef.current))); },
        setSubmission: value => { submission = value; }, setRecovery: value => { recovery = value; },
    };
}

test('unknown regeneration with old media retries and reloads by querying only its checkpoint until success', async () => {
    const h = retryHarness();
    await h.retry();
    assert.equal(h.submitted.length, 1);
    assert.equal(h.node().metadata.status, 'error');
    assert.equal(h.helpers.hasResumableVideoTask(h.node()), true);
    assert.equal(h.node().metadata.content, 'blob:old-success');
    h.setRecovery('unknown');
    await h.retry();
    assert.deepEqual(h.queried, ['new-task-1']);
    assert.equal(h.submitted.length, 1);
    assert.equal(h.node().metadata.status, 'error');
    assert.match(h.node().metadata.errorDetails, /original task/);
    h.reload();
    assert.equal(h.helpers.hasResumableVideoTask(h.node()), true);
    h.setRecovery('success');
    await h.poll();
    assert.deepEqual(h.queried, ['new-task-1', 'new-task-1']);
    assert.equal(h.submitted.length, 1);
    assert.equal(h.imported.length, 1);
    assert.equal(h.node().metadata.content, 'blob:new-success');
    assert.equal(h.node().metadata.storageKey, 'video:new-success');
    assert.equal(h.node().metadata.status, 'success');
    for (const key of ['videoTaskId', 'videoTaskProvider', 'videoTaskCheckpoint']) assert.equal(h.node().metadata[key], undefined);
    h.reload();
    assert.equal(h.helpers.hasResumableVideoTask(h.node()), false);
    await h.poll();
    assert.equal(h.queried.length, 2, 'completed result is not imported again after reload');
});

for (const status of ['loading', 'error']) {
    test(`saved ${status} regeneration keeps old media and resumes the original task after reload`, async () => {
        const h = retryHarness({ status, videoTaskId: 'saved-active', videoTaskProvider: 'comfy', videoTaskCheckpoint: { id: 'saved-active', baseUrl: 'http://fixture.invalid', outputNodeId: '92' } });
        h.reload();
        assert.equal(h.helpers.hasResumableVideoTask(h.node()), true);
        assert.equal(h.node().metadata.status, status);
        await h.poll();
        assert.deepEqual(h.queried, ['saved-active']);
        assert.equal(h.submitted.length, 0);
        assert.equal(h.node().metadata.content, 'blob:new-success');
    });
}

test('a prior unknown regeneration marked success with an error still recovers its retained task', async () => {
    const h = retryHarness({ status: 'success', errorDetails: 'unknown submission response', videoTaskId: 'saved-unknown', videoTaskProvider: 'comfy' });
    assert.equal(h.helpers.hasResumableVideoTask(h.node()), true);
    await h.retry();
    assert.deepEqual(h.queried, ['saved-unknown']);
    assert.equal(h.submitted.length, 0);
});

test('completed legacy media with a historical task ID stays complete and a new preflight failure cannot revive that ID', async () => {
    const h = retryHarness({ videoTaskId: 'historical-complete', videoTaskProvider: 'comfy', videoTaskCheckpoint: { id: 'historical-complete', baseUrl: 'http://fixture.invalid', outputNodeId: '92' } });
    h.reload();
    assert.equal(h.helpers.hasResumableVideoTask(h.node()), false);
    await h.poll();
    assert.deepEqual(h.queried, []);
    h.setSubmission('preflight');
    await h.retry();
    assert.equal(h.submitted.length, 1);
    for (const key of ['videoTaskId', 'videoTaskProvider', 'videoTaskCheckpoint']) assert.equal(h.node().metadata[key], undefined);
    h.reload();
    assert.equal(h.helpers.hasResumableVideoTask(h.node()), false);
    assert.equal(h.node().metadata.content, 'blob:old-success');
    assert.equal(h.node().metadata.status, 'success');
});

test('explicitly rejected regeneration with old media allows a fresh task on retry', async () => {
    const h = retryHarness();
    h.setSubmission('rejected');
    await h.retry();
    assert.equal(h.helpers.hasResumableVideoTask(h.node()), false);
    await h.retry();
    assert.deepEqual(h.submitted.map(task => task.id), ['new-task-1', 'new-task-2']);
    assert.deepEqual(h.queried, []);
    assert.equal(h.node().metadata.content, 'blob:old-success');
    assert.equal(h.node().metadata.videoTaskId, undefined);
});

for (const confirmed of [false, true]) {
    test(`stopping recovered video with old media ${confirmed ? 'allows a fresh retry after confirmed cancellation' : 'retains the original task when cancellation is unknown'}`, async () => {
        const h = retryHarness({ status: 'error', errorDetails: 'unknown submission', videoTaskId: 'still-owned', videoTaskProvider: 'comfy' });
        const bindings = { ...h.bindings, NODE_STATUS_IDLE: 'idle' };
        bindings.startGenerationRequest = id => {
            const controller = new AbortController();
            bindings.generationRequestsRef.current.set(id, { controller, targetNodeId: id, originNodeId: id, runningNodeId: id });
            return controller;
        };
        const stop = callback('stopGenerationByRunningId', bindings);
        bindings.waitForVideoGenerationTask = async (_config, task, options) => {
            h.queried.push(task.id);
            stop('a');
            assert.equal(options.signal.aborted, true);
            assert.equal(h.node().metadata.status, 'error');
            assert.match(h.node().metadata.errorDetails, /取消.*确认/);
            throw confirmed ? new DOMException('Aborted', 'AbortError') : new Error('cannot confirm cancellation');
        };
        await callback('pollVideoNodeTask', bindings)(h.node());
        assert.equal(h.node().metadata.content, 'blob:old-success');
        assert.equal(h.helpers.hasResumableVideoTask(h.node()), !confirmed);
        if (confirmed) {
            assert.equal(h.node().metadata.errorDetails, undefined);
            assert.equal(h.node().metadata.status, 'success');
            for (const key of ['videoTaskId', 'videoTaskProvider', 'videoTaskCheckpoint']) assert.equal(h.node().metadata[key], undefined);
            await h.poll();
            assert.deepEqual(h.queried, ['still-owned']);
            h.setSubmission('rejected');
            await h.retry();
            assert.equal(h.submitted.length, 1);
            assert.equal(h.node().metadata.videoTaskId, undefined);
        } else {
            assert.equal(h.node().metadata.status, 'error');
            assert.match(h.node().metadata.errorDetails, /cannot confirm cancellation/);
            h.reload();
            await h.retry();
            assert.deepEqual(h.queried, ['still-owned', 'still-owned']);
            assert.equal(h.submitted.length, 0);
        }
    });
}

test('retry during pending cancellation cannot submit another task before recovery settles', async () => {
    const h = retryHarness({ status: 'error', errorDetails: 'unknown submission', videoTaskId: 'still-owned', videoTaskProvider: 'comfy' });
    const bindings = { ...h.bindings, NODE_STATUS_IDLE: 'idle' };
    bindings.startGenerationRequest = id => {
        const controller = new AbortController();
        bindings.generationRequestsRef.current.set(id, { controller, targetNodeId: id, originNodeId: id, runningNodeId: id });
        return controller;
    };
    const stop = callback('stopGenerationByRunningId', bindings);
    let rejectCancellation;
    const pending = new Promise((_resolve, reject) => { rejectCancellation = reject; });
    bindings.waitForVideoGenerationTask = async (_config, task) => { h.queried.push(task.id); stop('a'); return pending; };
    const work = callback('pollVideoNodeTask', bindings)(h.node());
    assert.equal(h.node().metadata.status, 'error');
    const refreshed = retryHarness(JSON.parse(JSON.stringify(h.node().metadata)));
    assert.equal(refreshed.helpers.hasResumableVideoTask(refreshed.node()), true);
    await refreshed.retry();
    assert.deepEqual(refreshed.queried, ['still-owned']);
    assert.equal(refreshed.submitted.length, 0, 'a new page keeps querying the pending cancellation identity');
    await h.retry();
    const submittedWhilePending = h.submitted.length;
    rejectCancellation(new Error('cannot confirm cancellation'));
    await work;
    assert.equal(submittedWhilePending, 0);
    assert.equal(h.node().metadata.videoTaskId, 'still-owned');
    await h.retry();
    assert.deepEqual(h.queried, ['still-owned', 'still-owned']);
    assert.equal(h.submitted.length, 0);
});

for (const confirmed of [false, true]) {
    test(`stopping the initial H3 submission ${confirmed ? 'clears only its confirmed cancelled identity' : 'keeps unknown cancellation resumable'}`, async () => {
        const h = retryHarness();
        h.setSubmission(confirmed ? 'cancel-confirmed' : 'cancel-unknown');
        await h.retry();
        assert.equal(h.node().metadata.content, 'blob:old-success');
        assert.equal(h.helpers.hasResumableVideoTask(h.node()), !confirmed);
        if (confirmed) {
            assert.equal(h.node().metadata.status, 'success');
            for (const key of ['videoTaskId', 'videoTaskProvider', 'videoTaskCheckpoint']) assert.equal(h.node().metadata[key], undefined);
            assert.equal(h.node().metadata.errorDetails, undefined);
        } else {
            assert.equal(h.node().metadata.status, 'error');
            assert.equal(h.node().metadata.videoTaskId, 'new-task-1');
            h.reload();
            await h.retry();
            assert.deepEqual(h.queried, ['new-task-1']);
            assert.equal(h.submitted.length, 1);
        }
    });
}

test('a confirmed backend task failure clears recovery identity while retaining the old result', async () => {
    const h = retryHarness({ status: 'error', videoTaskId: 'failed-task', videoTaskProvider: 'comfy' });
    const bindings = { ...h.bindings, waitForVideoGenerationTask: async () => { throw Object.assign(new Error('backend task failed'), { name: 'VideoTaskFailed' }); } };
    await callback('pollVideoNodeTask', bindings)(h.node());
    assert.equal(h.node().metadata.content, 'blob:old-success');
    assert.equal(h.node().metadata.videoTaskId, undefined);
    assert.equal(h.helpers.hasResumableVideoTask(h.node()), false);
    await h.poll();
    assert.deepEqual(h.queried, []);
});

for (const explicit of [true, false]) {
    test(`submission failure ${explicit ? 'clears rejected' : 'retains unknown'} identity and keeps successful media/parameters`, async () => {
        const task = { id: 'saved-id', baseUrl: 'http://comfy.test', outputNodeId: '92' };
        const nodesRef = { current: [{ id: 'a', type: 'video', metadata: { content: 'blob:old-success', storageKey: 'video:old-success', model: 'MiniMax-H3', prompt: 'original', seconds: '5', videoTaskId: task.id, videoTaskProvider: 'comfy', videoTaskCheckpoint: task } }] };
        const run = callback('completeVideoNodeTask', {
            nodesRef, setNodes: f => { nodesRef.current = f(nodesRef.current); }, flushSync: f => f(), updateProject: () => {}, projectId: 'test-project',
            createVideoGenerationTask: async (_config, _prompt, _images, options) => { await options.onTaskSubmitted(task); throw explicit ? rejection() : new Error('unknown network'); },
            flushStateWrites: async () => {}, getStateStorageStatus: () => ({}), isVideoTaskSubmissionRejected: isRejected,
            isGenerationCanceled: loadGenerationHelpers().isGenerationCanceled,
        });
        await assert.rejects(run('a', { model: 'MiniMax-H3' }, 'original', [], new AbortController().signal));
        const metadata = nodesRef.current[0].metadata;
        assert.equal(metadata.content, 'blob:old-success'); assert.equal(metadata.storageKey, 'video:old-success');
        assert.equal(metadata.seconds, '5'); assert.equal(metadata.prompt, 'original');
        assert.equal(metadata.videoTaskId, explicit ? undefined : 'saved-id');
        assert.equal(metadata.videoTaskProvider, explicit ? undefined : 'comfy');
        assert.deepEqual(metadata.videoTaskCheckpoint, explicit ? undefined : task);
    });
}
