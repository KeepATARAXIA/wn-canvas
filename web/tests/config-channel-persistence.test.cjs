const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');

function harness() {
    const sourceRoot = path.join(__dirname, '../src');
    const cache = new Map();
    let persistence;
    const overrides = {
        '@/i18n': { t: key => key },
        react: { useMemo: fn => fn() },
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': { persist: (initializer, options) => { persistence = options; return initializer; } },
        nanoid: { nanoid: () => 'test-channel' },
    };
    function load(relative) {
        const file = path.resolve(sourceRoot, relative);
        if (cache.has(file)) return cache.get(file);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText;
        const exports = {};
        cache.set(file, exports);
        new Function('exports', 'require', 'fetch', code)(exports, name => {
            if (name in overrides) return overrides[name];
            const target = name.startsWith('@/') ? path.join(sourceRoot, name.slice(2)) : path.resolve(path.dirname(file), name);
            if (target.endsWith('?raw')) return fs.readFileSync(target.slice(0, -4), 'utf8');
            return load(fs.existsSync(target) ? target : target + '.ts');
        }, () => { throw new Error('Persistence tests must not make network requests'); });
        return exports;
    }
    const config = load('stores/use-config-store.ts');
    return {
        config,
        save() {
            // Use the store's real serialized selection, as localStorage does.
            return JSON.parse(JSON.stringify(persistence.partialize(config.useConfigStore.getState())));
        },
        restore(persisted) {
            // Call the application's actual merge against a freshly initialized store.
            return persistence.merge(persisted, config.useConfigStore.getState());
        },
    };
}

function savedH3(baseUrl, changes = {}) {
    const app = harness();
    const channels = structuredClone(app.config.defaultConfig.channels);
    channels.find(channel => channel.id === 'local-comfyui').baseUrl = baseUrl;
    const state = app.config.useConfigStore.getState();
    state.updateConfig('channels', channels);
    for (const [key, value] of Object.entries(changes)) state.updateConfig(key, value);
    return app.save();
}

function h3Channel(config) {
    return config.channels.find(channel => channel.id === 'local-comfyui');
}

for (const address of ['http://127.0.0.1:8188', 'http://127.0.0.1:8188/', 'http://localhost:8188', 'http://localhost:8188/']) {
    test(`refresh preserves the saved H3 direct address ${address}`, () => {
        const persisted = savedH3(address);
        const once = harness().restore(persisted);
        assert.equal(h3Channel(once.config).baseUrl, address);
        const twice = harness().restore(JSON.parse(JSON.stringify({ config: once.config, webdav: once.webdav })));
        assert.equal(h3Channel(twice.config).baseUrl, address);
    });
}

test('refresh preserves an explicitly enabled SageAttention setting on a direct H3 channel', () => {
    const persisted = savedH3('http://127.0.0.1:8188', {
        videoH3SageAttention: 'true', videoH3TeSpeed: 'false', videoH3Mode: 'native',
    });
    const { config } = harness().restore(persisted);
    assert.equal(config.videoH3SageAttention, 'true');
    assert.equal(config.videoH3TeSpeed, 'false');
    assert.equal(config.videoH3Mode, 'native');
});

for (const address of ['http://localhost:3000/api/comfyui', 'http://localhost:13117/api/comfyui', 'https://h3.example.invalid/custom-api']) {
    test(`refresh preserves the existing proxy or custom H3 channel ${address}`, () => {
        const persisted = savedH3(address, { videoH3SageAttention: 'true', videoH3Mode: 'turbo', videoH3TeSpeed: 'false' });
        const expected = {
            id: 'local-comfyui', name: 'My existing H3', baseUrl: address, apiKey: 'test-only-credential',
            apiFormat: 'openai', serviceType: 'comfyui',
            models: [{ name: 'My H3 video', capability: 'video', script: '// custom script\nreturn { custom: true };', workflowId: 'custom-h3-workflow' }],
        };
        persisted.config.channels = persisted.config.channels.map(channel => channel.id === expected.id ? expected : channel);
        persisted.config.videoModel = 'local-comfyui::My H3 video';
        persisted.config.model = persisted.config.videoModel;
        const before = structuredClone(persisted);
        const { config } = harness().restore(persisted);
        assert.deepEqual(h3Channel(config), expected);
        assert.equal(config.videoModel, persisted.config.videoModel);
        assert.equal(config.model, persisted.config.model);
        assert.equal(config.videoH3SageAttention, 'true');
        assert.equal(config.videoH3Mode, 'turbo');
        assert.equal(config.videoH3TeSpeed, 'false');
        assert.deepEqual(persisted, before, 'Restoring must not mutate the saved input');
    });
}

test('an empty saved state still initializes H3 and all four Qwen workflows', () => {
    const { config } = harness().restore(undefined);
    assert.equal(config.channels.filter(channel => channel.id === 'local-comfyui').length, 1);
    assert.equal(config.channels.filter(channel => channel.id === 'local-qwen-image21').length, 1);
    assert.equal(h3Channel(config).serviceType, 'comfyui');
    assert.equal(h3Channel(config).models[0].name, 'MiniMax-H3');
    assert.deepEqual(config.channels.find(channel => channel.id === 'local-qwen-image21').models.map(model => model.workflowId), [
        'builtin:qwen-image21-t2i', 'builtin:qwen-image21-edit',
        'builtin:qwen-image21-turbo-t2i', 'builtin:qwen-image21-turbo-edit',
    ]);
    assert.equal(config.qwenImage21Initialized, true);
    assert.equal(config.qwenImage21DefaultInitialized, true);
    assert.equal(config.qwenImage21TurboInitialized, true);
});

test('older configurations missing the local presets keep custom channels while adding the presets once', () => {
    const customChannel = {
        id: 'existing-api', name: 'Existing API', baseUrl: 'https://api.example.invalid/v1', apiKey: 'test-only-key',
        apiFormat: 'openai', serviceType: 'api',
        models: [{ name: 'my-image', capability: 'image', script: '// retained custom image script', workflowId: undefined }],
    };
    const persisted = { config: {
        channels: [customChannel], imageModel: 'existing-api::my-image', model: 'existing-api::my-image',
        videoH3SageAttention: 'true',
    } };
    const once = harness().restore(persisted);
    assert.deepEqual(once.config.channels.find(channel => channel.id === customChannel.id), customChannel);
    assert.equal(once.config.imageModel, 'existing-api::my-image');
    assert.equal(once.config.videoH3SageAttention, 'true');
    assert.equal(once.config.channels.filter(channel => channel.id === 'local-comfyui').length, 1);
    assert.equal(once.config.channels.filter(channel => channel.id === 'local-qwen-image21').length, 1);
    const twice = harness().restore(JSON.parse(JSON.stringify({ config: once.config })));
    assert.deepEqual(twice.config.channels.map(channel => channel.id), once.config.channels.map(channel => channel.id));
    assert.equal(twice.config.imageModel, 'existing-api::my-image');
});

test('a Qwen preset intentionally removed after initialization is not restored', () => {
    const app = harness();
    const state = app.config.useConfigStore.getState();
    state.updateConfig('channels', structuredClone(app.config.defaultConfig.channels.filter(channel => channel.id !== 'local-qwen-image21')));
    const restored = harness().restore(app.save());
    assert.equal(restored.config.channels.some(channel => channel.id === 'local-qwen-image21'), false);
    assert.equal(restored.config.channels.filter(channel => channel.id === 'local-comfyui').length, 1);
});
