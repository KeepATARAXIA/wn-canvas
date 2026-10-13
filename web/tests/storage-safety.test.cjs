const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

// Execute the actual TypeScript modules with isolated in-memory browser storage.
// No browser profile, IndexedDB database, model service, or user file is modified.
function load(relativePath, dependencies, globals = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src', relativePath), 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', ...Object.keys(globals), code)(exports, (name) => {
        if (name in dependencies) return dependencies[name];
        throw new Error(`Unexpected import: ${name}`);
    }, ...Object.values(globals));
    return exports;
}

function storageHarness(initial = {}) {
    const disk = new Map(Object.entries(initial));
    const fallback = new Map();
    const events = new Map();
    const timers = new Map();
    let timerId = 0;
    const db = {
        INDEXEDDB: 'asyncStorage',
        config(options) { assert.equal(options.driver, this.INDEXEDDB, 'must not silently switch to a different empty database'); },
        getItem: async (key) => disk.get(key) ?? null,
        setItem: async (key, value) => { disk.set(key, value); },
        removeItem: async (key) => { disk.delete(key); },
    };
    const window = {
        localStorage: {
            getItem: (key) => fallback.get(key) ?? null,
            setItem: (key, value) => fallback.set(key, value),
            removeItem: (key) => fallback.delete(key),
        },
        addEventListener: (name, fn) => events.set(name, fn),
    };
    const api = load('lib/localforage-storage.ts', { localforage: db }, {
        window,
        document: { visibilityState: 'visible', addEventListener: (name, fn) => events.set(name, fn) },
        setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
        clearTimeout: (id) => timers.delete(id),
    });
    return { api, storage: api.localForageStorage, db, disk, fallback, events };
}

test('a read failure is not reported as an empty database', async () => {
    const h = storageHarness({ canvas: 'original' });
    h.db.getItem = async () => { throw new Error('database unavailable'); };
    await assert.rejects(h.storage.getItem('canvas'));
    assert.equal(h.disk.get('canvas'), 'original');
});

test('an existing backup does not hide a primary database read failure', async () => {
    const h = storageHarness({ canvas: 'primary' });
    h.fallback.set('canvas', 'backup');
    h.db.getItem = async () => { throw new Error('database unavailable'); };
    await assert.rejects(h.storage.getItem('canvas'));
    assert.equal(h.fallback.get('canvas'), 'backup');
});

test('conflicting old fallback and primary records are preserved for recovery', async () => {
    const h = storageHarness({ canvas: 'primary' });
    h.fallback.set('canvas', 'backup');
    await assert.rejects(h.storage.getItem('canvas'));
    assert.equal(h.disk.get('canvas'), 'primary');
    assert.equal(h.fallback.get('canvas'), 'backup');
});

test('fallback-only data is migrated before being removed', async () => {
    const h = storageHarness();
    h.fallback.set('canvas', 'backup');
    assert.equal(await h.storage.getItem('canvas'), 'backup');
    assert.equal(h.disk.get('canvas'), 'backup');
    assert.equal(h.fallback.has('canvas'), false);
});

test('failed fallback migration leaves the original backup intact', async () => {
    const h = storageHarness();
    h.fallback.set('canvas', 'backup');
    h.db.setItem = async () => { throw new Error('disk full'); };
    await assert.rejects(h.storage.getItem('canvas'));
    assert.equal(h.fallback.get('canvas'), 'backup');
});

test('write failures stay pending; retry writes the newest state without stale fallback', async () => {
    const h = storageHarness({ canvas: 'old' });
    await h.storage.getItem('canvas');
    const write = h.db.setItem;
    h.db.setItem = async () => { throw new Error('quota exceeded'); };
    h.storage.setItem('canvas', 'new');
    await h.api.flushStateWrites();
    assert.equal(h.disk.get('canvas'), 'old');
    assert.equal(h.fallback.has('canvas'), false);
    assert.equal(h.api.getStateStorageStatus().pending, 1);
    assert.match(h.api.getStateStorageStatus().writeError, /quota exceeded/);
    h.storage.setItem('canvas', 'newest');
    h.db.setItem = write;
    await h.api.flushStateWrites();
    assert.equal(h.disk.get('canvas'), 'newest');
    assert.equal(h.api.getStateStorageStatus().pending, 0);
    assert.equal(h.api.getStateStorageStatus().writeError, '');
});

test('a failed read cannot be followed by an empty-state write', async () => {
    const h = storageHarness({ canvas: 'original' });
    h.db.getItem = async () => { throw new Error('read failed'); };
    await assert.rejects(h.storage.getItem('canvas'));
    h.storage.setItem('canvas', 'empty');
    await h.api.flushStateWrites();
    assert.equal(h.disk.get('canvas'), 'original');
});

test('writes are serialized and an older in-flight save cannot replace a newer save', async () => {
    const h = storageHarness({ canvas: 'old' });
    await h.storage.getItem('canvas');
    let release;
    const firstWrite = new Promise((resolve) => { release = resolve; });
    const writes = [];
    h.db.setItem = async (key, value) => {
        writes.push(value);
        if (value === 'first') await firstWrite;
        h.disk.set(key, value);
    };
    h.storage.setItem('canvas', 'first');
    const flushing = h.api.flushStateWrites();
    await new Promise(setImmediate);
    h.storage.setItem('canvas', 'second');
    const again = h.api.flushStateWrites();
    release();
    await Promise.all([flushing, again]);
    assert.deepEqual(writes, ['first', 'second']);
    assert.equal(h.disk.get('canvas'), 'second');
});

test('rehydration returns pending edits instead of stale disk content', async () => {
    const h = storageHarness({ canvas: 'old' });
    await h.storage.getItem('canvas');
    h.storage.setItem('canvas', 'edited');
    assert.equal(await h.storage.getItem('canvas'), 'edited');
});

test('removing a record waits for an in-flight save and prevents its resurrection', async () => {
    const h = storageHarness({ canvas: 'old' });
    await h.storage.getItem('canvas');
    let release;
    h.db.setItem = async (key, value) => {
        await new Promise((resolve) => { release = resolve; });
        h.disk.set(key, value);
    };
    h.storage.setItem('canvas', 'edited');
    const flush = h.api.flushStateWrites();
    const removal = h.storage.removeItem('canvas');
    release();
    await Promise.all([flush, removal]);
    assert.equal(h.disk.has('canvas'), false);
    assert.equal(h.api.getStateStorageStatus().pending, 0);
});

test('failed asset hydration cannot rewrite the original asset index', async () => {
    const key = 'infinite-canvas:asset_store';
    const h = storageHarness({ [key]: '{broken-assets' });
    const { useAssetStore } = load('stores/use-asset-store.ts', {
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': require('../node_modules/zustand/middleware'),
        nanoid: { nanoid: () => 'test-asset' },
        '@/lib/localforage-storage': h.api,
        '@/services/image-storage': {},
        '@/services/file-storage': {},
        '@/lib/canvas/canvas-assets': {},
    });
    await new Promise(setImmediate);
    await h.api.flushStateWrites();
    assert.equal(useAssetStore.getState().hydrated, false);
    assert.equal(h.disk.get(key), '{broken-assets');
    assert.ok(h.api.getStateStorageStatus().readError);
});

test('leaving with pending writes requests a browser warning; successful saves clear it', async () => {
    const h = storageHarness();
    await h.storage.getItem('canvas');
    h.storage.setItem('canvas', 'new');
    let warned = false;
    h.events.get('beforeunload')({ preventDefault() { warned = true; } });
    assert.equal(warned, true);
    await h.api.flushStateWrites();
    warned = false;
    h.events.get('beforeunload')({ preventDefault() { warned = true; } });
    assert.equal(warned, false);
});

function canvasStore(h) {
    return load('stores/canvas/use-canvas-store.ts', {
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': require('../node_modules/zustand/middleware'),
        nanoid: { nanoid: () => 'test-new-project' },
        '@/i18n': { t: (key) => key },
        '@/lib/canvas-theme': load('lib/canvas-theme.ts', {}),
        '@/lib/localforage-storage': h.api,
    }).useCanvasStore;
}

test('Zustand hydration failure never overwrites existing projects', async () => {
    const key = 'infinite-canvas:canvas_store';
    const original = JSON.stringify({ state: { projects: [{ id: 'original' }] }, version: 0 });
    const h = storageHarness({ [key]: original });
    h.db.getItem = async () => { throw new Error('temporary read failure'); };
    const store = canvasStore(h);
    await new Promise(setImmediate);
    await h.api.flushStateWrites();
    assert.equal(store.getState().hydrated, false);
    assert.equal(h.disk.get(key), original);
    assert.ok(h.api.getStateStorageStatus().readError);
});

test('malformed persisted JSON is preserved and blocks editing', async () => {
    const key = 'infinite-canvas:canvas_store';
    const h = storageHarness({ [key]: '{incomplete' });
    const store = canvasStore(h);
    await new Promise(setImmediate);
    await h.api.flushStateWrites();
    assert.equal(store.getState().hydrated, false);
    assert.equal(h.disk.get(key), '{incomplete');
    assert.ok(h.api.getStateStorageStatus().readError);
});

test('initial hydration is read-only and saved edits survive reopening the store', async () => {
    const key = 'infinite-canvas:canvas_store';
    const original = JSON.stringify({ state: { projects: [{ id: 'a', title: 'A' }] }, version: 0 });
    const h = storageHarness({ [key]: original });
    const store = canvasStore(h);
    await new Promise(setImmediate);
    assert.equal(store.getState().hydrated, true);
    assert.equal(h.api.getStateStorageStatus().pending, 0);
    store.getState().renameProject('a', 'Edited');
    store.getState().updateProject('a', { nodes: [{ id: 'text-1', type: 'text', metadata: { content: '保存回归' } }], connections: [] });
    await h.api.flushStateWrites();
    assert.equal(JSON.parse(h.disk.get(key)).state.projects[0].title, 'Edited');
    const reopened = canvasStore(h);
    await new Promise(setImmediate);
    assert.equal(reopened.getState().projects[0].title, 'Edited');
    assert.equal(reopened.getState().projects[0].nodes[0].metadata.content, '保存回归');
});

test('an incompatible persisted version cannot replace projects with defaults', async () => {
    const key = 'infinite-canvas:canvas_store';
    const original = JSON.stringify({ state: { projects: [{ id: 'a', title: 'A' }] }, version: 99 });
    const h = storageHarness({ [key]: original });
    const store = canvasStore(h);
    await new Promise(setImmediate);
    await h.api.flushStateWrites();
    assert.equal(store.getState().hydrated, false);
    assert.equal(h.disk.get(key), original);
    assert.ok(h.api.getStateStorageStatus().readError);
});

test('a second tab cannot initialize stores or overwrite the first tab', async () => {
    let held = false;
    const locks = { async request(_name, options, callback) {
        assert.equal(options.ifAvailable, true);
        if (held) return callback(null);
        held = true;
        return callback({ name: 'editor' });
    } };
    const { runWithCanvasEditor } = load('lib/single-editor.ts', {}, { navigator: { locks } });
    let started = 0;
    let blocked = 0;
    void runWithCanvasEditor(async () => { started++; }, () => { blocked++; });
    await new Promise(setImmediate);
    await runWithCanvasEditor(async () => { started++; }, () => { blocked++; });
    assert.equal(started, 1);
    assert.equal(blocked, 1);
});

test('unsupported browser lock API fails closed before any store starts', async () => {
    const { runWithCanvasEditor } = load('lib/single-editor.ts', {}, { navigator: {} });
    let started = false;
    await assert.rejects(runWithCanvasEditor(async () => { started = true; }, () => {}));
    assert.equal(started, false);
});

test('legacy canvases receive empty tombstones in memory without a startup write', async () => {
    const key = 'infinite-canvas:canvas_store';
    const original = JSON.stringify({ state: { projects: [{ id: 'old', title: 'Old' }] }, version: 0 });
    const h = storageHarness({ [key]: original });
    const store = canvasStore(h);
    await new Promise(setImmediate);
    assert.deepEqual(store.getState().deletedProjects, []);
    assert.equal(h.disk.get(key), original);
    assert.equal(h.api.getStateStorageStatus().pending, 0);
    store.getState().deleteProjects(['old']);
    await h.api.flushStateWrites();
    const reopened = canvasStore(h);
    await new Promise(setImmediate);
    assert.deepEqual(reopened.getState().projects, []);
    assert.equal(reopened.getState().deletedProjects[0].id, 'old');
});

test('invalid deletion records block hydration and preserve the stored canvas', async () => {
    const key = 'infinite-canvas:canvas_store';
    const original = JSON.stringify({ state: { projects: [{ id: 'old' }], deletedProjects: 'damaged' }, version: 0 });
    const h = storageHarness({ [key]: original });
    const store = canvasStore(h);
    await new Promise(setImmediate);
    await h.api.flushStateWrites();
    assert.equal(store.getState().hydrated, false);
    assert.equal(h.disk.get(key), original);
});
