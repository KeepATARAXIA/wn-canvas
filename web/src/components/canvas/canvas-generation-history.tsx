import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Input, Modal, Select, Tooltip } from "antd";
import { BrainCircuit, CalendarClock, CheckCircle2, CircleAlert, CircleDashed, Clock3, Cpu, FileText, FileType2, Gauge, HardDrive, History, Image as ImageIcon, Layers, Link2, LoaderCircle, LocateFixed, Copy, Music2, Ratio, Search, Settings2, Sparkles, Timer, Video, Volume2, type LucideIcon } from "lucide-react";
import type { GenerationRecord } from "@/lib/canvas/generation-history";
import { generationHistoryGroups, generationHistoryTint, generationRecordNumbers, generationRecordTiming } from "@/lib/canvas/generation-history-presentation";
import { generationDetailParameters } from "@/lib/canvas/generation-detail-parameters";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { modelOptionName } from "@/stores/use-config-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import "./canvas-generation-history.css";

const kinds = { image: "图片", video: "视频", audio: "音频", text: "文本" };
const statuses = { loading: "生成中", success: "已完成", error: "失败", canceled: "已取消", interrupted: "记录中断" };
const time = (value?: number) => value == null ? "未记录" : new Date(value).toLocaleString("zh-CN", { hour12: false });
const duration = (ms: number) => ms < 1000 ? `${Math.max(0, Math.round(ms))} 毫秒` : ms < 60000 ? `${(ms / 1000).toFixed(1)} 秒` : `${Math.floor(ms / 60000)} 分 ${((ms % 60000) / 1000).toFixed(1)} 秒`;
const bytes = (value?: number) => !value ? "未记录" : value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(2)} MB`;

type PreviewRecord = Pick<GenerationRecord, "kind" | "title" | "metadata">;

function useRecordUrl(record: PreviewRecord) {
    const { content = "", storageKey } = record.metadata;
    const [url, setUrl] = useState(storageKey ? "" : content);
    useEffect(() => {
        let canceled = false;
        setUrl(storageKey ? "" : content);
        const resolve = record.kind === "image" ? resolveImageUrl : resolveMediaUrl;
        if (storageKey) void resolve(storageKey, content).then((next) => { if (!canceled) setUrl(next); }).catch(() => { if (!canceled) setUrl(""); });
        return () => { canceled = true; };
    }, [content, storageKey, record.kind]);
    return url;
}

export function RecordPreview({ record, controls = false }: { record: PreviewRecord; controls?: boolean }) {
    const url = useRecordUrl(record);
    if (record.kind === "text") return controls ? <div className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-4 text-sm">{record.metadata.content || "暂无生成内容"}</div> : <FileText className="size-5 opacity-55" />;
    if (record.kind === "audio") return controls && url ? <audio src={url} controls className="w-full" /> : <Music2 className="size-5 opacity-55" />;
    if (url && record.kind === "image") return <img src={url} alt={record.title} loading="lazy" className={controls ? "max-h-72 w-full object-contain" : "size-full object-cover"} />;
    if (url && record.kind === "video") return <video src={url} controls={controls} muted={!controls} playsInline preload="metadata" className={controls ? "max-h-72 w-full object-contain" : "pointer-events-none size-full object-cover"} />;
    const Icon = record.kind === "video" ? Video : record.kind === "audio" ? Music2 : ImageIcon;
    return controls ? <div className="flex flex-col items-center gap-2 text-xs opacity-55"><Icon className="size-7" /><span>暂无可预览内容</span></div> : <Icon className="size-5 opacity-55" />;
}

export function CanvasGenerationHistory({ records, nodes, onFocusNode, onReuse }: { records: GenerationRecord[]; nodes: CanvasNodeData[]; onFocusNode: (id: string) => void; onReuse: (record: GenerationRecord) => void }) {
    const [keyword, setKeyword] = useState("");
    const [kind, setKind] = useState("all");
    const [detailId, setDetailId] = useState<string | null>(null);
    const [limit, setLimit] = useState(60);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(timer);
    }, []);
    const numbers = useMemo(() => generationRecordNumbers(records), [records]);
    const groups = useMemo(() => generationHistoryGroups(records, keyword, kind), [records, keyword, kind]);
    const detail = records.find((r) => r.id === detailId);
    const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
    const title = (record: GenerationRecord) => `${record.title || kinds[record.kind as keyof typeof kinds]} · #${numbers.get(record.id)}`;
    const latestId = useMemo(() => [...records].filter(r => r.startedAt != null).sort((a, b) => b.startedAt! - a.startedAt!)[0]?.nodeId, [records]);
    const recordTime = (record: GenerationRecord) => record.startedAt == null ? "时间未记录" : new Date(record.startedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    const statusIcon = (record: GenerationRecord) => {
        if (record.status === "success") return null;
        const Icon = record.status === "loading" ? LoaderCircle : record.status === "error" ? CircleAlert : CircleDashed;
        return <Tooltip title={statuses[record.status]}><span role="status" aria-label={statuses[record.status]} className="inline-flex shrink-0"><Icon className={`size-3.5 ${record.status === "loading" ? "motion-safe:animate-spin" : ""}`} style={{ color: record.status === "error" ? "#dc2626" : undefined }} /></span></Tooltip>;
    };
    const actions = (record: GenerationRecord) => <div className="history-actions flex items-center">
        <Tooltip title={nodeIds.has(record.nodeId) ? "定位画布" : "原节点已移除"} trigger={["hover", "focus"]}><span><button type="button" aria-label="定位画布" disabled={!nodeIds.has(record.nodeId)} className="history-icon" onClick={() => onFocusNode(record.nodeId)}><LocateFixed className="size-3.5" /></button></span></Tooltip>
        <Tooltip title="复用参数：新建节点，参考素材需重新连接" trigger={["hover", "focus"]}><button type="button" aria-label="复用参数" className="history-icon" onClick={() => onReuse(record)}><Copy className="size-3.5" /></button></Tooltip>
    </div>;
    return <div className="flex h-full flex-col" data-generation-history>
        <div className="flex items-center justify-between px-3 pb-2 text-xs text-muted-foreground"><span>{groups.length} 组 · {records.length} 条</span><Select aria-label="筛选生成类型" size="small" variant="borderless" className="w-20" value={kind} onChange={(value) => { setKind(value); setLimit(60); }} options={[{ value: "all", label: "全部" }, ...Object.entries(kinds).map(([value, label]) => ({ value, label }))]} /></div>
        <div className="px-3 pb-3"><Input aria-label="搜索生成记录" size="small" allowClear prefix={<Search className="size-3.5 opacity-40" />} placeholder="搜索名称、提示词、模型" value={keyword} onChange={(e) => { setKeyword(e.target.value); setLimit(60); }} /></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {groups.length ? groups.slice(0, limit).map(({ nodeId, records: group, cover }) => {
                const tint = generationHistoryTint(group[0].startedAt, now, nodeId === latestId);
                const open = expanded.has(nodeId);
                return <div key={nodeId} data-history-group={nodeId} className="history-group mb-1 rounded-lg" style={{ "--history-tint": tint } as CSSProperties}>
                    <div className="history-row flex min-h-16 items-center gap-1 p-2" data-history-record={cover.id}>
                        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 rounded text-left" aria-label={`查看生成详情：${title(cover)}`} onClick={() => setDetailId(cover.id)}>
                            <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-black/5 dark:bg-white/5"><RecordPreview record={cover} /></span>
                            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={cover.title}>{cover.title || kinds[cover.kind as keyof typeof kinds]}</span><span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="truncate">{recordTime(cover)}</span>{statusIcon(cover)}</span></span>
                        </button>
                        <div className="flex w-14 shrink-0 flex-col items-end">
                            {group.length > 1 ? <Tooltip title={`${open ? "收起" : "展开"} · 共 ${group.length} 条记录`} trigger={["hover", "focus"]}><button type="button" aria-label={`${open ? "收起" : "展开"} ${cover.title}，共 ${group.length} 条记录`} aria-expanded={open} aria-controls={open ? `history-${nodeId}` : undefined} className={`history-count inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs tabular-nums ${tint > 0 ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"}`} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId); return next; })}><Layers className="size-3.5" />{group.length}</button></Tooltip> : <span className="h-6 text-[11px] leading-6 text-muted-foreground">#{numbers.get(cover.id)}</span>}
                            {actions(cover)}
                        </div>
                    </div>
                    {open ? <div id={`history-${nodeId}`} className="mx-2 border-t border-black/5 pb-1 dark:border-white/10">{group.filter(record => record.id !== cover.id).map(record => <div key={record.id} className="history-row flex items-center gap-1 rounded px-1 py-1.5" data-history-record={record.id}>
                        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 rounded text-left" aria-label={`查看生成详情：${title(record)}`} onClick={() => setDetailId(record.id)}><span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-black/5 dark:bg-white/5"><RecordPreview record={record} /></span><span className="shrink-0 text-xs tabular-nums">#{numbers.get(record.id)}</span><span className="truncate text-[11px] text-muted-foreground">{recordTime(record)}</span>{statusIcon(record)}</button>{actions(record)}
                    </div>)}</div> : null}
                </div>;
            }) : <div className="flex flex-col items-center gap-3 px-3 pt-16 text-center text-xs opacity-70"><History className="size-7" /><span>{records.length ? "没有匹配的生成记录" : "暂无生成记录"}</span><span>生成内容会自动留档，上传素材可在资产库查看。</span></div>}
            {groups.length > limit ? <button type="button" className="w-full p-3 text-xs opacity-75" onClick={() => setLimit(limit + 60)}>加载更多记录</button> : null}
        </div>
        {detail ? <GenerationDetails record={detail} displayTitle={title(detail)} onFocus={nodeIds.has(detail.nodeId) ? () => { onFocusNode(detail.nodeId); setDetailId(null); } : undefined} onReuse={() => { onReuse(detail); setDetailId(null); }} onClose={() => setDetailId(null)} /> : null}
    </div>;
}

const parameterIcons: Partial<Record<keyof CanvasNodeMetadata, LucideIcon>> = { size: Ratio, quality: Sparkles, vquality: Ratio, seconds: Clock3, videoMode: Video, videoH3Mode: Gauge, h3SageAttention: Cpu, h3TeSpeed: Gauge, generateAudio: Volume2, watermark: FileType2, audioVoice: Music2, audioFormat: FileType2, audioSpeed: Gauge, audioInstructions: FileText, reasoningEffort: BrainCircuit, count: Layers, textCount: Layers, videoCount: Layers, background: ImageIcon, generationType: Sparkles };

function DetailField({ label, value, icon: Icon, wide = false }: { label: string; value: string; icon: LucideIcon; wide?: boolean }) {
    return <div className={`history-detail-field${wide ? " history-detail-field-wide" : ""}`}><dt><Icon className="size-3.5 shrink-0" aria-hidden="true" />{label}</dt><dd>{value}</dd></div>;
}

function GenerationDetails({ record, displayTitle, onFocus, onReuse, onClose }: { record: GenerationRecord; displayTitle: string; onFocus?: () => void; onReuse: () => void; onClose: () => void }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (record.status !== "loading") return;
        const timer = window.setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(timer);
    }, [record.status]);
    const m = record.metadata;
    const modelName = modelOptionName(m.model || "");
    const parameters = generationDetailParameters(m, modelName);
    const { total, waiting, stages, queued } = generationRecordTiming(record, now);
    const StatusIcon = record.status === "success" ? CheckCircle2 : record.status === "loading" ? LoaderCircle : record.status === "error" ? CircleAlert : CircleDashed;
    return <Modal className="history-detail-modal" title="生成详情" open onCancel={onClose} footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={!onFocus} onClick={onFocus} className="inline-flex items-center gap-1.5 rounded-lg border border-black/15 px-3 py-2 text-sm disabled:opacity-40 dark:border-white/20"><LocateFixed className="size-4" aria-hidden="true" />定位画布</button><button type="button" onClick={onReuse} title="新建节点并填入提示词和参数，参考素材需重新连接" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white"><Copy className="size-4" aria-hidden="true" />复用参数</button></div>} width="min(1400px, 96vw)" centered destroyOnHidden wrapProps={{ "data-canvas-shortcuts-ignore": true, "data-canvas-no-zoom": true }}>
        <div className="history-detail-layout" data-generation-details>
            <section className="history-detail-column history-detail-result" data-detail-column="preview" aria-label="生成结果">
                <div className="history-detail-result-heading"><h3>{displayTitle}</h3><span className={`history-detail-status history-detail-status-${record.status}`} role="status"><StatusIcon className={`size-3.5${record.status === "loading" ? " motion-safe:animate-spin" : ""}`} aria-hidden="true" />{queued ? "排队中" : statuses[record.status]}</span></div>
                <div className={`history-detail-preview${record.kind === "image" ? " history-detail-checkerboard" : ""}`}><RecordPreview record={record} controls /></div>
                <div className="history-detail-preview-caption"><span>{kinds[record.kind as keyof typeof kinds] || "生成结果"}</span><span>{m.naturalWidth && m.naturalHeight ? `${m.naturalWidth} × ${m.naturalHeight} px` : ""}</span></div>
            </section>
            <section className="history-detail-column history-detail-info thin-scrollbar" data-detail-column="metadata" aria-label="生成信息与参数" tabIndex={0}>
                <div className="history-detail-section"><h4><Cpu className="size-4" aria-hidden="true" />生成信息</h4>
                    <dl className="history-detail-fields">
                        <DetailField label="模型" value={modelName || "未记录"} icon={Cpu} wide />
                        {record.kind === "image" || record.kind === "video" ? <DetailField label="实际尺寸" value={m.naturalWidth && m.naturalHeight ? `${m.naturalWidth} × ${m.naturalHeight} px` : "未记录"} icon={Ratio} /> : null}
                        <DetailField label="文件大小" value={record.kind === "text" && m.content ? bytes(new TextEncoder().encode(m.content).length) + "（UTF-8）" : bytes(m.bytes)} icon={HardDrive} />
                        <DetailField label="文件格式" value={m.mimeType || (record.kind === "text" ? "文本" : "未记录")} icon={FileType2} />
                        {record.kind === "video" || record.kind === "audio" ? <DetailField label="媒体时长" value={m.durationMs != null ? duration(m.durationMs) : "未记录"} icon={Clock3} /> : null}
                    </dl>
                </div>
                <div className="history-detail-section"><h4><Settings2 className="size-4" aria-hidden="true" />生成参数</h4>
                    {parameters.length ? <dl className="history-detail-fields" data-detail-parameters>{parameters.map(({ key, label, value }) => <DetailField key={key} label={label} value={value} icon={parameterIcons[key] || Settings2} wide={key === "audioInstructions"} />)}</dl> : <p className="history-detail-muted">该记录未保存生成参数。</p>}
                </div>
                <div className="history-detail-section"><h4><Timer className="size-4" aria-hidden="true" />耗时分布<span className="history-detail-total">{total == null ? "未记录" : duration(total)}</span></h4>
                    <dl className="history-detail-fields history-detail-times"><DetailField label="开始时间" value={time(record.startedAt)} icon={CalendarClock} /><DetailField label="结束时间" value={time(record.endedAt)} icon={CalendarClock} /></dl>
                    {record.resumed ? <p className="history-detail-muted">仅记录恢复任务之后的耗时。</p> : null}
                    {waiting > 0 || queued ? <p className="history-detail-muted" data-detail-waiting>排队等待：{duration(waiting)}（不计入生成耗时）</p> : null}
                    {stages.length ? <div className="history-detail-stages">{stages.map((stage, index) => {
                    const elapsed = stage.elapsed;
                        return <div key={index} className="history-detail-stage" title={`${time(stage.startedAt)} → ${time(stage.endedAt)}`}><div><span>{stage.name}</span><span>{elapsed == null ? "未记录" : duration(elapsed)}</span></div><div className="history-detail-stage-track"><div style={{ width: `${elapsed != null && total ? Math.min(100, elapsed / total * 100) : 0}%` }} /></div></div>;
                    })}</div> : <p className="history-detail-muted">{queued ? "等待后台开始执行。" : record.stages.length ? "没有记录到生成阶段。" : "该历史内容没有耗时记录。"}</p>}
                    {record.stages.length ? <p className="history-detail-muted mt-3">按收到的阶段事件计时，包含传输延迟；未提供细分事件的时间合并展示。{record.status === "interrupted" ? "页面关闭或刷新期间的阶段无法还原。" : ""}</p> : null}
                </div>
            </section>
            <section className="history-detail-column history-detail-prompt" data-detail-column="prompt" aria-label="完整提示词">
                <h4><FileText className="size-4" aria-hidden="true" />提示词</h4>
                <div className="history-detail-prompt-scroll thin-scrollbar" tabIndex={0}>
                    <p className="whitespace-pre-wrap break-words" data-detail-prompt>{m.prompt || "该记录未保存提示词。"}</p>
                    {m.references?.length ? <div className="history-detail-references"><h4><Link2 className="size-4" aria-hidden="true" />参考素材 · {m.references.length}</h4>{m.references.map((reference, index) => <p key={index}>{reference}</p>)}</div> : null}
                    {m.errorDetails ? <p className="history-detail-error" role="alert">{m.errorDetails}</p> : null}
                </div>
            </section>
        </div>
    </Modal>;
}
