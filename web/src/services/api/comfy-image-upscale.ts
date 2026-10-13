import { checkLocalGpuIdle } from "./local-prompt";

type ComfyFile = { filename: string; subfolder?: string; type?: string };
type ProgressCallback = (progress: number, detail: { stage: string; indeterminate: boolean }) => void;

export async function requestComfyImageUpscale(sourceUrl: string, baseUrl: string, modelName: string, onProgress?: ProgressCallback) {
    const reportStage = (stage: string, percent?: number) => onProgress?.(percent ?? 0, { stage, indeterminate: percent === undefined });
    reportStage("正在检查本地 GPU");
    await checkLocalGpuIdle();
    const endpoint = new URL(baseUrl.replace(/\/+$/, "") + "/");
    reportStage("正在读取原图");
    const source = await fetch(sourceUrl).then((response) => {
        if (!response.ok) throw new Error("无法读取原图");
        return response.blob();
    });

    reportStage("正在上传原图");
    const form = new FormData();
    form.append("image", source, `canvas-upscale-${Date.now()}.${source.type.includes("jpeg") ? "jpg" : "png"}`);
    form.append("type", "input");
    form.append("subfolder", "infinite-canvas/upscale-inputs");
    form.append("overwrite", "true");
    const uploaded = await fetch(new URL("upload/image", endpoint), { method: "POST", body: form }).then(readJson) as { name?: string; subfolder?: string };
    if (!uploaded.name) throw new Error("ComfyUI 没有返回上传文件名");

    const inputName = [uploaded.subfolder, uploaded.name].filter(Boolean).join("/");
    const workflow = {
        "1": { class_type: "LoadImage", inputs: { image: inputName } },
        "2": { class_type: "UpscaleModelLoader", inputs: { model_name: modelName } },
        "3": { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["2", 0], image: ["1", 0] } },
        "4": { class_type: "SaveImage", inputs: { filename_prefix: "infinite-canvas/upscaled", images: ["3", 0] } },
    };
    const clientId = crypto.randomUUID();
    let promptId = "";
    const earlyEvents: unknown[] = [];
    let finished = false;
    const handleEvent = (event: unknown) => {
        if (!event || typeof event !== "object") return;
        const message = event as { type?: string; data?: { prompt_id?: string; node?: string | number | null; value?: number; max?: number } };
        if (!promptId) { earlyEvents.push(event); return; }
        if (message.data?.prompt_id !== promptId) return;
        if (message.type === "execution_start") reportStage("后台已开始，正在准备超分模型");
        if (message.type === "executing") {
            const stages: Record<string, string> = { "1": "正在读取原图", "2": "正在加载超分模型", "3": "正在执行图片超分", "4": "正在保存超分图片" };
            reportStage(message.data.node == null ? "后台执行结束，正在读取结果" : stages[String(message.data.node)] || "正在执行图片超分");
        }
        if (message.type === "progress" && String(message.data.node) === "3" && Number.isFinite(message.data.value) && Number.isFinite(message.data.max) && (message.data.max || 0) > 0) {
            reportStage(`正在执行图片超分 ${message.data.value}/${message.data.max}`, Math.max(0, Math.min(100, (message.data.value! / message.data.max!) * 100)));
        }
    };
    reportStage("正在连接后台进度");
    const socket = await openProgressSocket(endpoint, clientId, handleEvent);
    if (socket) socket.addEventListener("close", () => { if (!finished) reportStage("实时进度连接中断，继续查询后台结果"); });
    try {
        reportStage("正在提交图片超分任务");
        const queued = await fetch(new URL("prompt", endpoint), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: workflow, client_id: clientId }),
        }).then(readJson) as { prompt_id?: string };
        if (!queued.prompt_id) throw new Error("ComfyUI 没有返回任务 ID");
        promptId = queued.prompt_id;
        reportStage("已提交，正在等待后台执行");
        earlyEvents.splice(0).forEach(handleEvent);
        const output = await waitForOutput(endpoint, promptId);
        reportStage("正在读取超分图片");
        const response = await fetch(buildViewUrl(endpoint, output));
        if (!response.ok) throw new Error(`读取超分结果失败（HTTP ${response.status}）`);
        return response.blob();
    } finally {
        finished = true;
        socket?.close();
    }
}

async function openProgressSocket(baseUrl: URL, clientId: string, onEvent: (event: unknown) => void): Promise<WebSocket | null> {
    if (typeof WebSocket !== "function") return null;
    const url = new URL("ws", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("clientId", clientId);
    try {
        const socket = new WebSocket(url);
        socket.addEventListener("message", (event) => {
            try { onEvent(JSON.parse(String(event.data))); } catch { /* Ignore non-JSON backend frames. */ }
        });
        await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 2000);
            socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
            socket.addEventListener("error", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        if (socket.readyState === 1) return socket;
        socket.close();
    } catch { /* HTTP polling still retrieves the finished result. */ }
    return null;
}

async function waitForOutput(baseUrl: URL, promptId: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10 * 60 * 1000) {
        const history = await fetch(new URL(`history/${encodeURIComponent(promptId)}`, baseUrl)).then(readJson) as Record<string, { status?: { status_str?: string; messages?: unknown[] }; outputs?: Record<string, { images?: ComfyFile[] }> }>;
        const entry = history[promptId];
        if (entry?.status?.status_str === "error") throw new Error(readComfyError(entry.status.messages));
        const output = entry?.outputs?.["4"]?.images?.[0];
        if (output) return output;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("AI 超分等待超时");
}

function buildViewUrl(baseUrl: URL, file: ComfyFile) {
    const url = new URL("view", baseUrl);
    url.searchParams.set("filename", file.filename);
    url.searchParams.set("subfolder", file.subfolder || "");
    url.searchParams.set("type", file.type || "output");
    return url;
}

async function readJson(response: Response) {
    const text = await response.text();
    if (!response.ok) throw new Error(`ComfyUI 请求失败（HTTP ${response.status}）${text ? `：${text.slice(0, 300)}` : ""}`);
    return text ? JSON.parse(text) : {};
}

function readComfyError(messages?: unknown[]) {
    const failure = messages?.find((message) => Array.isArray(message) && message[0] === "execution_error") as [string, { exception_message?: string; exception_type?: string }] | undefined;
    return `ComfyUI 执行失败：${failure?.[1]?.exception_message || failure?.[1]?.exception_type || "未知错误"}`;
}
