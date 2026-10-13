import { ArrowUpRight, Bot, RefreshCw, Pencil, Image, Video, AudioLines, Type, KeyRound, Plus, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { channelConfigIssue, configuredCapability, probeChannel, type ChannelProbe } from "@/lib/config-capability-status";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { IconAction, InfoPopover } from "@/components/ui/compact-controls";

const capabilities: ModelCapability[] = ["image", "video", "text", "audio"];
const capabilityIcons = { image: Image, video: Video, text: Type, audio: AudioLines };
type CheckedChannel = { channel: ModelChannel; proxyKey: string; result?: ChannelProbe };
// Keep completed checks across tab unmounts; reopening still verifies current availability.
let recentChecks: Record<string, CheckedChannel> = {};

export function ConfigCapabilityStatus({ active = true, onEditChannel, onAddChannel, onOpenAgent }: { active?: boolean; onEditChannel: (id: string) => void; onAddChannel: () => void; onOpenAgent: () => void }) {
    const { t, i18n } = useTranslation();
    const zh = i18n.resolvedLanguage !== "en-US";
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const connected = useAgentStore((state) => state.connected);
    const enabled = useAgentStore((state) => state.enabled);
    const connectError = useAgentStore((state) => state.connectError);
    const conversation = useAgentStore((state) => state.conversation);
    const agentModel = useAgentStore((state) => state.model);
    const [checked, setChecked] = useState<Record<string, CheckedChannel>>(() => recentChecks);
    const [checking, setChecking] = useState(false);
    const request = useRef<AbortController | null>(null);
    const rows = useMemo(() => capabilities.map((capability) => ({ capability, ...configuredCapability(config, capability) })), [config.channels, config.imageModel, config.videoModel, config.textModel, config.audioModel]);
    const proxyKey = JSON.stringify([config.proxyEnabled, config.proxyUrl]);
    const text = (cn: string, en: string) => zh ? cn : en;
    const colors = { muted: themeName === "light" ? "#475569" : theme.node.muted, good: themeName === "light" ? "#166534" : "#86efac", warning: themeName === "light" ? "#854d0e" : "#fcd34d", error: themeName === "light" ? "#b91c1c" : "#fca5a5" };

    const checkConnections = useCallback(async (selectedChannel?: ModelChannel) => {
        if (request.current) return;
        const controller = new AbortController();
        request.current = controller;
        const channels = selectedChannel ? [selectedChannel] : [...new Map(rows.flatMap(({ channel }) => channel && !channelConfigIssue(channel) ? [[channel.id, channel] as const] : [])).values()];
        setChecking(true);
        setChecked((current) => ({ ...current, ...Object.fromEntries(channels.map((channel) => [channel.id, { channel, proxyKey, result: current[channel.id]?.channel === channel && current[channel.id]?.proxyKey === proxyKey ? current[channel.id].result : undefined }])) }));
        try {
            await Promise.all(channels.map(async (channel) => {
                const result = await probeChannel(channel, controller.signal);
                if (!controller.signal.aborted) {
                    const entry = { channel, proxyKey, result };
                    recentChecks = { ...recentChecks, [channel.id]: entry };
                    setChecked((current) => ({ ...current, [channel.id]: entry }));
                }
            }));
        } catch {
            // Leaving this view or changing configuration cancels the read-only checks.
        } finally {
            if (request.current === controller) { request.current = null; setChecking(false); }
        }
    }, [rows, proxyKey]);

    useEffect(() => {
        if (active) void checkConnections();
        else setChecking(false);
        return () => { request.current?.abort(); request.current = null; };
    }, [active, checkConnections]);

    const statusFor = (row: typeof rows[number]) => {
        if (!row.model || !row.channel) return { label: text("未选择模型", "No model selected"), detail: text("选择一个默认模型", "Choose a default model"), color: colors.warning };
        const issue = channelConfigIssue(row.channel);
        if (issue) {
            const labels = { "missing-url": text("缺少服务地址", "Service URL missing"), "invalid-url": text("服务地址无效", "Invalid service URL"), "missing-key": text("缺少 API Key", "API key missing"), "missing-models": text("未添加模型", "No models configured") };
            return { label: labels[issue], detail: text("补全该渠道配置", "Complete the channel configuration"), color: colors.warning };
        }
        const entry = checked[row.channel.id];
        const result = entry?.channel === row.channel && entry.proxyKey === proxyKey ? entry.result : undefined;
        if (!result) return { label: checking && entry ? text("检查中…", "Checking…") : text("尚未检查", "Not checked"), detail: text("已配置，连通性待确认", "Configured; connection not yet verified"), color: colors.muted };
        if (result.state === "reachable") {
            const listed = result.modelNames?.includes(row.model.name.replace(/^models\//, ""));
            return { label: text("接口已响应", "Endpoint responded"), detail: result.reason === "status" ? text("ComfyUI 在线；工作流尚未试运行", "ComfyUI online; workflow not tested") : listed ? text("列表中包含此模型；尚未试生成", "Model listed; generation not tested") : text("列表未包含此模型，请核对名称或权限", "Model not listed; verify name or access"), color: result.reason === "models" && !listed ? colors.warning : colors.good };
        }
        const labels = { timeout: text("检查超时", "Check timed out"), auth: text("鉴权失败", "Authentication failed"), http: `HTTP ${result.httpStatus}`, response: text("响应无法识别", "Unrecognized response"), network: text("无法确认连接", "Connection unconfirmed"), status: "", models: "" };
        return { label: labels[result.reason], detail: result.reason === "auth" ? text("检查 API Key 及服务权限", "Check your API key and service access") : text("检查服务、地址或浏览器跨域限制后重试", "Check service, URL or browser CORS settings"), color: result.state === "unreachable" ? colors.error : colors.warning };
    };
    const agentError = Boolean(connectError) || connected && conversation.status === "failed";
    const agentReady = connected && ["ready", "warning", "running"].includes(conversation.status);
    const agentWarning = connected && conversation.status === "warning";
    const agentLabel = agentError ? text("连接或初始化失败", "Connection or setup failed") : agentReady ? text(agentWarning ? "已连接 · 部分工具异常" : "已连接", agentWarning ? "Connected · some tools failed" : "Connected") : connected || enabled ? text("正在连接 / 初始化", "Connecting / initializing") : text("未连接", "Disconnected");
    const timestamps = rows.flatMap(({ channel }) => {
        const entry = channel && checked[channel.id];
        return entry?.channel === channel && entry?.proxyKey === proxyKey && entry.result ? [entry.result.checkedAt] : [];
    });

    return (
        <section aria-label={text("默认模型与连接状态", "Default models and connections")} className="config-section" style={{ color: theme.node.text }}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-1">
                    <h2 className="config-section-heading">{text("默认模型", "Default models")}</h2>
                    <InfoPopover label={text("模型与连接说明", "About models and connections")}>{text("选择常用模型，连接状态会自动检查。测试只读取状态和模型列表，不启动生成。", "Choose your models; connections are checked automatically. Tests only read status and model lists, without generating.")}{timestamps.length ? ` ${text("上次测试", "Last tested")} ${new Date(Math.max(...timestamps)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</InfoPopover>
                </div>
                <Button aria-label={text("测试全部连接", "Test all connections")} icon={<RefreshCw className="size-4" />} loading={checking} disabled={!rows.some(({ channel }) => channel && !channelConfigIssue(channel))} onClick={() => void checkConnections()}>{text("测试全部连接", "Test all connections")}</Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                {rows.map((row) => {
                    const status = statusFor(row);
                    const entry = row.channel && checked[row.channel.id];
                    const result = entry && entry.channel === row.channel && entry.proxyKey === proxyKey ? entry.result : undefined;
                    const issue = row.channel && channelConfigIssue(row.channel);
                    const missingModel = result?.reason === "models" && !result.modelNames?.includes(row.model?.name.replace(/^models\//, "") || "");
                    const edit = !row.model || !row.channel || Boolean(issue) || result?.reason === "auth" || missingModel;
                    const action = issue === "missing-key" || result?.reason === "auth" ? text("填写密钥", "Set API key") : issue === "missing-url" || issue === "invalid-url" ? text("设置地址", "Set URL") : !row.model || !row.channel || issue === "missing-models" ? text("添加模型", "Add models") : missingModel ? text("核对模型", "Review model") : result ? text("重新测试", "Test again") : text("测试连接", "Test connection");
                    const label = t(`config.channelEditor.capabilities.${row.capability}`);
                    const CapabilityIcon = capabilityIcons[row.capability];
                    const ActionIcon = issue === "missing-key" || result?.reason === "auth" ? KeyRound : !row.model || !row.channel ? Plus : edit ? Settings2 : RefreshCw;
                    return <div key={row.capability} data-capability={row.capability} className="min-w-0 rounded-xl p-4" style={{ background: theme.node.fill }}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <h3 className="flex items-center gap-2 text-sm font-semibold"><CapabilityIcon className="size-4" />{label}</h3>
                            {row.channel ? <IconAction label={text("编辑渠道", "Edit channel")} type="text" size="small" icon={<Pencil className="size-3.5" />} onClick={() => onEditChannel(row.channel!.id)} /> : null}
                        </div>
                        <ModelPicker config={config} value={config[`${row.capability}Model`]} onChange={(model) => updateConfig(`${row.capability}Model`, model)} capability={row.capability} fullWidth detailed ariaLabel={text(`默认${label}模型`, `Default ${row.capability} model`)} onMissingConfig={onAddChannel} />
                        <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1" title={result ? new Date(result.checkedAt).toLocaleString() : undefined}>
                                <div role="status" className="flex flex-wrap items-center gap-1.5"><span className="config-status-badge" style={{ color: status.color }}><span className="size-1.5 shrink-0 rounded-full bg-current" />{status.label}</span><InfoPopover label={text(`${label}连接详情`, `${label} connection details`)}>{status.detail}{result ? ` · ${new Date(result.checkedAt).toLocaleString()}` : ""}</InfoPopover></div>
                            </div>
                            <Button type="text" size="small" className="config-capability-action" aria-label={action} icon={<ActionIcon className="size-3.5" />} disabled={checking && !edit} loading={checking && Boolean(entry) && !result && !edit} onClick={() => edit ? row.channel ? onEditChannel(row.channel.id) : onAddChannel() : void checkConnections(row.channel)}>{action}</Button>
                        </div>
                    </div>;
                })}
            </div>
            <div data-capability="agent" className="mt-5 flex flex-wrap items-start justify-between gap-3 border-t pt-4" style={{ borderColor: theme.node.stroke }}>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Bot className="mt-0.5 size-4 shrink-0" style={{ color: theme.node.muted }} />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">Agent</span><span role="status" className="config-status-badge" style={{ color: agentError ? colors.error : agentWarning ? colors.warning : agentReady ? colors.good : colors.muted }}><span className="size-1.5 shrink-0 rounded-full bg-current" />{agentLabel}</span></div>
                        <div className="config-section-description mt-2 break-words">{agentError ? text("Agent 暂不可用。请打开连接设置，确认本地服务已启动、地址与连接密钥正确后重新连接。", "Agent is unavailable. Open connection settings, check the local service, URL and connection key, then reconnect.") : connected ? (agentModel || text("模型尚未选择", "No model selected")) : text("连接后可辅助整理项目、调用画布工具。", "Connect to organize projects and use canvas tools.")}</div>
                        {agentError && (connectError || conversation.error) ? <details className="config-section-description mt-2"><summary className="cursor-pointer">{text("技术详情", "Technical details")}</summary><pre className="mt-2 whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{connectError || conversation.error}</pre></details> : null}
                    </div>
                </div>
                <Button type="text" aria-label={agentError ? text("重新连接", "Reconnect") : text(connected ? "打开 Agent" : "连接 Agent", connected ? "Open Agent" : "Connect Agent")} icon={<ArrowUpRight className="size-3.5" />} onClick={onOpenAgent}>{agentError ? text("重新连接", "Reconnect") : text(connected ? "打开 Agent" : "连接 Agent", connected ? "Open Agent" : "Connect Agent")}</Button>
            </div>
        </section>
    );
}
