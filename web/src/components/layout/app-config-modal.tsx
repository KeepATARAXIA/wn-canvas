import { App, Button, Dropdown, Form, Input, Modal, Progress, Tooltip } from "antd";
import { Tabs as TabsPrimitive } from "radix-ui";
import type { TFunction } from "i18next";
import { Cloud, Download, Ellipsis, Pencil, Plus, RefreshCw, Trash2, Upload, Wifi, Palette, SlidersHorizontal, Server, HardDrive, Globe, Layers } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ConfigLocalProxy } from "@/components/layout/config-local-proxy";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import { ConfigCapabilityStatus } from "@/components/layout/config-capability-status";
import { ConfigModelSetup } from "@/components/layout/config-model-setup";
import { ConfigGenerationPreferences } from "@/components/layout/config-generation-preferences";
import { ConfigAppearanceTools } from "@/components/layout/config-appearance-tools";
import { InfoPopover } from "@/components/ui/compact-controls";
import { LOCAL_SERVICE_PRESETS, type LocalServicePreset } from "@/constant/local-service-presets";
import type { AppLocale } from "@/i18n";
import { modelSetupChannelDraft, type LocalSetupModel } from "@/lib/model-setup";
import { exportAppConfig, hasAppConfigImportBackup, importAppConfig, restoreAppConfigImportBackup } from "@/services/config-file";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { useAgentStore } from "@/stores/use-agent-store";
import { createModelChannel, isLocalModelChannel, isModelChannelReady, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

import "./app-config-modal.css";

type WebdavDomainProgress = {
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets"];
function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "status" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const configInputRef = useRef<HTMLInputElement>(null);
    const webdavFieldId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const channelsRef = useRef<HTMLElement>(null);
    const networkRef = useRef<HTMLDetailsElement>(null);
    const [networkOpen, setNetworkOpen] = useState(initialTab === "local-proxy");
    const [activeTab, setActiveTab] = useState<ConfigTabKey | "appearance">(panelTab(initialTab));
    const [editingChannelId, setEditingChannelId] = useState("");
    const [newChannel, setNewChannel] = useState<ModelChannel | null>(null);
    const [canRestoreImport, setCanRestoreImport] = useState(hasAppConfigImportBackup);
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const dialogOpen = useConfigStore((state) => showDoneButton ? state.isConfigOpen : undefined);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = newChannel || config.channels.find((channel) => channel.id === editingChannelId) || null;
    const locale = i18n.resolvedLanguage as AppLocale;
    const en = locale === "en-US";
    useEffect(() => {
        if (dialogOpen === false) return;
        setActiveTab(panelTab(initialTab));
        setNetworkOpen(initialTab === "local-proxy");
        const frame = requestAnimationFrame(() => {
            if (initialTab === "channels") channelsRef.current?.scrollIntoView({ block: "start" });
            if (initialTab === "local-proxy") networkRef.current?.scrollIntoView({ block: "start" });
        });
        return () => cancelAnimationFrame(frame);
    }, [initialTab, dialogOpen]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some(isModelChannelReady);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(t(shouldPromptContinue ? "config.savedContinue" : "config.saved"));
        clearPromptContinue();
    };

    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            setCanRestoreImport(true);
            message.success(t("config.imported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.importFailed"));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const restoreConfigImport = () => {
        if (restoreAppConfigImportBackup()) message.success(t("config.importRestored"));
        setCanRestoreImport(false);
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        const channel = createModelChannel({ name: t("config.channels.numberedName", { count: config.channels.length + 1 }) });
        setNewChannel(channel);
        setEditingChannelId(channel.id);
    };

    const addLocalChannel = (preset: LocalServicePreset) => {
        const existing = config.channels.find((channel) => channel.serviceType === preset.serviceType);
        if (existing) {
            setEditingChannelId(existing.id);
            return;
        }
        const channel = createModelChannel({
            name: t(preset.nameKey),
            baseUrl: preset.baseUrl,
            apiKey: preset.apiKey,
            apiFormat: preset.apiFormat,
            serviceType: preset.serviceType,
            models: preset.models.map((model) => ({ ...model })),
        });
        const unusedDefault = config.channels.length === 1 && !config.channels[0].models.length && !config.channels[0].apiKey.trim();
        setNewChannel(unusedDefault ? { ...channel, id: config.channels[0].id } : channel);
        setEditingChannelId(unusedDefault ? config.channels[0].id : channel.id);
    };

    const openModelSetupChannel = (kind: LocalSetupModel) => {
        const draft = modelSetupChannelDraft(config.channels, kind);
        setNewChannel(draft);
        setEditingChannelId(draft.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("config.channels.keepOne"));
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.some((item) => item.id === channel.id) ? config.channels.map((item) => (item.id === channel.id ? channel : item)) : [...config.channels, channel]);
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success(t("config.webdav.available"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.webdav.testFailed"));
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus(t("config.webdav.preparing"));
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(t("config.webdav.completed", { projects: result.projects, assets: result.assets, files: result.uploadedFiles, bytes: formatBytes(result.uploadedBytes) }));
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : t("config.webdav.failed"));
            message.error(error instanceof Error ? error.message : t("config.webdav.failed"));
        } finally {
            setSyncingWebdav(false);
        }
    };

    const tabs = [
                    {
                        key: "appearance",
                        icon: Palette,
                        label: en ? "Appearance & tools" : "外观与工具",
                        children: <ConfigAppearanceTools />,
                    },
                    {
                        key: "status",
                        icon: Server,
                        label: en ? "Models & services" : "模型与服务",
                        children: (
                            <div className="space-y-6">
                                <ConfigModelSetup onConfigureLocal={openModelSetupChannel} onConfigureCloud={addChannel} />
                                <ConfigCapabilityStatus
                                    active={dialogOpen !== false}
                                    onEditChannel={setEditingChannelId}
                                    onAddChannel={() => channelsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })}
                                    onOpenAgent={() => {
                                        setConfigDialogOpen(false);
                                        const agent = useAgentStore.getState();
                                        agent.setAgentState({ activeTab: agent.connected && !agent.connectError && agent.conversation.status !== "failed" ? "chat" : "setup" });
                                        agent.openPanel();
                                    }}
                                />
                                <section ref={channelsRef} aria-label={en ? "Channels" : "渠道管理"} className="config-section config-surface">
                                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1"><h2 className="config-section-heading">{en ? "Channels" : "渠道管理"}</h2><InfoPopover label={en ? "About channels" : "渠道说明"}>{t("config.channels.description")}</InfoPopover></div>
                                            <p className="config-section-description">{t("config.channels.description")}</p>
                                        </div>
                                        <Button icon={<Plus className="size-4" />} onClick={addChannel}>{t("config.channels.add")}</Button>
                                    </div>
                                    <details className="mb-5 border-b border-stone-200 pb-4 dark:border-stone-800">
                                        <summary className="cursor-pointer text-sm font-medium">{t("config.channels.localQuickTitle")}</summary>
                                        <p className="mt-2 text-sm text-slate-600 dark:text-stone-300">{t("config.channels.localQuickDescription")}</p>
                                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                            {LOCAL_SERVICE_PRESETS.map((preset) => (
                                                <button
                                                    key={preset.id}
                                                    type="button"
                                                    className="group rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-stone-800 dark:bg-stone-950/70 dark:hover:border-stone-400"
                                                    onClick={() => addLocalChannel(preset)}
                                                >
                                                    <div className="flex items-center justify-between gap-3" aria-label={`${t(preset.nameKey)} · ${t("config.channels.addPreset")}`}>
                                                        <span className="text-sm font-semibold">{t(preset.nameKey)}</span>
                                                        <Plus className="size-4 shrink-0 text-blue-700 dark:text-blue-300" />
                                                    </div>
                                                    <div className="mt-1 text-sm leading-5 text-slate-600 dark:text-stone-300">{t(preset.descriptionKey)}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </details>
                                    <div className="divide-y divide-stone-200 dark:divide-stone-700">
                                        {config.channels.map((channel) => (
                                            <div key={channel.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <div className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{channel.name || t("config.channels.unnamed")}</div>
                                                        <Tooltip title={t(isLocalModelChannel(channel) ? "config.channels.localTag" : "config.channels.apiTag")}><span className="shrink-0 text-muted-foreground" aria-label={t(isLocalModelChannel(channel) ? "config.channels.localTag" : "config.channels.apiTag")}>{isLocalModelChannel(channel) ? <HardDrive className="size-3.5" /> : <Globe className="size-3.5" />}</span></Tooltip>
                                                    </div>
                                                    <div className="mt-1 flex items-center gap-1 text-[13px] text-muted-foreground">
                                                        <Layers className="size-3.5" />{t("config.channels.modelCount", { count: channel.models.length })}<InfoPopover label={en ? `${channel.name} details` : `${channel.name}渠道详情`}>{apiFormatLabel(channel.apiFormat)} · {t("config.channels.modelCount", { count: channel.models.length })}<br />{channel.baseUrl || t("config.channels.missingUrl")}</InfoPopover>
                                                    </div>
                                                </div>
                                                <Dropdown trigger={["click"]} autoFocus menu={{ items: [
                                                    { key: "edit", label: t("common.edit"), icon: <Pencil className="size-4" />, onClick: () => setEditingChannelId(channel.id) },
                                                    { key: "delete", label: t("common.delete"), icon: <Trash2 className="size-4" />, danger: true, onClick: () => deleteChannel(channel.id) },
                                                ] }}>
                                                    <Button type="text" icon={<Ellipsis className="size-4" />} aria-label={`${en ? "Channel actions" : "渠道操作"} ${channel.name || t("config.channels.unnamed")}`}>{en ? "Manage" : "管理"}</Button>
                                                </Dropdown>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                                <details ref={networkRef} open={networkOpen} onToggle={(event) => setNetworkOpen(event.currentTarget.open)} className="config-section config-surface">
                                    <summary className="cursor-pointer text-sm font-medium">{en ? "Advanced network settings" : "高级网络设置"}</summary>
                                    <div className="mt-4"><ConfigLocalProxy /></div>
                                </details>
                            </div>
                        ),
                    },
                    {
                        key: "preferences",
                        icon: SlidersHorizontal,
                        label: en ? "Generation preferences" : "生成偏好",
                        children: <ConfigGenerationPreferences />,
                    },
                    {
                        key: "webdav",
                        icon: Cloud,
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="config-section config-surface">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="config-section-heading flex items-center gap-2">
                                                <Cloud className="size-4" />
                                                {t("config.webdav.title")}
                                                <InfoPopover label={t("config.webdav.title")}>{t("config.webdav.description")}</InfoPopover>
                                            </div>
                                        </div>
                                        <div className="text-xs text-slate-600 dark:text-stone-300">{webdav.lastSyncedAt ? t("config.webdav.lastSynced", { time: formatWebdavTime(webdav.lastSyncedAt, locale) }) : t("config.webdav.neverSynced")}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label={t("config.webdav.url")} htmlFor={`${webdavFieldId}-url`} className="mb-4">
                                            <Input id={`${webdavFieldId}-url`} value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={<span className="inline-flex items-center"><span id={`${webdavFieldId}-directory-label`}>{t("config.webdav.directory")}</span><InfoPopover label={`${t("config.webdav.directory")}${en ? " information" : "说明"}`}>{t("config.webdav.directoryDescription", { manifest: WEBDAV_MANIFEST_FILE_NAME })}</InfoPopover></span>} htmlFor={`${webdavFieldId}-directory`} className="mb-4">
                                            <Input id={`${webdavFieldId}-directory`} aria-labelledby={`${webdavFieldId}-directory-label`} value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.webdav.username")} htmlFor={`${webdavFieldId}-username`} className="mb-0">
                                            <Input id={`${webdavFieldId}-username`} value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label={t("config.webdav.password")} htmlFor={`${webdavFieldId}-password`} className="mb-0">
                                            <Input.Password id={`${webdavFieldId}-password`} value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>{t("config.webdav.test")}</Button>
                                        <Button type={showDoneButton ? "default" : "primary"} icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {t(syncingWebdav ? "config.webdav.syncing" : "config.webdav.syncNow")}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-slate-600 dark:text-stone-300">{syncStageLabel(webdavSyncStatus, t)}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} t={t} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "local-storage",
                        icon: HardDrive,
                        label: t("config.tabs.localStorage"),
                        children: <ConfigLocalStorage active={activeTab === "local-storage"} />,
                    },
                ];

    return (
        <div ref={panelRef} className={`app-config-panel${showDoneButton ? " app-config-panel-modal" : ""}`}>
            <TabsPrimitive.Root className="app-config-tabs" value={activeTab} onValueChange={(key) => {
                setActiveTab(key as ConfigTabKey | "appearance");
                panelRef.current?.querySelector(".app-config-scroll")?.scrollTo({ top: 0 });
            }}>
                <TabsPrimitive.List className="app-config-tab-list" aria-label={en ? "Configuration sections" : "配置分类"}>
                    {tabs.map((tab) => <Tooltip key={tab.key} title={tab.label} trigger={["hover", "focus"]}><TabsPrimitive.Trigger value={tab.key} aria-label={tab.label} className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-2 py-3 text-sm text-slate-600 outline-offset-2 transition-colors data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 dark:text-stone-300 dark:data-[state=active]:border-[#7593ff] dark:data-[state=active]:text-[#a9bdff]"><tab.icon className="size-4" /><span className="config-tab-label">{tab.label}</span></TabsPrimitive.Trigger></Tooltip>)}
                </TabsPrimitive.List>
                <div className="app-config-scroll">
                    {tabs.map((tab) => <TabsPrimitive.Content key={tab.key} value={tab.key} className="min-w-0 outline-offset-2">{tab.children}</TabsPrimitive.Content>)}
                </div>
            </TabsPrimitive.Root>
            <div className="app-config-footer flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3 dark:border-stone-700">
                <div className="min-w-0 text-xs leading-5 text-slate-600 dark:text-stone-300">
                    <div className="flex items-center gap-1">{en ? "Saved automatically" : "自动保存"}<InfoPopover label={en ? "Saving and configuration files" : "保存与配置文件说明"}>{en ? "Changes are saved automatically in this browser." : "修改自动保存到当前浏览器。"}<br />{t("config.fileSecurity")}</InfoPopover></div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Dropdown trigger={["click"]} autoFocus onOpenChange={(open) => { if (open) setCanRestoreImport(hasAppConfigImportBackup()); }} menu={{ items: [
                        { key: "import", label: t("config.import"), icon: <Upload className="size-4" />, onClick: () => configInputRef.current?.click() },
                        { key: "export", label: t("config.export"), icon: <Download className="size-4" />, onClick: exportAppConfig },
                        { key: "restore-import", label: t("config.restoreImport"), disabled: !canRestoreImport, onClick: restoreConfigImport },
                    ] }}>
                        <Button type="text" icon={<Ellipsis className="size-4" />}>{en ? "Configuration files" : "配置文件"}</Button>
                    </Dropdown>
                    {showDoneButton ? <Button type="primary" onClick={finishConfig}>{t("common.done")}</Button> : null}
                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                </div>
            </div>
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => { setEditingChannelId(""); setNewChannel(null); }} />
        </div>
    );
}

function panelTab(tab: ConfigTabKey): ConfigTabKey {
    return tab === "channels" || tab === "local-proxy" ? "status" : tab;
}

export function AppConfigModal() {
    const { t } = useTranslation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="flex items-center gap-1 text-lg font-semibold">{t("config.title")}<InfoPopover label={t("config.title")}>{t("config.modalDescription")}</InfoPopover></div>
                </div>
            }
            open={isConfigOpen}
            width={1000}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { height: "min(720px, calc(100dvh - 160px))", overflow: "hidden" } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        serviceType: channels[0]?.serviceType || config.serviceType,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return "Gemini";
    return "OpenAI";
}

function formatWebdavTime(value: string, locale: AppLocale) {
    return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress, t }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress>; t: TFunction }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{t(`config.webdav.domains.${domainTranslationKey(key)}`)}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {syncStageLabel(item.stage, t)}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function domainTranslationKey(domain: AppSyncDomainKey) {
    return domain;
}

function syncStageLabel(stage: string, t: TFunction) {
    if (stage === "等待本地数据加载") return t("config.webdav.stages.localWaiting");
    if (stage === "同步完成") return t("config.webdav.stages.syncComplete");
    if (stage === "等待同步") return t("config.webdav.stages.waiting");
    if (stage === "读取远端清单") return t("config.webdav.stages.remoteManifest");
    if (stage === "读取本地数据") return t("config.webdav.stages.localData");
    if (stage === "下载缺失媒体") return t("config.webdav.stages.downloadMedia");
    if (stage === "写入本地合并结果") return t("config.webdav.stages.writeMerge");
    if (stage === "上传新增媒体") return t("config.webdav.stages.uploadMedia");
    if (stage === "媒体已齐全") return t("config.webdav.stages.mediaReady");
    if (stage === "媒体无需上传") return t("config.webdav.stages.mediaSkipped");
    if (stage === "检查缺失媒体") return t("config.webdav.stages.checkMissingMedia");
    if (stage === "下载媒体") return t("config.webdav.stages.downloadMediaFile");
    if (stage === "检查本地媒体") return t("config.webdav.stages.checkLocalMedia");
    if (stage.startsWith("上传媒体 ")) return t("config.webdav.stages.uploadMediaFile", { size: stage.slice(5) });
    if (stage === "完成") return t("config.webdav.stages.complete");
    if (stage.startsWith("上传清单 ")) return t("config.webdav.stages.uploadManifest", { size: stage.slice(5) });
    return stage;
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
