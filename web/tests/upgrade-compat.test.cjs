const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const src = path.join(__dirname, '../src');
const translate = { t: (key, values = {}) => values.prompt ? `${key}: ${values.prompt}` : key };

// Load real modules with all persistence, HTTP, GPU work and browser APIs isolated.
function loader(overrides = {}, globals = {}) {
    const cache = new Map();
    function load(file) {
        file = path.resolve(src, file);
        if (cache.has(file)) return cache.get(file);
        let source = fs.readFileSync(file, 'utf8');
        const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
        const output = {};
        cache.set(file, output);
        const resolve = (name) => {
            if (name in overrides) return overrides[name];
            if (name === '@/i18n') return translate;
            if (name.startsWith('.') || name.startsWith('@/')) {
                const target = name.startsWith('@/') ? path.join(src, name.slice(2)) : path.resolve(path.dirname(file), name);
                if (target.endsWith('?raw')) return fs.readFileSync(target.slice(0, -4), 'utf8');
                return load(fs.existsSync(target) ? target : target + '.ts');
            }
            throw new Error('Unexpected dependency: ' + name);
        };
        new Function('exports', 'require', ...Object.keys(globals), code)(output, resolve, ...Object.values(globals));
        return output;
    }
    return load;
}

function configHarness() {
    let persistOptions;
    const load = loader({
        react: { useMemo: (fn) => fn() },
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': { persist: (fn, options) => { persistOptions = options; return fn; } },
        nanoid: { nanoid: () => 'new-channel' },
    });
    const api = load('stores/use-config-store.ts');
    return { api, load, hydrate: (config) => persistOptions.merge({ config }, api.useConfigStore.getState()).config };
}

test('legacy Ark and custom H3 settings survive config hydration', () => {
    const { api, hydrate } = configHarness();
    const stock = api.defaultConfig;
    const customH3 = { ...stock.channels[0], models: [{ name: 'MiniMax-H3', capability: 'video', script: 'return customH3();' }] };
    const ark = api.createModelChannel({ id: 'ark', apiFormat: 'ark', models: [{ name: 'seedance-2', capability: 'video' }] });
    const restored = hydrate({ ...stock, channels: [customH3, ark], videoH3Mode: 'turbo', videoH3TeSpeed: 'false', videoMode: undefined });
    assert.equal(restored.channels[0].models[0].script, 'return customH3();');
    assert.equal(restored.channels[1].apiFormat, 'ark');
    assert.match(restored.channels[1].baseUrl, /api\/v3$/);
    assert.equal(restored.videoH3Mode, 'turbo');
    assert.equal(restored.videoH3TeSpeed, 'false');
    assert.equal(restored.videoMode, 'frames');
    assert.equal(restored.proxyEnabled, false);
});

test('Qwen image channel is added once without changing existing selections or custom channels', () => {
    const { api, hydrate } = configHarness();
    const custom = api.createModelChannel({ id: 'my-local', baseUrl: 'http://127.0.0.1:9000', models: [{ name: 'My model', capability: 'image', script: 'return custom();' }] });
    const previous = { ...api.defaultConfig, qwenImage21Initialized: undefined, channels: [api.defaultConfig.channels[0], api.defaultConfig.channels[1], custom], imageModel: 'my-local::My model' };
    const migrated = hydrate(previous);
    assert.equal(migrated.imageModel, previous.imageModel);
    assert.equal(migrated.videoModel, previous.videoModel);
    assert.equal(migrated.channels.find((channel) => channel.id === 'my-local').models[0].script, 'return custom();');
    assert.equal(migrated.channels.filter((channel) => channel.id === 'local-qwen-image21').length, 1);
    assert.equal(migrated.qwenImage21Initialized, true);
    const deleted = hydrate({ ...migrated, channels: migrated.channels.filter((channel) => channel.id !== 'local-qwen-image21') });
    assert.equal(deleted.channels.some((channel) => channel.id === 'local-qwen-image21'), false);
});

test('API URL construction retains Ark paths and optional proxy forwarding', () => {
    const { api } = configHarness();
    const base = 'https://ark.example/api/v3';
    assert.equal(api.buildApiUrl(base, '/contents/generations/tasks'), base + '/contents/generations/tasks');
    assert.equal(api.buildApiUrl('https://ark.example/api/plan/v3/chat/completions', '/models'), 'https://ark.example/api/plan/v3/models');
    api.useConfigStore.getState().updateConfig('proxyEnabled', true);
    assert.equal(api.buildApiUrl(base, '/models'), 'http://127.0.0.1:23210/' + base + '/models');
});

test('stock H3 task-control update migrates exact templates and preserves custom scripts and mode', () => {
    const { api, hydrate } = configHarness();
    const previous = fs.readFileSync(path.join(src, 'services/api/templates/comfyui-minimax-h3-before-task-control.txt'), 'utf8');
    const current = fs.readFileSync(path.join(src, 'services/api/templates/comfyui-minimax-h3.js'), 'utf8').trim();
    for (const script of [previous, previous.replace(/\r\n/g, '\n'), previous + '\n// user customization']) {
        const restored = hydrate({ ...api.defaultConfig, videoH3Mode: 'te', channels: [{ ...api.defaultConfig.channels[0], models: [{ name: 'MiniMax-H3', capability: 'video', script }] }] });
        assert.equal(restored.channels[0].models[0].script.trim(), script.includes('// user customization') ? script.trim() : current);
        assert.equal(restored.videoH3Mode, 'te');
    }
});

test('stock H3 progress update migrates the previous template without overwriting customization', () => {
    const { api, hydrate } = configHarness();
    const previous = fs.readFileSync(path.join(src, 'services/api/templates/comfyui-minimax-h3-before-progress.txt'), 'utf8');
    const current = fs.readFileSync(path.join(src, 'services/api/templates/comfyui-minimax-h3.js'), 'utf8').trim();
    for (const script of [previous, previous.replace(/\r\n/g, '\n'), previous + '\n// user customization']) {
        const restored = hydrate({ ...api.defaultConfig, videoH3Mode: 'turbo', channels: [{ ...api.defaultConfig.channels[0], models: [{ name: 'MiniMax-H3', capability: 'video', script }] }] });
        assert.equal(restored.channels[0].models[0].script.trim(), script.includes('// user customization') ? script.trim() : current);
        assert.equal(restored.videoH3Mode, 'turbo');
    }
});

test('stock H3 recovery update migrates the previous template without overwriting customization', () => {
    const { api, hydrate } = configHarness();
    const previous = fs.readFileSync(path.join(src, 'services/api/templates/comfyui-minimax-h3-before-recovery.txt'), 'utf8');
    const current = fs.readFileSync(path.join(src, 'services/api/templates/comfyui-minimax-h3.js'), 'utf8').trim();
    for (const script of [previous, previous.replace(/\r\n/g, '\n'), previous + '\n// user customization']) {
        const restored = hydrate({ ...api.defaultConfig, videoH3Mode: 'turbo', channels: [{ ...api.defaultConfig.channels[0], models: [{ name: 'MiniMax-H3', capability: 'video', script }] }] });
        assert.equal(restored.channels[0].models[0].script.trim(), script.includes('// user customization') ? script.trim() : current);
        assert.equal(restored.videoH3Mode, 'turbo');
    }
});

test('stock H3 timeout update migrates one- and two-hour scripts without overwriting custom scripts', () => {
    const { api, hydrate } = configHarness();
    const previous = fs.readFileSync(path.join(src, 'services/api/templates/comfyui-minimax-h3-before-timeout.txt'), 'utf8');
    const current = fs.readFileSync(path.join(src, 'services/api/templates/comfyui-minimax-h3.js'), 'utf8').trim();
    const twoHour = previous.replace('timeoutMs: 3600000', 'timeoutMs: 7200000');
    for (const script of [previous, previous.replace(/\r\n/g, '\n'), twoHour, previous + '\n// user customization', twoHour + '\n// user customization']) {
        const restored = hydrate({ ...api.defaultConfig, channels: [{ ...api.defaultConfig.channels[0], models: [{ name: 'MiniMax-H3', capability: 'video', script }] }] });
        assert.equal(restored.channels[0].models[0].script.trim(), script.includes('// user customization') ? script.trim() : current);
    }
});

test('credential import updates only the matching channel and preserves scripts', () => {
    const { api } = configHarness();
    const original = { ...api.defaultConfig, channels: [...api.defaultConfig.channels, api.createModelChannel({ id: 'cloud', baseUrl: 'https://example.test/v1', apiKey: 'old-test-key', models: [{ name: 'model', capability: 'video', script: 'return 1;' }] })] };
    const changed = api.upsertChannelCredentials(original, { baseUrl: 'https://example.test', apiKey: 'new-test-key' });
    assert.equal(changed.status, 'updated');
    assert.equal(changed.config.channels[0], original.channels[0]);
    assert.equal(changed.config.channels.at(-1).apiKey, 'new-test-key');
    assert.equal(changed.config.channels.at(-1).models[0].script, 'return 1;');
    assert.equal(original.channels.at(-1).apiKey, 'old-test-key');
    assert.equal(api.upsertChannelCredentials(original, { apiKey: 'test' }).config, original);
});

function pluginHarness() {
    const requests = [];
    const axios = { request: async (options) => { requests.push(options); return { data: options.method === 'get' ? { status: 'completed', url: 'data:video/mp4;base64,AA==' } : { id: 'remote-task', data: [{ url: 'data:image/png;base64,AA==' }] } }; }, isCancel: () => false };
    const api = loader({ axios, '@/stores/use-config-store': { buildApiUrl: (base, value) => base + value, withLocalProxy: (url) => url } })('services/api/model-plugin.ts');
    return { api, requests };
}

test('all shipped model templates compile, including the retained H3 template', () => {
    const { api } = pluginHarness();
    const templates = api.getPluginTemplates();
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    for (const template of Object.values(templates).flat()) assert.doesNotThrow(() => new AsyncFunction(template.script), template.label);
    assert.ok(templates.video.some((t) => t.label.includes('MiniMax-H3')));
});

test('OpenAI video template accepts legacy media objects without an API key', async () => {
    const { api, requests } = pluginHarness();
    const video = new Blob(['video'], { type: 'video/mp4' });
    const audio = new Blob(['audio'], { type: 'audio/mpeg' });
    const result = await api.runModelPlugin({ capability: 'video', script: api.getPluginTemplates().video[0].script, config: { baseUrl: 'http://localhost:9999', apiKey: '', model: 'local-video' }, videos: [{ name: 'v.mp4', url: 'unused', blob: video }], audios: [{ name: 'a.mp3', url: 'unused', blob: audio }], params: { mode: 'reference', seconds: '7' } });
    assert.equal(requests[0].data.get('video[]').size, video.size);
    assert.equal(requests[0].data.get('audio[]').size, audio.size);
    assert.equal(requests[0].headers.Authorization, undefined);
    assert.equal(result.url, 'data:video/mp4;base64,AA==');
});

function videoHarness() {
    const captured = { requests: [], plugin: null, cleanup: 0 };
    const configApi = {
        buildApiUrl: (base, route) => base + route,
        withLocalProxy: (url) => url,
        channelRequiresApiKey: (config) => config.serviceType !== 'comfyui' && config.serviceType !== 'local-openai',
        modelOptionName: (value) => value.split('::').at(-1),
        resolveModelRequestConfig: (config) => config,
    };
    const axios = {
        post: async (url, data, options) => { captured.requests.push({ url, data, options }); return { data: url.includes('predictLongRunning') ? { name: 'operations/gemini-task' } : { id: 'task-id' } }; },
        get: async (url) => { captured.requests.push({ url }); return { data: { status: 'succeeded', content: { video_url: 'https://example.test/result.mp4' } } }; },
        isCancel: () => false, isAxiosError: () => false,
    };
    const load = loader({
        axios, nanoid: { nanoid: () => 'plugin-task' }, '@/stores/use-config-store': configApi,
        '@/lib/image-utils': { dataUrlToFile: (image) => new File(['image'], image.name || 'ref.png', { type: 'image/png' }), readFileAsDataUrl: async (file) => 'data:' + file.type + ';base64,AA==' },
        '@/services/file-storage': { getMediaBlob: async () => new Blob(['media'], { type: 'video/mp4' }), resolveMediaUrl: async (_, url) => url, uploadMediaFile: async (v) => v },
        '@/services/image-storage': { imageToDataUrl: async (image) => image.dataUrl || 'data:image/png;base64,AA==' },
        './model-plugin': { runModelPlugin: async (args) => { captured.plugin = args; args.onProgress?.(50); return new Blob(['done'], { type: 'video/mp4' }); } },
        './comfy-workflow': { resolveModelExecutionScript: async (config) => config.script || '' },
        './comfy-memory': { shouldAutoCleanComfy: (_, model) => model.includes('H3'), cancelComfyIdleCleanup: () => {}, resetComfyIdleCleanup: () => captured.cleanup++ },
        './local-prompt': { checkLocalGpuIdle: async () => {} },
    });
    const api = load('services/api/video.ts');
    const config = { model: 'video-model', videoModel: 'video-model', baseUrl: 'https://example.test', apiKey: 'test-key', apiFormat: 'openai', size: '16:9', vquality: '720', videoSeconds: '7', videoMode: 'frames', videoGenerateAudio: 'true', videoWatermark: 'false' };
    return { api, captured, config };
}

test('H3 retains progress, acceleration, duration and media metadata', async () => {
    const { api, captured, config } = videoHarness();
    let progress;
    const task = await api.createVideoGenerationTask({ ...config, model: 'MiniMax-H3', serviceType: 'comfyui', apiKey: '', script: 'H3-script', videoSeconds: '2', videoH3Mode: 'turbo', videoH3SageAttention: 'false', videoH3TeSpeed: 'true' }, 'prompt', [], { videos: [{ name: 'reference.mp4', url: 'blob:fake', storageKey: 'video:1', width: 640, height: 480, durationMs: 1234 }], onProgress: (n) => progress = n });
    assert.equal(task.provider, 'plugin');
    assert.equal(captured.plugin.params.seconds, '2');
    assert.equal(captured.plugin.params.h3Mode, 'turbo');
    assert.equal(captured.plugin.params.h3SageAttention, false);
    assert.equal(captured.plugin.params.h3TeSpeed, true);
    assert.deepEqual(captured.plugin.params.outputDimensions, { width: 1280, height: 720 });
    assert.equal(captured.plugin.videos[0].width, 640);
    assert.equal(captured.plugin.videos[0].durationMs, 1234);
    assert.ok(captured.plugin.videos[0].blob instanceof Blob);
    assert.equal(progress, 50);
    assert.equal(captured.cleanup, 1);
    assert.equal((await api.pollVideoGenerationTask(config, task)).status, 'completed');
});

test('OpenAI frame mode sends both frames; multiple references select reference mode', async () => {
    const { api, config, captured } = videoHarness();
    const images = [1, 2, 3].map((id) => ({ id: String(id), name: 'ref.png', dataUrl: 'data:image/png;base64,AA==' }));
    await api.createVideoGenerationTask(config, 'prompt', images.slice(0, 2));
    assert.equal(captured.requests[0].data.get('mode'), 'frames');
    assert.ok(captured.requests[0].data.get('first_frame') instanceof Blob);
    assert.ok(captured.requests[0].data.get('last_frame') instanceof Blob);
    await api.createVideoGenerationTask({ ...config, videoSeconds: '40' }, 'prompt', images);
    assert.equal(captured.requests[1].data.get('mode'), 'reference');
    assert.equal(captured.requests[1].data.getAll('image[]').length, 3);
    assert.equal(captured.requests[1].data.get('seconds'), '30');
});

test('Ark tasks retain their provider and native task endpoint', async () => {
    const { api, config, captured } = videoHarness();
    const task = await api.createVideoGenerationTask({ ...config, apiFormat: 'ark', baseUrl: 'https://ark.example/api/v3' }, 'prompt');
    assert.equal(task.provider, 'seedance');
    assert.match(captured.requests[0].url, /api\/v3\/contents\/generations\/tasks$/);
});

test('Gemini tasks use the upstream operation API', async () => {
    const { api, config, captured } = videoHarness();
    const task = await api.createVideoGenerationTask({ ...config, apiFormat: 'gemini' }, 'prompt');
    assert.equal(task.provider, 'gemini');
    assert.equal(task.id, 'operations/gemini-task');
    assert.match(captured.requests[0].url, /predictLongRunning$/);
});

test('image previews are used only while their resolution is sufficient', () => {
    const { pickImageSource } = loader()('lib/image-thumbnail.ts');
    const params = { previewUrl: 'preview', originalUrl: 'original', naturalWidth: 4000, naturalHeight: 3000, renderedWidth: 420, renderedHeight: 315 };
    assert.equal(pickImageSource({ ...params, scale: 1, devicePixelRatio: 1 }), 'preview');
    assert.equal(pickImageSource({ ...params, scale: 3, devicePixelRatio: 2 }), 'original');
    assert.equal(pickImageSource({ ...params, previewUrl: undefined, scale: 1, devicePixelRatio: 1 }), 'original');
});

test('generation preview flattens selected groups and deduplicates their children', async () => {
    const { api: configApi } = configHarness();
    const load = loader({
        '@/stores/use-config-store': configApi,
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: (config) => config, getGenerationCount: (n) => Number(n) || 1 },
        '@/services/comfy-workflow-storage': { getComfyWorkflowPreset: async () => null },
        '@/lib/canvas/node-registry': { getNodeDefinition: () => undefined },
        '@/lib/image-utils': { getDataUrlByteSize: () => 1, readImageMeta: async () => ({ width: 1, height: 1 }) },
        '@/services/image-storage': { imageToDataUrl: async (v) => v.dataUrl },
    });
    const { buildCanvasGenerationPreview } = load('lib/canvas/canvas-generation-preview.ts');
    const prompt = '@[node:g] @[node:image]';
    const nodes = [
        { id: 'config', type: 'config', title: 'Target', metadata: { composerContent: prompt } },
        { id: 'g', type: 'group', title: 'Group' },
        { id: 'image', type: 'image', title: 'Image', metadata: { groupId: 'g', content: 'data:image/png;base64,AA==' } },
        { id: 'text', type: 'text', title: 'Text', metadata: { groupId: 'g', content: 'Scene description' } },
    ];
    const data = await buildCanvasGenerationPreview({ nodeId: 'config', mode: 'image', prompt, nodes, connections: [{ id: '1', fromNodeId: 'g', toNodeId: 'config' }, { id: '2', fromNodeId: 'image', toNodeId: 'config' }], config: { ...configApi.defaultConfig, model: 'default::gpt-image-2' } });
    assert.deepEqual(data.references.map((r) => r.nodeId), ['image', 'text']);
    assert.ok(data.prompt.includes('Scene description'));
});

test('Qwen preview follows connected reference images and composer selection while excluding its own output', async () => {
    const { api: configApi } = configHarness();
    const load = loader({
        '@/stores/use-config-store': configApi,
        '@/lib/canvas/canvas-generation-helpers': { buildGenerationConfig: (config) => config, getGenerationCount: (n) => Number(n) || 1 },
        '@/services/comfy-workflow-storage': { getComfyWorkflowPreset: async () => null },
        '@/lib/canvas/node-registry': { getNodeDefinition: () => undefined },
        '@/lib/image-utils': { getDataUrlByteSize: () => 1, readImageMeta: async () => ({ width: 1, height: 1 }) },
        '@/services/image-storage': { imageToDataUrl: async (v) => v.dataUrl },
    });
    const { buildCanvasGenerationPreview } = load('lib/canvas/canvas-generation-preview.ts');
    const image = { id: 'image', type: 'image', title: 'Reference', metadata: { content: 'data:image/png;base64,AA==' } };
    const text = { id: 'text', type: 'text', title: 'Text', metadata: { content: 'Scene description' } };
    for (const scenario of [
        { target: { id: 'target', type: 'config', metadata: {} }, connected: [text], model: '编辑', expected: '生图', imageCount: 0, prompt: 'draw' },
        { target: { id: 'target', type: 'config', metadata: {} }, connected: [image], model: '生图', expected: '编辑', imageCount: 1, prompt: 'edit' },
        { target: { id: 'target', type: 'image', metadata: { content: 'data:image/png;base64,OWN' } }, connected: [image, text], model: '生图', expected: '编辑', imageCount: 1, prompt: 'edit' },
        { target: { id: 'target', type: 'image', metadata: { content: 'data:image/png;base64,OWN' } }, connected: [], model: '编辑', expected: '生图', imageCount: 0, prompt: 'draw again' },
        { target: { id: 'target', type: 'config', metadata: { composerContent: '@[node:text]' } }, connected: [image, text], model: '编辑', expected: '生图', imageCount: 0, prompt: '@[node:text]' },
    ]) {
        const data = await buildCanvasGenerationPreview({
            nodeId: 'target', mode: 'image', prompt: scenario.prompt,
            nodes: [scenario.target, ...scenario.connected],
            connections: scenario.connected.map(node => ({ id: node.id, fromNodeId: node.id, toNodeId: 'target' })),
            config: { ...configApi.defaultConfig, model: `local-qwen-image21::Qwen-Image 2.1 · ${scenario.model}`, background: 'transparent', quality: 'high', size: '3840x2160' },
        });
        assert.ok(data.model.includes(`Qwen-Image 2.1 · ${scenario.expected}`));
        assert.equal(data.references.filter(reference => reference.type === 'image').length, scenario.imageCount);
        assert.match(data.prompt, /RGBA image with an alpha channel/);
        assert.equal(data.parameters.some(parameter => parameter.label === 'canvas.generationPreview.parameter.quality'), false);
        assert.ok(data.parameters.some(parameter => parameter.label === 'settingsPanels.image.transparent' && parameter.value === 'canvas.generationPreview.yes'));
        assert.equal(data.parameters.find(parameter => parameter.label === 'canvas.generationPreview.parameter.size').value, scenario.expected === '编辑' ? '参考图原比例 · 约 1K' : '3840x2160');
    }
});

test('node H3 mode overrides the global mode and survives config construction', () => {
    const { api: configApi } = configHarness();
    const { buildGenerationConfig } = loader({
        '@/stores/use-config-store': configApi,
        '@/services/image-storage': {},
        '@/services/file-storage': {},
        '@/lib/canvas/canvas-node-factory': {},
    })('lib/canvas/canvas-generation-helpers.ts');
    const global = { ...configApi.defaultConfig, videoH3Mode: 'te-speed' };
    const result = buildGenerationConfig(global, { metadata: { videoH3Mode: 'turbo', seconds: '2', h3TeSpeed: 'false' } }, 'video');
    assert.equal(result.videoH3Mode, 'turbo');
    assert.equal(result.videoH3TeSpeed, 'false');
    assert.equal(result.videoSeconds, '2');
    assert.equal(buildGenerationConfig(global, undefined, 'video').videoH3Mode, 'te-speed');
});

test('new Agent fragment bootstrap consumes credentials while preserving other hash fields', () => {
    const { readAgentUrlBootstrap } = loader()('lib/agent/agent-url-bootstrap.ts');
    const result = readAgentUrlBootstrap('#agentUrl=http%3A%2F%2F127.0.0.1%3A17371&agentToken=test-token&view=canvas');
    assert.equal(result.url, 'http://127.0.0.1:17371');
    assert.equal(result.token, 'test-token');
    assert.equal(result.remainingHash, '#view=canvas');
});

test('Qwen becomes the bundled image default once and later choices remain persistent', () => {
    const { api, hydrate } = configHarness();
    const qwen = 'local-qwen-image21::Qwen-Image 2.1 · 生图';
    assert.equal(api.defaultConfig.imageModel, qwen);
    const fresh = hydrate({});
    assert.equal(fresh.imageModel, qwen);
    assert.ok(fresh.models.includes('default::gpt-image-2'));
    assert.equal(api.resolveModelForCapability(fresh, 'default::gpt-image-2', 'image'), 'default::gpt-image-2');
    const migrated = hydrate({ ...api.defaultConfig, qwenImage21DefaultInitialized: undefined, imageModel: 'default::gpt-image-2', model: 'default::gpt-image-2' });
    assert.equal(migrated.imageModel, qwen);
    assert.equal(migrated.model, qwen);
    assert.equal(migrated.qwenImage21DefaultInitialized, true);
    const changed = hydrate({ ...migrated, imageModel: 'default::gpt-image-2' });
    assert.equal(changed.imageModel, 'default::gpt-image-2');
    const custom = hydrate({ ...api.defaultConfig, qwenImage21DefaultInitialized: undefined, imageModel: 'local-qwen-image21::Qwen-Image 2.1 · 编辑' });
    assert.equal(custom.imageModel, 'local-qwen-image21::Qwen-Image 2.1 · 编辑');
    const removed = hydrate({ ...api.defaultConfig, qwenImage21DefaultInitialized: undefined, channels: api.defaultConfig.channels.filter(c => c.id !== 'local-qwen-image21'), imageModel: 'default::gpt-image-2' });
    assert.equal(removed.imageModel, 'default::gpt-image-2');
});
