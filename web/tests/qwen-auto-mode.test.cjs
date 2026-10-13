const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const src = path.join(__dirname, '../src');

function harness() {
    const cache = new Map(), calls = [];
    let sequence = 0;
    const overrides = {
        react: require('../node_modules/react'),
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': { persist: initializer => initializer },
        nanoid: { nanoid: () => `id-${++sequence}` },
        '@/i18n': { t: key => key },
        axios: { isCancel: () => false, isAxiosError: () => false },
        '@/lib/image-utils': {},
        '@/lib/image-reference-prompt': { buildImageReferencePromptText: prompt => prompt },
        '@/services/image-storage': { imageToDataUrl: async image => image.dataUrl },
        './model-plugin': { runModelPlugin: async args => { calls.push(args); return ['data:image/png;base64,QA']; }, normalizePluginImages: value => value },
        './comfy-workflow': { resolveModelExecutionScript: async (config, model) => load('stores/use-config-store.ts').resolveModelWorkflowId(config, model) },
    };
    function load(relative) {
        const file = path.resolve(src, relative);
        if (cache.has(file)) return cache.get(file);
        const baseline = process.env.QWEN_BASELINE === '1' && relative === 'services/api/image.ts';
        const input = baseline ? path.join(__dirname, '../../audits/2026-10-08/qwen-auto-mode/before/web/src/services/api/image.ts') : file;
        const code = ts.transpileModule(fs.readFileSync(input, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
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
    return { calls, store, resolve: load('lib/qwen-image-mode.ts').resolveQwenImageConfig, api: () => load('services/api/image.ts') };
}

const generation = 'local-qwen-image21::Qwen-Image 2.1 · 生图';
const edit = 'local-qwen-image21::Qwen-Image 2.1 · 编辑';

test('Qwen follows reference images in both directions and leaves global defaults and parameters intact', () => {
    const { store, resolve } = harness();
    const config = { ...store.defaultConfig, model: generation, size: '16:9', count: '4', quality: 'high' };
    const editing = resolve(config, 1);
    assert.equal(editing.model, edit);
    assert.equal(editing.imageModel, generation);
    assert.equal(config.model, generation);
    assert.equal(editing.channels, config.channels);
    assert.equal(editing.size, '16:9');
    assert.equal(editing.count, '4');
    assert.equal(resolve(editing, 0).model, generation);
    assert.equal(resolve(editing, 10), editing);
    assert.equal(resolve(config, 0), config);
});

test('renamed Qwen workflows switch within the selected channel, including unqualified old selections', () => {
    const { store, resolve } = harness();
    const channels = [...store.defaultConfig.channels, { id: 'other-qwen', name: 'Other', baseUrl: 'http://localhost:9999', apiKey: '', models: [
        { name: 'My generator', capability: 'image', workflowId: 'builtin:qwen-image21-t2i' },
        { name: 'My editor', capability: 'image', workflowId: 'builtin:qwen-image21-edit' },
    ] }];
    const config = { ...store.defaultConfig, channels, model: 'other-qwen::My generator' };
    assert.equal(resolve(config, 2).model, 'other-qwen::My editor');
    assert.equal(resolve({ ...config, model: 'My generator' }, 2).model, 'other-qwen::My editor');
});

test('other models and custom Qwen-named workflows retain the selected model', () => {
    const { store, resolve } = harness();
    const gpt = { ...store.defaultConfig, model: 'default::gpt-image-2' };
    assert.equal(resolve(gpt, 1), gpt);
    const custom = { ...store.defaultConfig, model: generation, channels: store.defaultConfig.channels.map(channel => channel.id === 'local-qwen-image21' ? { ...channel, models: channel.models.map(model => ({ ...model, workflowId: 'user:custom-qwen' })) } : channel) };
    assert.equal(resolve(custom, 1), custom);
});

test('a missing paired model never switches channels and validation remains explicit', () => {
    const { store, resolve, api } = harness();
    const config = { ...store.defaultConfig, model: generation, channels: store.defaultConfig.channels.map(channel => channel.id === 'local-qwen-image21' ? { ...channel, models: channel.models.filter(model => model.workflowId !== 'builtin:qwen-image21-edit') } : channel) };
    assert.equal(resolve(config, 1), config);
    assert.match(api().validateQwenImageInputs(config, 1), /生图不支持参考图片/);
});

test('image edit requests automatically use the editor with unchanged references and 1K editing parameters', async () => {
    const { store, calls, api } = harness();
    const references = [{ id: 'ref', name: 'ref.png', type: 'image/png', dataUrl: 'data:image/png;base64,REF' }];
    const results = await api().requestEdit({ ...store.defaultConfig, model: generation, count: '2', size: '3840x2160', quality: 'high' }, 'change background', references);
    assert.equal(results.length, 2);
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.equal(call.script, 'builtin:qwen-image21-edit');
        assert.deepEqual(call.images, [references[0].dataUrl]);
        assert.equal(call.params.size, undefined);
        assert.equal(call.params.quality, undefined);
        assert.equal(call.config.baseUrl, 'http://127.0.0.1:8189');
    }
});

test('text generation and an empty edit request both use the generator, even when editing was selected', async () => {
    const { store, calls, api } = harness();
    const config = { ...store.defaultConfig, model: edit, count: '1' };
    await api().requestGeneration(config, 'draw a tree');
    await api().requestEdit(config, 'draw a tree', []);
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.equal(call.script, 'builtin:qwen-image21-t2i');
        assert.deepEqual(call.images, []);
        assert.equal(call.params.size, '1024x1024');
    }
});

test('the ten-reference limit still rejects before model execution after automatic switching', async () => {
    const { store, calls, api } = harness();
    await assert.rejects(api().requestEdit({ ...store.defaultConfig, model: generation }, 'edit', Array.from({ length: 11 }, () => ({ dataUrl: 'data:image/png;base64,REF' }))), /最多支持 10 张/);
    assert.equal(calls.length, 0);
});
