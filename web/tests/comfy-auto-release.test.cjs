const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');
const output = {};
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/api/comfy-memory.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('exports', code)(output);

function fixture(response = { status: 202, ok: true, json: async () => ({ message: 'H3 与千问已请求释放' }) }) {
    const timers = new Map(), requests = [], notices = [];
    let next = 0;
    const state = { enabled: true, blocked: false, localWork: false, idle: true, onStatus: (busy, message) => notices.push({ busy, message }) };
    const controller = output.createComfyAutoRelease({
        setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
        clearTimer: id => timers.delete(id),
        fetchImpl: async (url, options) => { requests.push({ url, options }); return typeof response === 'function' ? response() : response; },
    });
    const update = patch => { Object.assign(state, patch); controller.update({ ...state }); };
    const tick = async () => {
        for (const [id, timer] of [...timers]) if (timer.ms === 3000) { timers.delete(id); timer.callback(); }
        await new Promise(resolve => setImmediate(resolve));
    };
    return { controller, update, tick, requests, notices, timers };
}

test('off retains models, including the legacy completion hint', async () => {
    const f = fixture();
    f.update({ enabled: false, localWork: true, blocked: true, idle: false });
    f.controller.markComplete();
    f.update({ localWork: false, blocked: false, idle: true });
    await f.tick();
    assert.equal(f.requests.length, 0);
    assert.equal(f.timers.size, 0);
});

test('enabling while already idle does not unload a retained model', async () => {
    const f = fixture();
    f.update({});
    await f.tick();
    assert.equal(f.requests.length, 0);
});

test('after local work finishes, releases once through the guarded endpoint', async () => {
    const f = fixture();
    f.update({ localWork: true, blocked: true, idle: false });
    f.update({ localWork: false, blocked: false, idle: true });
    await f.tick();
    f.update({});
    await f.tick();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, '/api/local-resources/release');
    assert.equal(f.requests[0].options.headers['X-Canvas-Resource-Action'], 'release');
    assert.match(f.notices.at(-1).message, /自动释放.*已请求/);
});

test('frontend batch or next queued item blocks release between backend tasks', async () => {
    const f = fixture();
    f.update({ localWork: true, blocked: true, idle: false });
    f.update({ localWork: false, idle: true });
    f.controller.markComplete();
    await f.tick();
    assert.equal(f.requests.length, 0);
    f.update({ blocked: false });
    await f.tick();
    assert.equal(f.requests.length, 1);
});

test('a quick task completion hint releases even if sampling missed the busy state', async () => {
    const f = fixture();
    f.update({});
    f.controller.markComplete();
    await f.tick();
    assert.equal(f.requests.length, 1);
});

for (const patch of [{ enabled: false }, { blocked: true }, { idle: false }]) {
    test(`pending release is canceled for ${JSON.stringify(patch)}`, async () => {
        const f = fixture();
        f.update({ localWork: true, blocked: true, idle: false });
        f.update({ localWork: false, blocked: false, idle: true });
        f.update(patch);
        await f.tick();
        assert.equal(f.requests.length, 0);
    });
}

test('server busy or manual-release cooldown is retried without duplicate requests', async () => {
    let calls = 0;
    const f = fixture(() => ({ status: ++calls === 1 ? 409 : 202, ok: calls !== 1, json: async () => ({ message: calls === 1 ? '服务仍忙碌' : '已请求释放' }) }));
    f.update({});
    f.controller.markComplete();
    await f.tick();
    await f.tick();
    await f.tick();
    assert.equal(f.requests.length, 2);
});

test('request failure stays visible and does not repeat in idle polling', async () => {
    const f = fixture(() => { throw new Error('offline'); });
    f.update({});
    f.controller.markComplete();
    await f.tick();
    f.update({});
    await f.tick();
    assert.equal(f.requests.length, 1);
    assert.match(f.notices.at(-1).message, /未确认/);
});

test('dispose cancels timers and a late response never updates the unmounted panel', async () => {
    let finish;
    const f = fixture(() => new Promise(resolve => { finish = resolve; }));
    f.update({});
    f.controller.markComplete();
    await f.tick();
    f.controller.dispose();
    const count = f.notices.length;
    finish({ status: 202, ok: true, json: async () => ({ message: 'accepted' }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.notices.length, count);
    assert.equal(f.timers.size, 0);
});

test('only bundled local Comfy endpoints qualify for frontend work hints', () => {
    for (const url of ['http://127.0.0.1:8189', 'http://localhost:8188', 'http://localhost:3000/api/comfyui', 'http://[::1]:8188']) assert.equal(output.isManagedLocalComfy(url), true, url);
    for (const url of ['http://remote.test:8189', 'http://localhost:12345', 'http://localhost:3000/api/other', 'bad url']) assert.equal(output.isManagedLocalComfy(url), false, url);
});
