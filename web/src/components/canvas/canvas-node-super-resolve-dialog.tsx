import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Radio } from "antd";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";

export type CanvasImageSuperResolveMode = "general2x" | "general4x" | "anime4x";
export type CanvasImageSuperResolveParams = { mode: CanvasImageSuperResolveMode; modelName: string; scale: 2 | 4 };

const modes: CanvasImageSuperResolveParams[] = [
    { mode: "general2x", modelName: "RealESRGAN_x2plus.pth", scale: 2 },
    { mode: "general4x", modelName: "RealESRGAN_x4plus.pth", scale: 4 },
    { mode: "anime4x", modelName: "RealESRGAN_x4plus_anime_6B.pth", scale: 4 },
];

export function CanvasNodeSuperResolveDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageSuperResolveParams) => void }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<CanvasImageSuperResolveMode>("general2x");
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const selected = modes.find((item) => item.mode === mode) || modes[0];
    const outputSize = useMemo(() => image ? `${image.width * selected.scale} x ${image.height * selected.scale} px` : t("canvas.editors.loading"), [image, selected.scale, t]);

    useEffect(() => {
        if (!open) return;
        setMode("general2x");
        setImage(null);
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={820} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">{t("canvas.superResolveDialog.title")}</h2>
                    <p className="mt-1 text-sm opacity-60">{t("canvas.superResolveDialog.description")}</p>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="rounded-xl border p-4">
                        <div className="grid min-h-[280px] place-items-center rounded-lg bg-black/5 dark:bg-white/5">
                            <img src={dataUrl} alt="" className="max-h-[320px] max-w-full rounded-lg object-contain" draggable={false} />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">{t("canvas.editors.source")}</span>
                            <span className="font-semibold">{image ? `${image.width} x ${image.height} px` : t("canvas.editors.loading")}</span>
                        </div>
                    </div>
                    <div className="space-y-4 py-1">
                        <div className="font-medium opacity-75">{t("canvas.superResolveDialog.mode")}</div>
                        <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)} className="grid w-full gap-2">
                            {modes.map((item) => (
                                <Radio.Button key={item.mode} value={item.mode} className="!flex !h-auto !w-full items-center !rounded-xl !px-4 !py-3">
                                    <span className="flex flex-col leading-5">
                                        <span className="font-medium">{t(`canvas.superResolveDialog.${item.mode}`)}</span>
                                        <span className="text-xs opacity-55">{t(`canvas.superResolveDialog.${item.mode}Description`)}</span>
                                    </span>
                                </Radio.Button>
                            ))}
                        </Radio.Group>
                        <div className="rounded-xl border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">{t("canvas.editors.outputSize")}</span>
                                <span className="font-semibold">{outputSize}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<Sparkles className="size-4" />} onClick={() => onConfirm(selected)}>
                        {t("canvas.projectPage.startSuperResolve")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
