import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Button, Tooltip, Popover } from "antd";
import { Activity, ChevronDown, Eraser, LoaderCircle, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { resolveModelChannel, useConfigStore } from "@/stores/use-config-store";
import { ConfigVramPreference } from "@/components/layout/config-vram-preference";
import { autoComfyCleanup, isManagedLocalComfy } from "@/services/api/comfy-memory";
import type { CanvasNodeData } from "@/types/canvas";
import type { GenerationQueueItem } from "@/lib/canvas/generation-queue";

type MemoryUsage = { used: number; total: number; percent: number };
type ResourceStats = {
    cpu: number | null;
    memory: MemoryUsage;
    gpu: (MemoryUsage & { devices: { name: string; used: number; total: number }[] }) | null;
    comfy: "idle" | "busy" | "unavailable";
    services?: { id: string; name: string; state: "idle" | "busy" | "unavailable" }[];
};

const capacity = (usage: { used: number; total: number }) => `${(usage.used / 1024 ** 3).toFixed(1)} / ${(usage.total / 1024 ** 3).toFixed(1)} GB`;

export function CanvasResourceMonitor({ nodes, generationQueue }: { nodes: CanvasNodeData[]; generationQueue: GenerationQueueItem[] }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useConfigStore((state) => state.config);
    const autoRelease = Boolean(config.autoReleaseVram);
    const autoReleaseRef = useRef(autoRelease);
    autoReleaseRef.current = autoRelease;
    const [autoReleasing, setAutoReleasing] = useState(false);
    const [open, setOpen] = useState(false);
    const panelId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const [stats, setStats] = useState<ResourceStats | null>(null);
    const [releasing, setReleasing] = useState(false);
    const [notice, setNotice] = useState("");
    const [failed, setFailed] = useState(false);
    const releaseLock = useRef(false);
    const mounted = useRef(false);
    const releaseController = useRef<AbortController | null>(null);
    const cooldown = useRef<ReturnType<typeof setTimeout> | null>(null);

    const frontendBusy = generationQueue.length > 0 || nodes.some((node) => node.metadata?.status === "loading");
    const isLocalModel = (model: string) => {
        const channel = resolveModelChannel(config, model);
        return channel.serviceType === "comfyui" && isManagedLocalComfy(channel.baseUrl);
    };
    const localWork = stats?.comfy === "busy" || generationQueue.some((item) => isLocalModel(nodes.find((node) => node.id === item.nodeId)?.metadata?.model || (item.mode === "image" ? config.imageModel : config.videoModel))) || nodes.some((node) => {
        if (node.metadata?.status !== "loading") return false;
        const mode = node.type === "config" ? node.metadata?.generationMode : node.type;
        return (mode === "image" || mode === "video") && isLocalModel(node.metadata?.model || (mode === "image" ? config.imageModel : config.videoModel));
    });

    useEffect(() => {
        autoComfyCleanup.update({ enabled: autoRelease, blocked: frontendBusy || releasing, localWork, idle: stats?.comfy === "idle", onStatus: (busy, message) => { setAutoReleasing(busy); setNotice(message); } });
    }, [autoRelease, frontendBusy, releasing, localWork, stats]);

    useEffect(() => () => autoComfyCleanup.dispose(), []);

    useEffect(() => {
        if (!open) return;
        // Canvas pointer capture can suppress the mousedown used by Popover.
        const closeOutside = (event: PointerEvent) => {
            if (!triggerRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
        };
        window.addEventListener("pointerdown", closeOutside, true);
        window.addEventListener("keydown", closeOnEscape, true);
        return () => {
            window.removeEventListener("pointerdown", closeOutside, true);
            window.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [open]);

    useEffect(() => {
        mounted.current = true;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        let controller: AbortController | null = null;
        async function poll() {
            if (stopped) return;
            if (!document.hidden || autoReleaseRef.current) {
                controller = new AbortController();
                const timeout = setTimeout(() => controller?.abort(), 6000);
                try {
                    const response = await fetch("/api/local-resources", { signal: controller.signal, cache: "no-store" });
                    if (!response.ok) throw new Error();
                    const data = await response.json() as ResourceStats;
                    if (!stopped) { setStats(data); setFailed(false); }
                } catch {
                    if (!stopped) { setStats(null); setFailed(true); }
                } finally { clearTimeout(timeout); }
            }
            if (!stopped) timer = setTimeout(poll, 2000);
        }
        void poll();
        return () => {
            mounted.current = false;
            stopped = true;
            clearTimeout(timer);
            controller?.abort();
            releaseController.current?.abort();
            if (cooldown.current) clearTimeout(cooldown.current);
        };
    }, []);

    async function release() {
        if (releaseLock.current || autoReleasing || stats?.comfy !== "idle") return;
        releaseLock.current = true;
        setReleasing(true);
        setNotice("");
        const controller = new AbortController();
        releaseController.current = controller;
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch("/api/local-resources/release", { method: "POST", headers: { "X-Canvas-Resource-Action": "release" }, signal: controller.signal });
            const result = await response.json() as { message: string };
            if (response.ok) autoComfyCleanup.acknowledgeRelease();
            if (mounted.current) setNotice(result.message);
        } catch {
            if (mounted.current) setNotice("释放请求未确认，请检查本地服务并观察显存变化。");
        } finally {
            clearTimeout(timeout);
            if (releaseController.current === controller) releaseController.current = null;
            if (mounted.current) cooldown.current = setTimeout(() => { releaseLock.current = false; setReleasing(false); }, 5000);
        }
    }

    const releaseBusy = releasing || autoReleasing;
    const reason = releaseBusy ? "正在请求释放，请稍候" : stats?.comfy === "busy" ? "H3 或千问正在生成或排队，请等任务结束后释放" : stats?.comfy !== "idle" ? "模型服务未连接或状态未知，暂时无法释放显存" : "卸载已连接的 H3 和千问模型并回收显存缓存；下次生成需重新加载。其他软件占用会保留。";
    const unavailable = failed ? "监控暂不可用，请检查本地画布服务" : "正在读取占用";

    const releaseDisabled = releaseBusy || stats?.comfy !== "idle";
    const releaseStatus = releaseBusy ? "正在请求释放…" : stats?.comfy === "busy" ? "生成中，暂不可释放" : stats?.comfy === "idle" ? "可释放空闲模型" : "模型服务未连接";
    const gpuPercent = stats?.gpu ? Math.round(stats.gpu.percent) : null;
    const gpuColor = gpuPercent === null ? theme.node.faint : gpuPercent >= 85 ? "#ef4444" : gpuPercent >= 60 ? "#f59e0b" : "#22c55e";

    const panel = (
        <section ref={panelRef} id={panelId} aria-label="电脑资源监控" data-canvas-no-zoom data-canvas-shortcuts-ignore className="pointer-events-auto relative flex w-[288px] max-w-[calc(100vw-56px)] flex-col gap-4"
            style={{ color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Activity className="size-4" style={{ color: theme.toolbar.activeText }} /><h2 className="m-0 text-sm font-semibold">性能监控</h2></div>
                <div className="flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: theme.node.muted }}>{failed ? "读取失败" : stats ? "实时更新" : "读取中…"}</span>
                    <button type="button" aria-label="关闭性能面板" onClick={() => { setOpen(false); triggerRef.current?.focus(); }} className="grid size-7 place-items-center rounded-md hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/10" style={{ color: theme.node.muted }}><X className="size-3.5" /></button>
                </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
                <UsageBar label="显存" value={stats?.gpu?.percent ?? null} detail={stats ? stats.gpu ? stats.gpu.devices.map((device) => `${device.name}：${capacity(device)}`).join("；") : "无法读取显存，需可用的 NVIDIA 驱动" : unavailable} />
                <UsageBar label="CPU" value={stats?.cpu ?? null} detail={stats ? "整机 CPU 实时使用率" : unavailable} />
                <UsageBar label="内存" value={stats?.memory.percent ?? null} detail={stats ? `整机内存：${capacity(stats.memory)}` : unavailable} />
            </div>
            {stats?.gpu ? <p className="m-0 -mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>显存已用 {capacity(stats.gpu)}</p> : <p className="m-0 -mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{stats ? "显存暂不可用，CPU 与内存仍可查看" : unavailable}</p>}
            {stats?.services?.length ? <div className="flex flex-col gap-2 border-t pt-3 text-xs" style={{ borderColor: theme.toolbar.border }} aria-label="模型服务状态">
                <span className="mb-0.5 text-[11px]" style={{ color: theme.node.muted }}>模型服务</span>
                {stats.services.map((service) => <div key={service.id} className="flex items-center justify-between gap-2">
                    <span>{service.name}</span><span className="flex items-center gap-1.5" style={{ color: theme.node.muted }}><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: service.state === "idle" ? "#22c55e" : service.state === "busy" ? "#f59e0b" : theme.node.faint }} />{service.state === "idle" ? "空闲" : service.state === "busy" ? "生成或排队中" : "未连接 / 状态未知"}</span>
                </div>)}
            </div> : null}
            <div className="border-t pt-3" style={{ borderColor: theme.toolbar.border }}><ConfigVramPreference compact /></div>
            <div className="flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                <div className="min-w-0"><span className="text-xs" style={{ color: theme.node.muted }}>{releaseStatus}</span><p className="m-0 mt-1 text-[11px]" style={{ color: theme.node.muted }}>释放后，下次生成需重新加载</p></div>
                <Tooltip title={reason} styles={{ root: { pointerEvents: "none" } }}>
                    <span className="inline-flex">
                        <Button size="small" disabled={releaseDisabled} onClick={() => void release()} className="!h-8 !px-3 !text-xs" style={releaseDisabled ? undefined : { background: theme.toolbar.activeBg, borderColor: theme.node.activeStroke, color: theme.toolbar.activeText }} aria-label="释放显存" icon={releaseBusy ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Eraser className="size-3.5" />}>{releaseBusy ? "释放中…" : "释放显存"}</Button>
                    </span>
                </Tooltip>
            </div>
            {notice ? <div role="status" className="flex w-full items-start gap-2 border-t pt-2 text-xs leading-relaxed" style={{ borderColor: theme.toolbar.border }}>
                <span className="flex-1">{notice}</span><button type="button" aria-label="关闭资源提示" onClick={() => setNotice("")} className="px-1 opacity-60">×</button>
            </div> : null}
        </section>
    );
    return <Popover trigger="click" placement="bottom" open={open} onOpenChange={setOpen} content={panel} styles={{ container: { background: theme.toolbar.panel, borderRadius: 12, padding: 16 } }}>
        <button ref={triggerRef} type="button" aria-label="性能监控" aria-expanded={open} aria-controls={open ? panelId : undefined} title={stats?.gpu ? `显存 ${capacity(stats.gpu)} · 点击查看性能详情` : unavailable} data-canvas-no-zoom data-canvas-shortcuts-ignore onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}
            className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[var(--performance-border)] px-2.5 text-xs transition-colors duration-150 hover:bg-[var(--performance-hover)] hover:border-[var(--performance-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--performance-accent)] active:bg-[var(--performance-active)] max-[480px]:gap-1 max-[480px]:px-1.5 motion-reduce:transition-none"
            style={{ "--performance-hover": theme.toolbar.itemHover, "--performance-active": theme.toolbar.activeBg, "--performance-accent": theme.node.activeStroke, "--performance-border": theme.toolbar.border, color: open ? theme.toolbar.activeText : theme.node.text, borderColor: open ? theme.node.activeStroke : undefined, background: open ? theme.toolbar.activeBg : undefined } as CSSProperties}>
            <Activity aria-hidden="true" className="hidden size-3.5 min-[480px]:block" />
            <span className="whitespace-nowrap font-medium">性能</span>
            <span className="flex items-center gap-1.5 border-l pl-2 max-[480px]:border-l-0 max-[480px]:pl-0" style={{ borderColor: theme.toolbar.border }}><span aria-hidden="true" className="hidden size-1.5 rounded-full min-[480px]:block" style={{ background: gpuColor }} /><span className="min-w-6 text-right tabular-nums max-[480px]:text-[11px]" style={{ color: gpuPercent !== null && gpuPercent >= 85 ? "#ef4444" : open ? theme.toolbar.activeText : theme.node.muted }}>{gpuPercent === null ? "—" : `${gpuPercent}%`}</span></span>
            <ChevronDown aria-hidden="true" className={`size-3 transition-transform duration-150 max-[480px]:size-2.5 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </button>
    </Popover>;
}

function UsageBar({ label, value, detail }: { label: string; value: number | null; detail: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const known = value !== null && Number.isFinite(value);
    const percent = known ? Math.max(0, Math.min(100, value)) : 0;
    const color = !known ? "#94a3b8" : percent >= 85 ? "#ef4444" : percent >= 60 ? "#eab308" : "#22c55e";
    return (
        <Tooltip title={detail} styles={{ root: { pointerEvents: "none" } }}>
            <div className="min-w-0" role="progressbar" aria-label={`${label}占用`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? Math.round(percent) : undefined} aria-valuetext={known ? `${Math.round(percent)}%` : "暂不可用"}>
                <div className="mb-2 text-[11px] leading-none" style={{ color: theme.node.muted }}>{label}</div>
                <div className="mb-2 text-lg font-semibold leading-none tabular-nums">{known ? <>{Math.round(percent)}<span className="ml-0.5 text-xs font-normal" style={{ color: theme.node.muted }}>%</span></> : "—"}</div>
                <div className="h-1 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]"><div className="h-full rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none" style={{ width: `${percent}%`, backgroundColor: color }} /></div>
            </div>
        </Tooltip>
    );
}
