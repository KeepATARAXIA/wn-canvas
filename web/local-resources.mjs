import { cpus, freemem, totalmem } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const MODEL_SERVICES = [
    { id: "h3", name: "H3 视频", url: "http://127.0.0.1:8188" },
    { id: "qwen", name: "千问图片", url: "http://127.0.0.1:8189" },
];

export function cpuTimes(items) {
    return items.reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
}

export function cpuPercent(previous, current) {
    const elapsed = current.total - previous.total;
    return elapsed > 0 ? Math.max(0, Math.min(100, (1 - (current.idle - previous.idle) / elapsed) * 100)) : null;
}

export function parseGpuMemory(output) {
    const devices = output.trim().split(/\r?\n/).map((line) => {
        const [index, name, used, total] = line.split(",").map((part) => part.trim());
        return { index, name, used: Number(used) * 1024 ** 2, total: Number(total) * 1024 ** 2 };
    });
    if (!devices.length || devices.some((device) => !Number.isFinite(device.used) || !Number.isFinite(device.total) || device.used < 0 || device.total <= 0 || device.used > device.total)) return null;
    const used = devices.reduce((sum, device) => sum + device.used, 0);
    const total = devices.reduce((sum, device) => sum + device.total, 0);
    return { used, total, percent: used / total * 100, devices };
}

export function createResourceService({ fetchImpl = fetch, run = runFile, readCpus = cpus, readFree = freemem, readTotal = totalmem, now = Date.now } = {}) {
    let previousCpu = cpuTimes(readCpus());
    let cached = null;
    let pending = null;
    let releasing = false;
    let releaseAfter = 0;

    async function queueState(url) {
        try {
            const response = await fetchImpl(`${url}/queue`, { signal: AbortSignal.timeout(2500) });
            if (!response.ok) return "unavailable";
            const queue = await response.json();
            if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) return "unavailable";
            return queue.queue_running.length || queue.queue_pending.length ? "busy" : "idle";
        } catch {
            return "unavailable";
        }
    }

    const serviceStates = () => Promise.all(MODEL_SERVICES.map(async (service) => ({ ...service, state: await queueState(service.url) })));
    const combinedState = (services) => services.some((service) => service.state === "busy") ? "busy" : services.some((service) => service.state === "idle") ? "idle" : "unavailable";

    async function sample() {
        const current = cpuTimes(readCpus());
        const cpu = cpuPercent(previousCpu, current);
        previousCpu = current;
        const total = readTotal();
        const used = Math.max(0, total - readFree());
        const [gpu, services] = await Promise.all([
            run("nvidia-smi", ["--query-gpu=index,name,memory.used,memory.total", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024 })
                .then(({ stdout }) => parseGpuMemory(String(stdout))).catch(() => null),
            serviceStates(),
        ]);
        cached = { sampledAt: now(), cpu, memory: { used, total, percent: used / total * 100 }, gpu, comfy: combinedState(services), services };
        return cached;
    }

    return {
        async stats() {
            if (cached && now() - cached.sampledAt < 1500) return cached;
            if (!pending) pending = sample().finally(() => { pending = null; });
            return pending;
        },
        async release() {
            if (releasing || now() < releaseAfter) return { status: 409, message: "正在释放显存，请稍后查看占用变化。" };
            releasing = true;
            try {
                // Always recheck the actual queue; the displayed sample may already be stale.
                const services = await serviceStates();
                const busy = services.filter((service) => service.state === "busy");
                if (busy.length) return { status: 409, services, message: `${busy.map((service) => service.name).join("、")}正在生成或有排队任务，请等任务结束后释放显存。` };
                if (combinedState(services) !== "idle") return { status: 503, services, message: "无法确认 H3 和千问服务空闲，未释放显存。请检查模型后台。" };
                const results = await Promise.all(services.map(async (service) => {
                    if (service.state !== "idle") return service;
                    try {
                        const response = await fetchImpl(`${service.url}/free`, {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(5000),
                        });
                        return { ...service, state: response.ok ? "accepted" : "failed" };
                    } catch {
                        return { ...service, state: "failed" };
                    }
                }));
                cached = null;
                releaseAfter = now() + 5000;
                // ComfyUI acknowledges flags here; reclamation happens asynchronously in its worker.
                const message = results.map((service) => `${service.name}：${service.state === "accepted" ? "已请求释放" : service.state === "failed" ? "释放未确认，请检查后台" : "未连接或状态未知，未释放"}`).join("；");
                return { status: results.some((service) => service.state === "failed") ? 502 : 202, services: results, message: `${message}。请观察显存变化，下次生成需重新加载模型。` };
            } catch {
                return { status: 502, message: "释放请求未确认，请检查模型后台并观察显存变化。" };
            } finally {
                releasing = false;
            }
        },
    };
}

export function resourceMiddleware(service = createResourceService()) {
    return async (req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (path !== "/api/local-resources" && path !== "/api/local-resources/release") return next();
        const reply = (status, data) => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(data));
        };
        // These endpoints expose/control this computer only, never a remote user's machine.
        const address = req.socket.remoteAddress;
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) return reply(403, { message: "仅支持本机访问。" });
        try {
            const host = new URL(`http://${req.headers.host}`).hostname;
            if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new Error();
            if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new Error();
            if (req.headers["sec-fetch-site"] === "cross-site") throw new Error();
        } catch {
            return reply(403, { message: "请求来源不被允许。" });
        }
        const release = path.endsWith("/release");
        if (req.method !== (release ? "POST" : "GET")) {
            res.setHeader("Allow", release ? "POST" : "GET");
            return reply(405, { message: "请求方法不支持。" });
        }
        if (release && req.headers["x-canvas-resource-action"] !== "release") return reply(403, { message: "无效的释放请求。" });
        try {
            if (release) {
                const result = await service.release();
                return reply(result.status, { message: result.message, services: result.services });
            }
            return reply(200, await service.stats());
        } catch {
            return reply(503, { message: "暂时无法读取电脑资源占用。" });
        }
    };
}

export function localResourcesPlugin() {
    return {
        name: "local-resources",
        configureServer(server) { server.middlewares.use(resourceMiddleware()); },
        configurePreviewServer(server) { server.middlewares.use(resourceMiddleware()); },
    };
}
