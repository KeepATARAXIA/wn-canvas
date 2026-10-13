import type { CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasNodeData } from "@/types/canvas";
import { getNodeDefinition } from "./node-registry";
import { videoMetadata } from "./canvas-node-factory";
import { uploadMediaFile } from "@/services/file-storage";
import { cancelVideoToolJob, getVideoToolJob, readVideoToolResult, submitSeedVr2ToolJob, submitVideoToolJob, uploadVideoToolAsset, type VideoOperation, type VideoToolJob, type VideoToolParams } from "@/services/api/canvas-video-tools";

type Host = Pick<CanvasPluginHost, "getNodes" | "getNode" | "getConnections" | "updateMetadata">;
export type VideoToolState = { job?: VideoToolJob; submitting: boolean; importing: boolean; error: string; chainRunning: boolean; chainStatus: string };
const EMPTY_STATE: VideoToolState = { submitting: false, importing: false, error: "", chainRunning: false, chainStatus: "" };
export const videoToolJobActive = (job?: VideoToolJob) => !!job && ["queued", "running", "cancelling"].includes(job.status);
const runtimes = new Map<string, VideoToolRuntime>();
const listeners = new Set<() => void>();
const publish = () => listeners.forEach(listener => listener());
export const subscribeVideoTools = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getVideoToolState = (projectId: string, nodeId: string) => runtimes.get(projectId)?.state(nodeId) || EMPTY_STATE;
export const getVideoToolRuntime = (projectId: string) => runtimes.get(projectId);
export const videoPipelineRunning = (projectId: string) => Boolean(runtimes.get(projectId)?.chain);

// The project owns execution and polling. Viewport culling may freely unmount node UI.
export class VideoToolRuntime {
    private states = new Map<string, VideoToolState>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private watching = new Map<string, string>();
    private imports = new Map<string, Promise<void>>();
    private uploads = new Map<string, AbortController>();
    private disposed = false;
    chain: AbortController | null = null;

    constructor(readonly projectId: string, private getHost: () => Host, private saveJob?: (nodeId: string, jobId: string) => Promise<void>) {}
    state = (id: string) => this.states.get(id) || EMPTY_STATE;
    private patch(id: string, patch: Partial<VideoToolState>) {
        if (this.disposed) return;
        this.states.set(id, { ...this.state(id), ...patch });
        publish();
    }
    fail = (id: string, error: unknown) => this.patch(id, { error: error instanceof Error ? error.message : String(error) });
    private node(id: string) {
        const node = this.getHost().getNode(id);
        if (this.disposed || !node) throw new Error("画布已关闭或节点已移除；已提交的任务可返回原画布取回");
        return node;
    }
    sync(nodes: CanvasNodeData[]) {
        for (const node of nodes) {
            const jobId = node.metadata?.videoToolJobId;
            if (node.type.startsWith("video-tool:") && jobId && !this.state(node.id).submitting && this.watching.get(node.id) !== jobId) this.watch(node.id, jobId);
        }
        for (const id of this.watching.keys()) {
            if (!nodes.some(node => node.id === id && node.metadata?.videoToolJobId === this.watching.get(id))) {
                clearTimeout(this.timers.get(id));
                this.watching.delete(id);
            }
        }
    }
    private watch(id: string, jobId: string) {
        clearTimeout(this.timers.get(id));
        this.watching.set(id, jobId);
        const poll = async () => {
            const current = () => !this.disposed && this.watching.get(id) === jobId && Boolean(this.getHost().getNode(id));
            if (!current()) return;
            let delay = 0;
            try {
                const job = await getVideoToolJob(jobId);
                if (!current()) return;
                this.patch(id, { job, error: job.status === "cancelled" ? this.state(id).error : "" });
                if (job.status === "complete" && this.node(id).metadata?.videoToolImportedJobId !== job.id) await this.importResult(id, job);
                if (videoToolJobActive(job)) delay = 2000;
            } catch (error) {
                if (!current()) return;
                this.fail(id, error);
                if (this.state(id).job?.status !== "complete") delay = 5000;
            }
            if (delay && current()) this.timers.set(id, setTimeout(() => void poll(), delay));
        };
        void poll();
    }
    async importResult(id: string, job = this.state(id).job) {
        if (!job || job.status !== "complete") return;
        const key = `${id}:${job.id}`;
        if (this.imports.has(key)) return this.imports.get(key);
        this.patch(id, { importing: true, error: "" });
        const operation = (async () => {
            try {
                const video = await uploadMediaFile(await readVideoToolResult(job.id), "video");
                if (this.disposed || this.getHost().getNode(id)?.metadata?.videoToolJobId !== job.id) return;
                this.getHost().updateMetadata(id, { ...videoMetadata(video), videoToolImportedJobId: job.id });
            } catch (error) {
                throw new Error(`结果已保存在后台，点击「取回结果」重试：${String(error)}`);
            } finally { this.patch(id, { importing: false }); }
        })();
        this.imports.set(key, operation);
        try { await operation; } finally { this.imports.delete(key); }
    }
    private async parameters(id: string, signal?: AbortSignal): Promise<VideoToolParams> {
        const node = this.node(id), settings = node.metadata?.videoToolSettings || {};
        const operation = node.type.split(":")[1] as VideoOperation;
        const upstream = this.getHost().getConnections().filter(c => c.toNodeId === id).flatMap(c => this.getHost().getNode(c.fromNodeId) || []);
        const media = upstream.flatMap(node => {
            const resource = getNodeDefinition(node.type)?.resource?.(node);
            return resource?.url ? [{ id: node.id, kind: resource.kind, url: resource.url, duration: node.metadata?.durationMs }] : [];
        });
        const videos = media.filter(item => item.kind === "video");
        const source = String(settings.source || (videos.length === 1 ? videos[0].id : ""));
        const long = operation === "continuum" || operation === "handtie";
        if (long && !String(settings.prompt || "").trim()) throw new Error("请填写分段描述");
        if (!long && !media.some(item => item.id === source && item.kind === "video")) throw new Error("请连接一个已经有结果的视频节点");
        if (operation === "audio" && settings.audioMode !== "mute" && !settings.audio) throw new Error("请选择连接的新音轨");
        if (upstream.some(node => node.metadata?.videoToolJobId && node.metadata.videoToolJobId !== node.metadata.videoToolImportedJobId)) throw new Error("请先完成上游节点，或断开不需要的输入连线。");
        if (operation === "restore") return {
            projectId: this.projectId, operation, sourceNodeId: id,
            source: videos.find(item => item.id === source)!.url, resolution: Number(settings.resolution ?? 1080),
            seedVr2: { batchSize: Number(settings.batchSize ?? 9), temporalOverlap: Number(settings.temporalOverlap ?? 4), colorCorrection: String(settings.colorCorrection ?? "lab"), seed: Number(settings.seed ?? 42) },
        };
        const upload = async (key: string | undefined, kind: string) => {
            if (!key) return undefined;
            const item = media.find(item => item.id === key && item.kind === kind);
            if (!item) throw new Error("所选素材未连接或类型不匹配，请检查输入连线。");
            signal?.throwIfAborted();
            const response = await fetch(item.url, { signal });
            if (!response.ok) throw new Error("无法读取输入素材，请先完成上游节点");
            const blob = await response.blob();
            const ext = ({ "image/jpeg": "jpg", "image/webp": "webp", "video/webm": "webm", "audio/mpeg": "mp3", "audio/flac": "flac", "audio/ogg": "ogg", "audio/mp4": "m4a" } as Record<string, string>)[blob.type] || (kind === "image" ? "png" : kind === "audio" ? "wav" : "mp4");
            return (await uploadVideoToolAsset(blob, `canvas.${ext}`)).id;
        };
        return {
            projectId: this.projectId, operation, sourceNodeId: id,
            source: operation !== "continuum" ? await upload(source, "video") : undefined,
            firstImage: long ? await upload(settings.firstImage as string | undefined, "image") : undefined,
            references: long ? await Promise.all(((settings.references || []) as string[]).map(async key => (await upload(key, "image"))!)) : undefined,
            audio: long || (operation === "audio" && settings.audioMode !== "mute") ? await upload(settings.audio as string | undefined, "audio") : undefined,
            voice: operation === "handtie" ? await upload(settings.voice as string | undefined, "audio") : undefined,
            prompt: String(settings.prompt || ""), chunks: Number(settings.chunks ?? 2), seconds: Number(settings.seconds ?? 5), resolution: Number(settings.resolution ?? 480),
            orientation: String(settings.orientation || "landscape"), review: settings.review !== false,
            start: Number(settings.start ?? 0), end: Number(settings.end ?? Math.min(5, (videos.find(item => item.id === source)?.duration || 5000) / 1000)),
            cutMode: String(settings.cutMode || "precise"), audioMode: String(settings.audioMode || "replace"), gain: Number(settings.gain ?? -6), anime: settings.anime === true,
        };
    }
    async startJob(id: string, resume = false, redo = false, signal?: AbortSignal) {
        const state = this.state(id), node = this.node(id);
        if (state.submitting || state.importing || videoToolJobActive(state.job) || (this.chain && !signal) || (node.metadata?.videoToolJobId && state.job?.id !== node.metadata.videoToolJobId)) throw new Error("已有任务或流程正在执行，请等待完成");
        this.patch(id, { submitting: true, error: "" });
        try {
            const params = resume && state.job ? { projectId: this.projectId, resumeFrom: state.job.id, reviewAction: redo ? "Regenerate Current" : "Continue / Next" } : await this.parameters(id, signal);
            this.node(id);
            signal?.throwIfAborted();
            if ("operation" in params && params.operation === "restore") return await this.startSeedJob(id, params, signal);
            const next = await submitVideoToolJob(params);
            // Retain the ID even when a stop was requested while POST was in flight.
            if (!this.disposed) this.getHost().updateMetadata(id, { videoToolJobId: next.id });
            this.patch(id, { job: next });
            // React commits metadata asynchronously; a fast completed job must not
            // import against the previous job ID and then stop polling forever.
            for (let attempt = 0; !this.disposed && this.node(id).metadata?.videoToolJobId !== next.id; attempt++) {
                if (attempt >= 100) throw new Error("任务已提交，但画布未保存任务标识，请返回画布检查");
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            await this.saveJob?.(id, next.id);
            this.node(id);
            if (this.watching.get(id) !== next.id) this.watch(id, next.id);
            if (signal?.aborted) await this.cancel(id);
            signal?.throwIfAborted();
            return next;
        } finally { this.patch(id, { submitting: false }); }
    }
    private async startSeedJob(id: string, params: VideoToolParams, signal?: AbortSignal) {
        const jobId = `seedvr2-${crypto.randomUUID().replaceAll("-", "")}`;
        const controller = new AbortController();
        this.uploads.set(id, controller);
        const stop = () => { void this.cancel(id).catch(error => this.fail(id, error)); };
        signal?.addEventListener("abort", stop, { once: true });
        this.patch(id, { job: { id: jobId, params, status: "running", stage: "正在准备原视频", progress: 0, progressIndeterminate: true, createdAt: Date.now() } });
        this.getHost().updateMetadata(id, { videoToolJobId: jobId });
        try {
            // Persist before uploading: refresh resumes this ID, never creates a duplicate.
            for (let attempt = 0; this.node(id).metadata?.videoToolJobId !== jobId; attempt++) {
                if (attempt >= 100) throw new Error("画布未保存任务标识，尚未提交超分");
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            await this.saveJob?.(id, jobId);
            this.node(id);
            controller.signal.throwIfAborted();
            signal?.throwIfAborted();
            const next = await submitSeedVr2ToolJob(jobId, params, controller.signal);
            this.patch(id, { job: next });
            return next;
        } catch (error) {
            // Reconcile ambiguous POST failures against the original ID. A missing
            // upload is cancelled at the service before retry becomes available.
            try { this.patch(id, { job: await getVideoToolJob(jobId) }); }
            catch { /* Poll the saved ID again when the local service returns. */ }
            throw error;
        } finally {
            this.uploads.delete(id);
            signal?.removeEventListener("abort", stop);
            if (!this.disposed && this.getHost().getNode(id)) this.watch(id, jobId);
        }
    }
    async cancel(id: string) {
        this.uploads.get(id)?.abort();
        const job = this.state(id).job;
        if (job) this.patch(id, { job: await cancelVideoToolJob(job.id) });
    }
    async execute(id: string, signal: AbortSignal) {
        const next = await this.startJob(id, false, false, signal);
        for (;;) {
            this.node(id);
            if (signal.aborted) { await this.cancel(id); throw new Error("流程已停止，当前任务已请求取消"); }
            const state = this.state(id);
            if (state.job?.id === next.id && ["error", "cancelled"].includes(state.job.status)) throw new Error(state.job.error || state.job.stage);
            if (state.error) throw new Error(state.error);
            if (this.node(id).metadata?.videoToolImportedJobId === next.id) return;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    async runChain(id: string) {
        if (this.chain) throw new Error("当前画布已有流程正在执行");
        const ordered = videoPipelineNodes(id, this.getHost());
        for (const node of ordered) {
            const settings = node.metadata?.videoToolSettings || {};
            if ((node.type === "video-tool:continuum" || node.type === "video-tool:handtie") && !String(settings.prompt || "").trim()) throw new Error(`「${node.title}」还没有填写分段描述`);
            if (node.type === "video-tool:continuum" && settings.review !== false) throw new Error(`「${node.title}」开启逐段检查，请单独执行或先关闭逐段检查。`);
            if (node.type === "video-tool:audio" && settings.audioMode !== "mute" && !settings.audio) throw new Error(`「${node.title}」还没有选择新音轨`);
            if (node.type === "video-tool:trim" && settings.end !== undefined && Number(settings.end) <= Number(settings.start || 0)) throw new Error(`「${node.title}」的终点必须大于起点`);
        }
        const controller = new AbortController();
        this.chain = controller;
        this.patch(id, { chainRunning: true, error: "" });
        try {
            for (let i = 0; i < ordered.length; i++) {
                controller.signal.throwIfAborted();
                this.patch(id, { chainStatus: `${i + 1}/${ordered.length} · ${ordered[i].title}` });
                await this.execute(ordered[i].id, controller.signal);
            }
            this.patch(id, { chainStatus: `已完成全部 ${ordered.length} 个节点` });
        } catch (error) {
            this.fail(id, error);
            this.patch(id, { chainStatus: "流程已停止" });
        } finally { this.chain = null; this.patch(id, { chainRunning: false }); }
    }
    stopChain = () => this.chain?.abort();
    dispose() {
        this.disposed = true;
        this.timers.forEach(clearTimeout);
        this.timers.clear();
        this.watching.clear();
        // Leaving the page stops subsequent steps, but does not cancel submitted backend jobs.
    }
}

export function videoPipelineNodes(id: string, host: Pick<Host, "getNode" | "getConnections">) {
    const ordered: CanvasNodeData[] = [], visited = new Set<string>(), visiting = new Set<string>();
    const connections = host.getConnections();
    function visit(id: string) {
        if (visiting.has(id)) throw new Error("连线形成循环，请断开回到上游的连线");
        if (visited.has(id)) return;
        const node = host.getNode(id);
        if (!node) throw new Error("流程节点已移除，请检查连线");
        visiting.add(id);
        connections.filter(c => c.toNodeId === id).forEach(c => visit(c.fromNodeId));
        visiting.delete(id); visited.add(id);
        if (node.type.startsWith("video-tool:")) ordered.push(node);
    }
    visit(id);
    return ordered;
}

export function registerVideoProject(projectId: string, getHost: () => Host, saveJob?: (nodeId: string, jobId: string) => Promise<void>) {
    const runtime = new VideoToolRuntime(projectId, getHost, saveJob);
    runtimes.set(projectId, runtime);
    publish();
    return () => { runtime.dispose(); if (runtimes.get(projectId) === runtime) runtimes.delete(projectId); publish(); };
}

export async function runRegisteredVideoNode(projectId: string, nodeId: string) {
    const runtime = runtimes.get(projectId);
    if (!runtime) throw new Error("请先打开此画布，再执行视频节点");
    if (runtime.chain) throw new Error("当前画布已有流程正在执行");
    await runtime.execute(nodeId, new AbortController().signal);
}
