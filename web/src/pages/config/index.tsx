import { useTranslation } from "react-i18next";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export default function ConfigPage() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <main className="workspace-page h-full overflow-y-auto" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
                <div className="mb-6">
                    <h1 className="text-2xl font-semibold">{t("config.title")}</h1>
                    <p className="workspace-muted mt-2 text-sm">{t("config.description")}</p>
                </div>
                <AppConfigPanel />
            </div>
        </main>
    );
}
