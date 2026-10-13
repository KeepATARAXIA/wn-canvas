import { useState } from "react";
import { Button, Modal, Segmented } from "antd";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

const resolutions = [1080, 1440, 2160];

export function CanvasNodeVideoUpscaleDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (resolution: number) => void }) {
    const { t } = useTranslation();
    const [resolution, setResolution] = useState(1080);
    return (
        <Modal title={null} open={open} onCancel={onClose} footer={null} width={560} centered destroyOnHidden>
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl font-semibold">{t("canvas.videoUpscale.title")}</h2>
                    <p className="mt-1 text-sm opacity-60">{t("canvas.videoUpscale.description")}</p>
                </div>
                <div className="space-y-2">
                    <div className="font-medium opacity-75">{t("canvas.videoUpscale.resolution")}</div>
                    <Segmented block value={resolution} options={resolutions.map((value) => ({ value, label: value === 2160 ? "4K · 2160p" : `${value}p` }))} onChange={(value) => setResolution(Number(value))} />
                </div>
                <div className="rounded-xl border px-4 py-3 text-sm opacity-70">{t("canvas.videoUpscale.notice")}</div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<Sparkles className="size-4" />} onClick={() => onConfirm(resolution)}>{t("canvas.videoUpscale.start")}</Button>
                </div>
            </div>
        </Modal>
    );
}
