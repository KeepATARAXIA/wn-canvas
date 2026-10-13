const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');

const qwen = { id: 'local-qwen-image21', name: 'Qwen', serviceType: 'comfyui', baseUrl: 'http://127.0.0.1:8189', apiKey: '', models: [{ name: 'Qwen Turbo', capability: 'image', workflowId: 'builtin:qwen-image21-turbo-t2i' }] };
const h3 = { id: 'local-comfyui', name: 'H3', serviceType: 'comfyui', baseUrl: 'http://localhost:3000/api/comfyui', apiKey: '', models: [{ name: 'MiniMax-H3', capability: 'video', script: 'fetch("/workflows/minimax-h3-local-api.json")' }] };
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/model-setup.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = {};
new Function('exports', 'require', code)(api, () => ({ defaultConfig: { channels: [h3, qwen] }, createModelChannel: patch => ({ id: 'new-channel', ...patch }) }));

test('Qwen and H3 guide actions select different ComfyUI channels regardless of order', () => {
    for (const channels of [[h3, qwen], [qwen, h3]]) {
        assert.equal(api.findModelSetupChannel(channels, 'qwen'), qwen);
        assert.equal(api.findModelSetupChannel(channels, 'h3'), h3);
    }
    assert.equal(api.findModelSetupChannel([h3], 'qwen'), undefined);
    assert.equal(api.findModelSetupChannel([qwen], 'h3'), undefined);
});

test('existing custom channels are preserved and draft mutations cannot alter stored values', () => {
    const existing = { ...qwen, id: 'custom', name: 'Renamed image service', baseUrl: 'http://127.0.0.1:19000', apiKey: 'test-only', models: structuredClone(qwen.models) };
    const before = structuredClone(existing);
    const draft = api.modelSetupChannelDraft([h3, existing], 'qwen');
    assert.deepEqual(draft, before);
    draft.models[0].name = 'Unsaved edit';
    draft.apiKey = '';
    assert.deepEqual(existing, before);
    assert.equal(api.modelSetupChannelDraft([h3], 'h3').baseUrl, h3.baseUrl);
});

test('missing local services open new model-specific drafts with direct backend addresses', () => {
    const imageDraft = api.modelSetupChannelDraft([h3], 'qwen');
    assert.equal(imageDraft.id, 'new-channel');
    assert.equal(imageDraft.baseUrl, 'http://127.0.0.1:8189');
    assert.equal(imageDraft.models[0].workflowId, 'builtin:qwen-image21-turbo-t2i');
    const videoDraft = api.modelSetupChannelDraft([qwen], 'h3');
    assert.equal(videoDraft.baseUrl, 'http://127.0.0.1:8188');
    assert.equal(videoDraft.models[0].name, 'MiniMax-H3');
});

test('startup commands use the current local browser origin including a non-default port', () => {
    for (const origin of ['http://localhost:13119', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
        assert.ok(api.comfyStartCommand('qwen', origin).endsWith(`--port 8189 --enable-cors-header ${origin}`));
        assert.ok(api.comfyStartCommand('h3', origin).endsWith(`--port 8188 --enable-cors-header ${origin}`));
    }
});

test('startup command rejects nonlocal origins and shell-bearing or path-bearing input', () => {
    for (const origin of ['https://example.com', 'file://localhost', 'http://localhost:3000/path', 'http://user@localhost:3000', 'http://localhost:3000; calc', 'http://localhost:3000\ncalc']) {
        assert.throws(() => api.comfyStartCommand('qwen', origin));
    }
});
