const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const src = path.join(__dirname, '../src');

function harness(disk = new Map(), extraOverrides = {}) {
    const cache = new Map();
    const storage = { getItem: key => disk.get(key) || null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) };
    const overrides = {
        react: require('../node_modules/react'),
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': { persist: (initializer, options) => {
            const middleware = require('../node_modules/zustand/middleware');
            return middleware.persist(initializer, { ...options, storage: middleware.createJSONStorage(() => storage) });
        } },
        nanoid: { nanoid: () => 'id' },
        '@/i18n': { t: key => key },
        ...extraOverrides,
    };
    function load(relative) {
        const file = path.resolve(src, relative);
        if (cache.has(file)) return cache.get(file);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
        const output = {};
        cache.set(file, output);
        new Function('exports', 'require', 'localStorage', code)(output, name => {
            if (name in overrides) return overrides[name];
            const target = name.startsWith('@/') ? path.join(src, name.slice(2)) : path.resolve(path.dirname(file), name);
            if (target.endsWith('?raw')) return fs.readFileSync(target.slice(0, -4), 'utf8');
            return load(fs.existsSync(target) ? target : target + '.ts');
        }, storage);
        return output;
    }
    return { disk, load, api: load('stores/use-config-store.ts'), prefs: load('lib/canvas/generation-preferences.ts') };
}

test('automatic VRAM release defaults off and persists independently of generation settings', () => {
    const disk = new Map();
    const { api } = harness(disk);
    assert.equal(api.useConfigStore.getState().config.autoReleaseVram, false);
    api.useConfigStore.getState().updateConfig('autoReleaseVram', true);
    const restored = harness(disk).api.useConfigStore.getState();
    assert.equal(restored.config.autoReleaseVram, true);
    assert.equal(restored.config.inheritLastImageSettings, false);
    restored.updateConfig('autoReleaseVram', false);
    assert.equal(harness(disk).api.useConfigStore.getState().config.autoReleaseVram, false);
});

test('image and video defaults are independent and only affect newly created nodes', () => {
    const { api, load } = harness();
    const { createCanvasNode } = load('lib/canvas/canvas-node-factory.ts');
    const old = createCanvasNode('image', { x: 0, y: 0 });
    api.useConfigStore.getState().updateImageDefaults({ size: '2048x1360', quality: 'high', count: '5', background: '' });
    api.useConfigStore.getState().updateVideoDefaults({ size: '9:16', videoSeconds: '10', vquality: '720', videoH3Mode: 'turbo' });
    const image = createCanvasNode('image', { x: 0, y: 0 });
    const video = createCanvasNode('video', { x: 0, y: 0 });
    assert.equal(old.metadata.size, '1:1');
    assert.equal(old.metadata.count, 3);
    assert.equal(image.metadata.size, '2048x1360');
    assert.equal(image.metadata.count, 5);
    assert.equal(image.metadata.quality, 'high');
    assert.equal(video.metadata.size, '9:16');
    assert.equal(video.metadata.seconds, '10');
    assert.equal(video.metadata.videoH3Mode, 'turbo');
    assert.equal(video.metadata.vquality, '720');
    assert.equal(api.useConfigStore.getState().config.size, '1:1');
    api.useConfigStore.getState().updateImageDefaults({ count: '-5' });
    assert.equal(createCanvasNode('image', { x: 0, y: 0 }).metadata.count, 5);
    api.useConfigStore.getState().updateImageDefaults({ count: '99' });
    assert.equal(createCanvasNode('image', { x: 0, y: 0 }).metadata.count, 15);
});

test('switch uses the last success, falls back without a record, and restores defaults when disabled', () => {
    const { api, prefs } = harness();
    const store = api.useConfigStore;
    store.getState().updateImageDefaults({ size: '4:3', count: '2' });
    store.getState().updateConfig('inheritLastImageSettings', true);
    assert.equal(prefs.newGenerationMetadata(store.getState().config, 'image').size, '4:3');
    store.getState().updateConfig('lastImageGeneration', { model: api.defaultConfig.imageModel, size: '9:16', quality: 'low', count: '7', background: '', completedAt: 100 });
    assert.equal(prefs.newGenerationMetadata(store.getState().config, 'image').count, 7);
    assert.equal(prefs.newGenerationMetadata(store.getState().config, 'video').size, '1:1');
    store.getState().updateConfig('inheritLastImageSettings', false);
    assert.equal(prefs.newGenerationMetadata(store.getState().config, 'image').size, '4:3');
});

test('preferences and successful snapshots survive real persistence; legacy settings are preserved', () => {
    const h = harness();
    h.api.useConfigStore.getState().updateImageDefaults({ size: '3:2', count: '6' });
    h.api.useConfigStore.getState().updateVideoDefaults({ size: '16:9', videoSeconds: '12' });
    h.api.useConfigStore.getState().updateConfig('inheritLastVideoSettings', true);
    h.api.useConfigStore.getState().updateConfig('lastVideoGeneration', { ...h.prefs.videoDefaults(h.api.defaultConfig), model: h.api.defaultConfig.videoModel, size: '9:16', completedAt: 100 });
    const reopened = harness(h.disk);
    assert.equal(reopened.api.useConfigStore.getState().config.imageGenerationDefaults.count, '6');
    assert.equal(reopened.prefs.newGenerationMetadata(reopened.api.useConfigStore.getState().config, 'video').size, '9:16');
    const legacy = new Map([[h.api.CONFIG_STORE_KEY, JSON.stringify({ state: { config: { ...h.api.defaultConfig, size: '4:3', canvasImageCount: '8' } }, version: 0 })]]);
    const restored = harness(legacy);
    assert.equal(restored.prefs.newGenerationMetadata(restored.api.useConfigStore.getState().config, 'image').count, 8);
    assert.equal(restored.prefs.newGenerationMetadata(restored.api.useConfigStore.getState().config, 'video').size, '4:3');
});

test('removed models fall back to the configured default without carrying incompatible settings', () => {
    const { api, prefs } = harness();
    const config = { ...api.defaultConfig, inheritLastImageSettings: true, imageGenerationDefaults: { size: '16:9' }, lastImageGeneration: { model: 'deleted::model', size: '9:16', count: '9', completedAt: 100 } };
    const m = prefs.newGenerationMetadata(config, 'image');
    assert.equal(m.model, api.defaultConfig.imageModel);
    assert.equal(m.size, '16:9');
    assert.equal(m.count, 3);
});

test('uploads, explicit node metadata, and non-generation nodes retain their meaning', () => {
    const { api, load } = harness();
    api.useConfigStore.getState().updateImageDefaults({ size: '9:16', count: '5' });
    const { createCanvasNode } = load('lib/canvas/canvas-node-factory.ts');
    const uploaded = createCanvasNode('image', { x: 0, y: 0 }, { content: 'blob:upload', status: 'success' });
    assert.equal(uploaded.metadata.model, undefined);
    assert.equal(createCanvasNode('text', { x: 0, y: 0 }).metadata.model, undefined);
    const explicit = createCanvasNode('image', { x: 0, y: 0 }, { size: '1:1', count: 1 });
    assert.equal(explicit.metadata.size, '1:1');
    assert.equal(explicit.metadata.count, 1);
});

const node = (type, metadata) => ({ id: 'n', type, title: 'test', position: { x: 0, y: 0 }, width: 100, height: 100, metadata });
function complete(h, type, metadata, result = {}) {
    const { recordGenerationChanges } = h.load('lib/canvas/generation-history.ts');
    const before = node(type, { ...metadata, status: 'loading' });
    const after = node(type, { ...metadata, ...result, status: 'success', content: 'blob:result' });
    let history = recordGenerationChanges([], [before], [], 100, 'start');
    history = recordGenerationChanges([before], [after], history, 200, 'finish');
    return { before, after, history, result: h.prefs.completedGenerationPreferences([before], [after], history) };
}

test('completed images remember the request settings, excluding prompts, files, credentials and later edits', () => {
    const h = harness();
    const { result } = complete(h, 'image', { model: h.api.defaultConfig.imageModel, size: '3:2', quality: 'auto', background: '', count: 4, prompt: 'private prompt', references: ['secret.png'] }, { size: '9:16' });
    assert.deepEqual(result.image, { model: h.api.defaultConfig.imageModel, size: '3:2', quality: 'auto', background: '', count: '4', completedAt: 200 });
});

test('completed video remembers duration, mode, resolution, audio, watermark and H3 flags', () => {
    const h = harness();
    const { result } = complete(h, 'video', { model: h.api.defaultConfig.videoModel, size: '16:9', seconds: '12', vquality: '1080', generateAudio: 'false', watermark: 'true', h3SageAttention: 'false', h3TeSpeed: 'false', videoH3Mode: 'turbo', videoMode: 'reference', videoTaskId: 'job' });
    assert.equal(result.video.videoSeconds, '12');
    assert.equal(result.video.videoH3Mode, 'turbo');
    assert.equal(result.video.videoH3TeSpeed, 'false');
    assert.equal(result.video.videoGenerateAudio, 'false');
    assert.equal(result.video.videoWatermark, 'true');
    assert.equal(result.video.videoMode, 'reference');
    assert.equal(result.video.videoTaskId, undefined);
});

test('failure, cancel, import, manual edits and video processing never overwrite successful preferences', () => {
    const h = harness();
    const c = complete(h, 'video', { model: h.api.defaultConfig.videoModel, size: '16:9' });
    for (const status of ['error', 'idle', 'loading']) {
        assert.deepEqual(h.prefs.completedGenerationPreferences([c.before], [{ ...c.after, metadata: { ...c.after.metadata, status } }], c.history), {});
    }
    assert.deepEqual(h.prefs.completedGenerationPreferences([], [c.after], c.history), {});
    assert.deepEqual(h.prefs.completedGenerationPreferences([c.after], [c.after], c.history), {});
    assert.deepEqual(h.prefs.completedGenerationPreferences([{ ...c.before, metadata: { ...c.before.metadata, seedVr2TaskId: 'upscale' } }], [c.after], c.history), {});
});

test('a batch is remembered only once all outputs succeed; retry preserves its configured count', () => {
    const h = harness();
    const c = complete(h, 'image', { model: h.api.defaultConfig.imageModel, size: '4:3', count: 3 });
    const images = [{ id: '1', status: 'success', content: 'blob:one' }, { id: '2', status: 'error', content: '' }];
    const partial = { ...c.after, metadata: { ...c.after.metadata, images } };
    assert.deepEqual(h.prefs.completedGenerationPreferences([c.before], [partial], c.history), {});
    const success = { ...partial, metadata: { ...partial.metadata, images: images.map(image => ({ ...image, status: 'success', content: 'blob:ok' })) } };
    const result = h.prefs.completedGenerationPreferences([c.before], [success], c.history);
    assert.equal(result.image.count, '3');
});

test('image upscalers outside configured generation models do not replace last successful settings', () => {
    const h = harness(new Map(), { react: {
        ...require('../node_modules/react'),
        useReducer: (_, initial) => [{ ...initial, completed: { image: { model: '4x-UltraSharp', size: '4:3', count: '1', quality: 'auto', background: '', completedAt: 300 } } }, () => {}],
        useEffect: fn => fn(), useCallback: fn => fn,
    } });
    const saved = { model: h.api.defaultConfig.imageModel, size: '9:16', count: '3', quality: 'auto', background: '', completedAt: 200 };
    h.api.useConfigStore.getState().updateConfig('lastImageGeneration', saved);
    h.load('pages/canvas/hooks/use-generation-history.ts').useGenerationHistory();
    assert.deepEqual(h.api.useConfigStore.getState().config.lastImageGeneration, saved);
});
