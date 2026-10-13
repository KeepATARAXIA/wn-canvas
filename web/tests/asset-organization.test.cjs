const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

const storeKey = 'infinite-canvas:asset_store';
const source = fs.readFileSync(path.join(__dirname, '../src/stores/use-asset-store.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const text = { id: 'text', kind: 'text', title: '文稿', tags: ['旧标签'], coverUrl: '', createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', data: { content: '原始正文' } };
const image = { ...text, id: 'image', kind: 'image', title: '图片', tags: [], data: { dataUrl: 'blob:old', storageKey: 'image:original', width: 100, height: 80, bytes: 12, mimeType: 'image/png' } };
const video = { ...text, id: 'video', kind: 'video', title: '视频', tags: [], data: { url: 'blob:video', storageKey: 'video:original', width: 100, height: 80, bytes: 24, mimeType: 'video/mp4' } };
const settle = () => new Promise(setImmediate);

function harness(state = { assets: [text, image, video] }) {
    const original = typeof state === 'string' ? state : JSON.stringify({ state, version: 0 });
    const disk = new Map([[storeKey, original]]);
    const cleanups = [], scheduled = [], errors = [], uploads = [];
    let sequence = 0, writes = 0, failNextWrite = false;
    const projects = [{ id: 'canvas', nodes: [{ metadata: { storageKey: image.data.storageKey } }] }];
    const modules = {
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': require('../node_modules/zustand/middleware'),
        nanoid: { nanoid: () => 'new-' + ++sequence },
        '@/lib/canvas/canvas-assets': { assetResourceKey: asset => asset.kind === 'text' ? 'text:' + asset.data.content : asset.kind + ':' + (asset.data.storageKey || asset.data.dataUrl || asset.data.url) },
        '@/lib/localforage-storage': { localForageStorage: { getItem: async key => disk.get(key), setItem: async (key, value) => { writes++; if (failNextWrite) { failNextWrite = false; throw new Error('quota exceeded'); } disk.set(key, value); } }, reportStateReadError: (_, error) => errors.push(error.message) },
        '@/services/image-storage': { ensureImagePreview: async () => {}, resolveImageUrl: async key => 'blob:resolved-' + key, cleanupUnusedImages: async value => cleanups.push(value), uploadImage: async value => { uploads.push(value); return { url: 'blob:migrated', storageKey: 'image:migrated', bytes: 12, mimeType: 'image/png' }; } },
        '@/services/file-storage': { resolveMediaUrl: async key => 'blob:resolved-' + key, cleanupUnusedMedia: async value => cleanups.push(value) },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ hydrated: true, projects }) } },
    };
    function open() {
        const exports = {};
        new Function('exports', 'require', 'window', code)(exports, name => { assert.ok(name in modules, name); return modules[name]; }, { setTimeout: callback => scheduled.push(callback) });
        return exports.useAssetStore;
    }
    return { open, disk, original, cleanups, scheduled, errors, projects, uploads, writes: () => writes, failNextWrite: () => { failNextWrite = true; } };
}

test('legacy assets gain empty registries and existing tags without a startup write', async () => {
    const h = harness(); const store = h.open(); await settle();
    assert.equal(store.getState().hydrated, true);
    assert.deepEqual(store.getState().folders, []);
    assert.deepEqual(store.getState().tags, ['旧标签']);
    assert.deepEqual(store.getState().deletedAssets, []);
    assert.equal(h.writes(), 0);
    assert.equal(h.disk.get(storeKey), h.original);
});

test('a failed persistence call can retry the same state references after the hydration skip', async () => {
    const h = harness(); const store = h.open(); await settle();
    const options = store.persist.getOptions();
    const value = { state: options.partialize(store.getState()), version: 0 };
    h.failNextWrite();
    await assert.rejects(options.storage.setItem(storeKey, value), /quota exceeded/);
    await options.storage.setItem(storeKey, value);
    assert.equal(h.writes(), 2);
    assert.equal(JSON.parse(h.disk.get(storeKey)).state.assets.length, 3);
});

test('legacy inline images persist their new media key once rather than remigrating on every reload', async () => {
    const dataUrl = 'data:image/png;base64,eA==';
    const h = harness({ assets: [{ ...image, coverUrl: dataUrl, data: { ...image.data, dataUrl, storageKey: undefined } }] });
    const store = h.open(); await settle();
    assert.equal(store.getState().hydrated, true);
    assert.equal(h.uploads.length, 1);
    assert.equal(h.writes(), 1);
    assert.equal(JSON.parse(h.disk.get(storeKey)).state.assets[0].data.storageKey, 'image:migrated');
    const reopened = h.open(); await settle();
    assert.equal(reopened.getState().assets[0].data.storageKey, 'image:migrated');
    assert.equal(h.uploads.length, 1);
    assert.equal(h.writes(), 1);
});

test('updates, trash, restore and permanent deletion advance a fast-clock record timestamp strictly', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const h = harness({ assets: [{ ...text, updatedAt: future }] }); const store = h.open(); await settle();
    store.getState().updateAssets(['text'], { favorite: true });
    const edited = store.getState().assets[0].updatedAt;
    assert.ok(edited > future);
    store.getState().trashAssets(['text']);
    const trashed = store.getState().assets[0].updatedAt;
    assert.ok(trashed > edited);
    store.getState().restoreAssets(['text']);
    const restored = store.getState().assets[0].updatedAt;
    assert.ok(restored > trashed);
    store.getState().removeAssets(['text']);
    assert.ok(store.getState().deletedAssets[0].deletedAt > restored);
});

test('folder management moves or unfiles assets while retaining identity and media', async () => {
    const h = harness(); const store = h.open(); await settle();
    const first = store.getState().addFolder('  角色  ');
    const second = store.getState().addFolder('场景');
    const beforeDuplicate = h.writes();
    assert.equal(store.getState().addFolder('角色').id, first.id);
    assert.equal(store.getState().addFolder('  '), null);
    assert.equal(h.writes(), beforeDuplicate);
    store.getState().renameFolder(first.id, '场景');
    assert.equal(store.getState().folders[0].name, '角色');
    store.getState().renameFolder(first.id, '人物');
    const media = store.getState().assets.find(asset => asset.id === 'image').data;
    const beforeBatch = h.writes();
    store.getState().updateAssets(['text', 'image', 'image', 'missing'], { folderId: first.id, favorite: true });
    assert.equal(h.writes() - beforeBatch, 1);
    store.getState().updateAssets(['text'], { folderId: null, title: '  新文稿  ' });
    assert.equal(store.getState().assets[0].folderId, undefined);
    assert.equal(store.getState().assets[0].title, '新文稿');
    store.getState().removeFolder(first.id);
    assert.deepEqual(store.getState().folders, [second]);
    assert.equal(store.getState().assets.length, 3);
    assert.equal(store.getState().assets.find(asset => asset.id === 'image').folderId, undefined);
    assert.equal(store.getState().assets.find(asset => asset.id === 'image').data, media);
    assert.equal(store.getState().assets.find(asset => asset.id === 'image').favorite, true);
    const reopened = h.open(); await settle();
    assert.deepEqual(reopened.getState().folders, [second]);
    assert.equal(reopened.getState().assets.find(asset => asset.id === 'image').favorite, true);
});

test('tag add/remove batches use one save and rename merges labels in active and trashed records', async () => {
    const h = harness(); const store = h.open(); await settle();
    store.getState().addTag(' 空标签 ');
    const before = h.writes();
    store.getState().updateAssets(['text', 'image'], { tags: ['旧标签', ' 新标签 ', '新标签'], tagMode: 'add' });
    assert.equal(h.writes() - before, 1);
    assert.deepEqual(store.getState().assets[0].tags, ['旧标签', '新标签']);
    store.getState().updateAssets(['image'], { tags: ['旧标签'], tagMode: 'remove' });
    assert.deepEqual(store.getState().assets[1].tags, ['新标签']);
    store.getState().trashAssets(['text']);
    store.getState().renameTag('旧标签', '新标签');
    assert.deepEqual(store.getState().assets[0].tags, ['新标签']);
    assert.deepEqual(store.getState().tags, ['新标签', '空标签']);
    store.getState().removeTag('新标签');
    assert.deepEqual(store.getState().assets[0].tags, []);
    assert.deepEqual(store.getState().assets[1].tags, []);
    assert.deepEqual(store.getState().tags, ['空标签']);
});

test('trashing and restoring preserve files, dedupe after reload and do not run media cleanup', async () => {
    const h = harness(); const store = h.open(); await settle();
    const media = store.getState().assets[1].data;
    const before = h.writes();
    store.getState().trashAssets(['image', 'video', 'image', 'missing']);
    assert.equal(h.writes() - before, 1);
    assert.equal(store.getState().assets[1].data, media);
    assert.ok(store.getState().assets[1].deletedAt);
    assert.equal(h.scheduled.length, 0);
    store.getState().trashAssets(['image']);
    assert.equal(h.writes() - before, 1);
    const reopened = h.open(); await settle();
    reopened.getState().syncCanvasAssets([image, video]);
    assert.equal(reopened.getState().assets.length, 3);
    assert.equal(reopened.getState().assets.filter(asset => !asset.deletedAt).length, 1);
    reopened.getState().restoreAssets(['image']);
    assert.equal(reopened.getState().assets[1].deletedAt, undefined);
    assert.equal(reopened.getState().assets[1].data.storageKey, 'image:original');
    assert.equal(h.scheduled.length, 0);
});

test('permanent removal saves exclusions and tombstones once while keeping canvas and remaining trash references', async () => {
    const h = harness(); const store = h.open(); await settle();
    store.getState().trashAssets(['image', 'video']);
    const before = h.writes();
    store.getState().removeAssets(['image', 'image', 'missing']);
    assert.equal(h.writes() - before, 1);
    assert.equal(h.scheduled.length, 1);
    assert.equal(store.getState().deletedAssets[0].id, 'image');
    assert.deepEqual(store.getState().excludedCanvasResources, ['image:image:original']);
    await h.scheduled[0]();
    assert.equal(h.cleanups.length, 2);
    for (const cleanup of h.cleanups) {
        assert.equal(cleanup.projects, h.projects);
        assert.ok(cleanup.assets.some(asset => asset.id === 'video' && asset.deletedAt));
    }
    const reopened = h.open(); await settle();
    reopened.getState().syncCanvasAssets([image, video]);
    assert.equal(reopened.getState().assets.some(asset => asset.id === 'image'), false);
    assert.equal(reopened.getState().assets.length, 2);
});

test('package import merges same-name folders, allocates new ids and persists organization in one batch', async () => {
    const h = harness({ assets: [], folders: [{ id: 'local-folder', name: '人物' }], tags: ['本地标签'] });
    const store = h.open(); await settle();
    const before = h.writes();
    const count = store.getState().importAssets([{ ...image, folderId: 'remote-folder', favorite: true, tags: ['包内标签'] }, { ...video, deletedAt: '2026-10-11T00:00:00Z' }], { folders: [{ id: 'remote-folder', name: '人物' }, { id: 'empty-folder', name: '空文件夹' }], tags: ['空标签'] });
    assert.equal(count, 1);
    assert.equal(h.writes() - before, 1);
    assert.equal(store.getState().assets[0].folderId, 'local-folder');
    assert.notEqual(store.getState().assets[0].id, image.id);
    assert.equal(store.getState().assets[0].createdAt, image.createdAt);
    assert.equal(store.getState().assets[0].favorite, true);
    assert.equal(store.getState().folders.length, 2);
    assert.deepEqual(store.getState().tags, ['本地标签', '空标签', '包内标签']);
});

for (const patch of [{ folders: 'bad' }, { tags: [1] }, { organizationUpdatedAt: 1 }, { deletedAssets: [{ id: 'x', deletedAt: 'bad' }] }, { excludedCanvasResources: [1] }, { assets: [{ ...image, favorite: 'yes' }] }, { assets: [{ ...image, deletedAt: false }] }]) {
    test('invalid organization remains intact and never becomes a writable empty store: ' + Object.keys(patch)[0] + JSON.stringify(patch).slice(0, 30), async () => {
        const h = harness({ assets: [text], ...patch }); const store = h.open(); await settle();
        assert.equal(store.getState().hydrated, false);
        assert.equal(h.writes(), 0);
        assert.equal(h.disk.get(storeKey), h.original);
        assert.equal(h.errors.length, 1);
    });
}
