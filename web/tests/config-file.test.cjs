const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');

function harness() {
    const sourceRoot = path.join(__dirname, '../src');
    const cache = new Map();
    const downloads = [];
    const overrides = {
        '@/i18n': { t: key => key },
        react: { useMemo: fn => fn() },
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': { persist: fn => fn },
        nanoid: { nanoid: () => 'test-channel' },
        'file-saver': { saveAs: (blob, name) => downloads.push({ blob, name }) },
    };
    function load(relative) {
        const file = path.resolve(sourceRoot, relative);
        if (cache.has(file)) return cache.get(file);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
        const exports = {};
        cache.set(file, exports);
        new Function('exports', 'require', code)(exports, name => {
            if (name in overrides) return overrides[name];
            const target = name.startsWith('@/') ? path.join(sourceRoot, name.slice(2)) : path.resolve(path.dirname(file), name);
            if (target.endsWith('?raw')) return fs.readFileSync(target.slice(0, -4), 'utf8');
            return load(fs.existsSync(target) ? target : target + '.ts');
        });
        return exports;
    }
    const config = load('stores/use-config-store.ts');
    const service = load('services/config-file.ts');
    const store = config.useConfigStore;
    const fixture = () => ({ app: 'infinite-canvas', version: 1, config: structuredClone(config.defaultConfig), webdav: { ...config.defaultWebdavSyncConfig } });
    const original = fixture();
    original.config.channels.push({ id: 'my-channel', name: 'Custom', baseUrl: 'http://127.0.0.1:1234', apiKey: 'test-only', apiFormat: 'openai', models: [{ name: 'custom', capability: 'text', script: 'custom script' }] });
    original.config.models.push('my-channel::custom');
    original.config.textModel = 'my-channel::custom';
    original.webdav.url = 'https://example.invalid/dav';
    store.setState({ config: original.config, webdav: original.webdav });
    const importData = data => service.importAppConfig({ text: async () => JSON.stringify(data) });
    return { config, service, store, fixture, importData, downloads };
}

test('malformed files never replace either saved configuration domain', async () => {
    const { store, fixture, importData, service } = harness();
    const previous = JSON.stringify({ config: store.getState().config, webdav: store.getState().webdav });
    const cases = [null, [], {}, { app: 'infinite-canvas', version: 1, config: {}, webdav: {} }, { ...fixture(), version: 2 }, { ...fixture(), app: 'other-app' }];
    for (const data of cases) {
        await assert.rejects(importData(data), /config.invalidFile/);
        assert.equal(JSON.stringify({ config: store.getState().config, webdav: store.getState().webdav }), previous);
    }
    await assert.rejects(service.importAppConfig({ text: async () => '{bad json' }), /config.invalidFile/);
    assert.equal(JSON.stringify({ config: store.getState().config, webdav: store.getState().webdav }), previous);
});

test('wrong field types and broken channel entries are rejected before writing', async () => {
    const { store, fixture, importData } = harness();
    const previous = store.getState();
    const patches = [
        data => { data.config.baseUrl = null; },
        data => { data.config.proxyEnabled = 'false'; },
        data => { data.config.imageGenerationDefaults = { count: 2 }; },
        data => { data.config.lastVideoGeneration = { model: 'test', completedAt: 'now' }; },
        data => { data.config.channels[0].models = {}; },
        data => { data.config.channels[0].models[0].capability = 'unsupported'; },
        data => { data.config.channels[0].models[0].script = 42; },
        data => { data.config.channels[0].apiFormat = 'unsupported'; },
        data => { data.config.channels.push({ ...data.config.channels[0] }); },
        data => { data.config.channels[0].models.push({ ...data.config.channels[0].models[0] }); },
        data => { data.config.imageModel = 'missing-channel::missing-model'; },
        data => { data.config.models.push('missing-channel::missing-model'); },
        data => { data.config.videoGenerationDefaults = { videoMode: 'unsupported' }; },
        data => { data.exportedAt = 42; },
        data => { data.config.webdav = {}; data.webdav.url = 42; },
        data => { delete data.webdav.password; },
    ];
    for (const patch of patches) {
        const data = fixture();
        patch(data);
        await assert.rejects(importData(data), /config.invalidFile/);
        assert.equal(store.getState().config, previous.config);
        assert.equal(store.getState().webdav, previous.webdav);
    }
});

test('current valid export imports atomically and preserves scripts and preferences', async () => {
    const { store, fixture, importData } = harness();
    const data = fixture();
    data.config.inheritLastImageSettings = true;
    data.config.imageGenerationDefaults = { size: '16:9', count: '2' };
    data.config.lastImageGeneration = { model: data.config.imageModel, completedAt: 1000, size: '16:9', quality: 'auto', background: '', count: '2' };
    data.webdav.url = 'https://backup.invalid/dav';
    const writes = [];
    const stop = store.subscribe(state => writes.push(state));
    await importData(data);
    stop();
    assert.equal(writes.length, 1);
    assert.deepEqual(store.getState().config, data.config);
    assert.deepEqual(store.getState().webdav, data.webdav);
});

test('older valid exports are completed without borrowing existing user values', async () => {
    const { store, fixture, importData, config } = harness();
    const data = fixture();
    for (const key of ['audioModel', 'audioSpeed', 'videoH3Mode', 'videoH3TeSpeed', 'canvasImageCount', 'proxyEnabled', 'proxyUrl', 'imageGenerationDefaults', 'lastImageGeneration']) delete data.config[key];
    delete data.webdav.lastSyncedAt;
    await importData(data);
    assert.equal(store.getState().config.audioSpeed, config.defaultConfig.audioSpeed);
    assert.equal(store.getState().config.audioModel, config.defaultConfig.audioModel);
    assert.equal(store.getState().config.channels.some(channel => channel.id === 'my-channel'), false);
    assert.equal(store.getState().webdav.lastSyncedAt, '');
});

test('older saved generation settings fill newly introduced fields but keep supplied settings', async () => {
    const { store, fixture, importData, config } = harness();
    const data = fixture();
    data.config.lastVideoGeneration = { model: data.config.videoModel, completedAt: 1000, size: '16:9', videoSeconds: '8', vquality: '720' };
    await importData(data);
    assert.equal(store.getState().config.lastVideoGeneration.videoSeconds, '8');
    assert.equal(store.getState().config.lastVideoGeneration.videoH3Mode, config.defaultConfig.videoH3Mode);
    assert.equal(store.getState().config.lastVideoGeneration.videoH3TeSpeed, config.defaultConfig.videoH3TeSpeed);
});

test('legacy exports without channel lists migrate raw model names and keep custom values', async () => {
    const { store, importData } = harness();
    await importData({ app: 'infinite-canvas', version: 1, config: { baseUrl: 'http://127.0.0.1:4321', apiKey: 'old-only', model: 'custom-text', models: ['custom-text', 'custom-image'], size: '16:9' }, webdav: { url: '', username: '', password: '', directory: 'legacy' } });
    const actual = store.getState().config;
    assert.equal(actual.channels.length, 1);
    assert.equal(actual.channels[0].baseUrl, 'http://127.0.0.1:4321');
    assert.equal(actual.model, 'default::custom-text');
    assert.equal(actual.textModel, 'default::custom-text');
    assert.equal(actual.imageModel, 'default::custom-image');
    assert.equal(actual.size, '16:9');
});

test('exported backup round trips and undo restores both previous domains once', async () => {
    const { service, store, importData, fixture, downloads } = harness();
    service.exportAppConfig();
    const backup = JSON.parse(await downloads[0].blob.text());
    assert.equal(downloads[0].name, 'infinite-canvas-config.json');
    const data = fixture();
    await importData(data);
    assert.equal(service.hasAppConfigImportBackup(), true);
    await assert.rejects(importData({ app: 'infinite-canvas', version: 1, config: {}, webdav: {} }));
    assert.equal(service.restoreAppConfigImportBackup(), true);
    assert.deepEqual(store.getState().config, backup.config);
    assert.deepEqual(store.getState().webdav, backup.webdav);
    assert.equal(service.hasAppConfigImportBackup(), false);
    assert.equal(service.restoreAppConfigImportBackup(), false);
    await importData(backup);
    assert.deepEqual(store.getState().config, backup.config);
});

test('opening configuration files synchronizes undo availability across concurrently mounted panels', async () => {
    const { service, fixture, importData } = harness();
    const source = fs.readFileSync(path.join(__dirname, '../src/components/layout/app-config-modal.tsx'), 'utf8');
    const file = ts.createSourceFile('app-config-modal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    const visit = node => {
        if (ts.isJsxAttribute(node) && node.name.getText(file) === 'onOpenChange' && node.initializer?.expression && ts.isArrowFunction(node.initializer.expression)) callback = node.initializer.expression.getText(file);
        ts.forEachChild(node, visit);
    };
    visit(file);
    assert.ok(callback, 'configuration file menu must update session snapshot availability on open');
    let modalCanRestore = false;
    const code = ts.transpileModule('return (' + callback + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const openMenu = new Function('hasAppConfigImportBackup', 'setCanRestoreImport', code)(service.hasAppConfigImportBackup, value => { modalCanRestore = value; });
    await importData(fixture()); // Imported from the other panel.
    assert.equal(modalCanRestore, false);
    openMenu(true);
    assert.equal(modalCanRestore, true);
    service.restoreAppConfigImportBackup(); // Restored from the other panel.
    openMenu(false);
    openMenu(true);
    assert.equal(modalCanRestore, false);
});
