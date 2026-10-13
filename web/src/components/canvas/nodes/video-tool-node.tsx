import { createElement, useSyncExternalStore } from "react";
import { useParams } from "react-router-dom";
import { App, Button, Checkbox, Input, InputNumber, Progress, Segmented, Select, Tooltip } from "antd";
import { PromptFavorites } from "../prompt-favorites";
import { getVideoToolRuntime, getVideoToolState, subscribeVideoTools, videoPipelineNodes, videoToolJobActive as active } from "@/lib/canvas/video-tool-runtime";
import { ListVideo, Users, Gauge, Scaling, Sparkles, Scissors, AudioLines, Play, Video, X, ArrowRight, Workflow, Download, Square, RotateCcw, SkipForward, Link2, Layers, VolumeX, Volume2, Replace, SlidersHorizontal } from "lucide-react";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { placeVideoNodes } from "@/lib/canvas/video-node-placement";
import { getVideoToolInput } from "@/lib/canvas/video-tool-preview";
import { videoOperationLabels, type VideoOperation } from "@/services/api/canvas-video-tools";
import { IconAction, InfoPopover } from "@/components/ui/compact-controls";

const operationIcons = { continuum: ListVideo, handtie: Users, interpolate: Gauge, upscale: Scaling, restore: Sparkles, trim: Scissors, audio: AudioLines };
const operationHelp = {
    continuum: "按分段描述续接视频，可逐段检查后继续。参考素材和更多参数在高级设置中。",
    handtie: "使用角色、视频和音轨参考串联片段。角色按 @role1、@role2、@role3 引用；相邻片段会裁去重叠部分，成片时长略短于段数×每段时长。",
    interpolate: "RIFE 补帧到原帧率的 2 倍，例如 24→48fps；保留视频时长和音轨。会重新编码，并自动检查末尾帧。",
    upscale: "Video2X 放大到原宽高的 2 倍，保留帧率和音轨。需要修复压缩和模糊时，可连接视频超分节点。",
    restore: "SeedVR2 修复模糊与压缩细节，保留原比例、帧率和音轨。输出按短边设置，完成后结果显示在本节点。细小文字与人脸细节可能被重建，建议先用短片段对比。",
    trim: "精确剪切会重新编码。无损剪切按关键帧对齐，实际起点可能提前；需要准确时间请用精确剪切。",
    audio: "音轨按视频长度裁齐；不足部分补静音。视频画面不重新编码。替换、混音和静音只改变声音。",
};
export const videoToolNodeType = (operation: VideoOperation) => `video-tool:${operation}`;

function VideoToolNode({ ctx }: { ctx: CanvasNodeContext }) {
    const projectId = useParams<{ id: string }>().id || "";
    const { job, submitting, importing, error, chainRunning } = useSyncExternalStore(subscribeVideoTools, () => getVideoToolState(projectId, ctx.node.id));
    const failed = error || ctx.node.metadata?.errorDetails || job?.status === "error";
    const label = submitting ? "提交中" : importing ? "取回结果中" : active(job) ? job?.stage || "处理中" : chainRunning ? "流程执行中" : failed ? "失败 · 点击查看" : ctx.node.metadata?.content ? "已完成" : getVideoToolInput(ctx.node, ctx.getUpstream()).preview ? "输入预览 · 待执行" : "待执行";
    return <div className="pointer-events-none absolute right-3 top-3 max-w-[calc(100%-24px)] rounded-full bg-black/65 px-2.5 py-1 text-xs text-white" role="status">{label}</div>;
}

function VideoToolPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const projectId = useParams<{ id: string }>().id || "";
    const operation = ctx.node.type.split(":")[1] as VideoOperation;
    const OperationIcon = operationIcons[operation];
    const { modal, message } = App.useApp();
    const { job, submitting, importing, error, chainStatus, chainRunning } = useSyncExternalStore(subscribeVideoTools, () => getVideoToolState(projectId, ctx.node.id));
    const perform = (action: (runtime: NonNullable<ReturnType<typeof getVideoToolRuntime>>) => Promise<unknown>) => {
        const runtime = getVideoToolRuntime(projectId);
        if (!runtime) return void message.warning("画布正在准备，请稍后重试");
        void action(runtime).catch(error => runtime.fail(ctx.node.id, error));
    };
    const startJob = (resume = false, redo = false) => perform(runtime => runtime.startJob(ctx.node.id, resume, redo));
    const importResult = () => perform(runtime => runtime.importResult(ctx.node.id));
    const runChain = () => {
        try {
            const steps = videoPipelineNodes(ctx.node.id, ctx);
            modal.confirm({
                title: `重新运行 ${steps.length} 个步骤？`,
                content: <div className="space-y-2"><p>{steps.map(node => node.title).join(" → ")}</p><p>已完成的上游功能节点也会重新执行。只处理当前视频时，请用「执行本节点」。</p></div>,
                okText: "重新运行全部步骤", cancelText: "返回检查",
                onOk: () => perform(runtime => runtime.runChain(ctx.node.id)),
            });
        } catch (error) { void message.error(error instanceof Error ? error.message : String(error)); }
    };
    const settings = ctx.node.metadata?.videoToolSettings || {};
    function useSetting<T extends string | number | boolean | string[] | undefined>(key: string, fallback?: T): [T, (value: T) => void] {
        return [(settings[key] ?? fallback) as T, value => {
            const latest = ctx.getNode(ctx.node.id)?.metadata?.videoToolSettings || {};
            ctx.updateMetadata({ videoToolSettings: { ...latest, [key]: value } });
        }];
    }
    const [source, setSource] = useSetting<string>("source", undefined);
    const [firstImage, setFirstImage] = useSetting<string>("firstImage", undefined);
    const [references, setReferences] = useSetting<string[]>("references", []);
    const [audio, setAudio] = useSetting<string>("audio", undefined);
    const [voice, setVoice] = useSetting<string>("voice", undefined);
    const [prompt, setPrompt] = useSetting<string>("prompt", "");
    const [chunks, setChunks] = useSetting<number>("chunks", 2);
    const [seconds, setSeconds] = useSetting<number>("seconds", 5);
    const [resolution, setResolution] = useSetting<number>("resolution", operation === "restore" ? 1080 : 480);
    const [batchSize, setBatchSize] = useSetting<number>("batchSize", 9);
    const [temporalOverlap, setTemporalOverlap] = useSetting<number>("temporalOverlap", 4);
    const [colorCorrection, setColorCorrection] = useSetting<string>("colorCorrection", "lab");
    const [seed, setSeed] = useSetting<number>("seed", 42);
    const [orientation, setOrientation] = useSetting<string>("orientation", "landscape");
    const [review, setReview] = useSetting<boolean>("review", true);
    const [start, setStart] = useSetting<number>("start", 0);
    const inputVideos = ctx.getUpstream().filter(n => getNodeDefinition(n.type)?.resource?.(n)?.kind === "video");
    const inputDuration = (inputVideos.find(n => n.id === source) || (inputVideos.length === 1 ? inputVideos[0] : undefined))?.metadata?.durationMs;
    const [end, setEnd] = useSetting<number>("end", inputDuration ? Math.min(5, Math.floor(inputDuration) / 1000) : 5);
    const [cutMode, setCutMode] = useSetting<string>("cutMode", "precise");
    const [audioMode, setAudioMode] = useSetting<string>("audioMode", "replace");
    const [gain, setGain] = useSetting<number>("gain", -6);
    const [anime, setAnime] = useSetting<boolean>("anime", false);

    const jobId = ctx.node.metadata?.videoToolJobId;
    const long = operation === "continuum" || operation === "handtie";
    const media = ctx.getUpstream().flatMap(n => {
        const resource = getNodeDefinition(n.type)?.resource?.(n);
        return resource?.url && ["image", "video", "audio"].includes(resource.kind) ? [{ key: n.id, name: n.title, kind: resource.kind, url: resource.url }] : [];
    });
    const connectedCount = ctx.getUpstream().length;
    const options = (kind: string) => media.filter(m => m.kind === kind).map(m => ({ value: m.key, label: m.name }));
    const { source: effectiveSource, preview } = getVideoToolInput(ctx.node, ctx.getUpstream());
    const busy = submitting || importing || active(job) || Boolean(jobId && job?.id !== jobId);
    const input = inputVideos.find(node => node.id === effectiveSource)?.metadata;
    const inputWidth = input?.naturalWidth;
    const inputHeight = input?.naturalHeight;
    const sourceSize = inputWidth && inputHeight ? `${inputWidth} × ${inputHeight}` : "尺寸待读取";
    return <div className="flex min-w-0 cursor-default flex-col rounded-xl border p-4 text-sm" style={{ color: ctx.theme.toolbar.item, background: ctx.theme.toolbar.panel, borderColor: ctx.theme.toolbar.border }} onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
        <div className="min-w-0 space-y-3 pb-2">
            <div className="flex items-center justify-between gap-2"><strong className="flex items-center gap-2 text-base"><OperationIcon className="size-4 text-blue-600 dark:text-blue-300" />{videoOperationLabels[operation]}</strong><div className="flex items-center gap-1"><InfoPopover label={`${videoOperationLabels[operation]}说明`}>{operationHelp[operation]}</InfoPopover><IconAction label="关闭视频工具设置" type="text" size="small" icon={<X className="size-4" />} onClick={onClose} /></div></div>
            <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{ctx.node.metadata?.content ? "生成结果" : preview ? "输入预览" : "等待输入"}</span><div className="flex gap-3"><Tooltip title={`${connectedCount} 个连线`}><span aria-label={`${connectedCount} 个连线`} className="inline-flex items-center gap-1"><Link2 className="size-3.5" />{connectedCount}</span></Tooltip><Tooltip title={`${media.length} 个素材就绪`}><span aria-label={`${media.length} 个素材就绪`} className="inline-flex items-center gap-1"><Layers className="size-3.5" />{media.length}</span></Tooltip></div></div>
            {(operation === "restore" || operation === "upscale" || operation === "interpolate") && <div data-video-transform className="flex items-center justify-between gap-2 rounded-lg bg-blue-500/5 px-3 py-3 text-xs">
                <span className="flex min-w-0 flex-col gap-1"><Video className="size-5 text-muted-foreground" /><span className="tabular-nums">{operation === "interpolate" ? "原帧率" : sourceSize}</span></span><ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" /><span className="flex min-w-0 flex-col items-end gap-1"><OperationIcon className="size-5 text-blue-600 dark:text-blue-300" /><span className="tabular-nums">{operation === "restore" ? `短边 ${resolution}p` : operation === "interpolate" ? "帧率 ×2" : inputWidth && inputHeight ? `${inputWidth * 2} × ${inputHeight * 2}` : "宽高 ×2"}</span></span>
            </div>}
            <fieldset disabled={busy || chainRunning} className="min-w-0 space-y-3 border-0 p-0" data-canvas-shortcuts-ignore>
            {operation !== "continuum" && <div className="flex items-center gap-2"><Tooltip title={operation === "handtie" ? "参考视频（可选）" : "原视频"}><Video className="size-4 shrink-0 text-muted-foreground" /></Tooltip><Select aria-label={operation === "handtie" ? "参考视频" : "原视频"} className="min-w-0 flex-1" allowClear placeholder={connectedCount ? "等待上游视频输出" : "连接视频节点后选择"} value={effectiveSource} options={options("video")} onChange={setSource} /></div>}
            {long && <>
                <label className="block">分段描述<Input.TextArea className="mt-2" rows={3} maxLength={16000} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={operation === "handtie" ? "描述第一段；后续段落只写接下来发生什么。用单独一行 --- 分隔。角色按 @role1、@role2、@role3 引用。" : "描述每段内容，用单独一行 --- 分隔；也可填写一段统一描述。"} /></label>
                <PromptFavorites value={prompt} onApply={setPrompt} />
                <div className="flex flex-wrap items-center gap-4"><label>段数 <InputNumber min={1} max={8} value={chunks} onChange={v => setChunks(v || 2)} /></label><label>每段 <Select value={seconds} options={[5, 8, 10, 15].map(v => ({ value: v, label: `${v} 秒` }))} onChange={setSeconds} /></label><Select value={resolution} options={[480, 720, 1080].map(v => ({ value: v, label: `${v}p` }))} onChange={setResolution} /><Segmented className="max-w-full [&_.ant-segmented-group]:flex-wrap [&_.ant-segmented-item-label]:whitespace-normal" value={orientation} options={[{ value: "landscape", label: "横屏 16:9" }, { value: "portrait", label: "竖屏 9:16" }]} onChange={v => setOrientation(String(v))} /></div>
                <details className="rounded-xl border p-3" style={{ borderColor: ctx.theme.node.stroke }}><summary className="cursor-pointer text-sm">参考素材与高级设置</summary><div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 gap-3">
                    <label>首帧（可选）<Select className="mt-2 w-full" allowClear value={firstImage} options={options("image")} onChange={setFirstImage} placeholder="不选则按文字生成" /></label>
                    <label>角色参考（最多 3 张）<Select mode="multiple" maxCount={3} className="mt-2 w-full" value={references} options={options("image")} onChange={setReferences} /></label>
                </div>
                <div className="text-sm opacity-60">480p 横屏导出 854×480，720p 为 1280×720，1080p 为 1920×1080；竖屏宽高互换。1080p 使用较低内部分辨率放大导出。角色串联的模型尺寸另按其预设对齐。16GB 显卡建议先跑 480p、两段；角色串联可能耗时十分钟以上。</div>
                <label className="block">连续音轨（可选，作为整段视频的声音）<Select className="mt-2 w-full" allowClear value={audio} options={options("audio")} onChange={setAudio} /></label>
                {operation === "handtie" ? <><label className="block">声音参考（可选）<Select className="mt-2 w-full" allowClear value={voice} options={options("audio")} onChange={setVoice} /></label><p className="text-sm opacity-60">使用 Motion-Context 续接画面和声音；相邻片段会裁去重叠部分，成片时长略短于段数×每段时长。</p></> : <Checkbox checked={review} onChange={e => setReview(e.target.checked)}>逐段检查：每次生成一段，再点击「继续下一段」</Checkbox>}
                </div></details>
            </>}
            {operation === "upscale" && <Checkbox checked={anime} onChange={e => setAnime(e.target.checked)}>动画素材</Checkbox>}
            {operation === "restore" && <>
                <Segmented block aria-label="超分输出短边" disabled={busy || chainRunning} value={resolution} options={[1080, 1440, 2160].map(value => ({ value, label: `${value}p` }))} onChange={setResolution} />
                <details className="border-t pt-3" style={{ borderColor: ctx.theme.node.stroke }}><summary className="cursor-pointer"><SlidersHorizontal className="mr-2 inline size-3.5" />画质与连续性</summary><div className="mt-3 space-y-3">
                    <label className="block">每批帧数<Select aria-label="每批帧数" className="mt-2 w-full" disabled={busy || chainRunning} value={batchSize} options={[{ value: 5, label: "5 帧 · 节省显存" }, { value: 9, label: "9 帧 · 均衡" }, { value: 13, label: "13 帧 · 更多连续画面" }]} onChange={setBatchSize} /></label>
                    <label className="block">批次重叠融合<Select aria-label="批次重叠融合" className="mt-2 w-full" disabled={busy || chainRunning} value={temporalOverlap} options={[0, 2, 4].map(value => ({ value, label: value ? `${value} 帧` : "关闭（旧版设置）" }))} onChange={setTemporalOverlap} /></label>
                    <label className="block">色彩校正<Select aria-label="色彩校正" className="mt-2 w-full" disabled={busy || chainRunning} value={colorCorrection} options={[{ value: "lab", label: "LAB · 贴近原片" }, { value: "wavelet", label: "Wavelet · 保留纹理" }]} onChange={setColorCorrection} /></label>
                    <label className="block">随机种子<InputNumber aria-label="超分随机种子" className="mt-2 w-full" min={0} max={2147483647} precision={0} value={seed} onChange={value => setSeed(value ?? 42)} /></label>
                    <p className="text-xs opacity-60">增加帧数有助于连续性，也会增加显存用量；重叠融合会增加耗时。当前为 3B FP8 模型，细小文字与人脸细节可能被重建，建议先用短片段对比。</p>
                </div></details>
            </>}
            {operation === "trim" && <>
                {inputDuration && inputDuration > 0 ? <div role="img" aria-label={`剪切区间 ${start} 至 ${end} 秒，原片 ${(inputDuration / 1000).toFixed(1)} 秒`} className="relative h-3 overflow-hidden rounded bg-black/10 dark:bg-white/10"><div className="absolute inset-y-0 rounded bg-blue-500" style={{ left: `${Math.min(100, start / inputDuration * 100000)}%`, width: `${Math.max(0, Math.min(end, inputDuration / 1000) - start) / inputDuration * 100000}%` }} /></div> : null}
                <div className="flex flex-wrap items-center gap-2"><InputNumber aria-label="起点（秒）" min={0} step={.1} value={start} onChange={v => setStart(v ?? 0)} /><ArrowRight className="size-3.5" /><InputNumber aria-label="终点（秒）" min={0} step={.1} value={end} onChange={v => setEnd(v ?? 0)} /><span className="text-xs text-muted-foreground">秒</span></div><Segmented block value={cutMode} options={[{ value: "precise", label: "精确剪切" }, { value: "lossless", label: "无损剪切" }]} onChange={v => setCutMode(String(v))} />{cutMode === "lossless" ? <p className="text-xs text-muted-foreground">按关键帧对齐，实际起点可能提前。</p> : null}
            </>}
            {operation === "audio" && <><Segmented block aria-label="音轨处理方式" value={audioMode} options={[{ value: "replace", name: "替换音轨", icon: Replace }, { value: "mix", name: "混入背景音", icon: AudioLines }, { value: "mute", name: "移除声音", icon: VolumeX }].map(({ value, name, icon: Icon }) => ({ value, label: <Tooltip title={name}><span aria-label={name} className="inline-flex py-1.5"><Icon className="size-5" /></span></Tooltip> }))} onChange={v => setAudioMode(String(v))} />{audioMode !== "mute" && <><Select aria-label="新音轨" className="w-full" value={audio} options={options("audio")} onChange={setAudio} placeholder="选择新音轨" /><label className="flex items-center gap-2"><Volume2 className="size-4" /><InputNumber aria-label="新音轨音量（dB）" min={-40} max={12} value={gain} onChange={v => setGain(v ?? -6)} /><span className="text-xs">dB</span></label></>}</>}

            </fieldset>
            {(error || ctx.node.metadata?.errorDetails) && <p role="alert" className="text-red-500 whitespace-pre-wrap">{error || ctx.node.metadata?.errorDetails}</p>}
            {chainStatus && <div className="space-y-1 text-xs"><p>{chainStatus}</p>{chainRunning && <Button danger size="small" onClick={() => getVideoToolRuntime(projectId)?.stopChain()}>停止流程</Button>}</div>}
            {job && (!chainRunning || active(job)) && <div className="space-y-2 border-t pt-3">
                <p>{job.stage}{job.error ? `：${job.error}` : ""}{job.notice ? ` · ${job.notice}` : ""}</p>
                {active(job) && <>{!job.progressIndeterminate && <Progress percent={job.progress} size="small" />}<IconAction label="取消本节点任务" icon={<Square className="size-4" />} danger disabled={job.status === "cancelling"} onClick={() => perform(runtime => runtime.cancel(ctx.node.id))} /></>}
                {job.status === "complete" && <IconAction label="取回结果" icon={<Download className="size-4" />} loading={importing} onClick={importResult} />}
                {long && !active(job) && <IconAction label="继续下一段 / 从缓存恢复" icon={<SkipForward className="size-4" />} disabled={busy} onClick={() => void startJob(true)} />}
                {operation === "continuum" && job.status === "complete" && <IconAction label="重做当前段" icon={<RotateCcw className="size-4" />} disabled={busy} onClick={() => void startJob(true, true)} />}
            </div>}
            {ctx.node.metadata?.content && <Tooltip title="下载结果"><a aria-label="下载结果" className="inline-flex size-8 items-center justify-center rounded hover:bg-accent" href={ctx.node.metadata.content} download={`${videoOperationLabels[operation]}.mp4`}><Download className="size-4" /></a></Tooltip>}
        </div>
        <div className="mt-2 flex shrink-0 flex-wrap gap-2 border-t pt-2" style={{ borderColor: ctx.theme.node.stroke }}>
            <Button className="flex-1" icon={<Play className="size-4" />} type="primary" loading={submitting} disabled={busy || chainRunning || (long ? !prompt.trim() : !preview) || (operation === "audio" && audioMode !== "mute" && !audio)} onClick={() => void startJob()}>{operation === "restore" ? "开始" : "执行本节点"}</Button>
            <IconAction label="运行到这里：会重新执行上游节点，点击查看范围" icon={<Workflow className="size-4" />} disabled={busy || chainRunning} onClick={() => void runChain()} />
        </div>
    </div>;
}

export const videoToolNodeDefinitions: CanvasNodeDefinition[] = (Object.keys(videoOperationLabels) as VideoOperation[]).map(operation => ({
    type: videoToolNodeType(operation), title: videoOperationLabels[operation], icon: createElement(operationIcons[operation], { className: "size-5" }),
    defaultSize: { width: 420, height: 236 },
    autoOpenPanel: true, showInCreateMenu: true, hasSourceHandle: true, Content: VideoToolNode, Panel: VideoToolPanel,
    toolbar: ctx => (["trim", "interpolate", "upscale", "restore", "audio"] as VideoOperation[]).map(next => ({
        id: `connect-${next}`, title: `连接${videoOperationLabels[next]}节点`, label: videoOperationLabels[next], icon: createElement(operationIcons[next], { className: "size-4" }),
        onClick: () => {
            const id = crypto.randomUUID();
            const [placed] = placeVideoNodes([{ id, type: videoToolNodeType(next), title: videoOperationLabels[next], width: 420, height: 236, position: { x: ctx.node.position.x + ctx.node.width + 96, y: ctx.node.position.y } }], ctx.getNodes());
            ctx.applyOps([
                { type: "add_node", id, nodeType: videoToolNodeType(next), position: placed.position },
                { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
                { type: "select_nodes", ids: [id] },
            ]);
            window.dispatchEvent(new CustomEvent("canvas-focus-created-video", { detail: id }));
        },
    })),
    resource: node => node.metadata?.content ? { kind: "video", url: node.metadata.content } : null,
}));
