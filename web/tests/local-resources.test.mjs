import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cpuTimes, cpuPercent, parseGpuMemory, createResourceService, resourceMiddleware } from "../local-resources.mjs";

test("CPU uses differences across all cores, handles missing sample and clamps counters", () => {
    const previous = cpuTimes([{ times: { idle: 100, user: 50 } }, { times: { idle: 100, user: 50 } }]);
    const current = cpuTimes([{ times: { idle: 160, user: 90 } }, { times: { idle: 160, user: 90 } }]);
    assert.equal(cpuPercent(previous, current), 40);
    assert.equal(cpuPercent(current, current), null);
    assert.equal(cpuPercent({ idle: 100, total: 100 }, { idle: 99, total: 200 }), 100);
});

test("GPU counts actual board memory across cards and rejects unsupported readings", () => {
    const result = parseGpuMemory("0, RTX A, 1024, 4096\r\n1, RTX B, 2048, 8192\n");
    assert.equal(result.percent, 25);
    assert.equal(result.used, 3072 * 1024 ** 2);
    assert.equal(result.devices.length, 2);
    for (const output of ["", "0, RTX, N/A, 4096", "0, RTX, 1, 0", "0, RTX, -1, 100", "0, RTX, 101, 100"]) assert.equal(parseGpuMemory(output), null);
});

function fixture({ state = "idle", states = {}, failFree = false, failGpu = false } = {}) {
    let time = 10000, ticks = 0, scans = 0;
    const calls = [];
    const service = createResourceService({
        now: () => time,
        readCpus: () => [{ times: { idle: ++ticks * 50, user: ticks * 50 } }],
        readFree: () => 25, readTotal: () => 100,
        run: async (...args) => { scans++; assert.equal(args[2].windowsHide, true); if (failGpu) throw new Error(); return { stdout: "0, RTX, 1024, 4096" }; },
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            const port = new URL(url).port;
            if (url.endsWith("/free")) return { ok: !(failFree === true || failFree === port) };
            const current = states[port] || state;
            if (current === "offline") throw new Error("Offline");
            return { ok: true, json: async () => current === "malformed" ? {} : { queue_running: current === "busy" ? [1] : [], queue_pending: current === "pending" ? [1] : [] } };
        },
    });
    return { service, calls, scans: () => scans, advance: () => { time += 6000; }, setState: value => { state = value; } };
}

test("sampling shares in-flight work, caches briefly, and refreshes CPU/memory", async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.service.stats(), f.service.stats()]);
    assert.equal(a, b);
    assert.equal(a.cpu, 50);
    assert.equal(a.memory.percent, 75);
    assert.equal(a.gpu.percent, 25);
    await f.service.stats();
    assert.equal(f.scans(), 1);
    f.advance();
    await f.service.stats();
    assert.equal(f.scans(), 2);
});

test("unavailable GPU and ComfyUI do not hide CPU and RAM", async () => {
    const { service } = fixture({ state: "offline", failGpu: true });
    const data = await service.stats();
    assert.equal(data.gpu, null);
    assert.equal(data.comfy, "unavailable");
    assert.equal(data.cpu, 50);
    assert.equal(data.memory.percent, 75);
});

for (const state of ["busy", "pending", "offline", "malformed"]) {
    test(`release refuses ${state} queue without calling free`, async () => {
        const f = fixture({ state });
        assert.ok((await f.service.release()).status >= 400);
        assert.equal(f.calls.some(call => call.url.endsWith("/free")), false);
    });
}

test("release rechecks queue instead of trusting cached idle state", async () => {
    const f = fixture();
    assert.equal((await f.service.stats()).comfy, "idle");
    f.setState("busy");
    assert.equal((await f.service.release()).status, 409);
    assert.equal(f.calls.some(call => call.url.endsWith("/free")), false);
});

test("release requests model/cache reclamation only, serializes clicks and reports accepted", async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.service.release(), f.service.release()]);
    assert.equal(a.status, 202);
    assert.equal(b.status, 409);
    const free = f.calls.filter(call => call.url.endsWith("/free"));
    assert.deepEqual(free.map(call => new URL(call.url).port).sort(), ["8188", "8189"]);
    assert.deepEqual(JSON.parse(free[0].options.body), { unload_models: true, free_memory: true });
    assert.equal((await f.service.release()).status, 409);
    f.advance();
    assert.equal((await f.service.release()).status, 202);
});

test("release backend failure is never reported as success", async () => {
    assert.equal((await fixture({ failFree: true }).service.release()).status, 502);
});

for (const offlinePort of ["8188", "8189"]) {
    test(`release reaches the other model when ${offlinePort} is offline`, async () => {
        const f = fixture({ states: { [offlinePort]: "offline" } });
        const stats = await f.service.stats();
        assert.equal(stats.comfy, "idle");
        assert.equal(stats.services.length, 2);
        const result = await f.service.release();
        assert.equal(result.status, 202);
        assert.equal(result.services.find(s => new URL(s.url).port === offlinePort).state, "unavailable");
        assert.deepEqual(f.calls.filter(c => c.url.endsWith("/free")).map(c => new URL(c.url).port), [offlinePort === "8188" ? "8189" : "8188"]);
        assert.match(result.message, /未释放/);
    });
}

for (const state of ["busy", "pending"]) {
    test(`Qwen ${state} protects both services even when H3 is idle`, async () => {
        const f = fixture({ states: { "8189": state } });
        assert.equal((await f.service.stats()).comfy, "busy");
        assert.equal((await f.service.release()).status, 409);
        assert.equal(f.calls.some(c => c.url.endsWith("/free")), false);
    });
}

test("Qwen state is rechecked after a cached idle sample", async () => {
    const states = { "8189": "idle" };
    const f = fixture({ states });
    await f.service.stats();
    states["8189"] = "busy";
    assert.equal((await f.service.release()).status, 409);
    assert.equal(f.calls.some(c => c.url.endsWith("/free")), false);
});

test("partial release failure reports both accepted and failed models", async () => {
    const f = fixture({ failFree: "8189" });
    const result = await f.service.release();
    assert.equal(result.status, 502);
    assert.deepEqual(result.services.map(s => s.state), ["accepted", "failed"]);
    assert.match(result.message, /H3.*已请求/);
    assert.match(result.message, /千问.*未确认/);
});

test("HTTP endpoints enforce local access, origin, methods, action header, and no caching", async () => {
    let releases = 0;
    const middleware = resourceMiddleware({ stats: async () => ({ cpu: 42 }), release: async () => { releases++; return { status: 202, message: "accepted" }; } });
    const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const sample = await fetch(base + "/api/local-resources");
        assert.equal(sample.status, 200);
        assert.equal(sample.headers.get("cache-control"), "no-store");
        assert.deepEqual(await sample.json(), { cpu: 42 });
        const path = base + "/api/local-resources/release";
        assert.equal((await fetch(path)).status, 405);
        assert.equal((await fetch(path, { method: "POST" })).status, 403);
        const headers = { "X-Canvas-Resource-Action": "release" };
        assert.equal((await fetch(path, { method: "POST", headers: { ...headers, Origin: "https://example.com" } })).status, 403);
        assert.equal((await fetch(path, { method: "POST", headers: { ...headers, Origin: base } })).status, 202);
        assert.equal(releases, 1);
        assert.equal((await fetch(base + "/other")).status, 404);
        const res = { setHeader() {}, end(body) { this.body = body; } };
        await middleware({ url: "/api/local-resources", socket: { remoteAddress: "192.168.1.1" }, headers: {} }, res, () => {});
        assert.equal(res.statusCode, 403);
        await middleware({ url: "/api/local-resources", socket: { remoteAddress: "127.0.0.1" }, headers: { host: "evil.example:3000" } }, res, () => {});
        assert.equal(res.statusCode, 403);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
