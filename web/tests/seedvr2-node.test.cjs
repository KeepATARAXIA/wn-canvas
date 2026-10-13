const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies, globals = {}) {
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(id => {
        if (!(id in dependencies)) throw new Error('Unmocked ' + id);
        return dependencies[id];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function harness({ saveGate, submitGate, failSave = false, submitFails = false } = {}) {
    const nodes = [{ id: 'source', type: 'video', metadata: { content: 'blob:original' } }, { id: 'tool', title: '超分', type: 'video-tool:restore', metadata: { videoToolSettings: { resolution: 1440, batchSize: 13, temporalOverlap: 2, colorCorrection: 'wavelet', seed: 123 } } }];
    const requests = [], saved = [], cancelled = [], imports = [];
    let backend;
    const { VideoToolRuntime } = load('lib/canvas/video-tool-runtime.ts', {
        './node-registry': { getNodeDefinition: () => ({ resource: node => node.metadata.content ? { kind: 'video', url: node.metadata.content } : null }) },
        './canvas-node-factory': { videoMetadata: video => ({ ...video, status: 'success' }) },
        '@/services/file-storage': { uploadMediaFile: async blob => { imports.push(blob); return { content: 'blob:result' }; } },
        '@/services/api/canvas-video-tools': {
            submitVideoToolJob: () => assert.fail('Seed must not use Video2X service'),
            uploadVideoToolAsset: () => assert.fail('Seed must not upload to Video2X service'),
            submitSeedVr2ToolJob: async (id, params, signal) => { requests.push({ id, params }); if (submitGate) await submitGate.promise; signal.throwIfAborted(); if (submitFails) throw new Error('connection lost'); return backend = { id, status: 'running', stage: '修复' }; },
            getVideoToolJob: async id => backend || { id, status: 'cancelled' },
            cancelVideoToolJob: async id => { cancelled.push(id); return backend = { id, status: 'cancelled' }; },
            readVideoToolResult: async () => new Blob(['output']),
        },
    });
    const host = { getNodes: () => nodes, getNode: id => nodes.find(n => n.id === id), getConnections: () => [{ fromNodeId: 'source', toNodeId: 'tool' }], updateMetadata: (id, patch) => Object.assign(host.getNode(id).metadata, patch) };
    const runtime = new VideoToolRuntime('test-project', () => host, async (id, job) => { if (saveGate) await saveGate.promise; if (failSave) throw new Error('storage full'); saved.push([id, job]); });
    return { runtime, host, requests, saved, cancelled, imports, complete: () => backend.status = 'complete' };
}

test('creating and syncing a restore node never uploads or submits', () => {
    const h = harness();
    h.runtime.sync(h.host.getNodes());
    assert.equal(h.requests.length, 0);
    assert.equal(h.host.getNode('tool').metadata.content, undefined);
    h.runtime.dispose();
});

test('Start saves original ID before upload, forwards chosen quality, and blocks duplicate clicks', async () => {
    const saveGate = deferred(), h = harness({ saveGate });
    try {
        const work = h.runtime.startJob('tool');
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.match(h.host.getNode('tool').metadata.videoToolJobId, /^seedvr2-[0-9a-f]{32}$/);
        h.runtime.sync(h.host.getNodes());
        assert.equal(h.requests.length, 0);
        await assert.rejects(h.runtime.startJob('tool'), /已有任务/);
        saveGate.resolve(); const job = await work;
        assert.deepEqual(h.saved, [['tool', job.id]]);
        assert.equal(h.requests.length, 1);
        assert.deepEqual(h.requests[0].params.seedVr2, { batchSize: 13, temporalOverlap: 2, colorCorrection: 'wavelet', seed: 123 });
        assert.equal(h.requests[0].params.source, 'blob:original');
        assert.equal(h.requests[0].params.resolution, 1440);
    } finally { h.runtime.dispose(); }
});

test('failed local checkpoint cannot start GPU inference', async () => {
    const h = harness({ failSave: true });
    try { await assert.rejects(h.runtime.startJob('tool'), /storage full/); assert.equal(h.requests.length, 0); }
    finally { h.runtime.dispose(); }
});

test('cancelling during upload aborts upload and only cancels the reserved ID', async () => {
    const submitGate = deferred(), h = harness({ submitGate });
    try {
        const work = h.runtime.startJob('tool');
        await new Promise(resolve => setTimeout(resolve, 5));
        await h.runtime.cancel('tool'); submitGate.resolve();
        await assert.rejects(work, error => error.name === 'AbortError');
        assert.deepEqual(h.cancelled, [h.saved[0][1]]);
        assert.equal(h.runtime.state('tool').job.status, 'cancelled');
    } finally { h.runtime.dispose(); }
});

test('restored Seed ID polls without re-upload and imports into that same node', async () => {
    const h = harness();
    try {
        const first = await h.runtime.startJob('tool'); h.complete();
        h.runtime.dispose();
        // importResult is also used after a restored poll and must respect current ID.
        const h2 = harness();
        try {
            h2.host.getNode('tool').metadata.videoToolJobId = first.id;
            await h2.runtime.importResult('tool', { id: first.id, status: 'complete' });
            assert.equal(h2.host.getNode('tool').metadata.videoToolImportedJobId, first.id);
            assert.equal(h2.requests.length, 0);
        } finally { h2.runtime.dispose(); }
    } finally { h.runtime.dispose(); }
});

test('Seed adapter handles a missing interrupted upload by cancelling its ID before retry', async () => {
    const calls = [], id = 'a'.repeat(32);
    const api = load('services/api/canvas-video-tools.ts', { './seedvr2-video': {
        getSeedVr2Job: async key => { calls.push(['get', key]); return null; },
        cancelSeedVr2Video: async key => { calls.push(['cancel', key]); return { id: key, status: 'cancelled' }; },
    } });
    const job = await api.getVideoToolJob('seedvr2-' + id);
    assert.deepEqual(calls, [['get', id], ['cancel', id]]);
    assert.equal(job.status, 'cancelled');
});

test('Seed adapter routes complete result/cancel while old video tools keep their endpoint', async () => {
    const calls = [], id = 'b'.repeat(32);
    const api = load('services/api/canvas-video-tools.ts', { './seedvr2-video': {
        getSeedVr2Job: async () => ({ id, status: 'running', stage: '正在编码原视频', progress: 0, progressIndeterminate: true }),
        readSeedVr2Result: async key => { calls.push(key); return new Blob(['seed']); },
        cancelSeedVr2Video: async key => ({ id: key, status: 'cancelled' }),
    } }, { fetch: async url => { calls.push(url); return Response.json({ id: 'legacy', status: 'running' }); } });
    const job = await api.getVideoToolJob('seedvr2-' + id);
    assert.equal(job.progressIndeterminate, true); assert.equal(job.stage, '正在编码原视频');
    assert.equal(await (await api.readVideoToolResult(job.id)).text(), 'seed');
    assert.equal((await api.cancelVideoToolJob(job.id)).status, 'cancelled');
    assert.equal((await api.getVideoToolJob('legacy')).id, 'legacy');
    assert.deepEqual(calls, [id, 'http://127.0.0.1:17374/jobs/legacy']);
});

test('quality controls reject an old service before reading or uploading source video', async () => {
    const calls = [];
    const api = load('services/api/seedvr2-video.ts', { './local-prompt': { checkLocalGpuIdle: async () => {} } }, {
        fetch: async url => { calls.push(url); assert.ok(url.endsWith('/health')); return Response.json({ ready: true }); },
    });
    await assert.rejects(api.submitSeedVr2Video('blob:source', 1080, { batchSize: 9 }), /后台仍为旧版/);
    assert.equal(calls.length, 1);
});
