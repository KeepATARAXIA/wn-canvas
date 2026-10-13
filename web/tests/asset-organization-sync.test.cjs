const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/app-sync.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const oldTime = '2026-10-10T00:00:00Z', newTime = '2026-10-11T00:00:00Z';
const text = { id: 'a', kind: 'text', title: '文稿', tags: ['写实'], coverUrl: '', data: { content: '原文' }, createdAt: oldTime, updatedAt: oldTime };

async function scenario(local, remote, options = {}) {
    let state = { assets: [], folders: [], tags: [], organizationUpdatedAt: '', deletedAssets: [], excludedCanvasResources: [], ...structuredClone(local) };
    const snapshots = [], writes = [], events = [];
    const blobs = new Map(options.blobs || []);
    const projects = [], deletedProjects = [];
    const deps = {
        '@/i18n': { default: { t: key => key } },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ hydrated: true, projects, deletedProjects, replaceProjects() {} }) } },
        '@/stores/use-asset-store': { useAssetStore: { getState: () => ({ ...state, hydrated: true, replaceAssets: (assets, organization) => { state = { ...state, ...organization, assets }; } }) } },
        '@/services/image-storage': { getImageBlob: async key => blobs.get(key), setImageBlob: async (key, blob) => blobs.set(key, blob), resolveImageUrl: async key => 'blob:' + key },
        '@/services/file-storage': { getMediaBlob: async key => blobs.get(key), setMediaBlob: async (key, blob) => blobs.set(key, blob), resolveMediaUrl: async key => 'blob:' + key },
        '@/services/webdav-sync': {
            WEBDAV_MANIFEST_FILE_NAME: 'manifest.json',
            webdavFileMatches: async () => true,
            downloadWebdavFile: async (_, filename) => filename === 'assets/manifest.json' ? new Blob([JSON.stringify({ app: 'infinite-canvas', domain: 'assets', version: 1, data: remote, files: options.files || [] })]) : null,
            uploadWebdavFile: async (_, filename, blob) => { writes.push(filename); if (filename === 'assets/manifest.json') snapshots.push(JSON.parse(await blob.text())); },
        },
    };
    const exports = {};
    new Function('exports', 'require', code)(exports, name => { assert.ok(name in deps, name); return deps[name]; });
    let result, error;
    try {
        result = await exports.syncAppDataToWebdav({}, event => {
            events.push(event);
            if (options.concurrent && event.domain === 'assets' && event.stage === '下载缺失媒体') state = { ...state, ...options.concurrent };
        });
    } catch (e) { error = e; }
    return { state, snapshots, writes, events, result, error, blobs };
}

test('organization and favorites survive old WebDAV manifests without resetting local folders', async () => {
    const folders = [{ id: 'people', name: '人物' }];
    const r = await scenario({ assets: [{ ...text, folderId: 'people', favorite: true, updatedAt: newTime }], folders, tags: ['写实', '空标签'], organizationUpdatedAt: newTime }, { assets: [text] });
    assert.ifError(r.error);
    assert.deepEqual(r.state.folders, folders);
    assert.equal(r.state.assets[0].favorite, true);
    assert.equal(r.state.assets[0].folderId, 'people');
    assert.deepEqual(r.snapshots[0].data.tags, ['写实', '空标签']);
});

test('newer explicit registry edits propagate folder renames and tag removals', async () => {
    const r = await scenario({ assets: [text], folders: [{ id: 'people', name: '人物' }], tags: ['写实'], organizationUpdatedAt: oldTime }, { assets: [{ ...text, tags: ['肖像'], updatedAt: newTime }], folders: [{ id: 'people', name: '肖像' }], tags: ['肖像'], organizationUpdatedAt: newTime });
    assert.ifError(r.error);
    assert.deepEqual(r.state.folders, [{ id: 'people', name: '肖像' }]);
    assert.deepEqual(r.state.tags, ['肖像']);
    assert.deepEqual(r.state.assets[0].tags, ['肖像']);
});

test('recycle-bin records retain their media in synchronized manifests and active counts exclude them', async () => {
    const clip = { ...text, id: 'clip', kind: 'video', deletedAt: newTime, updatedAt: newTime, data: { storageKey: 'video:clip', url: 'blob:old', bytes: 3, mimeType: 'video/mp4' } };
    const r = await scenario({ assets: [text, clip] }, { assets: [text] }, { blobs: [['video:clip', new Blob(['abc'], { type: 'video/mp4' })]] });
    assert.ifError(r.error);
    assert.equal(r.result.assets, 1);
    assert.equal(r.state.assets.find(asset => asset.id === 'clip').deletedAt, newTime);
    assert.equal(r.snapshots[0].files[0].storageKey, 'video:clip');
    assert.equal(r.blobs.get('video:clip').size, 3);
});

test('a permanent-deletion tombstone blocks old remote assets without requiring their erased files', async () => {
    const remoteClip = { ...text, id: 'clip', kind: 'video', data: { storageKey: 'video:missing', url: '', bytes: 3, mimeType: 'video/mp4' } };
    const r = await scenario({ deletedAssets: [{ id: 'clip', deletedAt: newTime }], excludedCanvasResources: ['video:video:missing'] }, { assets: [remoteClip] });
    assert.ifError(r.error);
    assert.deepEqual(r.state.assets, []);
    assert.equal(r.snapshots[0].data.deletedAssets[0].id, 'clip');
    assert.deepEqual(r.snapshots[0].data.excludedCanvasResources, ['video:video:missing']);
});

test('a newer restored record wins over the older recycle-bin version', async () => {
    const r = await scenario({ assets: [{ ...text, updatedAt: newTime }] }, { assets: [{ ...text, deletedAt: oldTime }] });
    assert.ifError(r.error);
    assert.equal(r.state.assets[0].deletedAt, undefined);
    assert.equal(r.result.assets, 1);
});

test('remote-only records assigned to a removed folder return to the unfiled collection', async () => {
    const r = await scenario({ organizationUpdatedAt: newTime }, { assets: [{ ...text, folderId: 'deleted-folder' }], folders: [{ id: 'deleted-folder', name: '已移除' }], tags: ['写实'], organizationUpdatedAt: oldTime });
    assert.ifError(r.error);
    assert.equal(r.state.assets[0].folderId, undefined);
    assert.deepEqual(r.state.folders, []);
});

for (const concurrent of [{ folders: [{ id: 'live', name: '新文件夹' }] }, { tags: ['新标签'] }, { deletedAssets: [{ id: 'new', deletedAt: newTime }] }]) {
    test('concurrent registry or deletion edits stop synchronization without replacing the live state: ' + Object.keys(concurrent)[0], async () => {
        const r = await scenario({ assets: [text] }, { assets: [text] }, { concurrent });
        assert.match(r.error?.message || '', /同步期间.*编辑/);
        assert.deepEqual(r.state[Object.keys(concurrent)[0]], Object.values(concurrent)[0]);
        assert.equal(r.writes.includes('assets/manifest.json'), false);
    });
}

for (const patch of [{ folders: null }, { tags: [false] }, { deletedAssets: [{ id: 'x', deletedAt: false }] }, { organizationUpdatedAt: 1 }, { assets: [{ ...text, favorite: 'yes' }] }]) {
    test('invalid remote organization leaves local records intact: ' + Object.keys(patch)[0], async () => {
        const r = await scenario({ assets: [text] }, { assets: [text], ...patch });
        assert.match(r.error?.message || '', /远端资产管理记录无效/);
        assert.deepEqual(r.state.assets, [text]);
        assert.equal(r.writes.includes('assets/manifest.json'), false);
    });
}
