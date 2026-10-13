import { useRef, useState } from "react";
import { App, Button, Modal } from "antd";
import { Download, ExternalLink, PlugZap, Upload, WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { exportJimengPackage, JIMENG_VIDEO_URL } from "@/services/jimeng-bridge";
import { generateWithJimengExtension, isJimengExtensionAvailable } from "@/services/jimeng-auto-bridge";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export default function CanvasJimengBridgeDialog({ prompt, seconds, ratio, references, onClose, onImport }: { prompt: string; seconds: string; ratio: string; references: CanvasResourceReference[]; onClose: () => void; onImport: (file: File) => void | Promise<void> }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const inputRef = useRef<HTMLInputElement>(null);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("");

    const openJimeng = () => {
        copyText(prompt, t("canvas.jimeng.promptCopied"));
        const tab = window.open(JIMENG_VIDEO_URL, "_blank");
        if (tab) tab.opener = null;
        if (!tab) message.warning(t("canvas.jimeng.popupBlocked"));
    };

    const exportPackage = async () => {
        setExporting(true);
        try {
            await exportJimengPackage(prompt, seconds, ratio, references);
            message.success(t("canvas.jimeng.packageReady"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.jimeng.packageFailed"));
        } finally {
            setExporting(false);
        }
    };

    const generateAutomatically = async () => {
        setGenerating(true);
        setProgress(1);
        setStatus(t("canvas.jimeng.connecting"));
        try {
            if (!(await isJimengExtensionAvailable())) throw new Error(t("canvas.jimeng.extensionMissing"));
            const file = await generateWithJimengExtension({ prompt, seconds, ratio, references, onProgress: (value, text) => { setProgress(value); if (text) setStatus(text); } });
            await onImport(file);
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.jimeng.autoFailed"));
        } finally {
            setGenerating(false);
        }
    };

    return (
        <Modal title={t("canvas.jimeng.title")} open centered width={560} footer={null} onCancel={onClose} destroyOnHidden>
            <div data-canvas-no-zoom className="pt-2">
                <div className="rounded-xl border border-current/10 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium"><WandSparkles className="size-4" />{t("canvas.jimeng.summary")}</div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs opacity-75">
                        <div className="rounded-lg bg-current/5 px-2 py-2">{t("canvas.jimeng.ratio")}<strong className="mt-1 block text-sm">{ratio}</strong></div>
                        <div className="rounded-lg bg-current/5 px-2 py-2">{t("canvas.jimeng.duration")}<strong className="mt-1 block text-sm">{seconds} s</strong></div>
                        <div className="rounded-lg bg-current/5 px-2 py-2">{t("canvas.jimeng.references")}<strong className="mt-1 block text-sm">{references.length}</strong></div>
                    </div>
                    <p className="mb-0 mt-3 text-xs leading-5 opacity-60">{t("canvas.jimeng.notice")}</p>
                </div>
                <div className="mt-4 grid gap-2">
                    <Button type="primary" icon={<PlugZap className="size-4" />} loading={generating} disabled={!prompt.trim()} onClick={() => void generateAutomatically()}>{t("canvas.jimeng.autoGenerate")}</Button>
                    {generating ? <div className="px-1"><div className="h-1.5 overflow-hidden rounded-full bg-current/10"><div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} /></div><p className="mb-0 mt-1 text-center text-xs opacity-60">{status || `${progress}%`}</p></div> : null}
                    <Button type="primary" icon={<ExternalLink className="size-4" />} disabled={!prompt.trim()} onClick={openJimeng}>{t("canvas.jimeng.open")}</Button>
                    <Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportPackage()}>{t("canvas.jimeng.export")}</Button>
                    <Button icon={<Upload className="size-4" />} loading={importing} onClick={() => inputRef.current?.click()}>{t("canvas.jimeng.import")}</Button>
                </div>
                <input ref={inputRef} type="file" accept="video/*,.mp4,.mov,.webm" className="hidden" onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setImporting(true);
                    try {
                        await onImport(file);
                        onClose();
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : t("canvas.jimeng.importFailed"));
                    } finally {
                        setImporting(false);
                    }
                }} />
                <p className="mb-0 mt-3 text-center text-xs opacity-50">{t("canvas.jimeng.importHint")}</p>
            </div>
        </Modal>
    );
}
