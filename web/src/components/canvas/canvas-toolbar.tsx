import { videoOperationLabels, type VideoOperation } from "@/services/api/canvas-video-tools";
import { useState } from "react";
import { Button, Dropdown, Tooltip } from "antd";
import { Plus, Gauge, Scissors, Scaling, ListVideo, Workflow, Sparkles, AudioLines, FolderClosed, Users, Group, Hand, Image as ImageIcon, MousePointer2, Music2, Settings2, Type, Upload, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { useTranslation } from "react-i18next";

export function CanvasToolbar({
    canvasTool,
    onAddImage,
    onVideoTools,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onAddGroup,
    onAddExtensionNode,
    onUpload,
    onOpenAssets,
    assetsOpen,
    onCanvasToolChange,
}: {
    canvasTool: "select" | "pan";
    onAddImage: () => void;
    onVideoTools: (operation: VideoOperation) => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onAddGroup: () => void;
    onAddExtensionNode: (type: string) => void;
    onUpload: () => void;
    onOpenAssets: () => void;
    assetsOpen: boolean;
    onCanvasToolChange: (tool: "select" | "pan") => void;
}) {
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const [dockLabelsOpen, setDockLabelsOpen] = useState(false);
    const dockTooltipProps = {
        open: dockLabelsOpen,
        trigger: [],
        arrow: false,
        styles: {
            root: { pointerEvents: "none" as const },
            container: { background: "transparent", boxShadow: "none", color: theme.toolbar.item, minHeight: 0, padding: "0 0 0 12px" },
        },
    };
    // Keep extension plugin nodes synchronized with registry changes.
    useNodeRegistryVersion();
    const extensionDefs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin");
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <div role="toolbar" aria-label="创建素材与视频节点" aria-orientation="vertical" data-canvas-no-zoom data-canvas-shortcuts-ignore onMouseEnter={() => setDockLabelsOpen(true)} onMouseLeave={() => setDockLabelsOpen(false)} className="hide-scrollbar pointer-events-auto absolute left-4 top-1/2 -translate-y-1/2 z-50 flex max-h-[calc(100%-176px)] w-12 flex-col items-center gap-1 overflow-y-auto rounded-2xl border py-2 backdrop-blur [&>*]:shrink-0 max-[480px]:!left-3 max-[480px]:!top-[70px] max-[480px]:!h-12 max-[480px]:!max-h-none max-[480px]:!w-[calc(100%-24px)] max-[480px]:!translate-y-0 max-[480px]:!flex-row max-[480px]:!overflow-x-auto max-[480px]:!overflow-y-hidden max-[480px]:!px-2 max-[480px]:!py-0" style={dockStyle}>
            <Tooltip title={t(`canvas.toolbar.${canvasTool}`)} placement="right" {...dockTooltipProps}>
                <Button type="text" aria-label={t(`canvas.toolbar.${canvasTool}`)} aria-pressed={canvasTool === "pan"} className="!size-9 !p-0" style={activeStyle} icon={canvasTool === "select" ? <MousePointer2 className="size-[18px]" /> : <Hand className="size-[18px]" />} onClick={() => onCanvasToolChange(canvasTool === "select" ? "pan" : "select")} />
            </Tooltip>
            <div className="my-1 w-6 border-t" style={{ borderColor: theme.toolbar.border }} />
            {[
                { label: "文本", Icon: Type, onClick: onAddText },
                { label: "图片", Icon: ImageIcon, onClick: onAddImage },
                { label: "视频", Icon: Video, onClick: onAddVideo },
                { label: "音频", Icon: Music2, onClick: onAddAudio },
            ].map(({ label, Icon, onClick }) => (
                <Tooltip key={label} title={label} placement="right" {...dockTooltipProps}>
                    <Button type="text" aria-label={label} className="!size-9 !p-0" style={{ color: theme.toolbar.item }} icon={<Icon className="size-[18px]" />} onClick={onClick} />
                </Tooltip>
            ))}
            <Tooltip title="添加节点" placement="right" {...dockTooltipProps}><Dropdown trigger={["click"]} placement="bottomLeft" menu={{ items: [
                { key: "text", label: "文本", icon: <Type className="size-4" />, onClick: onAddText },
                { key: "image", label: "图片", icon: <ImageIcon className="size-4" />, onClick: onAddImage },
                { key: "video", label: "视频", icon: <Video className="size-4" />, onClick: onAddVideo },
                { key: "audio", label: "音频", icon: <Music2 className="size-4" />, onClick: onAddAudio },
                { key: "config", label: "生成配置", icon: <Settings2 className="size-4" />, onClick: onAddConfig },
                { key: "group", label: "组", icon: <Group className="size-4" />, onClick: onAddGroup },
                ...(extensionDefs.length ? [{ type: "divider" as const }, ...extensionDefs.map((def) => ({ key: def.type, label: def.title, icon: <span className="grid size-4 place-items-center">{def.icon}</span>, onClick: () => onAddExtensionNode(def.type) }))] : []),
            ] }} popupRender={(menu) => <div data-canvas-shortcuts-ignore>{menu}</div>}><Button type="text" aria-label="添加节点" className="!size-9 !p-0" style={{ color: theme.toolbar.item }} icon={<Plus className="size-[18px]" />} /></Dropdown></Tooltip>
            <Tooltip title="上传素材" placement="right" {...dockTooltipProps}>
                <Button type="text" aria-label="上传素材" className="!size-9 !p-0" style={{ color: theme.toolbar.item }} icon={<Upload className="size-[18px]" />} onClick={onUpload} />
            </Tooltip>
            <Tooltip title="预设流程" placement="right" {...dockTooltipProps}><Dropdown trigger={["click"]} placement="bottomLeft" menu={{ items: [
                { key: "enhance", label: "剪切 → 补帧 → 放大", onClick: () => window.dispatchEvent(new CustomEvent("canvas-video-workflow", { detail: ["trim", "interpolate", "upscale"] })) },
                { key: "sound", label: "剪切 → 音轨整理", onClick: () => window.dispatchEvent(new CustomEvent("canvas-video-workflow", { detail: ["trim", "audio"] })) },
            ] }}><Button type="text" aria-label="预设流程" className="!size-9 !p-0" style={{ color: theme.toolbar.item }} icon={<Workflow className="size-[18px]" />} /></Dropdown></Tooltip>
            <div className="my-1 w-6 border-t" style={{ borderColor: theme.toolbar.border }} />
            {(Object.keys(videoOperationLabels) as VideoOperation[]).map(operation => {
                const Icon = {continuum: ListVideo, handtie: Users, interpolate: Gauge, upscale: Scaling, restore: Sparkles, trim: Scissors, audio: AudioLines}[operation];
                const label = ({continuum: "续生成", handtie: "角色串联", interpolate: "补帧", upscale: "放大", restore: "超分", trim: "剪切", audio: "音轨"})[operation];
                return <Tooltip key={operation} title={label} placement="right" {...dockTooltipProps}><Button type="text" aria-label={label} className="!size-9 !p-0" style={{ color: theme.toolbar.item }} icon={<Icon className="size-[18px]" />} onClick={() => onVideoTools(operation)} /></Tooltip>;
            })}
            <div className="my-1 w-6 border-t" style={{ borderColor: theme.toolbar.border }} />
            <Tooltip title="资产库" placement="right" {...dockTooltipProps}>
                <Button type="text" aria-label="资产库" aria-haspopup="dialog" aria-expanded={assetsOpen} className="!size-9 !p-0" style={assetsOpen ? activeStyle : { color: theme.toolbar.item }} icon={<FolderClosed className="size-[18px]" />} onClick={() => { setDockLabelsOpen(false); onOpenAssets(); }} />
            </Tooltip>
        </div>
    );
}
