import { cancelSeedVr2Video, getSeedVr2Job, readSeedVr2Result, submitSeedVr2Video, type SeedVr2Job, type SeedVr2Settings } from "./seedvr2-video";

const BASE = "http://127.0.0.1:17374";
export type VideoOperation = "continuum" | "handtie" | "interpolate" | "upscale" | "restore" | "trim" | "audio";
export const videoOperationLabels: Record<VideoOperation, string> = {
    continuum: "长视频续生成", handtie: "角色与音轨串联", interpolate: "视频补帧", upscale: "视频放大", restore: "视频超分", trim: "视频剪切", audio: "音轨整理",
};
export type VideoToolParams = {
    projectId: string; operation: VideoOperation; source?: string; sourceNodeId?: string; firstImage?: string; references?: string[]; audio?: string; voice?: string;
    prompt?: string; chunks?: number; seconds?: number; resolution?: number; orientation?: string; review?: boolean; seed?: number;
    start?: number; end?: number; cutMode?: string; audioMode?: string; gain?: number; anime?: boolean;
    seedVr2?: SeedVr2Settings;
};
export type VideoToolJob = {
    id: string; params: VideoToolParams; status: "queued" | "running" | "cancelling" | "complete" | "error" | "cancelled";
    stage: string; progress: number; progressIndeterminate?: boolean; error?: string; notice?: string; createdAt: number;
    media?: { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number }[] };
};
async function json<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error("视频工具服务未连接，请双击桌面「无限画布（一键启动）」后重试。"); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `视频工具请求失败（${response.status}）`);
    return data;
}
export async function uploadVideoToolAsset(blob: Blob, name: string) {
    return json<{ id: string }>(`/assets?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
}
export const listVideoToolJobs = (projectId: string) => json<VideoToolJob[]>(`/jobs?projectId=${encodeURIComponent(projectId)}`);
export const isSeedVr2ToolJob = (id: string) => /^seedvr2-[0-9a-f]{32}$/.test(id);
function seedJob(job: SeedVr2Job): VideoToolJob {
    const stages = { uploading: "正在接收原视频", queued: "等待视频超分", running: "SeedVR2 正在处理", cancelling: "正在取消视频超分", complete: "视频超分完成", error: "视频超分失败", cancelled: "视频超分已取消，可重新开始" };
    return { id: `seedvr2-${job.id}`, params: { projectId: "", operation: "restore", resolution: job.resolution }, status: job.status === "uploading" ? "running" : job.status, stage: job.stage || stages[job.status], progress: job.progress || 0, progressIndeterminate: job.progressIndeterminate !== false && job.status !== "complete", error: job.error, createdAt: (job.createdAt || 0) * 1000 };
}
export async function getVideoToolJob(id: string): Promise<VideoToolJob> {
    if (!isSeedVr2ToolJob(id)) return json<VideoToolJob>(`/jobs/${id}`);
    const rawId = id.slice(8);
    // A refresh may interrupt upload before it reaches the service. Reserve a
    // cancellation tombstone before allowing retry so a late POST cannot run.
    return seedJob(await getSeedVr2Job(rawId) || await cancelSeedVr2Video(rawId));
}
export async function submitSeedVr2ToolJob(id: string, params: VideoToolParams, signal?: AbortSignal) {
    await submitSeedVr2Video(params.source!, params.resolution || 1080, params.seedVr2 || {}, { jobId: id.slice(8), signal });
    return getVideoToolJob(id);
}
export const submitVideoToolJob = (params: VideoToolParams | { projectId: string; resumeFrom: string; reviewAction?: string }) => json<VideoToolJob>("/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
export const cancelVideoToolJob = async (id: string) => isSeedVr2ToolJob(id) ? seedJob(await cancelSeedVr2Video(id.slice(8))) : json<VideoToolJob>(`/jobs/${id}/cancel`, { method: "POST" });
export async function readVideoToolResult(id: string) {
    if (isSeedVr2ToolJob(id)) return readSeedVr2Result(id.slice(8));
    const response = await fetch(`${BASE}/jobs/${id}/result`);
    if (!response.ok) throw new Error("无法读取视频结果，请从任务记录重试");
    return response.blob();
}
