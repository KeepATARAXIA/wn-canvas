const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies) {
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((id) => { if (!(id in dependencies)) throw new Error('Unmocked ' + id); return dependencies[id]; }, module, module.exports);
    return module.exports;
}

function harness() {
    const disk = new Map(), writes = [], downloads = [];
    let nextId = 0;
    const zip = load('lib/zip.ts', { fflate: require('../node_modules/fflate') });
    const get = async (key) => disk.get(key);
    const set = async (key, blob) => { writes.push(key); disk.set(key, blob); return `blob:restored-${key}`; };
    const api = load('pages/assets/asset-transfer.ts', {
        'file-saver': { saveAs: (blob) => downloads.push(blob) },
        nanoid: { nanoid: () => `import-${++nextId}` },
        '@/lib/zip': zip,
        '@/services/image-storage': { getImageBlob: get, setImageBlob: set },
        '@/services/file-storage': { getMediaBlob: get, setMediaBlob: set },
        '@/stores/use-config-store': { withLocalProxy: (url) => url },
    });
    return { api, zip, disk, writes, downloads };
}
const base = { id: 'saved', title: 'clip', tags: ['project'], coverUrl: '', source: 'Canvas', createdAt: '2026-09-22', updatedAt: '2026-09-22' };
const video = { ...base, kind: 'video', data: { storageKey: 'video:original', url: 'blob:old-session', width: 1280, height: 720, bytes: 4, mimeType: 'video/webm' } };
const text = { ...base, id: 'text', kind: 'text', data: { content: 'Original\ntext' } };

test('asset ZIP round trip preserves content, generates new media keys and rebinds current URLs', async () => {
    const h = harness();
    const original = new Blob(['clip'], { type: 'video/webm' });
    h.disk.set(video.data.storageKey, original);
    const snapshot = structuredClone(video);
    const archive = await h.api.buildAssetArchive([video, text]);
    const restored = await h.api.readAssetPackage(archive);
    assert.deepEqual(video, snapshot);
    assert.deepEqual(restored[1], text);
    assert.notEqual(restored[0].data.storageKey, video.data.storageKey);
    assert.match(restored[0].data.url, /^blob:restored-/);
    assert.equal(await h.disk.get(restored[0].data.storageKey).text(), 'clip');
    assert.equal(h.disk.get(video.data.storageKey), original);
    assert.deepEqual(h.writes, [restored[0].data.storageKey]);
});

test('incomplete manifest or missing ZIP binary rejects the whole import before writes', async () => {
    for (const files of [[], [{ storageKey: video.data.storageKey, path: 'files/missing.webm', bytes: 4, mimeType: 'video/webm' }]]) {
        const h = harness();
        const archive = await h.zip.createZip([{ name: 'assets.json', data: JSON.stringify({ app: 'infinite-canvas', version: 1, assets: [text, video], files }) }]);
        await assert.rejects(h.api.readAssetPackage(archive), /缺少|缺失/);
        assert.deepEqual(h.writes, []);
    }
});

test('asset ZIP size mismatch rejects before touching existing media', async () => {
    const h = harness();
    const archive = await h.zip.createZip([
        { name: 'assets.json', data: JSON.stringify({ app: 'infinite-canvas', version: 1, assets: [video], files: [{ storageKey: video.data.storageKey, path: 'clip.webm', bytes: 99, mimeType: 'video/webm' }] }) },
        { name: 'clip.webm', data: 'clip' },
    ]);
    await assert.rejects(h.api.readAssetPackage(archive), /大小不符/);
    assert.deepEqual(h.writes, []);
});

test('invalid display metadata rejects before any otherwise valid media is written', async () => {
    for (const patch of [{ coverUrl: { broken: true } }, { tags: [{ broken: true }] }, { source: 7 }, { updatedAt: 'invalid date' }, { favorite: 'yes' }, { folderId: 7 }, { deletedAt: 'invalid date' }]) {
        const h = harness();
        const archive = await h.zip.createZip([
            { name: 'assets.json', data: JSON.stringify({ app: 'infinite-canvas', version: 1, assets: [{ ...video, ...patch }], files: [{ storageKey: video.data.storageKey, path: 'clip.webm', bytes: 4, mimeType: 'video/webm' }] }) },
            { name: 'clip.webm', data: 'clip' },
        ]);
        await assert.rejects(h.api.readAssetPackage(archive), /无效/);
        assert.deepEqual(h.writes, []);
    }
});

test('organized asset ZIP preserves folders, explicit tags and favorites while excluding trash', async () => {
    const h = harness();
    h.disk.set(video.data.storageKey, new Blob(['clip'], { type: 'video/webm' }));
    const organization = { folders: [{ id: 'characters', name: '人物' }, { id: 'empty', name: '空文件夹' }], tags: ['project', '空标签'] };
    const organized = { ...video, folderId: 'characters', favorite: true };
    const archive = await h.api.buildAssetArchive([organized, { ...text, deletedAt: '2026-10-11T00:00:00Z' }], organization);
    const manifest = JSON.parse(await (await h.zip.readZip(archive)).get('assets.json').text());
    assert.equal(manifest.assets.length, 1);
    assert.deepEqual(manifest.organization, organization);
    const restored = await h.api.readAssetPackage(archive);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].favorite, true);
    assert.equal(restored[0].folderId, 'characters');
    assert.deepEqual(restored.packageOrganization, organization);
});

test('invalid package organization rejects before otherwise valid media is written', async () => {
    for (const organization of [null, { folders: [{ id: 'x', name: '人物' }, { id: 'x', name: '重复' }], tags: [] }, { folders: [], tags: [7] }]) {
        const h = harness();
        const archive = await h.zip.createZip([
            { name: 'assets.json', data: JSON.stringify({ app: 'infinite-canvas', version: 1, assets: [video], files: [{ storageKey: video.data.storageKey, path: 'clip.webm', bytes: 4, mimeType: 'video/webm' }], organization }) },
            { name: 'clip.webm', data: 'clip' },
        ]);
        await assert.rejects(h.api.readAssetPackage(archive), /无效/);
        assert.deepEqual(h.writes, []);
    }
});

test('an obsolete folder reference exports as unfiled and its own ZIP remains importable', async () => {
    const h = harness();
    h.disk.set(video.data.storageKey, new Blob(['clip'], { type: 'video/webm' }));
    const asset = { ...video, folderId: 'removed-folder', favorite: true };
    const archive = await h.api.buildAssetArchive([asset], { folders: [], tags: ['project'] });
    const restored = await h.api.readAssetPackage(archive);
    assert.equal(restored[0].folderId, undefined);
    assert.equal(restored[0].favorite, true);
    assert.equal(asset.folderId, 'removed-folder');
});

test('trashed asset cannot prepare an insertion payload', async () => {
    const { prepareAssetInsertPayload } = load('pages/assets/asset-payload.ts', { '@/services/image-storage': {}, '@/services/file-storage': {} });
    await assert.rejects(prepareAssetInsertPayload({ ...video, deletedAt: '2026-10-11T00:00:00Z' }), /回收站/);
});

test('export refuses missing stored media and never triggers a download', async () => {
    const h = harness();
    await assert.rejects(h.api.exportAssets([video], 'assets'), /本地素材文件缺失/);
    assert.equal(h.downloads.length, 0);
});

test('URL-only and legacy inline media become portable files with fresh URLs', async () => {
    const h = harness();
    const inline = { ...video, data: { ...video.data, storageKey: undefined, url: 'data:video/webm;base64,Y2xpcA==' } };
    const archive = await h.api.buildAssetArchive([inline]);
    const restored = await h.api.readAssetPackage(archive);
    assert.equal(await h.disk.get(restored[0].data.storageKey).text(), 'clip');
    const legacy = await h.zip.createZip([{ name: 'assets.json', data: JSON.stringify({ app: 'infinite-canvas', version: 1, assets: [inline], files: [] }) }]);
    const legacyRestored = await h.api.readAssetPackage(legacy);
    assert.match(legacyRestored[0].data.url, /^blob:restored-/);
    assert.equal(await h.disk.get(legacyRestored[0].data.storageKey).text(), 'clip');
});

test('invalid URL responses do not produce a successful asset backup', async () => {
    const h = harness();
    const invalid = { ...video, data: { ...video.data, storageKey: undefined, url: 'data:text/html,error-page' } };
    await assert.rejects(h.api.exportAssets([invalid], 'assets'), /没有返回有效素材文件/);
    assert.equal(h.downloads.length, 0);
});

test('asset request checks stored media existence and resolves a fresh session URL', async () => {
    const { prepareAssetInsertPayload } = load('pages/assets/asset-payload.ts', {
        '@/services/image-storage': { getImageBlob: async () => null },
        '@/services/file-storage': { getMediaBlob: async (key) => key === 'video:original' ? new Blob(['clip']) : null, resolveMediaUrl: async () => 'blob:current-session' },
    });
    const payload = await prepareAssetInsertPayload(video);
    assert.equal(payload.url, 'blob:current-session');
    assert.equal(video.data.url, 'blob:old-session');
    await assert.rejects(prepareAssetInsertPayload({ ...video, data: { ...video.data, storageKey: 'video:missing' } }), /本地素材文件缺失/);
});
