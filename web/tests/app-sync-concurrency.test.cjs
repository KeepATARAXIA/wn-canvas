const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/app-sync.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

async function scenario(mode) {
    const old = { id: 'p', title: 'old', updatedAt: '2026-10-04T01:00:00Z', nodes: [] };
    let projects = [old], deleted = [], assets = [{ id: 'a', title: 'old', kind: 'video', coverUrl: '', data: { storageKey: 'video:a', url: '' }, updatedAt: old.updatedAt }];
    let changed = false;
    const manifests = [], events = [];
    const change = () => {
        if (changed) return;
        changed = true;
        if (mode === 'delete') { projects = []; deleted = [{ id: 'p', deletedAt: '2026-10-04T03:00:00Z' }]; }
        else if (mode === 'asset-delete') assets = [];
        else if (mode === 'asset-hydration') assets = [{ ...assets[0], title: 'new asset edit' }];
        else projects = [{ ...old, title: 'new edit', updatedAt: '2026-10-04T03:00:00Z' }];
    };
    const deps = {
        '@/i18n': { default: { t: s => s } },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ hydrated: true, projects, deletedProjects: deleted, replaceProjects: (p, d) => { projects = p; deleted = d; } }) } },
        '@/stores/use-asset-store': { useAssetStore: { getState: () => ({ hydrated: true, assets, replaceAssets: a => { assets = a; } }) } },
        '@/services/image-storage': { getImageBlob: async () => null, setImageBlob: async () => {}, resolveImageUrl: async () => '' },
        '@/services/file-storage': { getMediaBlob: async () => new Blob(['a']), setMediaBlob: async () => {}, resolveMediaUrl: async () => { if (['asset-hydration', 'asset-delete'].includes(mode)) change(); return 'blob:hydrated'; } },
        '@/services/webdav-sync': {
            WEBDAV_MANIFEST_FILE_NAME: 'manifest.json',
            downloadWebdavFile: async (_c, p) => new Blob([JSON.stringify({ app: 'infinite-canvas', version: 1, domain: p.split('/')[0], files: [], data: p.startsWith('canvas/') ? { projects: [{ id: 'remote', updatedAt: old.updatedAt, nodes: [] }], deleted: [] } : { assets: [] } })]),
            uploadWebdavFile: async (_c, p, blob) => { if (p === 'canvas/manifest.json') { manifests.push(JSON.parse(await blob.text())); if (mode === 'manifest-upload') change(); } },
        },
    };
    const exports = {};
    new Function('exports', 'require', code)(exports, name => { if (!(name in deps)) throw Error(name); return deps[name]; });
    let result, error;
    try { result = await exports.syncAppDataToWebdav({}, event => {
        events.push(event);
        if (event.domain === 'canvas' && event.stage === '下载缺失媒体' && ['edit', 'delete'].includes(mode)) change();
        if (event.domain === 'canvas' && event.stage === '上传新增媒体' && mode === 'upload') change();
    }); } catch (e) { error = e; }
    return { projects, deleted, assets, manifests, events, error, result };
}
test('unchanged local state still merges and publishes remote projects', async () => {
    const r = await scenario('unchanged');
    assert.ifError(r.error);
    assert.equal(r.projects.length, 2);
    assert.equal(r.manifests.length, 1);
});
for (const mode of ['edit', 'delete', 'upload', 'manifest-upload', 'asset-hydration', 'asset-delete']) {
    test(`sync preserves concurrent ${mode} and reports retry instead of success`, async () => {
        const r = await scenario(mode);
        assert.match(r.error?.message || '', /同步期间.*(编辑|变更|修改)/);
        assert.equal(r.events.some(e => e.stage === '同步完成' && e.status === 'success'), false);
        if (mode === 'delete') { assert.equal(r.projects.length, 0); assert.equal(r.deleted[0].id, 'p'); }
        else if (mode === 'asset-delete') assert.equal(r.assets.length, 0);
        else if (mode === 'asset-hydration') assert.equal(r.assets[0].title, 'new asset edit');
        else assert.equal(r.projects.find(p => p.id === 'p').title, 'new edit');
        if (['edit', 'delete', 'upload'].includes(mode)) assert.equal(r.manifests.length, 0);
    });
}
