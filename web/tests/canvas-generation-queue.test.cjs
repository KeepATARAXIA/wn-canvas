const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function pageCallback(name, bindings) {
    const file = ts.createSourceFile('project.tsx', fs.readFileSync(path.join(__dirname, '../src/pages/canvas/project.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) callback = node.initializer.arguments[0].getText(file);
        ts.forEachChild(node, visit);
    }
    visit(file);
    assert.ok(callback, name);
    const code = ts.transpileModule('return (' + callback + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

function loadCanvasModule(file, dependencies = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => dependencies[id] || {}, module, module.exports);
    return module.exports;
}

const copyNodeTypes = { Image: 'image', Text: 'text', Video: 'video', Config: 'config', Audio: 'audio', Group: 'group' };
const copyHelpers = loadCanvasModule('canvas-generation-helpers.ts', { '@/types/canvas': { CanvasNodeType: copyNodeTypes } });
const historyRecorder = loadCanvasModule('generation-history.ts').recordGenerationChanges;

function copyHarness(source, method, onChange = () => {}) {
    const nodesRef = { current: [source] }, connectionsRef = { current: [] };
    const bindings = {
        nodesRef, connectionsRef, CanvasNodeType: copyNodeTypes,
        copiedNodeMetadata: copyHelpers.copiedNodeMetadata,
        clipboardRef: { current: { nodes: [source], connections: [] } },
        getCanvasCenter: () => ({ x: 500, y: 500 }),
        setNodes: update => { const before = nodesRef.current; nodesRef.current = update(before); onChange(before, nodesRef.current); },
        setConnections: update => { connectionsRef.current = update(connectionsRef.current); },
        setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {}, setDialogNodeId: () => {}, setContextMenu: () => {},
    };
    const copy = pageCallback(method, bindings);
    copy(source.id);
    return { nodesRef, connectionsRef, bindings, copied: nodesRef.current[1] };
}

test('duplicate and paste detach video generation state while preserving parameters and existing media', () => {
    for (const method of ['duplicateNode', 'pasteCopiedNodes']) for (const [status, content] of [['loading', undefined], ['loading', 'blob:previous'], ['success', 'blob:completed']]) {
        const source = { id: 'source', type: 'video', title: 'Video', position: { x: 0, y: 0 }, width: 400, height: 300, metadata: {
            status, content, storageKey: content ? 'video:existing' : undefined, model: 'MiniMax-H3', prompt: 'rain', seconds: '10', size: '16:9', vquality: '720p', videoH3Mode: 'turbo',
            generationStartedAt: 10, progress: 25, progressStage: '正在采样 5/20 步', progressIndeterminate: false,
            videoTaskId: 'original-task', videoTaskProvider: 'comfy', videoTaskCheckpoint: { id: 'original-task', baseUrl: 'http://original', outputNodeId: '92' },
            seedVr2TaskId: 'original-upscale', seedVr2Resolution: 720,
        } };
        const before = structuredClone(source);
        const { copied } = copyHarness(source, method);
        assert.deepEqual(source, before, method + ' must preserve the source');
        assert.notEqual(copied.metadata, source.metadata);
        assert.equal(copied.metadata.status, content ? 'success' : 'idle');
        for (const field of ['generationStartedAt', 'progress', 'progressStage', 'progressIndeterminate', 'videoTaskId', 'videoTaskProvider', 'videoTaskCheckpoint', 'seedVr2TaskId', 'seedVr2Resolution']) assert.equal(copied.metadata[field], undefined, method + ': ' + field);
        for (const field of ['content', 'storageKey', 'model', 'prompt', 'seconds', 'size', 'vquality', 'videoH3Mode']) assert.equal(copied.metadata[field], source.metadata[field], method + ': ' + field);
    }
});

test('copied video waiting in the local queue records time only after its own generation starts', async () => {
    const source = { id: 'source', type: 'video', title: 'Video', position: { x: 0, y: 0 }, width: 400, height: 300, metadata: { status: 'loading', model: 'MiniMax-H3', generationStartedAt: 10, progressStage: '正在采样 5/20 步', videoTaskId: 'original-task' } };
    let now = 1000, event = 0;
    let history = historyRecorder([], [source], [], now, 'original');
    const { copied, nodesRef, connectionsRef, bindings } = copyHarness(source, 'duplicateNode', (before, after) => { history = historyRecorder(before, after, history, now, 'copy-' + ++event); });
    assert.equal(history.length, 1, 'copying a running video must not create another running record');
    const generationQueueRef = { current: [] }, generationQueueRunsRef = { current: new Map() }, drainGenerationQueueRef = { current: null };
    const config = { model: 'MiniMax-H3', size: '16:9', count: '1', videoSeconds: '10', vquality: '720p' };
    let queueId = 0, releaseFirst, completeVideo;
    Object.assign(bindings, {
        generationQueueRef, generationQueueRunsRef, drainGenerationQueueRef,
        setGenerationQueue: () => {}, nanoid: () => 'queue-' + ++queueId,
        message: { error: value => assert.fail(value) }, effectiveConfig: config, buildGenerationConfig: () => config,
        isAiConfigReady: () => true, openConfigDialog: () => assert.fail('Unexpected config dialog'),
        getNodeDefinition: () => undefined, setRunningNodeId: () => {},
        startGenerationRequest: (_, __, ___, controller = new AbortController()) => controller, finishGenerationRequest: () => {},
        hydrateNodeGenerationContext: async value => value,
        buildNodeGenerationContext: (_, __, ___, prompt) => ({ prompt, referenceImages: [], referenceVideos: [], referenceAudios: [] }),
        generationReferenceUrls: () => [], nodeSizeFromRatio: () => null, NODE_DEFAULT_SIZE: { video: { width: 400, height: 300 } },
        NODE_STATUS_LOADING: 'loading', NODE_STATUS_IDLE: 'idle', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error',
        createGeneratedTitle: () => 'Video Copy', isGenerationCanceled: () => false, t: key => key,
        completeVideoNodeTask: () => new Promise(resolve => { completeVideo = resolve; }),
        setNodesWithoutHistory: update => { nodesRef.current = update(nodesRef.current); },
    });
    bindings.executeGenerateNode = pageCallback('executeGenerateNode', bindings);
    drainGenerationQueueRef.current = pageCallback('drainGenerationQueue', bindings);
    bindings.enqueueGeneration = pageCallback('enqueueGeneration', bindings);
    const first = bindings.enqueueGeneration(source.id, 'video', 'first', 'First', () => new Promise(resolve => { releaseFirst = resolve; }));
    const second = pageCallback('handleGenerateNode', bindings)(copied.id, 'video', 'second');
    assert.equal(generationQueueRef.current[1].status, 'queued');
    assert.equal(generationQueueRef.current[1].startedAt, undefined);
    assert.equal(nodesRef.current[1].metadata.generationStartedAt, undefined);
    assert.equal(history.length, 1);
    now = 11000;
    releaseFirst();
    await new Promise(resolve => setImmediate(resolve));
    const record = history.find(item => item.nodeId === copied.id);
    assert.equal(record.startedAt, now);
    assert.equal(record.resumed, false);
    assert.equal(record.stages[0].name, '正在生成视频');
    assert.ok(nodesRef.current[1].metadata.generationStartedAt > source.metadata.generationStartedAt);
    completeVideo();
    await Promise.all([first, second]);
});

test('image and video requests wait, can be reordered or canceled, and advance after completion', async () => {
    const generationQueueRef = { current: [] };
    const generationQueueRunsRef = { current: new Map() };
    const drainGenerationQueueRef = { current: null };
    const started = [];
    const releases = new Map();
    const notices = [];
    let id = 0;
    let visible = [];
    const bindings = {
        generationQueueRef, generationQueueRunsRef, drainGenerationQueueRef,
        setGenerationQueue: value => { visible = value; },
        executeGenerateNode: (_, mode, prompt) => { started.push([mode, prompt]); return new Promise(resolve => releases.set(prompt, resolve)); },
        message: { info: value => notices.push(value), error: value => { throw new Error(value); } },
        nodesRef: { current: [{ id: 'one', title: '第一个节点' }, { id: 'two', title: '第二个节点' }] },
        buildGenerationConfig: () => ({ model: 'mock' }), effectiveConfig: {}, isAiConfigReady: () => true,
        connectionsRef: { current: [] }, buildNodeGenerationContext: (_, __, ___, prompt) => ({ prompt }),
        openConfigDialog: () => { throw new Error('Unexpected config dialog'); },
        nanoid: () => `queue-${++id}`, confirmStopGeneration: () => { throw new Error('Unexpected active cancellation'); },
    };
    const drain = pageCallback('drainGenerationQueue', bindings);
    drainGenerationQueueRef.current = drain;
    bindings.enqueueGeneration = pageCallback('enqueueGeneration', bindings);
    const enqueue = pageCallback('handleGenerateNode', bindings);
    const cancel = pageCallback('cancelQueuedGeneration', bindings);
    const move = pageCallback('moveQueuedGeneration', bindings);

    const pending = [enqueue('one', 'image', 'first'), enqueue('two', 'image', 'cancel me'), enqueue('two', 'video', 'last'), enqueue('one', 'image', 'third')];
    assert.deepEqual(started, [['image', 'first']]);
    assert.deepEqual(visible.map(item => item.status), ['running', 'queued', 'queued', 'queued']);
    assert.equal(visible[1].startedAt, undefined);
    assert.equal(notices.length, 0);
    cancel('queue-2');
    move('queue-4', -1);
    assert.deepEqual(visible.map(item => item.prompt), ['first', 'third', 'last']);
    releases.get('first')();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [['image', 'first'], ['image', 'third']]);
    releases.get('third')();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [['image', 'first'], ['image', 'third'], ['video', 'last']]);
    releases.get('last')();
    await new Promise(resolve => setImmediate(resolve));
    await Promise.all(pending);
    assert.deepEqual(visible, []);
});

test('a multi-image task starts one image at a time and does not time queued images', async () => {
    const nodesRef = { current: [{ id: 'source', type: 'image', title: 'Image', position: { x: 0, y: 0 }, width: 260, height: 180, metadata: {} }] };
    const connectionsRef = { current: [] };
    const calls = [];
    const releases = [];
    let id = 0;
    const config = { model: 'mock-model', count: '3', size: 'auto' };
    const bindings = {
        nodesRef, connectionsRef, effectiveConfig: config, buildGenerationConfig: () => config,
        isAiConfigReady: () => true, openConfigDialog: () => assert.fail('Unexpected config dialog'),
        getNodeDefinition: () => undefined, setRunningNodeId: () => {},
        startGenerationRequest: (_, __, ___, controller = new AbortController()) => controller,
        finishGenerationRequest: () => {},
        CanvasNodeType: { Image: 'image', Text: 'text', Video: 'video', Config: 'config', Audio: 'audio' },
        hydrateNodeGenerationContext: async value => value,
        buildNodeGenerationContext: (_, __, ___, prompt) => ({ prompt, referenceImages: [], referenceVideos: [], referenceAudios: [] }),
        getGenerationCount: value => Number(value), validateQwenImageInputs: () => null,
        resolveQwenImageConfig: config => config,
        buildImageGenerationMetadata: () => ({ model: 'mock-model', generationType: 'generation' }),
        NODE_DEFAULT_SIZE: { image: { width: 260, height: 180 }, text: { width: 300, height: 200 }, config: { width: 300, height: 200 } },
        nanoid: () => `generated-${++id}`,
        NODE_STATUS_LOADING: 'loading', NODE_STATUS_IDLE: 'idle', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error',
        createGeneratedTitle: () => '图片1',
        setNodes: update => { nodesRef.current = update(nodesRef.current); },
        setConnections: update => { connectionsRef.current = update(connectionsRef.current); },
        setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {}, setDialogNodeId: () => {},
        fitNodeSize: () => ({ width: 260, height: 180 }),
        uploadImage: async dataUrl => ({ url: dataUrl, storageKey: dataUrl, width: 1920, height: 1080, bytes: 123, mimeType: 'image/png' }),
        requestGeneration: () => { calls.push(calls.length + 1); return new Promise(resolve => releases.push(() => resolve([{ dataUrl: `result-${calls.length}` }]))); },
        requestEdit: () => assert.fail('Unexpected edit request'),
        isGenerationCanceled: () => false, t: key => key, message: { error: value => assert.fail(value) },
    };
    bindings.setNodesWithoutHistory = bindings.setNodes;
    const run = pageCallback('executeGenerateNode', bindings);
    const pending = run('source', 'image', 'three images');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [1]);
    assert.deepEqual(nodesRef.current[0].metadata.images.map(image => image.status), ['loading', 'idle', 'idle']);
    assert.equal(nodesRef.current[0].metadata.images[1].generationStartedAt, undefined);
    releases.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [1, 2]);
    assert.deepEqual(nodesRef.current[0].metadata.images.map(image => image.status), ['success', 'loading', 'idle']);
    releases.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [1, 2, 3]);
    releases.shift()();
    await pending;
    assert.equal(nodesRef.current[0].metadata.status, 'success');
    assert.deepEqual(nodesRef.current[0].metadata.images.map(image => image.status), ['success', 'success', 'success']);
});

test('image generation resolves Qwen from connected references and excludes its own output before validation and metadata', async () => {
    for (const ownImage of [false, true]) {
        const connectedReference = { id: 'connected', dataUrl: 'blob:connected' };
        const source = { id: 'source', type: 'image', title: 'Source', position: { x: 0, y: 0 }, width: 260, height: 180, metadata: ownImage ? { content: 'blob:own' } : {} };
        const nodesRef = { current: [source] };
        const connectionsRef = { current: [] };
        const expectedCount = 1;
        let id = 0;
        let requestModel;
        const config = { model: 'qwen::t2i', count: '1', size: 'auto' };
        const bindings = {
            nodesRef, connectionsRef, effectiveConfig: config, buildGenerationConfig: () => config,
            isAiConfigReady: () => true, openConfigDialog: () => assert.fail('Unexpected config dialog'),
            getNodeDefinition: () => undefined, setRunningNodeId: () => {},
            startGenerationRequest: (_, __, ___, controller = new AbortController()) => controller,
            finishGenerationRequest: () => {},
            CanvasNodeType: { Image: 'image', Text: 'text', Video: 'video', Config: 'config', Audio: 'audio' },
            hydrateNodeGenerationContext: async value => value,
            buildNodeGenerationContext: (_, __, ___, prompt) => ({ prompt, referenceImages: [connectedReference], referenceVideos: [], referenceAudios: [] }),
            getGenerationCount: value => Number(value),
            resolveQwenImageConfig: (config, referenceCount) => { assert.equal(referenceCount, expectedCount); return { ...config, model: 'qwen::edit' }; },
            validateQwenImageInputs: (config, referenceCount) => { assert.equal(config.model, 'qwen::edit'); assert.equal(referenceCount, expectedCount); return null; },
            buildImageGenerationMetadata: (type, config) => { assert.equal(type, 'edit'); assert.equal(config.model, 'qwen::edit'); return { model: config.model, generationType: type }; },
            NODE_DEFAULT_SIZE: { image: { width: 260, height: 180 }, text: { width: 300, height: 200 }, config: { width: 300, height: 200 } },
            nanoid: () => `generated-${++id}`,
            NODE_STATUS_LOADING: 'loading', NODE_STATUS_IDLE: 'idle', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error',
            createGeneratedTitle: () => '图片1',
            setNodes: update => { nodesRef.current = update(nodesRef.current); },
            setConnections: update => { connectionsRef.current = update(connectionsRef.current); },
            setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {}, setDialogNodeId: () => {},
            fitNodeSize: () => ({ width: 260, height: 180 }),
            uploadImage: async dataUrl => ({ url: dataUrl, storageKey: dataUrl, width: 1024, height: 1024, bytes: 123, mimeType: 'image/png' }),
            requestGeneration: () => assert.fail('Unexpected text-to-image request'),
            requestEdit: async (config, prompt, references) => { requestModel = config.model; assert.equal(references.length, expectedCount); return [{ dataUrl: 'blob:result' }]; },
            isGenerationCanceled: () => false, t: key => key, message: { error: value => assert.fail(value) },
        };
        bindings.setNodesWithoutHistory = bindings.setNodes;
        await pageCallback('executeGenerateNode', bindings)('source', 'image', 'edit image');
        assert.equal(requestModel, 'qwen::edit');
        assert.equal(nodesRef.current.find(node => node.metadata.content === 'blob:result').metadata.model, 'qwen::edit');
    }
});

test('image retry joins the same queue behind an active generation', async () => {
    const node = { id: 'retry-image', type: 'image', title: '重试图片', metadata: { prompt: 'retry prompt' } };
    const generationQueueRef = { current: [] };
    const generationQueueRunsRef = { current: new Map() };
    const drainGenerationQueueRef = { current: null };
    const calls = [];
    let releaseFirst;
    let id = 0;
    const bindings = {
        generationQueueRef, generationQueueRunsRef, drainGenerationQueueRef,
        setGenerationQueue: () => {}, nanoid: () => `retry-${++id}`,
        message: { info: () => {}, error: value => assert.fail(value) },
        nodesRef: { current: [node] }, CanvasNodeType: { Image: 'image', Video: 'video' },
        executeRetryNode: async (current, imageId) => { calls.push([current.id, imageId]); },
    };
    drainGenerationQueueRef.current = pageCallback('drainGenerationQueue', bindings);
    bindings.enqueueGeneration = pageCallback('enqueueGeneration', bindings);
    const retry = pageCallback('handleRetryNode', bindings);
    const first = bindings.enqueueGeneration('first', 'image', 'first', '第一张', () => new Promise(resolve => { releaseFirst = resolve; }));
    const second = retry(node, 'candidate-2');
    assert.deepEqual(calls, []);
    assert.deepEqual(generationQueueRef.current.map(item => item.status), ['running', 'queued']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(calls, [['retry-image', 'candidate-2']]);
});

test('confirmed leave removes waiting tasks before aborting the running one and flushes state', async () => {
    const queue = { current: [{ id: 'a', nodeId: 'active', status: 'running' }, { id: 'b', nodeId: 'waiting', status: 'queued' }] };
    const events = [];
    const runs = { current: new Map([['b', { finish: () => events.push('finish waiting') }]]) };
    let writeError = '';
    const discard = pageCallback('discardGenerationQueue', {
        generationQueueRef: queue, generationQueueRunsRef: runs,
        flushSync: action => action(), setGenerationQueue: value => assert.deepEqual(value, []),
        stopGenerationByRunningId: id => { assert.deepEqual(queue.current, []); events.push('stop '+id); },
        flushStateWrites: async () => { events.push('flush'); },
        getStateStorageStatus: () => ({ pending: 0, readError: '', writeError }),
    });
    await discard(); assert.deepEqual(events, ['finish waiting', 'stop active', 'flush']); assert.equal(runs.current.size,0);
    writeError = 'disk full'; await assert.rejects(discard(), /保存尚未完成/);
});
