import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Input, InputNumber, Modal, Progress, Segmented, Select } from "antd";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { cancelVideoToolJob, listVideoToolJobs, readVideoToolResult, submitVideoToolJob, uploadVideoToolAsset, videoOperationLabels, type VideoOperation, type VideoToolJob } from "@/services/api/canvas-video-tools";

type MediaChoice = { key: string; name: string; kind: "image" | "video" | "audio"; url?: string; file?: File };
const active = (j: VideoToolJob) => ["queued", "running", "cancelling"].includes(j.status);

export function CanvasVideoToolsDialog({ open, onClose, projectId, nodes, initialNodeId, operation, onResult }: {
    open: boolean; onClose: () => void; projectId: string; nodes: CanvasNodeData[]; initialNodeId?: string | null;
    operation: VideoOperation;
    onResult: (blob: Blob, job: VideoToolJob) => Promise<void>;
}) {
    const { message } = App.useApp();
    const [files, setFiles] = useState<MediaChoice[]>([]);
    const [source, setSource] = useState<string>();
    const [firstImage, setFirstImage] = useState<string>();
    const [references, setReferences] = useState<string[]>([]);
    const [audio, setAudio] = useState<string>();
    const [voice, setVoice] = useState<string>();
    const [prompt, setPrompt] = useState("");
    const [chunks, setChunks] = useState(2);
    const [seconds, setSeconds] = useState(5);
    const [resolution, setResolution] = useState(480);
    const [orientation, setOrientation] = useState("landscape");
    const [review, setReview] = useState(true);
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(5);
    const [cutMode, setCutMode] = useState("precise");
    const [audioMode, setAudioMode] = useState("replace");
    const [gain, setGain] = useState(-6);
    const [anime, setAnime] = useState(false);
    const [jobs, setJobs] = useState<VideoToolJob[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [watchId, setWatchId] = useState("");
    const [importing, setImporting] = useState("");
    const imported = useRef(new Set<string>());
    const localUrls = useRef<string[]>([]);
    const assetIds = useRef(new Map<string, string>());
    const resultCallback = useRef(onResult);
    resultCallback.current = onResult;
    const media: MediaChoice[] = [
        ...nodes.flatMap((n): MediaChoice[] => n.metadata?.content && [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(n.type as CanvasNodeType) ? [{ key: n.id, name: n.title || n.id, kind: n.type as MediaChoice["kind"], url: n.metadata.content }] : []),
        ...files,
    ];
    const options = (kind: MediaChoice["kind"]) => media.filter(m => m.kind === kind).map(m => ({ value: m.key, label: m.name }));
    const selectedVideo = media.find(m => m.key === source);
    const preview = selectedVideo?.url;
    const busy = submitting || jobs.some(active);
    const long = operation === "continuum" || operation === "handtie";

    useEffect(() => () => localUrls.current.forEach(url => URL.revokeObjectURL(url)), []);

    useEffect(() => {
        if (!open || !initialNodeId) return;
        const n = nodes.find(n => n.id === initialNodeId);
        if (n?.type === CanvasNodeType.Video && n.metadata?.content) { setSource(n.id); }
        if (n?.metadata?.prompt) setPrompt(n.metadata.prompt);
    }, [open, initialNodeId]);

    useEffect(() => {
        if (!open && !watchId) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const rows = await listVideoToolJobs(projectId);
                if (stopped) return;
                setJobs(rows);
                const done = rows.find(j => j.id === watchId);
                if (done && !active(done)) {
                    setWatchId("");
                    if (done.status === "complete" && !imported.current.has(done.id)) {
                        imported.current.add(done.id);
                        try { await resultCallback.current(await readVideoToolResult(done.id), done); message.success("视频已放入画布"); }
                        catch (e) { imported.current.delete(done.id); setError(`生成已完成，回传失败，可在记录中重新放入画布：${String(e)}`); }
                    } else if (done.status === "error") setError(done.error || "任务失败");
                }
            } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : String(e)); }
            if (!stopped) timer = setTimeout(poll, 2000);
        };
        void poll();
        return () => { stopped = true; clearTimeout(timer); };
    }, [open, watchId, projectId, message]);

    async function upload(key?: string) {
        if (!key) return undefined;
        const item = media.find(m => m.key === key);
        if (!item) throw new Error("所选素材已从画布移除，请重新选择");
        const cacheKey = key + (item.url || "");
        if (assetIds.current.has(cacheKey)) return assetIds.current.get(cacheKey)!;
        const blob = item.file || await fetch(item.url!).then(r => { if (!r.ok) throw new Error("无法读取画布素材"); return r.blob(); });
        if (!blob) throw new Error("素材为空，请重新选择");
        const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/webm": "webm", "audio/wav": "wav", "audio/mpeg": "mp3", "audio/flac": "flac", "audio/ogg": "ogg", "audio/mp4": "m4a" } as Record<string, string>)[blob.type] || (item.kind === "image" ? "png" : item.kind === "audio" ? "wav" : "mp4");
        const result = await uploadVideoToolAsset(blob, item.file?.name || `canvas.${ext}`);
        assetIds.current.set(cacheKey, result.id);
        return result.id;
    }

    async function startJob(resume?: VideoToolJob, redo = false) {
        setSubmitting(true); setError("");
        try {
            const j = resume ? await submitVideoToolJob({ projectId, resumeFrom: resume.id, reviewAction: redo ? "Regenerate Current" : "Continue / Next" }) : await submitVideoToolJob({
                projectId, operation, sourceNodeId: operation !== "continuum" && nodes.some(n => n.id === source) ? source : undefined, source: operation !== "continuum" ? await upload(source) : undefined,
                firstImage: long ? await upload(firstImage) : undefined,
                references: long ? await Promise.all(references.map(async key => (await upload(key))!)) : undefined,
                audio: long || (operation === "audio" && audioMode !== "mute") ? await upload(audio) : undefined,
                voice: operation === "handtie" ? await upload(voice) : undefined,
                prompt, chunks, seconds, resolution, orientation, review, start, end, cutMode, audioMode, gain, anime,
            });
            setJobs(rows => [j, ...rows]); setWatchId(j.id);
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setSubmitting(false); }
    }

    async function importResult(job: VideoToolJob) {
        setImporting(job.id);
        try { await onResult(await readVideoToolResult(job.id), job); message.success("已放入画布"); }
        catch (e) { setError(String(e)); }
        finally { setImporting(""); }
    }

    return <Modal title={videoOperationLabels[operation]} open={open} onCancel={onClose} footer={null} width={800} centered styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}>
        <div className="space-y-5">
            <p className="text-sm opacity-60">完成后自动添加视频节点。关闭窗口不停止任务，可从此功能的记录取回结果。</p>
            <label className="block text-sm">添加本地素材 <input className="ml-3 max-w-full" type="file" accept="image/*,video/*,audio/*" multiple onChange={e => {
                const added = Array.from(e.target.files || []).filter(f => /^(image|video|audio)\//.test(f.type)).map(f => {
                    const url = URL.createObjectURL(f); localUrls.current.push(url);
                    return { key: crypto.randomUUID(), name: f.name, kind: f.type.split("/")[0] as MediaChoice["kind"], file: f, url };
                });
                setFiles(current => [...current, ...added]); e.target.value = "";
            }} /></label>
            {operation !== "continuum" && <div className="space-y-2"><div>{operation === "handtie" ? "参考视频（可选，作为动作/画面参考）" : "原视频"}</div><Select className="w-full" allowClear placeholder="选择画布视频或已添加的本地视频" value={source} options={options("video")} onChange={setSource} />{preview && !long && <video className="max-h-48 w-full rounded-lg" src={preview} controls preload="metadata" onLoadedMetadata={e => setEnd(Number(e.currentTarget.duration.toFixed(2)))} />}</div>}
            {long && <>
                <div className="grid grid-cols-2 gap-4">
                    <label>首帧（可选）<Select className="mt-2 w-full" allowClear value={firstImage} options={options("image")} onChange={setFirstImage} placeholder="不选则按文字生成" /></label>
                    <label>角色参考（最多 3 张）<Select mode="multiple" maxCount={3} className="mt-2 w-full" value={references} options={options("image")} onChange={setReferences} /></label>
                </div>
                <label className="block">分段描述<Input.TextArea className="mt-2" rows={5} maxLength={16000} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={operation === "handtie" ? "描述第一段；后续段落只写接下来发生什么。用单独一行 --- 分隔。角色按 @role1、@role2、@role3 引用。" : "描述每段内容，用单独一行 --- 分隔；也可填写一段统一描述。"} /></label>
                <div className="flex flex-wrap items-center gap-4"><label>段数 <InputNumber min={1} max={8} value={chunks} onChange={v => setChunks(v || 2)} /></label><label>每段 <Select value={seconds} options={[5, 8, 10, 15].map(v => ({ value: v, label: `${v} 秒` }))} onChange={setSeconds} /></label><Select value={resolution} options={[480, 720, 1080].map(v => ({ value: v, label: `${v}p` }))} onChange={setResolution} /><Segmented value={orientation} options={[{ value: "landscape", label: "横屏 16:9" }, { value: "portrait", label: "竖屏 9:16" }]} onChange={v => setOrientation(String(v))} /></div>
                <div className="text-sm opacity-60">480p 横屏导出 854×480，720p 为 1280×720，1080p 为 1920×1080；竖屏宽高互换。1080p 使用较低内部分辨率放大导出。角色串联的模型尺寸另按其预设对齐。16GB 显卡建议先跑 480p、两段；角色串联可能耗时十分钟以上。</div>
                <label className="block">连续音轨（可选，作为整段视频的声音）<Select className="mt-2 w-full" allowClear value={audio} options={options("audio")} onChange={setAudio} /></label>
                {operation === "handtie" ? <><label className="block">声音参考（可选）<Select className="mt-2 w-full" allowClear value={voice} options={options("audio")} onChange={setVoice} /></label><p className="text-sm opacity-60">使用 Motion-Context 续接画面和声音；相邻片段会裁去重叠部分，成片时长略短于段数×每段时长。</p></> : <Checkbox checked={review} onChange={e => setReview(e.target.checked)}>逐段检查：每次生成一段，在任务记录点「继续下一段」</Checkbox>}
            </>}
            {operation === "interpolate" && <p className="text-sm opacity-70">RIFE 补帧到原帧率的 2 倍，例如 24→48fps；保留视频时长和音轨。会重新编码，并自动检查末尾帧。</p>}
            {operation === "upscale" && <><p className="text-sm opacity-70">Video2X 放大到原宽高的 2 倍，保留帧率和音轨。需要修复压缩和模糊时，也可用视频节点原有的 SeedVR2「视频超分」。</p><Checkbox checked={anime} onChange={e => setAnime(e.target.checked)}>动画素材</Checkbox></>}
            {operation === "trim" && <><div className="flex gap-4"><label>起点（秒）<InputNumber min={0} step={.1} value={start} onChange={v => setStart(v ?? 0)} /></label><label>终点（秒）<InputNumber min={0} step={.1} value={end} onChange={v => setEnd(v ?? 0)} /></label></div><Segmented value={cutMode} options={[{ value: "precise", label: "精确剪切（重新编码）" }, { value: "lossless", label: "无损剪切（关键帧对齐）" }]} onChange={v => setCutMode(String(v))} /><p className="text-sm opacity-60">无损模式的实际起点可能提前到关键帧；需要准确时间请用精确剪切。</p></>}
            {operation === "audio" && <><Segmented value={audioMode} options={[{ value: "replace", label: "替换音轨" }, { value: "mix", label: "混入背景音" }, { value: "mute", label: "移除声音" }]} onChange={v => setAudioMode(String(v))} />{audioMode !== "mute" && <><Select className="w-full" value={audio} options={options("audio")} onChange={setAudio} placeholder="选择新音轨" /><label>新音轨音量（dB） <InputNumber min={-40} max={12} value={gain} onChange={v => setGain(v ?? -6)} /></label><p className="text-sm opacity-60">音轨按视频长度裁齐；不足部分补静音。视频画面不重新编码。</p></>}</>}
            {error && <p role="alert" className="text-sm text-red-500 whitespace-pre-wrap">{error}</p>}
            {jobs.some(j => active(j) && j.params.operation !== operation) && <p className="text-sm opacity-60">其他视频功能正在处理任务，完成后即可开始。</p>}
            <div className="flex justify-end"><Button type="primary" loading={submitting} disabled={busy || (long ? !prompt.trim() : !source)} onClick={() => void startJob()}>{submitting ? "上传素材并提交…" : `开始${videoOperationLabels[operation]}`}</Button></div>
            <div className="border-t pt-4"><h3 className="mb-3 font-medium">本功能任务记录</h3><div className="space-y-4">{jobs.filter(j => j.params.operation === operation).length === 0 && <p className="text-sm opacity-50">尚无任务。结果和缓存保存在本机。</p>}{jobs.filter(j => j.params.operation === operation).slice(0, 12).map(j => <div key={j.id} className="border-b pb-3 text-sm">
                <div className="flex justify-between gap-3"><strong>{videoOperationLabels[j.params.operation]}</strong><span className="opacity-50">{new Date(j.createdAt*1000).toLocaleString()}</span></div>
                <div className="my-2 opacity-70">{j.stage}{j.error ? `：${j.error}` : ""}{j.notice ? ` · ${j.notice}` : ""}</div>
                {active(j) && <><Progress percent={j.progress} status="active" showInfo={false} /><Button type="text" danger disabled={j.status === "cancelling"} onClick={() => void cancelVideoToolJob(j.id).catch(e => setError(String(e)))}>取消本次任务</Button></>}
                {j.status === "complete" && <Button type="text" loading={importing === j.id} onClick={() => void importResult(j)}>放入画布</Button>}
                {!active(j) && ["continuum", "handtie"].includes(j.params.operation) && <Button type="text" disabled={busy} onClick={() => void startJob(j)}>{j.params.operation === "continuum" && j.params.review && j.status === "complete" ? "继续下一段" : "从缓存恢复 / 重试"}</Button>}
                {j.status === "complete" && j.params.operation === "continuum" && j.params.review && <Button type="text" disabled={busy} onClick={() => void startJob(j, true)}>重做当前段</Button>}
            </div>)}</div></div>
        </div>
    </Modal>;
}
