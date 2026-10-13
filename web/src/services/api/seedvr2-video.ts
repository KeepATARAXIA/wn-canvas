import { checkLocalGpuIdle } from "./local-prompt";

const BASE_URL = "http://127.0.0.1:17372";

type Progress = (progress: number, detail: { stage: string; indeterminate: boolean }) => void;
export type SeedVr2Settings = { batchSize?: number; temporalOverlap?: number; colorCorrection?: string; seed?: number };
export type SeedVr2Job = { id: string; status: "uploading" | "queued" | "running" | "cancelling" | "complete" | "error" | "cancelled"; progress?: number; stage?: string; progressIndeterminate?: boolean; error?: string; createdAt?: number; resolution?: number };

export async function requestSeedVr2Video(sourceUrl: string, resolution: number, onProgress?: Progress, options: { jobId?: string; signal?: AbortSignal } = {}) {
    const jobId = await submitSeedVr2Video(sourceUrl, resolution, {}, options, onProgress);
    return waitSeedVr2Video(jobId, onProgress, options.signal);
}

export async function submitSeedVr2Video(sourceUrl: string, resolution: number, settings: SeedVr2Settings, options: { jobId?: string; signal?: AbortSignal } = {}, onProgress?: Progress) {
    onProgress?.(0, { stage: "正在检查本地 GPU", indeterminate: true });
    await checkLocalGpuIdle();
    if (Object.keys(settings).length) {
        const health = await fetch(`${BASE_URL}/health`, { signal: options.signal }).then(readJson) as { qualitySettings?: boolean };
        if (!health.qualitySettings) throw new Error("SeedVR2 后台仍为旧版，请重启本地整合包后再开始，新的画质参数尚未生效");
    }
    onProgress?.(0, { stage: "正在读取原视频", indeterminate: true });
    const response = await fetch(sourceUrl, { signal: options.signal });
    if (!response.ok) throw new Error("原视频读取失败，请检查素材后重试");
    const source = await response.blob();
    onProgress?.(0, { stage: "正在提交视频超分任务", indeterminate: true });
    const query = new URLSearchParams({ resolution: String(resolution) });
    if (options.jobId) query.set("id", options.jobId);
    for (const [key, value] of Object.entries(settings)) if (value !== undefined) query.set(key, String(value));
    const queued = await fetch(`${BASE_URL}/jobs?${query}`, { method: "POST", headers: { "Content-Type": source.type || "video/mp4" }, body: source, signal: options.signal }).then(readJson) as { id?: string };
    if (!queued.id) throw new Error("SeedVR2 没有返回任务 ID");
    return queued.id;
}

export async function getSeedVr2Job(jobId: string, signal?: AbortSignal): Promise<SeedVr2Job | null> {
    const response = await fetch(`${BASE_URL}/jobs/${jobId}`, { signal });
    if (response.status === 404) return null;
    return readJson(response) as Promise<SeedVr2Job>;
}

export async function waitSeedVr2Video(jobId: string, onProgress?: Progress, signal?: AbortSignal) {
    while (true) {
        const job = await getSeedVr2Job(jobId, signal);
        if (!job) throw new Error("原超分任务不存在，请从原视频重新发起超分");
        if (job.status === "error") throw new Error(job.error || "SeedVR2 视频超分失败");
        if (job.status === "cancelled") throw new Error("视频超分任务已取消");
        if (job.status === "complete") break;
        if (job.status === "uploading") onProgress?.(0, { stage: "正在接收原视频", indeterminate: true });
        else if (job.status === "queued") onProgress?.(0, { stage: "任务已提交，正在排队", indeterminate: true });
        else if (job.status === "cancelling") onProgress?.(0, { stage: "正在取消视频超分", indeterminate: true });
        else if (job.stage) onProgress?.(job.progress || 0, { stage: job.stage, indeterminate: job.progressIndeterminate !== false });
        else if (typeof job.progress === "number" && job.progress > 3 && job.progress < 100) onProgress?.(job.progress, { stage: "SeedVR2 模型处理进度", indeterminate: false });
        else onProgress?.(0, { stage: "SeedVR2 正在准备模型", indeterminate: true });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        signal?.throwIfAborted();
    }
    onProgress?.(0, { stage: "正在读取超分结果", indeterminate: true });
    return readSeedVr2Result(jobId, signal);
}

export async function readSeedVr2Result(jobId: string, signal?: AbortSignal) {
    const result = await fetch(`${BASE_URL}/jobs/${jobId}/result`, { signal });
    if (!result.ok) throw new Error("无法读取 SeedVR2 视频结果");
    return result.blob();
}

export async function cancelSeedVr2Video(jobId: string) {
    return fetch(`${BASE_URL}/jobs/${jobId}/cancel`, { method: "POST" }).then(readJson) as Promise<SeedVr2Job>;
}

async function readJson(response: Response) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(data.error || `SeedVR2 服务请求失败（HTTP ${response.status}）`);
    return data;
}
