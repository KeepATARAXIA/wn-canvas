import { App, Button, Input, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, KeyRound, Link2, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

export function AgentConnectView({
    theme, url, token, enabled, connected, activity, connectError, onUrlChange, onTokenChange, onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t, i18n } = useTranslation();
    const { message } = App.useApp();
    const zh = i18n.resolvedLanguage !== "en-US";
    const text = (cn: string, en: string) => zh ? cn : en;
    const dark = theme === canvasThemes.dark;
    const statusText = connectError ? t("agent.status.failed") : connected ? (activity || t("agent.status.connected")) : enabled ? t("agent.status.connecting") : t("agent.status.disconnected");
    const statusColor = connectError ? (dark ? "#fca5a5" : "#b91c1c") : connected ? (dark ? "#86efac" : "#15803d") : enabled ? (dark ? "#fcd34d" : "#a16207") : theme.node.muted;
    const copyCommand = (command: string) => {
        copyToClipboard(command);
        message.success(t("agent.connect.commandCopied"));
    };
    const commandRow = (command: string) => <div className="mt-2 flex items-center gap-2 rounded-md border px-2 py-1.5" style={{ borderColor: theme.node.stroke }}>
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs leading-5">{command}</code>
        <Tooltip title={t("agent.connect.copyCommand")}><Button size="small" type="text" aria-label={t("agent.connect.copyCommand")} className="!h-7 !w-7 !min-w-7" icon={<Copy className="size-3.5" />} onClick={() => copyCommand(command)} /></Tooltip>
    </div>;

    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-5" data-agent-connect-view>
            <h2 className="text-base font-semibold leading-6">{t("agent.connect.title")}</h2>
            <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>{text("连接后，可以让 Agent 整理素材、调整画布并协助创作。", "Connect to organize assets, edit your canvas and assist with creative work.")}</p>

            <div className="mt-6 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div role="status" className="flex items-center gap-2 text-sm font-medium" style={{ color: statusColor }}><span className="size-2 shrink-0 rounded-full bg-current" /><span>{statusText}</span></div>
                    <p className="mt-2 break-all text-xs leading-5" style={{ color: theme.node.muted }}>{url || text("尚未设置服务地址", "No service URL configured")}</p>
                </div>
                <Button className="!h-9 shrink-0 !px-4" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>{t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}</Button>
            </div>
            <p className="mt-3 text-sm leading-6" style={{ color: theme.node.muted }}>{connected ? text("连接已建立。切换到对话继续操作。", "Connected. Switch to Chat to continue.") : enabled ? text("正在等待本地服务响应；可断开后重试。", "Waiting for the local service. You can disconnect and try again.") : text("基础画布可独立使用。使用 Agent 前，请先安装并编译 canvas-agent，再以 --agent 启动画布，或手动启动 Agent 后连接。", "The basic canvas works independently. To use Agent, install and build canvas-agent first, then launch the canvas with --agent, or start Agent manually before connecting.")}</p>
            {connectError ? <div role="alert" className="mt-3 rounded-lg border px-3 py-2.5 text-sm leading-6" style={{ borderColor: statusColor, color: statusColor }}>{connectError}</div> : null}

            <details className="mt-6 border-t pt-4" style={{ borderColor: theme.node.stroke }}>
                <summary className="cursor-pointer text-sm font-medium">{text("手动设置地址与 Token", "Set URL and token manually")}</summary>
                <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>{t("agent.connect.autoDiscover")}</p>
                <div className="mt-3 grid gap-3">
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-sm"><Link2 className="size-3.5" />{t("agent.connect.localAddress")}</span>
                        <Input size="large" value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder={t("agent.connect.urlPlaceholder")} />
                    </label>
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-sm"><KeyRound className="size-3.5" />{t("agent.connect.token")}</span>
                        <Input.Password size="large" value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder={t("agent.connect.tokenPlaceholder")} />
                    </label>
                </div>
            </details>

            <details className="mt-4 border-t pt-4" style={{ borderColor: theme.node.stroke }}>
                <summary className="cursor-pointer text-sm font-medium">{text("首次连接与故障排查", "First connection and troubleshooting")}</summary>
                <div className="mt-4 space-y-5 text-sm leading-6">
                    <div><h3 className="font-medium">{text("启动可选 Agent", "Start the optional Agent")}</h3><p className="mt-1" style={{ color: theme.node.muted }}>{text("先按 README 在 canvas-agent 目录安装依赖并构建。如果基础画布已在运行，先在对应启动终端按 Ctrl+C 停止，再从项目根目录运行：", "Follow the README to install dependencies and build canvas-agent. If the basic canvas is already running, stop its launcher with Ctrl+C, then run from the project root:")}</p>{commandRow("node 一键启动.cjs --agent")}</div>
                    <div><h3 className="font-medium">{text("单独启动 Agent", "Start Agent separately")}</h3><p className="mt-1" style={{ color: theme.node.muted }}>{text("也可以保留正在运行的画布，在另一个终端从项目根目录启动已构建的 Agent，再回到这里连接：", "You can also keep the canvas running and start the built Agent from the project root in another terminal, then return here to connect:")}</p>{commandRow("node canvas-agent/dist/index.js")}</div>
                </div>
            </details>
        </div>
    );
}
