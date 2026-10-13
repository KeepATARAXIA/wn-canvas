const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, dependencies = {}) {
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => { if (!(id in dependencies)) throw new Error('Unmocked ' + id); return dependencies[id]; }, module, module.exports);
    return module.exports;
}
const node = (id, type = 'video-tool:continuum', metadata = {}) => ({ id, title: id, type, position: { x: 0, y: 0 }, width: 400, height: 300, metadata: { videoToolSettings: { prompt: 'isolated test', review: false }, ...metadata } });
function runtimeHarness({ delayedCommit = false, restored = false, importFails = false, submitGate, pendingJob = false, saveJob } = {}) {
    let nodes = [node('a', undefined, restored ? { videoToolJobId: 'saved' } : {})];
    const submitted = [], imported = [], cancelled = [];
    const runtime = load('lib/canvas/video-tool-runtime.ts', {
        './node-registry': { getNodeDefinition: () => ({ resource: () => null }) },
        './canvas-node-factory': { videoMetadata: video => ({ ...video, status: 'success' }) },
        '@/services/file-storage': { uploadMediaFile: async blob => { if (importFails) throw new Error('quota'); imported.push(blob); return { storageKey: 'video:result', content: 'blob:result' }; } },
        '@/services/api/canvas-video-tools': {
            submitVideoToolJob: async params => { submitted.push(params); if (submitGate) await submitGate; return { id: 'job-' + submitted.length, status: 'queued' }; },
            getVideoToolJob: async id => ({ id, status: pendingJob ? 'running' : 'complete' }),
            readVideoToolResult: async () => new Blob(['video']),
            cancelVideoToolJob: async id => { cancelled.push(id); return { id, status: 'cancelled' }; },
            uploadVideoToolAsset: async () => ({ id: 'asset' }),
        },
    });
    const host = {
        getNodes: () => nodes, getNode: id => nodes.find(n => n.id === id), getConnections: () => [],
        updateMetadata: (id, patch) => {
            const commit = () => { nodes = nodes.map(n => n.id === id ? { ...n, metadata: { ...n.metadata, ...patch } } : n); };
            if (delayedCommit) setTimeout(commit, 30); else commit();
        },
    };
    const instance = new runtime.VideoToolRuntime('project', () => host, saveJob);
    return { runtime, instance, host, submitted, imported, cancelled };
}
test('video execution needs no mounted node view, including delayed React metadata commit', async () => {
    const h = runtimeHarness({ delayedCommit: true });
    try {
        await h.instance.execute('a', new AbortController().signal);
        assert.equal(h.submitted.length, 1); assert.equal(h.imported.length, 1);
        assert.equal(h.host.getNode('a').metadata.videoToolImportedJobId, 'job-1');
    } finally { h.instance.dispose(); }
});
test('saved video job is restored without submitting again', async () => {
    const h = runtimeHarness({ restored: true });
    h.instance.sync(h.host.getNodes());
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(h.submitted.length, 0); assert.equal(h.imported.length, 1);
    assert.equal(h.host.getNode('a').metadata.videoToolImportedJobId, 'saved');
    h.instance.dispose();
});
test('duplicate submission is rejected while the first is starting', async () => {
    const h = runtimeHarness();
    const first = h.instance.startJob('a');
    await assert.rejects(h.instance.startJob('a'), /已有任务/);
    await first; h.instance.dispose(); assert.equal(h.submitted.length, 1);
});
test('failed local import retains backend job and stops the chain', async () => {
    const h = runtimeHarness({ importFails: true });
    await h.instance.runChain('a');
    assert.match(h.instance.state('a').error, /取回结果/);
    assert.equal(h.host.getNode('a').metadata.videoToolJobId, 'job-1');
    assert.equal(h.instance.chain, null); h.instance.dispose();
});
test('pipeline cycle is rejected before any submission', async () => {
    const h = runtimeHarness();
    h.host.getConnections = () => [{ fromNodeId: 'a', toNodeId: 'a' }];
    await assert.rejects(h.instance.runChain('a'), /循环/);
    assert.equal(h.submitted.length, 0); h.instance.dispose();
});

test('stopping during submission cancels only the returned owned job and retains its ID', async () => {
    let release;
    const gate = new Promise(resolve => release = resolve);
    const h = runtimeHarness({ submitGate: gate, pendingJob: true });
    const controller = new AbortController();
    const work = h.instance.execute('a', controller.signal);
    await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort(); release();
    await assert.rejects(work, error => error.name === 'AbortError');
    assert.deepEqual(h.cancelled, ['job-1']);
    assert.equal(h.host.getNode('a').metadata.videoToolJobId, 'job-1'); h.instance.dispose();
});

test('leaving during POST checkpoints the original project without mutating the new page', async () => {
    let release; const saved = [];
    const h = runtimeHarness({ submitGate: new Promise(resolve => release = resolve), saveJob: async (node, job) => saved.push([node, job]) });
    const work = h.instance.startJob('a');
    await new Promise(resolve => setTimeout(resolve, 5));
    h.instance.dispose(); release();
    await assert.rejects(work, /画布已关闭/);
    assert.deepEqual(saved, [['a', 'job-1']]); assert.equal(h.host.getNode('a').metadata.videoToolJobId, undefined);
    assert.deepEqual(h.cancelled, []);
});

const packageModule = load('lib/canvas/canvas-package.ts', { nanoid: { nanoid: () => 'fresh' } });
const project = { id: 'p', title: 'portable', nodes: [node('a', 'video', { storageKey: 'video:one' })], connections: [], generationHistory: [{ metadata: { references: ['image:ref'] } }] };
test('project references in generation history are included in media collection', () => {
    assert.deepEqual(packageModule.collectProjectStorageKeys(project), ['video:one', 'image:ref']);
});
const archive = () => ({ app: 'infinite-canvas', version: 3, projects: [{ project, files: [{ storageKey: 'video:one', path: 'one.mp4', bytes: 3, mimeType: 'video/mp4' }, { storageKey: 'image:ref', path: 'ref.png', bytes: 3, mimeType: 'image/png' }] }] });
test('import fails on missing files, size mismatch, or missing manifest reference', () => {
    assert.throws(() => packageModule.prepareCanvasImport(archive(), new Map()), /缺失/);
    assert.throws(() => packageModule.prepareCanvasImport(archive(), new Map([['one.mp4', new Blob(['xx'])]])), /大小/);
    const data = archive(); data.projects[0].files.pop();
    assert.throws(() => packageModule.prepareCanvasImport(data, new Map([['one.mp4', new Blob(['abc'])]])), /清单缺少/);
});
test('import remaps media and reference IDs without mutating original package', () => {
    const result = packageModule.prepareCanvasImport(archive(), new Map([['one.mp4', new Blob(['abc'])], ['ref.png', new Blob(['def'])]]));
    assert.equal(result.projects[0].nodes[0].metadata.storageKey, 'video:fresh');
    assert.equal(result.projects[0].generationHistory[0].metadata.references[0], 'image:fresh');
    assert.equal(project.nodes[0].metadata.storageKey, 'video:one');
    assert.equal(result.assets[0].blob.type, 'video/mp4');
});
test('import rejects non-text project titles before reading any media', () => {
    for (const title of [123, null, {}, [], true]) {
        const data = structuredClone(archive()); data.projects[0].project.title = title;
        assert.throws(() => packageModule.prepareCanvasImport(data, { get() { assert.fail('Media must not be read for invalid metadata'); } }), /项目名称必须是文本/);
    }
});
test('import rejects invalid project dates before reading any media', () => {
    for (const field of ['createdAt', 'updatedAt']) for (const value of [123, null, {}, [], true, '', 'not-a-date', '2026-99-99T00:00:00.000Z']) {
        const data = structuredClone(archive()); data.projects[0].project[field] = value;
        assert.throws(() => packageModule.prepareCanvasImport(data, { get() { assert.fail('Media must not be read for invalid metadata'); } }), error => error.message.includes('项目日期无效') && error.message.includes(field));
    }
});
test('import keeps omitted metadata compatible with project defaults', () => {
    const data = structuredClone(archive()); delete data.projects[0].project.title;
    const result = packageModule.prepareCanvasImport(data, new Map([['one.mp4', new Blob(['abc'])], ['ref.png', new Blob(['def'])]]));
    for (const field of ['title', 'createdAt', 'updatedAt']) assert.equal(Object.hasOwn(result.projects[0], field), false);
    data.projects[0].project.title = '';
    assert.equal(packageModule.prepareCanvasImport(data, new Map([['one.mp4', new Blob(['abc'])], ['ref.png', new Blob(['def'])]])).projects[0].title, '');
});
test('complete v3 backup metadata and media survive validation without mutation', async () => {
    const data = structuredClone(archive());
    Object.assign(data.projects[0].project, { createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-22T17:00:00+08:00' });
    const before = structuredClone(data);
    const result = packageModule.prepareCanvasImport(data, new Map([['one.mp4', new Blob(['abc'])], ['ref.png', new Blob(['def'])]]));
    assert.equal(result.projects[0].title, 'portable');
    assert.equal(result.projects[0].createdAt, before.projects[0].project.createdAt);
    assert.equal(result.projects[0].updatedAt, before.projects[0].project.updatedAt);
    assert.equal(result.projects[0].nodes[0].metadata.storageKey, 'video:fresh');
    assert.equal(result.projects[0].generationHistory[0].metadata.references[0], 'image:fresh');
    assert.deepEqual(await Promise.all(result.assets.map(asset => asset.blob.text())), ['abc', 'def']);
    assert.deepEqual(data, before);
});
test('valid project metadata still rejects invalid nodes', () => {
    const data = structuredClone(archive());
    Object.assign(data.projects[0].project, { createdAt: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-22T09:00:00.000Z' });
    data.projects[0].project.nodes[0].position.x = 'not-a-coordinate';
    assert.throws(() => packageModule.prepareCanvasImport(data, new Map()), /无效节点/);
});
test('export missing local media rejects instead of downloading an incomplete archive', async () => {
    let zipped = false;
    const api = load('lib/canvas/canvas-export.ts', {
        nanoid: { nanoid: () => 'exported' }, '@/stores/use-config-store': { withLocalProxy: x => x }, './canvas-package': packageModule,
        'file-saver': { saveAs() { throw new Error('Unexpected download'); } }, '@/i18n': { default: { t: x => x } },
        '@/lib/zip': { createZip: async () => { zipped = true; } }, '@/services/file-storage': { getMediaBlob: async () => null },
        '@/services/image-storage': { getImageBlob: async () => new Blob(['ref']) }, '@/types/canvas': { CanvasNodeType: { Text: 'text' } },
    });
    await assert.rejects(api.buildCanvasProjectArchive([project]), /缺少素材/); assert.equal(zipped, false);
});
test('H3 recovery downloads the original history result and never POSTs', async () => {
    const original = global.fetch, calls = [];
    global.fetch = async url => {
        calls.push(String(url));
        return String(url).includes('/view?') ? new Response(new Blob(['video'], { type: 'video/mp4' })) : Response.json({ saved: { outputs: { '92': { videos: [{ filename: 'saved.mp4' }] } }, status: { completed: true } } });
    };
    try {
        const { recoverComfyVideoTask } = load('services/api/comfy-video-task.ts', { '@/stores/use-config-store': { withLocalProxy: x => x } });
        const result = await recoverComfyVideoTask({ id: 'saved', baseUrl: 'http://original', outputNodeId: '92' });
        assert.equal(result.blob.size, 5); assert.equal(calls.length, 2); assert.ok(calls.every(url => url.startsWith('http://original/')));
    } finally { global.fetch = original; }
});
test('H3 recovery keeps its own queued time separate while another task is running', async () => {
    const originalFetch = global.fetch, originalTimeout = global.setTimeout, calls = [], stages = [];
    const queues = [
        { queue_running: [[1, 'foreign']], queue_pending: [[2, 'saved']] },
        { queue_running: [[1, 'foreign']], queue_pending: [[2, 'saved']] },
        { queue_running: [[2, 'saved']], queue_pending: [[3, 'foreign']] },
    ];
    let queueIndex = 0;
    global.setTimeout = (callback, delay, ...args) => originalTimeout(callback, delay === 2500 ? 0 : delay, ...args);
    global.fetch = async (url, init) => {
        calls.push(String(url));
        assert.equal(init?.method, undefined, 'recovery only reads the original task');
        if (String(url).endsWith('/queue')) return Response.json(queues[queueIndex++]);
        if (String(url).includes('/view?')) return new Response(new Blob(['video'], { type: 'video/mp4' }));
        return Response.json(queueIndex === queues.length
            ? { saved: { outputs: { '92': { videos: [{ filename: 'saved.mp4' }] } }, status: { completed: true } } }
            : {});
    };
    try {
        const { recoverComfyVideoTask } = load('services/api/comfy-video-task.ts', { '@/stores/use-config-store': { withLocalProxy: x => x } });
        const result = await recoverComfyVideoTask({ id: 'saved', baseUrl: 'http://original', outputNodeId: '92' }, {
            onProgress: (percent, detail) => { assert.equal(percent, 0); assert.equal(detail.indeterminate, true); stages.push(detail.stage); },
        });
        assert.equal(result.blob.size, 5);
        assert.deepEqual(stages, [
            '正在查询原任务，后台结果会自动取回',
            '已提交，正在排队等待执行',
            '已提交，正在排队等待执行',
            '后台已开始，正在生成视频',
            '已找到原任务结果，正在保存视频',
        ]);
        assert.equal(queueIndex, queues.length);
        assert.ok(calls.every(url => url.startsWith('http://original/') && !/\/(prompt|cancel)$/.test(url)));
    } finally { global.fetch = originalFetch; global.setTimeout = originalTimeout; }
});

test('H3 recovery of missing history is actionable and does not resubmit', async () => {
    const original = global.fetch;
    global.fetch = async (_url, init) => { assert.equal(init?.method, undefined); return Response.json({}); };
    try {
        const { recoverComfyVideoTask } = load('services/api/comfy-video-task.ts', { '@/stores/use-config-store': { withLocalProxy: x => x } });
        await assert.rejects(recoverComfyVideoTask({ id: 'saved', baseUrl: 'http://original', outputNodeId: '92' }), /标识已保留/);
    } finally { global.fetch = original; }
});

test('canceling recovered H3 task uses a fresh signal and its own ID-scoped endpoint', async () => {
    const original = global.fetch, calls = [];
    global.fetch = async (url, init) => { calls.push(url); assert.equal(init.method, 'POST'); assert.equal(init.signal.aborted, false); return Response.json({ cancelled: true }); };
    try {
        const { recoverComfyVideoTask } = load('services/api/comfy-video-task.ts', { '@/stores/use-config-store': { withLocalProxy: x => x } });
        const controller = new AbortController(); controller.abort();
        await assert.rejects(recoverComfyVideoTask({ id: 'saved', baseUrl: 'http://original', outputNodeId: '92' }, { signal: controller.signal }), error => error.name === 'AbortError');
        assert.deepEqual(calls, ['http://original/api/jobs/saved/cancel']);
    } finally { global.fetch = original; }
});

test('cleanup retains reference-only image and video assets from history', async () => {
    const maps = new Map(), deleted = [];
    const localforage = { createInstance: ({ storeName }) => {
        const data = new Map(); maps.set(storeName, data);
        return { iterate: async callback => { for (const [key, value] of data) callback(value, key); }, removeItem: async key => { deleted.push(key); data.delete(key); } };
    } };
    const deps = { localforage: { default: localforage }, nanoid: { nanoid: () => 'test' }, '@/i18n': { default: { t: x => x } }, '@/stores/use-config-store': { withLocalProxy: x => x }, '@/lib/image-thumbnail': {} };
    const images = load('services/image-storage.ts', deps), media = load('services/file-storage.ts', deps);
    maps.get('image_files').set('image:ref', new Blob(['image']));
    maps.get('media_files').set('video:ref', new Blob(['video']));
    maps.get('media_files').set('video:unused', new Blob(['unused']));
    const history = { generationHistory: [{ metadata: { references: ['image:ref', 'video:ref'] } }] };
    await images.cleanupUnusedImages(history); await media.cleanupUnusedMedia(history);
    assert.deepEqual(deleted, ['video:unused']);
});
