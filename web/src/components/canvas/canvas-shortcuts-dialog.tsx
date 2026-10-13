import { Modal } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type ShortcutItem = {
    keys: string[];
    value: string;
};

type CanvasShortcutsDialogProps = {
    open: boolean;
    onClose: () => void;
};

export function canvasShortcutModifier(platform = typeof navigator === "undefined" ? "" : navigator.platform) {
    return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘" : "Ctrl";
}

export function CanvasShortcutsDialog({ open, onClose }: CanvasShortcutsDialogProps) {
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const modifier = canvasShortcutModifier();

    const viewShortcuts: ShortcutItem[] = [
        { keys: [t("canvas.shortcut.wheel")], value: t("canvas.shortcut.zoom") },
        { keys: [t("canvas.shortcut.zoomSlider")], value: t("canvas.shortcut.preciseZoom") },
    ];
    const editShortcuts: ShortcutItem[] = [
        { keys: [t("canvas.shortcut.drag")], value: t("canvas.shortcut.boxSelect") },
        { keys: ["Shift", t("canvas.shortcut.click")], value: t("canvas.shortcut.addSelection") },
        { keys: [modifier, "A"], value: t("canvas.shortcut.selectAll") },
        { keys: [modifier, "C / V"], value: t("canvas.shortcut.copyPaste") },
        { keys: [modifier, "G"], value: t("canvas.shortcut.group") },
        { keys: [modifier, "Shift", "G"], value: t("canvas.shortcut.ungroup") },
        { keys: [modifier, "Z"], value: t("canvas.undo") },
        { keys: [modifier, "Shift", "Z"], value: t("canvas.redo") },
        { keys: [modifier === "⌘" ? "⌫" : "Delete"], value: t("canvas.shortcut.delete") },
        { keys: ["Esc"], value: t("canvas.shortcut.escape") },
    ];
    const actionShortcuts: ShortcutItem[] = [
        { keys: ["Ctrl / Space", t("canvas.shortcut.drag")], value: t("canvas.shortcut.toggleTool") },
        { keys: [t("canvas.shortcut.dropMedia")], value: t("canvas.shortcut.upload") },
    ];

    return (
        <Modal title={t("canvas.shortcuts")} open={open} onCancel={onClose} footer={null} centered width={480} destroyOnHidden>
            <div className="max-h-[70vh] space-y-5 overflow-y-auto" data-canvas-shortcuts-ignore>
                <ShortcutGroup title={t("canvas.shortcutGroup.view")} items={viewShortcuts} theme={theme} />
                <ShortcutGroup title={t("canvas.shortcutGroup.edit")} items={editShortcuts} theme={theme} />
                <ShortcutGroup title={t("canvas.shortcutGroup.action")} items={actionShortcuts} theme={theme} />
            </div>
        </Modal>
    );
}

function ShortcutGroup({ title, items, theme }: { title: string; items: ShortcutItem[]; theme: CanvasTheme }) {
    return (
        <section className="space-y-0.5">
            <div className="mb-1 text-xs font-medium" style={{ color: theme.node.faint }}>
                {title}
            </div>
            {items.map((item) => (
                <ShortcutRow key={`${item.keys.join("+")}-${item.value}`} keys={item.keys} value={item.value} theme={theme} />
            ))}
        </section>
    );
}

function ShortcutRow({ keys, value, theme }: { keys: string[]; value: string; theme: CanvasTheme }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5">
            <span className="text-sm" style={{ color: theme.node.muted }}>{value}</span>
            <span className="flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap">
                {keys.map((combo, comboIndex) => (
                    <span key={`${combo}-${comboIndex}`} className="flex items-center gap-1">
                        {comboIndex > 0 && <span className="text-xs opacity-40">+</span>}
                        {combo.split(" / ").map((part, partIndex) => (
                            <span key={`${part}-${partIndex}`} className="flex items-center gap-1">
                                {partIndex > 0 && <span className="text-xs opacity-40">/</span>}
                                <KeyCap label={part} theme={theme} />
                            </span>
                        ))}
                    </span>
                ))}
            </span>
        </div>
    );
}

function KeyCap({ label, theme }: { label: string; theme: CanvasTheme }) {
    return (
        <kbd
            className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center whitespace-nowrap rounded-md border px-1.5 text-xs font-medium leading-none"
            style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.text, boxShadow: "inset 0 -1px 0 rgba(0,0,0,.05)" }}
        >
            {label}
        </kbd>
    );
}
