import { useEffect, useState } from "react";
import { Modal } from "antd";
import { ArrowDown, ArrowUp, Clock3, Image as ImageIcon, LocateFixed, Square, Video, X } from "lucide-react";
import { generationQueueDisplay, type GenerationQueueItem } from "@/lib/canvas/generation-queue";
import type { CanvasNodeData } from "@/types/canvas";
import { RecordPreview } from "./canvas-generation-history";

const elapsed = (startedAt: number | undefined, now: number) => {
    if (startedAt == null) return "耗时未记录";
    const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
};

export function CanvasGenerationQueue({ items, nodes, onFocusNode, onCancel, onMove }: { items: GenerationQueueItem[]; nodes: CanvasNodeData[]; onFocusNode: (id: string) => void; onCancel: (id: string) => void; onMove: (id: string, direction: -1 | 1) => void }) {
    const [now, setNow] = useState(Date.now());
    const [detailId, setDetailId] = useState<string | null>(null);
    const running = items.some(item => item.status === "running");
    useEffect(() => {
        if (!running) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [running]);
    const detail = items.find(item => item.id === detailId);
    const display = detail ? generationQueueDisplay(detail, nodes) : null;
    return <div className="h-full overflow-y-auto px-3 pb-4" data-generation-queue>
        <p className="mb-2 text-xs leading-5 opacity-75">{running ? "1 个生成中" : "准备生成"} · {items.filter(item => item.status === "queued").length} 个等待，按顺序自动开始。</p>
        {items.length ? <p className="mb-3 rounded-lg bg-black/5 px-2.5 py-2 text-xs leading-5 dark:bg-white/5">请保持此画布打开。刷新或关闭页面会丢失等待队列；离开时会提醒。</p> : null}
        {items.length ? items.map((item, index) => {
            const queued = item.status === "queued";
            const Icon = item.mode === "image" ? ImageIcon : Video;
            const { source, target, preview, prompt, stage, percent } = generationQueueDisplay(item, nodes);
            const title = target?.title || source?.title || item.title;
            const position = items.slice(0, index + 1).filter(entry => entry.status === "queued").length;
            return <div key={item.id} data-queue-item={item.id} className="mb-3 overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
                <button type="button" className="block w-full p-3 text-left hover:bg-black/[.03] dark:hover:bg-white/5" aria-label={`查看任务详情：${item.title}`} onClick={() => setDetailId(item.id)}>
                    <span className="flex items-start gap-2.5">
                        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md bg-black/5 dark:bg-white/5">{preview ? <RecordPreview record={{ kind: preview.type, title: preview.title, metadata: preview.metadata || {} }} /> : <Icon className="size-5 opacity-70" />}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={title}>{title}</span><span className="mt-1 block truncate text-[11px] opacity-75">{item.mode === "image" ? "图片" : "视频"} · 来源：{source?.title || "节点已移除"}</span></span>
                    </span>
                    <span className="mt-2 line-clamp-2 break-words text-xs leading-5 opacity-85">{prompt || "未填写提示词 · 开始时读取节点输入"}</span>
                    {prompt ? <span className="mt-1 block text-[11px] text-blue-600 dark:text-blue-400">点击查看完整提示词</span> : null}
                    <span className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px]"><span className={queued ? "opacity-75" : "font-medium text-blue-600 dark:text-blue-400"}>{queued ? `等待第 ${position} 位` : "生成中"}</span>{!queued ? <span className="inline-flex items-center gap-1 tabular-nums opacity-75"><Clock3 className="size-3" />已耗时 {elapsed(item.startedAt, now)}</span> : null}</span>
                    {!queued ? <span className="mt-2 block break-words text-xs leading-5" data-queue-stage>{stage}{percent != null ? ` · ${Math.round(percent)}%` : ""}</span> : null}
                    {!queued && percent != null ? <span role="progressbar" aria-label="后台生成进度" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="mt-2 block h-1 overflow-hidden rounded bg-black/5 dark:bg-white/10"><span className="block h-full bg-blue-600" style={{ width: `${percent}%` }} /></span> : null}
                </button>
                <div className="flex flex-wrap items-center justify-between gap-1 border-t border-black/5 px-2 py-1.5 text-[11px] dark:border-white/10">
                    <button type="button" disabled={!source} className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10" onClick={() => onFocusNode(item.nodeId)}><LocateFixed className="size-3" />定位画布</button>
                    <div className="flex items-center gap-1">{queued ? <><button type="button" aria-label={`提前任务：${item.title}`} title="提前" disabled={index === 0 || items[index - 1].status === "running"} className="rounded p-1.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={() => onMove(item.id, -1)}><ArrowUp className="size-3.5" /></button><button type="button" aria-label={`推后任务：${item.title}`} title="推后" disabled={index === items.length - 1} className="rounded p-1.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={() => onMove(item.id, 1)}><ArrowDown className="size-3.5" /></button></> : null}
                    <button type="button" aria-label={`${queued ? "移出队列" : "取消生成"}：${item.title}`} className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-red-500/10 hover:text-red-500" onClick={() => onCancel(item.id)}>{queued ? <X className="size-3.5" /> : <Square className="size-3" />}{queued ? "移出队列" : "取消生成"}</button></div>
                </div>
            </div>;
        }) : <p className="pt-12 text-center text-xs opacity-70">当前没有生成任务</p>}
        {detail && display ? <Modal title="任务详情" open onCancel={() => setDetailId(null)} footer={null} width={560} centered wrapProps={{ "data-canvas-shortcuts-ignore": true, "data-canvas-no-zoom": true }} styles={{ body: { maxHeight: "70dvh", overflowY: "auto" } }}>
            <h3 className="mb-3 break-words font-medium">{detail.title}</h3>
            <dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="opacity-70">来源节点</dt><dd className="mt-1 break-words">{display.source?.title || "节点已移除"}</dd></div><div><dt className="opacity-70">状态</dt><dd className="mt-1">{detail.status === "queued" ? "等待执行" : `生成中 · ${elapsed(detail.startedAt, now)}`}</dd></div></dl>
            {detail.status === "running" ? <p className="mt-4 break-words text-sm">{display.stage}</p> : null}
            <h4 className="mb-2 mt-4 text-xs opacity-70">提示词</h4><p className="whitespace-pre-wrap break-words text-sm leading-6">{display.prompt || "开始时读取节点输入"}</p>
            <button type="button" disabled={!display.source} className="mt-4 rounded-lg border border-black/15 px-3 py-2 text-sm disabled:opacity-40 dark:border-white/20" onClick={() => { onFocusNode(detail.nodeId); setDetailId(null); }}>定位画布</button>
        </Modal> : null}
    </div>;
}
