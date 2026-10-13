import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Alert, Button, Modal, Progress, Tooltip } from "antd";
import { CloudDownload, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "@/constant/env";
import { WnPublishPanel, type PublisherStatus } from "./wn-publish-panel";

type Release = { id: string; version: string; fromVersion: string; notes: string; bytes: number; files: number };
type UpdateStatus = {
    mode?: "developer" | "user";
    compatibility?: { compatible: boolean; message: string } | null;
    configured: boolean; currentVersion: string | null; release: Release | null; pending: Release | null;
    phase: string; received: number; total: number; error: string;
    awaitingConfirmation: string | null;
    lastResult: { status: string; version: string } | null;
};
let snapshot: { status: UpdateStatus | null; publisher: PublisherStatus | null; busy: boolean; error: string } = { status: null, publisher: null, busy: false, error: "" };
const listeners = new Set<() => void>();
let initialized = false;
const subscribe = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; };
function publish(change: Partial<typeof snapshot>) { snapshot = { ...snapshot, ...change }; listeners.forEach(callback => callback()); }
async function request(action: "status" | "check" | "stage" | "cancel" | "confirm", id?: string) {
    const response = await fetch(`/api/wn-update/${action}`, {
        method: action === "status" ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(130000),
        headers: action === "status" ? {} : { "x-wn-update-action": action, ...(id ? { "x-wn-update-id": id } : {}) },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    return result;
}
async function refresh(clearError = false) {
    try {
        const status = await request("status") as UpdateStatus;
        publish({ status, ...(clearError ? { error: "" } : {}) });
        if (status.mode === "developer") {
            const response = await fetch("/api/wn-update/developer-status", { cache: "no-store", signal: AbortSignal.timeout(30000) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
            publish({ publisher: result });
        } else publish({ publisher: null });
    }
    catch (error) { publish({ error: error instanceof Error ? error.message : String(error) }); }
}
async function developerAction(name: "prepare" | "approve" | "verify", body?: object, id?: string) {
    if (snapshot.busy || snapshot.status?.mode !== "developer") return false;
    publish({ busy: true, error: "" });
    try {
        const action = `developer-${name}`;
        const response = await fetch(`/api/wn-update/${action}`, {
            method: "POST", cache: "no-store", signal: AbortSignal.timeout(300000),
            headers: { "x-wn-update-action": action, ...(id ? { "x-wn-update-id": id } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
        await refresh();
        return !snapshot.error;
    } catch (error) { publish({ error: error instanceof Error ? error.message : String(error) }); return false; }
    finally { publish({ busy: false }); }
}
async function action(name: "check" | "stage" | "cancel" | "confirm", id?: string) {
    if (snapshot.busy) return;
    publish({ busy: true, error: "" });
    try {
        const result = await request(name, id);
        if (name !== "stage") publish({ status: result });
        else await refresh();
    } catch (error) { publish({ error: error instanceof Error ? error.message : String(error) }); }
    finally { publish({ busy: false }); }
}

export function WnUpdateLifecycle() {
    const { status, busy, error } = useSyncExternalStore(subscribe, () => snapshot);
    const downloading = status?.phase === "downloading";
    const userMode = status?.mode !== "developer";
    const waiting = userMode && Boolean(status?.pending || status?.awaitingConfirmation);
    useEffect(() => {
        if (initialized) return;
        initialized = true;
        void refresh(true).then(() => { if (snapshot.status?.mode !== "developer" && snapshot.status?.configured && !snapshot.status.pending) void action("check"); });
    }, []);
    useEffect(() => {
        if (userMode && status?.awaitingConfirmation && !busy && !error) void action("confirm", status.awaitingConfirmation);
    }, [userMode, status?.awaitingConfirmation, busy, error]);
    useEffect(() => {
        if (!userMode || (!downloading && !waiting)) return;
        const timer = window.setInterval(() => { void refresh(); }, downloading ? 700 : 2000);
        return () => window.clearInterval(timer);
    }, [userMode, downloading, waiting]);
    useEffect(() => {
        if (!userMode) return;
        const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
        window.addEventListener("focus", onVisible);
        document.addEventListener("visibilitychange", onVisible);
        return () => { window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
    }, [userMode]);
    return null;
}

export function WnUpdateButton({ className, style, label }: { className?: string; style?: CSSProperties; label?: string }) {
    const { i18n } = useTranslation();
    const en = i18n.resolvedLanguage === "en-US";
    const [open, setOpen] = useState(false);
    const { status, publisher, busy, error } = useSyncExternalStore(subscribe, () => snapshot);
    const developer = status?.mode === "developer";
    const downloading = status?.phase === "downloading";
    const release = status?.pending || status?.release;
    const text = (zh: string, english: string) => en ? english : zh;
    const title = developer ? text("WN 发布管理", "WN release management") : text("WN 在线更新", "WN online updates");
    return <>
        <Tooltip title={title} mouseEnterDelay={0.2}>
            <button type="button" className={className} style={style} aria-label={title} onClick={() => { setOpen(true); void refresh(true); }}>
                {label || (developer ? <Upload className="size-4" /> : <CloudDownload className="size-4" />)}
                {Boolean(developer ? publisher && (publisher.changes.length || publisher.maintenanceChanges.length) : status?.release || status?.pending) && <span className="ml-1 inline-block size-1.5 rounded-full bg-primary" aria-label={developer ? text("有未发布改动", "Unreleased changes") : text("有可用更新", "Update available")} />}
            </button>
        </Tooltip>
        <Modal title={title} open={open} onCancel={() => setOpen(false)} width={developer ? 940 : 620} footer={null} centered styles={{ body: developer ? { overflow: "hidden" } : { maxHeight: "75vh", overflowY: "auto", paddingRight: 4 } }}>
            <div className={developer ? undefined : "space-y-4"}>
                {developer ? <>
                    <WnPublishPanel status={publisher} busy={busy} en={en} error={error} onRefresh={() => void refresh(true)} onPrepare={(version, notes, reviewId) => developerAction("prepare", { version, notes, reviewId })} onApprove={id => developerAction("approve", undefined, id)} onVerify={id => developerAction("verify", undefined, id)} />
                </> : <>
                <div className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">{text("当前 WN 版本", "Installed WN version")}</div>
                    <div className="mt-1 break-all text-base font-semibold">{status?.currentVersion || text("尚未登记分发版本", "Distribution version not registered")}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{text("基础画布", "Base canvas")} {APP_VERSION}</div>
                </div>
                {!status && !error && <p>{text("正在读取更新状态…", "Reading update status…")}</p>}
                {status && !status.configured && <Alert type="info" showIcon title={text("暂未设置更新源", "Update source is not configured")} description={text("当前画布可继续使用。发布地址确定后，再启用在线检查和下载。", "You can keep using the canvas. Online updates will be enabled after a release source is configured.")} />}
                {(error || status?.error) && <Alert type="error" showIcon title={text("更新未完成", "Update did not complete")} description={<span className="break-words">{error || status?.error}</span>} />}
                {status?.phase === "current" && !error && <Alert type="success" showIcon title={text("当前版本无需更新", "Your version is up to date")} />}
                {status?.lastResult?.status === "rolled-back" && <Alert type="warning" showIcon title={text("上次更新已恢复到原版本", "The previous update was rolled back")} />}
                {status?.compatibility && !status.compatibility.compatible && <Alert type="warning" showIcon title={text("当前安装与此版本不兼容", "This release is incompatible with this installation")} description={<span className="break-words">{status.compatibility.message}</span>} />}
                {release && <section className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <strong>{release.version}</strong>
                        <span className="text-xs text-muted-foreground">{(release.bytes / 1024 / 1024).toFixed(2)} MiB</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm">{release.notes}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{text("仅更新程序，保留模型、作品与个人配置。文件有本地修改时会停止安装。", "Updates program files and preserves models, projects and settings. Local file conflicts stop installation.")}</p>
                </section>}
                {downloading && <Progress percent={status.total ? Math.min(99, Math.floor(status.received / status.total * 100)) : 0} status="active" />}
                {status?.pending ? <Alert type="success" showIcon title={text("已下载并校验，等待下次完整启动", "Downloaded and verified; ready for the next full startup")} description={text("保存工作后，关闭画布和所有模型后台，或重启电脑，再使用一键启动安装。仅关闭浏览器不会停止后台；运行中不会安装更新。", "Save your work, close the canvas and all model services, or restart your computer, then use the launcher. Closing the browser alone does not stop services. Updates are not installed while services are running.")} /> : release && <p className="text-sm text-muted-foreground">{text("下载完成后，将在下次完整启动时安装。当前生成任务可以继续。", "Once downloaded, the update will install on the next full startup. Current generation tasks can continue.")}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                    <Button loading={busy && !downloading} disabled={downloading} onClick={() => void action("check")}>{text("检查更新", "Check for updates")}</Button>
                    {status?.pending ? <Button disabled={busy || downloading} onClick={() => void action("cancel")}>{text("取消待安装更新", "Cancel pending update")}</Button>
                        : status?.release && <Button type="primary" loading={downloading} disabled={busy || status.phase === "current" || status.compatibility?.compatible === false} onClick={() => void action("stage", status.release!.id)}>{text("下载并准备更新", "Download and prepare")}</Button>}
                </div>
                <details className="border-t border-border pt-3 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{text("基础画布更新记录", "Base canvas release notes")}</summary>
                    <div className="mt-3 max-h-56 space-y-4 overflow-y-auto">
                        {__APP_RELEASES__.map(release => <section key={release.version}>
                            <strong>{release.version}</strong><span className="ml-2 text-xs text-muted-foreground">{release.date}</span>
                            <ul className="mt-1 list-inside list-disc space-y-1">{release.items.map((item, index) => <li key={index}>{item.content}</li>)}</ul>
                        </section>)}
                    </div>
                </details>
                </>}
            </div>
        </Modal>
    </>;
}
