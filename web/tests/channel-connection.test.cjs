const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');

function harness(fetch) {
    const sourceRoot = path.join(__dirname, '../src');
    const cache = new Map();
    const overrides = {
        '@/i18n': { t: key => key }, react: { useMemo: fn => fn() },
        zustand: require('../node_modules/zustand'), 'zustand/middleware': { persist: fn => fn }, nanoid: { nanoid: () => 'test-channel' },
        axios: { get: async (url, options) => { const response = await fetch(url, { method: 'GET', headers: options?.headers }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return { data: await response.text() }; } },
        './image': { fetchChannelModels: async () => ['model-a', 'model-b'] },
    };
    function load(relative) {
        const file = path.resolve(sourceRoot, relative);
        if (cache.has(file)) return cache.get(file);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
        const exports = {};
        cache.set(file, exports);
        new Function('exports', 'require', 'fetch', 'setTimeout', code)(exports, name => {
            if (name in overrides) return overrides[name];
            const target = name.startsWith('@/') ? path.join(sourceRoot, name.slice(2)) : path.resolve(path.dirname(file), name);
            if (target.endsWith('?raw')) return fs.readFileSync(target.slice(0, -4), 'utf8');
            return load(fs.existsSync(target) ? target : target + '.ts');
        }, fetch, (fn, ms) => setTimeout(fn, ms === 6000 ? 10 : ms));
        return exports;
    }
    return { api: load('services/api/channel.ts'), status: load('lib/config-capability-status.ts'), config: load('stores/use-config-store.ts') };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('connection drawer rejects HTML200 and empty JSON just like the service overview', async () => {
    for (const response of [() => new Response('<html>proxy fallback</html>'), () => json({}), () => json({ error: 'denied' })]) {
        const { api, status, config } = harness(async () => response());
        const channel = config.defaultConfig.channels[0];
        assert.equal((await status.probeChannel(channel, new AbortController().signal)).state, 'unknown');
        await assert.rejects(api.testChannelConnection(channel), /config.channelEditor.connectionResponse/);
    }
});

test('ComfyUI success performs only the validated read with optional auth', async () => {
    const calls = [];
    const { api, config } = harness(async (url, init) => { calls.push({ url, init }); return json({ system: { os: 'windows' }, devices: [] }); });
    const result = await api.testChannelConnection({ ...config.defaultConfig.channels[0], apiKey: 'test-only' });
    assert.deepEqual(result, {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://localhost:3000/api/comfyui/system_stats');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-only');
});

test('auth rejection and network errors cannot produce connection success', async () => {
    const auth = harness(async () => json({ system: {}, devices: [] }, 401));
    await assert.rejects(auth.api.testChannelConnection(auth.config.defaultConfig.channels[0]), /config.channelEditor.connectionAuth/);
    const network = harness(async () => { throw new Error('connection refused'); });
    await assert.rejects(network.api.testChannelConnection(network.config.defaultConfig.channels[0]), /config.channelEditor.connectionNetwork/);
});

test('a stalled connection drawer probe times out and aborts its read', async () => {
    let aborted = false;
    const { api, config } = harness((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); })));
    await assert.rejects(api.testChannelConnection(config.defaultConfig.channels[0]), /config.channelEditor.connectionTimeout/);
    assert.equal(aborted, true);
});

test('API channel connection continues to return the existing model-list count', async () => {
    const { api, config } = harness(async () => { throw new Error('unexpected request'); });
    assert.deepEqual(await api.testChannelConnection(config.defaultConfig.channels[1]), { modelCount: 2 });
});
