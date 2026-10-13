const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');
const cache = {};
function load(relative) {
    if (cache[relative]) return cache[relative];
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative + '.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    new Function('exports', 'require', code)(exports, name => load(name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(relative), name)));
    cache[relative] = exports;
    return exports;
}
const { recordGenerationChanges: record, backfillGenerationHistory: backfill } = load('lib/canvas/generation-history');
const { collectCanvasAssets, assetResourceKey } = load('lib/canvas/canvas-assets');
const node = (metadata = {}, type = 'video', id = 'n') => ({ id, type, title: '舞狮', position: { x: 0, y: 0 }, width: 300, height: 200, metadata });
const loading = node({ status: 'loading', model: 'H3', prompt: '舞狮', progressStage: '排队' });
const done = node({ status: 'success', model: 'H3', content: 'blob:video', storageKey: 'video:one', naturalWidth: 480, naturalHeight: 480, bytes: 4096 });

test('records real stage durations, groups sampling steps, and freezes request parameters', () => {
    let h = record([], [loading], [], 1000, 'a');
    const sampling = node({ ...loading.metadata, progressStage: '正在采样 1/20 步' });
    h = record([loading], [sampling], h, 2000, 'b');
    const step2 = node({ ...sampling.metadata, progressStage: '正在采样 2/20 步', prompt: '后改提示词' });
    h = record([sampling], [step2], h, 3000, 'c');
    h = record([step2], [done], h, 5000, 'd');
    assert.equal(h.length, 1); assert.equal(h[0].status, 'success');
    assert.equal(h[0].endedAt - h[0].startedAt, 4000);
    assert.deepEqual(h[0].stages.map(s => [s.name, s.endedAt - s.startedAt]), [['排队', 1000], ['正在采样', 3000]]);
    assert.equal(h[0].metadata.prompt, '舞狮'); assert.equal(h[0].metadata.bytes, 4096);
});

test('retry creates another record and preserves previous file after replacing or deleting node', () => {
    let h = record([], [loading], [], 1000, 'a');
    h = record([loading], [done], h, 5000, 'b');
    const retry = node({ ...done.metadata, status: 'loading' });
    h = record([done], [retry], h, 6000, 'c');
    const done2 = node({ ...done.metadata, storageKey: 'video:two', content: 'blob:two' });
    h = record([retry], [done2], h, 8000, 'd');
    h = record([done2], [], h, 9000, 'e');
    assert.equal(h.length, 2);
    assert.equal(h[0].metadata.storageKey, 'video:one'); assert.equal(h[1].metadata.storageKey, 'video:two');
    assert.equal(collectCanvasAssets('p', [], h).length, 2);
});

test('batch successes and failures have independent records and assets', () => {
    const batch = node({ model: 'image', status: 'loading', images: [{ id: 'a', status: 'loading', content: '' }, { id: 'b', status: 'loading', content: '' }] }, 'image');
    let h = record([], [batch], [], 1000, 'start');
    const partial = node({ ...batch.metadata, images: [{ id: 'a', status: 'success', content: 'blob:a', storageKey: 'image:a', naturalWidth: 1024, naturalHeight: 768, bytes: 99 }, { id: 'b', status: 'error', content: '', errorDetails: '失败' }] }, 'image');
    h = record([batch], [partial], h, 4000, 'end');
    assert.deepEqual(h.map(r => r.status), ['success', 'error']);
    const assets = collectCanvasAssets('p', [partial], h);
    assert.equal(assets.length, 1); assert.equal(assets[0].data.width, 1024);
});

test('ordinary upload is an asset, never a fabricated generation', () => {
    const uploaded = node({ content: 'blob:x', storageKey: 'image:x', status: 'success', bytes: 77 }, 'image');
    assert.equal(record([], [uploaded], [], 1000, 'a').length, 0);
    assert.equal(backfill([uploaded], [], 1000).length, 0);
    assert.equal(collectCanvasAssets('p', [uploaded, { ...uploaded, id: 'copy' }], []).length, 1);
});

test('old generated media has unknown timestamps and is backfilled only once', () => {
    const first = backfill([done], [], 1000);
    assert.equal(first.length, 1); assert.equal(first[0].startedAt, undefined); assert.equal(first[0].endedAt, undefined);
    assert.equal(backfill([done], JSON.parse(JSON.stringify(first)), 5000).length, 1);
});

test('refresh marks active records interrupted without counting offline time', () => {
    const h = record([], [loading], [], 1000, 'a');
    const restored = backfill([loading], JSON.parse(JSON.stringify(h)), 900000);
    assert.equal(restored[0].status, 'interrupted'); assert.equal(restored[0].endedAt, undefined);
    assert.equal(restored[0].stages[0].endedAt, undefined);
});

test('cancellation and deletion close pending records and do not archive partial content', () => {
    const h = record([], [loading], [], 1000, 'a');
    for (const after of [[], [node({ ...loading.metadata, status: 'idle' })]]) {
        const result = record([loading], after, h, 2000, 'b');
        assert.equal(result[0].status, 'canceled'); assert.equal(result[0].endedAt, 2000);
        assert.equal(collectCanvasAssets('p', [], result).length, 0);
    }
});

test('text streaming is excluded from assets until complete; identical retry still gets a record', () => {
    const start = node({ status: 'loading', model: 'text', content: '相同答案' }, 'text');
    let h = record([], [start], [], 1000, 'a');
    assert.equal(collectCanvasAssets('p', [start], h).length, 0);
    const end = node({ ...start.metadata, status: 'success' }, 'text');
    h = record([start], [end], h, 2000, 'b');
    assert.equal(h[0].status, 'success'); assert.equal(collectCanvasAssets('p', [end], h).length, 1);
});

test('audio uploads and generated outputs are assets with media storage references', () => {
    const audio = node({ status: 'success', content: 'blob:audio', storageKey: 'audio:x', bytes: 88, mimeType: 'audio/wav' }, 'audio');
    const assets = collectCanvasAssets('p', [audio], []);
    assert.equal(assets[0].kind, 'audio'); assert.equal(assetResourceKey(assets[0]), 'audio:audio:x');
});

test('pure recorder is safe under React updater replay and ignores layout changes', () => {
    const a = record([], [loading], [], 1000, 'same');
    const b = record([], [loading], [], 1000, 'same');
    assert.deepEqual(a, b);
    assert.equal(record([loading], [{ ...loading, position: { x: 50, y: 10 } }], a, 2000, 'move'), a);
});

test('manual changes to old generated text do not create a second generation on reload', () => {
    const old = node({ model: 'text', status: 'success', content: '原文' }, 'text');
    const h = backfill([old], [], 1000);
    const edited = node({ ...old.metadata, content: '手动修改' }, 'text');
    assert.equal(backfill([edited], h, 2000).length, 1);
    assert.equal(collectCanvasAssets('p', [edited], h)[0].data.content, '原文');
});

test('actual asset store sync is idempotent, hydration gated, and remembers removal after reload', async () => {
    const disk = new Map(); let sequence = 0;
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/stores/use-asset-store.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const modules = {
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': require('../node_modules/zustand/middleware'),
        nanoid: { nanoid: () => `asset-${++sequence}` },
        '@/lib/canvas/canvas-assets': load('lib/canvas/canvas-assets'),
        '@/lib/localforage-storage': { localForageStorage: { getItem: async key => disk.get(key), setItem: async (key, value) => disk.set(key, value), removeItem: async key => disk.delete(key) }, reportStateReadError: (_, error) => assert.fail(error) },
        '@/services/image-storage': { ensureImagePreview: async () => {}, resolveImageUrl: async key => 'resolved:' + key },
        '@/services/file-storage': { resolveMediaUrl: async key => 'resolved:' + key },
    };
    const open = () => { const exports = {}; new Function('exports', 'require', 'window', code)(exports, name => modules[name], { setTimeout() {} }); return exports.useAssetStore; };
    const store = open();
    const candidates = collectCanvasAssets('p', [done], []);
    store.getState().syncCanvasAssets(candidates); assert.equal(store.getState().assets.length, 0);
    await new Promise(setImmediate);
    store.getState().syncCanvasAssets(candidates); store.getState().syncCanvasAssets(candidates);
    assert.equal(store.getState().assets.length, 1);
    const id = store.getState().assets[0].id;
    assert.equal(store.getState().addAsset(candidates[0]), id);
    store.getState().removeAsset(id); store.getState().syncCanvasAssets(candidates);
    assert.equal(store.getState().assets.length, 0);
    const reopened = open(); await new Promise(setImmediate);
    reopened.getState().syncCanvasAssets(candidates); assert.equal(reopened.getState().assets.length, 0);
    const audio = node({ status: 'success', content: 'blob:audio', storageKey: 'audio:x', mimeType: 'audio/wav' }, 'audio');
    reopened.getState().syncCanvasAssets(collectCanvasAssets('p', [audio], []));
    const final = open(); await new Promise(setImmediate);
    assert.equal(final.getState().assets[0].kind, 'audio'); assert.equal(final.getState().assets[0].data.url, 'resolved:audio:x');
});

test('batch asset removal writes once, ignores duplicate and missing ids, and persists every exclusion', async () => {
    const audio = node({ status: 'success', content: 'blob:audio', storageKey: 'audio:kept', mimeType: 'audio/wav' }, 'audio', 'audio-node');
    const image = node({ status: 'success', content: 'blob:image', storageKey: 'image:removed', mimeType: 'image/png' }, 'image', 'image-node');
    const drafts = [...collectCanvasAssets('p', [done, image, audio], []), { kind: 'text', title: '文本', coverUrl: '', tags: [], data: { content: '已删除文本' } }];
    const assets = drafts.map((asset, i) => ({ ...asset, id: `asset-${i}`, createdAt: 'old', updatedAt: 'old' }));
    assets.push({ ...assets[1], id: 'image-copy' });
    const disk = new Map([['infinite-canvas:asset_store', JSON.stringify({ state: { assets, excludedCanvasResources: ['video:earlier'] }, version: 0 })]]);
    let writes = 0; let cleanups = 0; let updates = 0; let scheduledCleanup;
    const projects = [{ id: 'p', nodes: [done, image, audio] }];
    const cleanupInputs = [];
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/stores/use-asset-store.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const modules = {
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': require('../node_modules/zustand/middleware'),
        nanoid: { nanoid: () => 'new-asset' },
        '@/lib/canvas/canvas-assets': load('lib/canvas/canvas-assets'),
        '@/lib/localforage-storage': { localForageStorage: { getItem: async key => disk.get(key), setItem: async (key, value) => { writes++; disk.set(key, value); }, removeItem: async key => disk.delete(key) }, reportStateReadError: (_, error) => assert.fail(error) },
        '@/services/image-storage': { ensureImagePreview: async () => {}, resolveImageUrl: async key => 'resolved:' + key, cleanupUnusedImages: async data => cleanupInputs.push(data) },
        '@/services/file-storage': { resolveMediaUrl: async key => 'resolved:' + key, cleanupUnusedMedia: async data => cleanupInputs.push(data) },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ hydrated: true, projects }) } },
    };
    const open = () => { const exports = {}; new Function('exports', 'require', 'window', code)(exports, name => modules[name], { setTimeout(callback) { cleanups++; scheduledCleanup = callback; } }); return exports.useAssetStore; };
    const store = open(); await new Promise(setImmediate);
    const kept = store.getState().assets.find(asset => asset.id === 'asset-2');
    writes = 0;
    store.subscribe(() => updates++);
    store.getState().removeAssets(['asset-0', 'asset-1', 'asset-3', 'image-copy', 'asset-0', 'missing']);
    assert.deepEqual(store.getState().assets, [kept]);
    assert.equal(updates, 1); assert.equal(writes, 1); assert.equal(cleanups, 1);
    assert.deepEqual(store.getState().excludedCanvasResources, ['video:earlier', 'video:video:one', 'image:image:removed', 'text:已删除文本']);
    await scheduledCleanup();
    assert.equal(cleanupInputs.length, 2);
    for (const input of cleanupInputs) {
        assert.deepEqual(input.assets, [kept]);
        assert.equal(input.projects, projects);
    }
    store.getState().removeAssets([]); store.getState().removeAssets(['missing']);
    assert.equal(updates, 1); assert.equal(writes, 1); assert.equal(cleanups, 1);
    const reopened = open(); await new Promise(setImmediate);
    reopened.getState().syncCanvasAssets(drafts);
    assert.equal(reopened.getState().assets.length, 1);
    assert.equal(reopened.getState().assets[0].id, kept.id);
    assert.equal(reopened.getState().assets[0].data.storageKey, 'audio:kept');
    assert.equal(collectCanvasAssets('p', [done, image, audio], []).length, 3);
});
