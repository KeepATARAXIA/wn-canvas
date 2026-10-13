const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');

function harness(fetch) {
    const sourceRoot = path.join(__dirname, '../src');
    const cache = new Map();
    const overrides = {
        '@/i18n': { t: key => key },
        react: { useMemo: fn => fn() },
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': { persist: fn => fn },
        nanoid: { nanoid: () => 'test-channel' },
    };
    function load(relative) {
        const file = path.resolve(sourceRoot, relative);
        if (cache.has(file)) return cache.get(file);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
        const exports = {};
        cache.set(file, exports);
        new Function('exports', 'require', 'fetch', code)(exports, name => {
            if (name in overrides) return overrides[name];
            const target = name.startsWith('@/') ? path.join(sourceRoot, name.slice(2)) : path.resolve(path.dirname(file), name);
            if (target.endsWith('?raw')) return fs.readFileSync(target.slice(0, -4), 'utf8');
            return load(fs.existsSync(target) ? target : target + '.ts');
        }, fetch);
        return exports;
    }
    return { status: load('lib/config-capability-status.ts'), config: load('stores/use-config-store.ts') };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('manual status entry preserves existing implicit and explicit configuration guidance routes', () => {
    const { config } = harness(() => { throw new Error('No request expected'); });
    const store = config.useConfigStore;
    store.getState().openConfigDialog(false, 'status');
    assert.equal(store.getState().configTab, 'status');
    assert.equal(store.getState().shouldPromptContinue, false);
    store.getState().openConfigDialog(true);
    assert.equal(store.getState().configTab, 'channels');
    assert.equal(store.getState().shouldPromptContinue, true);
    store.getState().openConfigDialog(false);
    assert.equal(store.getState().configTab, 'channels');
    store.getState().openConfigDialog(false, 'local-storage');
    assert.equal(store.getState().configTab, 'local-storage');
});

test('configured defaults are resolved strictly without treating stored names as reachable models', () => {
    const { status, config } = harness(() => { throw new Error('No request expected'); });
    const before = JSON.stringify(config.defaultConfig);
    const video = status.configuredCapability(config.defaultConfig, 'video');
    assert.equal(video.model.name, 'MiniMax-H3');
    assert.equal(status.channelConfigIssue(video.channel), undefined);
    assert.equal(status.channelConfigIssue(config.defaultConfig.channels[1]), 'missing-key');
    assert.equal(status.configuredCapability({ ...config.defaultConfig, imageModel: 'deleted::gpt-image-2' }, 'image').model, undefined);
    assert.equal(status.configuredCapability({ ...config.defaultConfig, imageModel: 'local-comfyui::MiniMax-H3' }, 'image').model, undefined);
    assert.equal(JSON.stringify(config.defaultConfig), before);
});

test('ComfyUI check only reads validated system stats, never starts GPU work', async () => {
    const calls = [];
    const { status, config } = harness(async (url, init) => { calls.push({ url, init }); return json({ system: { os: 'windows' }, devices: [] }); });
    const result = await status.probeChannel(config.defaultConfig.channels[0], new AbortController().signal);
    assert.equal(result.state, 'reachable');
    assert.equal(result.reason, 'status');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://localhost:3000/api/comfyui/system_stats');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
    assert.ok(result.checkedAt > 0);
});

test('invalid success-shaped responses cannot produce a healthy status', async () => {
    for (const payload of [{ ok: true }, { error: { message: 'denied' } }, null]) {
        const { status, config } = harness(async () => json(payload));
        assert.equal((await status.probeChannel(config.defaultConfig.channels[0], new AbortController().signal)).state, 'unknown');
        assert.equal((await status.probeChannel(config.defaultConfig.channels[1], new AbortController().signal)).state, 'unknown');
    }
    const { status, config } = harness(async () => new Response('<html>proxy fallback</html>'));
    const result = await status.probeChannel(config.defaultConfig.channels[0], new AbortController().signal);
    assert.equal(result.state, 'unknown');
    assert.equal(result.reason, 'response');
});

test('model checks retain existing proxy and Gemini URLs without executing model scripts', async () => {
    const calls = [];
    const { status, config } = harness(async (url, init) => { calls.push({ url, init }); return json({ models: [{ name: 'models/gemini-test' }] }); });
    config.useConfigStore.getState().updateConfig('proxyEnabled', true);
    const channel = { ...config.defaultConfig.channels[1], apiFormat: 'gemini', baseUrl: 'https://example.invalid/v1beta/', apiKey: 'test-key', models: [{ name: 'gemini-test', capability: 'text', script: 'throw new Error("must not execute")' }] };
    const result = await status.probeChannel(channel, new AbortController().signal);
    assert.deepEqual(result.modelNames, ['gemini-test']);
    assert.equal(calls[0].url, 'http://127.0.0.1:23210/https://example.invalid/v1beta/models');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers['x-goog-api-key'], 'test-key');
});

test('authentication failure remains a failure even when HTTP body contains model data', async () => {
    const { status, config } = harness(async () => json({ data: [{ id: 'listed' }] }, 401));
    const result = await status.probeChannel(config.defaultConfig.channels[1], new AbortController().signal);
    assert.equal(result.state, 'unreachable');
    assert.equal(result.reason, 'auth');
    assert.equal(result.httpStatus, 401);
});

test('a timed-out check aborts the underlying read and does not leave a hanging request', async () => {
    let aborted = false;
    const { status, config } = harness((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); })));
    const result = await status.probeChannel(config.defaultConfig.channels[0], new AbortController().signal, 10);
    assert.equal(result.reason, 'timeout');
    assert.equal(aborted, true);
});

test('leaving the view cancels a check without converting it into a saved failure', async () => {
    const { status, config } = harness((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))));
    const controller = new AbortController();
    const request = status.probeChannel(config.defaultConfig.channels[0], controller.signal);
    controller.abort(new Error('view closed'));
    await assert.rejects(request, /view closed/);
});
