import type { ComfyVideoCheckpoint } from "@/types/canvas";
import { withLocalProxy } from "@/stores/use-config-store";

// Recovery only queries the saved job. It must never resubmit a workflow.
export async function recoverComfyVideoTask(task: ComfyVideoCheckpoint, options?: { signal?: AbortSignal; onProgress?: (percent: number, detail: { stage: string; indeterminate: boolean }) => void }) {
    const base = task.baseUrl.replace(/\/+$/, "");
    const signal = options?.signal;
    const stage = (text: string) => options?.onProgress?.(0, { stage: text, indeterminate: true });
    const read = async (path: string) => {
        const response = await fetch(withLocalProxy(`${base}${path}`), { signal });
        if (!response.ok) throw new Error(`查询原任务失败（HTTP ${response.status}），任务标识已保留，可稍后重试`);
        return response;
    };
    try {
        signal?.throwIfAborted();
        stage("正在查询原任务，后台结果会自动取回");
        for (let attempt = 0; attempt < 4320; attempt++) {
            signal?.throwIfAborted();
            const history = await (await read(`/history/${encodeURIComponent(task.id)}`)).json();
            const entry = history[task.id];
            if (entry?.status?.status_str === "error") {
                const failure = entry.status.messages?.find((item: unknown[]) => item[0] === "execution_error")?.[1];
                const error = new Error(`原任务执行失败：${failure?.exception_message || "请查看 ComfyUI 日志"}`);
                error.name = "VideoTaskFailed";
                throw error;
            }
            const files = Object.values(entry?.outputs?.[task.outputNodeId] || {}).flatMap(value => Array.isArray(value) ? value : []) as { filename?: string; format?: string; subfolder?: string; type?: string }[];
            const file = files.find(file => file.filename && (/\.(mp4|mov|webm|mkv)$/i.test(file.filename) || file.format?.startsWith("video/")));
            if (file?.filename) {
                stage("已找到原任务结果，正在保存视频");
                const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: file.type || "output" });
                const blob = await (await read(`/view?${query}`)).blob();
                if (!blob.size || /json|text\/html/.test(blob.type)) throw new Error("原任务结果无法读取，任务标识已保留，请检查后台文件");
                return { blob };
            }
            if (entry?.status?.completed || entry?.status?.status_str === "success") throw new Error("原任务已完成，但没有找到视频文件，请检查 ComfyUI 历史输出");
            if (!entry) {
                const queue = await (await read("/queue")).json();
                const running = (queue.queue_running || []).some((item: unknown[]) => item[1] === task.id);
                const pending = (queue.queue_pending || []).some((item: unknown[]) => item[1] === task.id);
                if (running) stage("后台已开始，正在生成视频");
                else if (pending) stage("已提交，正在排队等待执行");
                else throw new Error(`后台暂未找到原任务 ${task.id}。标识已保留；请确认原服务和历史记录，再点击重试查询。`);
            }
            await new Promise<void>((resolve, reject) => {
                const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
                const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 2500);
                signal?.addEventListener("abort", abort, { once: true });
            });
        }
        throw new Error("查询原任务超时，任务标识已保留，可稍后重试");
    } catch (error) {
        if (signal?.aborted) {
            const response = await fetch(withLocalProxy(`${base}/api/jobs/${encodeURIComponent(task.id)}/cancel`), { method: "POST", signal: AbortSignal.timeout(10000) });
            if (!response.ok) throw new Error(`无法确认原任务 ${task.id} 已取消，请检查 ComfyUI 队列`);
            throw new DOMException("Aborted", "AbortError");
        }
        throw error;
    }
}
