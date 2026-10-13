const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const src = path.join(__dirname, '../src');
const turboGeneration = 'local-qwen-image21::Qwen-Image 2.1 Turbo · 生图';
const turboEdit = 'local-qwen-image21::Qwen-Image 2.1 Turbo · 编辑';
const generationId = 'builtin:qwen-image21-turbo-t2i';
const editId = 'builtin:qwen-image21-turbo-edit';
const sigmas = [1, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0];

function harness() {
    const cache = new Map(), saved = new Map(), calls = [];
    let persistOptions;
    const overrides = {
        react: require('../node_modules/react'), zustand: require('../node_modules/zustand'),
        'zustand/middleware': { persist: (fn, options) => { persistOptions = options; return fn; } },
        nanoid: { nanoid: () => 'qa-id' }, '@/i18n': { t: key => key },
        localforage: { createInstance: () => ({ getItem: async id => saved.get(id) }) },
        axios: { isCancel: () => false, isAxiosError: () => false },
        '@/lib/image-utils': {},
        '@/lib/image-reference-prompt': { buildImageReferencePromptText: prompt => prompt },
        '@/services/image-storage': { imageToDataUrl: async image => image.dataUrl },
        './model-plugin': { runModelPlugin: async args => { calls.push(args); return ['data:image/png;base64,QA']; }, normalizePluginImages: value => value },
    };
    function load(relative) {
        const file = path.resolve(src, relative);
        if (cache.has(file)) return cache.get(file);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
        const output = {};
        cache.set(file, output);
        new Function('exports', 'require', code)(output, name => {
            if (name in overrides) return overrides[name];
            const target = name.startsWith('@/') ? path.join(src, name.slice(2)) : path.resolve(path.dirname(file), name);
            if (target.endsWith('?raw')) return fs.readFileSync(target.slice(0, -4), 'utf8');
            return load(path.relative(src, fs.existsSync(target) ? target : target + '.ts'));
        });
        return output;
    }
    const store = load('stores/use-config-store.ts');
    return { load, store, calls, saved, hydrate: config => persistOptions.merge({ config }, store.useConfigStore.getState()).config };
}

function previousConfig(store) {
    const config = structuredClone(store.defaultConfig);
    delete config.qwenImage21TurboInitialized;
    config.channels.find(channel => channel.id === 'local-qwen-image21').models = config.channels.find(channel => channel.id === 'local-qwen-image21').models.filter(model => !model.workflowId.includes('turbo'));
    return config;
}

test('Turbo migrates once while preserving existing selections, channel settings and custom scripts', () => {
    const { store, hydrate } = harness();
    const config = previousConfig(store), qwen = config.channels.find(channel => channel.id === 'local-qwen-image21');
    qwen.baseUrl = 'http://localhost:9999'; qwen.name = 'My Qwen'; qwen.apiKey = 'local-key';
    qwen.models[0].name = 'My generator'; qwen.models[0].script = 'return custom();';
    config.model = config.imageModel = 'local-qwen-image21::My generator'; config.size = '1536x1024';
    const before = structuredClone(config), restored = hydrate(config), models = restored.channels.find(channel => channel.id === qwen.id).models;
    assert.deepEqual(config, before);
    assert.deepEqual(JSON.parse(JSON.stringify(models.slice(0, 2))), qwen.models);
    assert.equal(models.length, 4);
    assert.equal(restored.channels.find(channel => channel.id === qwen.id).baseUrl, qwen.baseUrl);
    assert.equal(restored.channels.find(channel => channel.id === qwen.id).apiKey, qwen.apiKey);
    assert.equal(restored.model, config.model); assert.equal(restored.imageModel, config.imageModel); assert.equal(restored.size, config.size);
    assert.equal(restored.qwenImage21TurboInitialized, true);
    assert.equal(hydrate(restored).channels.find(channel => channel.id === qwen.id).models.length, 4);
    restored.channels.find(channel => channel.id === qwen.id).models = models.filter(model => model.workflowId !== editId);
    assert.ok(!hydrate(restored).channels.find(channel => channel.id === qwen.id).models.some(model => model.workflowId === editId));
});

test('Turbo migration respects deleted channels, custom-only channels and model name/workflow collisions', () => {
    const { store, hydrate } = harness();
    const config = previousConfig(store);
    config.channels = config.channels.filter(channel => channel.id !== 'local-qwen-image21');
    assert.ok(!hydrate(config).channels.some(channel => channel.id === 'local-qwen-image21'));
    const custom = previousConfig(store), qwen = custom.channels.find(channel => channel.id === 'local-qwen-image21');
    qwen.models = [{ name: 'Custom', capability: 'image', workflowId: 'workflow:custom', script: 'return custom();' }];
    assert.deepEqual(hydrate(custom).channels.find(channel => channel.id === qwen.id).models, qwen.models);
    const collision = previousConfig(store), channel = collision.channels.find(channel => channel.id === qwen.id);
    channel.models.push({ name: 'Qwen-Image 2.1 Turbo · 生图', capability: 'image', workflowId: 'workflow:custom' }, { name: 'Renamed Turbo editor', capability: 'image', workflowId: editId });
    assert.deepEqual(JSON.parse(JSON.stringify(hydrate(collision).channels.find(item => item.id === qwen.id).models)), channel.models);
});

test('Turbo automatic modes remain in the same version and selected channel, including renamed models', () => {
    const { store, load } = harness(), resolve = load('lib/qwen-image-mode.ts').resolveQwenImageConfig;
    const config = { ...store.defaultConfig, model: turboGeneration };
    assert.equal(resolve(config, 1).model, turboEdit);
    assert.equal(resolve({ ...config, model: turboEdit }, 0).model, turboGeneration);
    assert.equal(resolve(config, 0), config);
    const missing = { ...config, channels: config.channels.map(channel => ({ ...channel, models: channel.models.filter(model => model.workflowId !== editId) })) };
    assert.equal(resolve(missing, 1), missing);
    const other = { ...config, model: 'other::Renamed generator', channels: [...config.channels, store.createModelChannel({ id: 'other', models: [
        { name: 'Renamed generator', capability: 'image', workflowId: generationId }, { name: 'Renamed editor', capability: 'image', workflowId: editId },
    ] })] };
    assert.equal(resolve(other, 2).model, 'other::Renamed editor');
});

test('Turbo image requests use the correct preset, retain count and enforce reference-sized editing', async () => {
    const { store, load, calls } = harness(), api = load('services/api/image.ts');
    const config = { ...store.defaultConfig, model: turboGeneration, size: '3840x2160', quality: 'high', background: 'transparent', count: '2' };
    const refs = [{ dataUrl: 'data:image/png;base64,REF' }];
    await api.requestEdit(config, 'edit background', refs);
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.match(call.script, /qwen_image_2.1_turbo_int8_convrot/);
        assert.deepEqual(call.images, [refs[0].dataUrl]);
        assert.equal(call.params.size, undefined); assert.equal(call.params.quality, undefined); assert.equal(call.params.background, undefined);
    }
    calls.length = 0;
    await api.requestEdit({ ...config, model: turboEdit, size: '1:1', count: '1' }, 'poster', []);
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].images, []);
    assert.equal(calls[0].params.size, '1024x1024');
    assert.match(calls[0].script, /EmptyLatentImage/);
    calls.length = 0;
    await assert.rejects(api.requestEdit(config, 'edit', Array.from({ length: 11 }, () => refs[0])), /最多支持 10 张/);
    assert.equal(calls.length, 0);
});

async function mapped(preset, count, ratio, abort = false) {
    const { load } = harness(), controller = new AbortController(), requests = [];
    let graph, uploads = 0;
    const request = async args => {
        requests.push(args);
        if (args.url.endsWith('/system_stats')) return {};
        if (args.url.endsWith('/upload/image')) return { name: `ref-${++uploads}.png`, subfolder: 'qa' };
        if (args.url.endsWith('/prompt')) { graph = args.data.prompt; if (abort) controller.abort(); return { prompt_id: 'qa-job' }; }
        if (args.url.endsWith('/api/jobs/qa-job/cancel')) return { cancelled: true };
        if (args.url.includes('/view?')) return new Blob(['QA'], { type: 'image/png' });
        throw new Error('Unexpected request: ' + args.url);
    };
    const poll = async (_, select) => select({ 'qa-job': { status: { completed: true, status_str: 'success' }, outputs: { [preset.mapping.outputNodeId]: { images: [{ filename: 'qa.png' }] } } } });
    const script = load('services/api/comfy-workflow.ts').buildComfyWorkflowScript(preset);
    const runner = new Function('prompt', 'images', 'videos', 'audios', 'params', 'baseUrl', 'request', 'poll', 'signal', 'onProgress', `return (async () => {\n${script}\n})();`);
    const result = runner('QA prompt', Array.from({ length: count }, () => ({ blob: new Blob(['REF'], { type: 'image/png' }) })), [], [], { ratio }, 'http://127.0.0.1:8189', request, poll, controller.signal);
    if (abort) await assert.rejects(result, { name: 'AbortError' });
    else if (count > 10) await assert.rejects(result, /最多支持 10 个图片参考/);
    else URL.revokeObjectURL(await result);
    return { graph, uploads, requests };
}

function assertSampling(preset, graph) {
    const sampler = graph[preset.mapping.seed.nodeId];
    assert.equal(sampler.class_type, 'SamplerCustom'); assert.equal(sampler.inputs.cfg, 1);
    assert.equal(sampler.inputs.add_noise, true); assert.ok(Number.isSafeInteger(sampler.inputs.noise_seed));
    assert.equal(graph['20'].inputs.sampler_name, 'euler');
    assert.deepEqual(graph['21'].inputs.sigmas.split(',').map(Number), sigmas);
    for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) if (Array.isArray(value)) assert.ok(graph[String(value[0])], 'Dangling graph link');
}

test('shipped Turbo generator maps ratios and custom dimensions without changing its eight-step schedule', async () => {
    const { load } = harness(), preset = await load('services/comfy-workflow-storage.ts').getComfyWorkflowPreset(generationId);
    let result = await mapped(preset, 0, '16:9'); assertSampling(preset, result.graph);
    assert.equal(result.graph['5'].inputs.aspect_ratio, '16:9 (Widescreen)'); assert.equal(result.graph['4'].inputs.prompt, 'QA prompt');
    result = await mapped(preset, 0, '1536x1024'); assertSampling(preset, result.graph);
    assert.equal(result.graph['5'], undefined); assert.equal(result.graph['6'].inputs.width, 1536); assert.equal(result.graph['6'].inputs.height, 1024);
});

test('shipped Turbo editor prunes unused inputs, accepts ten ordered references and rejects eleven before upload', async () => {
    const { load } = harness(), preset = await load('services/comfy-workflow-storage.ts').getComfyWorkflowPreset(editId);
    let result = await mapped(preset, 1, '1536x1024'); assertSampling(preset, result.graph);
    assert.equal(result.graph['10'].inputs.image, 'qa/ref-1.png');
    for (let i = 11; i <= 19; i++) assert.equal(result.graph[String(i)], undefined);
    assert.deepEqual(result.graph['6'].inputs.latent_image, ['4', 2]); assert.equal(result.graph['4'].inputs.resolution, 1024);
    result = await mapped(preset, 10, '1:1'); assertSampling(preset, result.graph); assert.equal(result.uploads, 10);
    for (let i = 10; i <= 19; i++) assert.equal(result.graph[String(i)].inputs.image, `qa/ref-${i - 9}.png`);
    result = await mapped(preset, 11, '1:1'); assert.equal(result.uploads, 0); assert.equal(result.graph, undefined);
});

test('Turbo retains accepted-job cancellation and the direct editor reference guard', async () => {
    const { load } = harness(), preset = await load('services/comfy-workflow-storage.ts').getComfyWorkflowPreset(generationId);
    const result = await mapped(preset, 0, '1:1', true);
    assert.deepEqual(result.requests.filter(args => args.method === 'post').map(args => args.url), ['http://127.0.0.1:8189/prompt', 'http://127.0.0.1:8189/api/jobs/qa-job/cancel']);
    const script = await load('services/api/comfy-workflow.ts').comfyWorkflowScript(editId, 'image');
    await assert.rejects(new Function('images', `return (async () => {\n${script}\n})();`)([]), /至少一张参考图片/);
});

test('user-saved presets continue to take precedence over the bundled Turbo preset', async () => {
    const { load, saved } = harness(), custom = { id: generationId, workflow: { custom: true } };
    saved.set(generationId, custom);
    assert.equal(await load('services/comfy-workflow-storage.ts').getComfyWorkflowPreset(generationId), custom);
});

test('Qwen transparency modifies only the submitted prompt, for both versions and both modes', async () => {
    const { load, store, calls } = harness(), api = load('services/api/image.ts');
    const refs = [{ dataUrl: 'data:image/png;base64,REF' }];
    for (const model of ['local-qwen-image21::Qwen-Image 2.1 · 生图', turboGeneration]) {
        const config = { ...store.defaultConfig, model, background: 'transparent', count: '1', systemPrompt: 'System instruction' };
        for (const editing of [false, true]) {
            calls.length = 0;
            await (editing ? api.requestEdit(config, 'Original user prompt', refs) : api.requestGeneration(config, 'Original user prompt'));
            assert.match(calls[0].prompt, /^System instruction\n\nOriginal user prompt/);
            assert.match(calls[0].prompt, /RGBA.*alpha channel/s);
            assert.match(calls[0].prompt, /transparent background/);
            assert.equal(calls[0].params.background, undefined);
            calls.length = 0;
            await (editing ? api.requestEdit({ ...config, background: '' }, 'Original user prompt', refs) : api.requestGeneration({ ...config, background: '' }, 'Original user prompt'));
            assert.equal(calls[0].prompt, 'System instruction\n\nOriginal user prompt');
            assert.equal(config.background, 'transparent');
        }
    }
    const config = { ...store.defaultConfig, model: 'custom::Qwen custom', background: 'transparent', count: '1', channels: [store.createModelChannel({ id: 'custom', models: [{ name: 'Qwen custom', capability: 'image', script: 'return custom();' }] })] };
    calls.length = 0;
    await api.requestGeneration(config, 'Keep custom prompt');
    assert.equal(calls[0].prompt, 'Keep custom prompt');
    assert.equal(calls[0].params.background, 'transparent');
});

test('both shipped editors keep reference alpha and prune unused alpha joins without dangling links', async () => {
    const { load } = harness();
    for (const id of ['builtin:qwen-image21-edit', editId]) {
        const preset = await load('services/comfy-workflow-storage.ts').getComfyWorkflowPreset(id);
        for (const count of [1, 4, 10]) {
            const { graph } = await mapped(preset, count, '1:1');
            for (let index = 0; index < 10; index++) {
                const joinId = String(30 + index), inputId = String(10 + index), slot = `images.image_${index + 1}`;
                if (index < count) {
                    assert.equal(graph[joinId].class_type, 'JoinImageWithAlpha');
                    assert.deepEqual(graph[joinId].inputs, { image: [inputId, 0], alpha: [inputId, 1] });
                    assert.deepEqual(graph['4'].inputs[slot], [joinId, 0]);
                } else {
                    assert.equal(graph[joinId], undefined);
                    assert.equal(graph[inputId], undefined);
                    assert.equal(graph['4'].inputs[slot], undefined);
                }
            }
            for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) if (Array.isArray(value)) assert.ok(graph[String(value[0])], 'Dangling alpha graph link');
        }
    }
});
