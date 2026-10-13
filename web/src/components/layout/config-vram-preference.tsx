import { Switch } from "antd";
import { useTranslation } from "react-i18next";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function ConfigVramPreference({ compact = false }: { compact?: boolean }) {
    const { i18n } = useTranslation();
    const en = i18n.resolvedLanguage === "en-US";
    const enabled = useConfigStore((state) => Boolean(state.config.autoReleaseVram));
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const label = en ? "Auto-release VRAM after generation" : "生成结束后自动释放显存";
    return <div className="min-w-0" data-canvas-shortcuts-ignore onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
            <span className={compact ? "text-xs font-medium" : "text-sm font-medium"}>{label}</span>
            <Switch className="shrink-0" size={compact ? "small" : "default"} checked={enabled} aria-label={label} onChange={(checked) => updateConfig("autoReleaseVram", checked)} />
        </div>
        <p className={`mb-0 mt-2 leading-5 ${compact ? "text-[11px]" : "text-xs"}`} style={{ color: theme.node.muted }}>
            {enabled ? (en ? "Releases H3 and Qwen after the whole queue is idle. The next generation reloads models." : "整批任务与本地队列空闲后释放 H3 和千问；下次生成需重新加载模型。") : (en ? "Keeps models loaded for faster repeat generation." : "保留模型占用，连续生成通常更快。")}
        </p>
    </div>;
}
