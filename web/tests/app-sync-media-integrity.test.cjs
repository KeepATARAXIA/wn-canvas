const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {test} = require('node:test'), ts = require('../node_modules/typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/app-sync.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
async function run(mode, domain = 'canvas', assetsGate) {
    const record = {id: 'p', title: '缺片测试作品', name: '缺片测试作品', kind: 'video', coverUrl: '', data: {storageKey: 'video:missing', url: ''}, updatedAt: '2026-10-04T00:00:00Z'};
    let projects = mode === 'local' ? [record] : [], assets = [], deleted = [];
    const blobs = new Map(), puts = [], events = [];
    if (['healthy','remote-lost'].includes(mode)) blobs.set('video:missing', new Blob(['abc']));
    const manifest = {app: 'infinite-canvas', domain, version: 1, data: domain === 'canvas' ? {projects: [record], deleted: []} : {assets: [record]}, files: mode === 'no-entry' ? [] : [{storageKey: 'video:missing', path: `${domain}/files/missing.mp4`, bytes: 3, mimeType: 'video/mp4'}]};
    const deps = {
        '@/i18n': {t: s => s},
        '@/stores/canvas/use-canvas-store': {useCanvasStore: {getState: () => ({hydrated: true, projects, deletedProjects: deleted, replaceProjects: (p,d) => {projects=p;deleted=d;}})}},
        '@/stores/use-asset-store': {useAssetStore: {getState: () => ({hydrated: true, assets, replaceAssets: a => {assets=a;}})}},
        '@/services/file-storage': {getMediaBlob: async k => blobs.get(k), setMediaBlob: async (k,b) => blobs.set(k,b), resolveMediaUrl: async () => 'blob:ok'},
        '@/services/image-storage': {getImageBlob: async () => null, setImageBlob: async () => {}, resolveImageUrl: async () => ''},
        '@/services/webdav-sync': {WEBDAV_MANIFEST_FILE_NAME: 'manifest.json', webdavFileMatches: async () => mode !== 'remote-lost', downloadWebdavFile: async (_c,p) => {
            if (p === 'assets/manifest.json' && assetsGate) await assetsGate;
            if (p === `${domain}/manifest.json`) return mode === 'local' ? null : new Blob([JSON.stringify(manifest)]);
            if (p.endsWith('manifest.json')) return null;
            if (mode === 'truncated') return new Blob(['x']);
            if (mode === 'download') return new Blob(['abc']);
            return null;
        }, uploadWebdavFile: async (_c,p) => puts.push(p)},
    };
    const exports = {};new Function('exports','require',code)(exports, s => {assert.ok(s in deps,s);return deps[s];});
    let error, result;try {result=await exports.syncAppDataToWebdav({}, e => events.push(e));} catch(e) {error=e;}
    return {error,result,puts,events,projects,assets,blobs};
}
for (const mode of ['missing','no-entry','truncated','local']) test(`missing media ${mode} fails before publishing incomplete canvas`, async () => {
    const r=await run(mode);
    assert.match(r.error?.message || '', /缺失|不完整/);
    assert.match(r.error.message, /video:missing/);
    assert.match(r.error.message, /缺片测试作品/);
    assert.equal(r.puts.includes('canvas/manifest.json'),false);
    assert.equal(r.events.some(e=>e.stage==='同步完成'),false);
    if(mode!=='local')assert.equal(r.projects.length,0);
});
test('missing asset fails with asset label and key', async () => {
    const r=await run('missing','assets');assert.match(r.error?.message||'', /video:missing/);assert.equal(r.assets.length,0);assert.equal(r.puts.includes('assets/manifest.json'),false);
});
for (const mode of ['healthy','download']) test(`available ${mode} media syncs normally`, async () => {
    const r=await run(mode);assert.ifError(r.error);assert.ok(r.result);assert.equal(r.projects.length,1);assert.equal(r.blobs.get('video:missing').size,3);assert.equal(r.puts.includes('canvas/manifest.json'),true);
});
test('a failed domain waits for the other domain before exposing retry', async () => {
    let release, finished = false;
    const gate = new Promise(resolve => { release = resolve; });
    const pending = run('missing', 'canvas', gate).then(result => { finished = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 20));
    const premature = finished;
    release();
    const result = await pending;
    assert.equal(premature, false);
    assert.match(result.error.message, /video:missing/);
});
test('remote file lost despite manifest is repaired from the local copy', async () => {
    const r = await run('remote-lost');
    assert.ifError(r.error);
    assert.ok(r.puts.includes('canvas/files/missing.mp4'));
    assert.ok(r.puts.indexOf('canvas/files/missing.mp4') < r.puts.indexOf('canvas/manifest.json'));
});
