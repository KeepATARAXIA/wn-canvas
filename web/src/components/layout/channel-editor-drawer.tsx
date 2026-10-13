import { Alert, App, Button, Drawer, Input, Segmented, Select, Space } from "antd";
import { ListPlus, PlugZap, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { testChannelConnection } from "@/services/api/channel";
import { channelRequiresApiKey, defaultBaseUrlForApiFormat, guessCapability, isLocalModelChannel, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ComfyWorkflowMapperModal } from "./comfy-workflow-mapper-modal";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [workflowTarget, setWorkflowTarget] = useState<ChannelModel | null>(null);
    const [testingConnection, setTestingConnection] = useState(false);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "Ark / Seedance", value: "ark" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const localChannel = isLocalModelChannel(draft);
    const apiKeyRequired = channelRequiresApiKey(draft);

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) =>
        setModels(draft.models.map((model) => (model.name === name ? { ...model, capability, workflowId: model.capability === capability ? model.workflowId : undefined } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const setWorkflow = (name: string, workflowId?: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, workflowId } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const testConnection = async () => {
        if (!draft.baseUrl.trim() || (apiKeyRequired && !draft.apiKey.trim())) {
            message.error(t("config.modelSelect.missingConfig"));
            return;
        }
        setTestingConnection(true);
        try {
            const result = await testChannelConnection(draft);
            message.success(result.modelCount === undefined ? t("config.channelEditor.connectionAvailable") : t("config.channelEditor.connectionAvailableWithModels", { count: result.modelCount }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.channelEditor.connectionFailed"));
        } finally {
            setTestingConnection(false);
        }
    };

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            {localChannel ? (
                <Alert
                    className="mb-4"
                    type="info"
                    showIcon
                    message={t("config.channelEditor.localNoticeTitle")}
                    description={t(draft.serviceType === "comfyui" ? "config.channelEditor.comfyCorsDescription" : "config.channelEditor.localNoticeDescription")}
                />
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">
                        API Key {!apiKeyRequired ? <span className="font-normal text-stone-500">{t("config.channelEditor.localKeyOptional")}</span> : null}
                    </span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder={apiKeyRequired ? "sk-..." : t("config.channelEditor.localKeyPlaceholder")} />
                </label>
            </div>
            <div className="mt-3 flex justify-end">
                <Button icon={<PlugZap className="size-4" />} loading={testingConnection} onClick={() => void testConnection()}>
                    {t("config.channelEditor.testConnection")}
                </Button>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                {draft.serviceType === "comfyui" && model.capability !== "text" ? (
                                    <Button size="small" type={model.workflowId ? "primary" : "default"} ghost={Boolean(model.workflowId)} onClick={() => setWorkflowTarget(model)}>
                                        {t(model.workflowId ? "config.channelEditor.workflowReady" : "config.channelEditor.workflow")}
                                    </Button>
                                ) : null}
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />

            {workflowTarget && workflowTarget.capability !== "text" ? (
                <ComfyWorkflowMapperModal
                    open
                    capability={workflowTarget.capability}
                    modelName={workflowTarget.name}
                    workflowId={workflowTarget.workflowId}
                    onSave={(workflowId) => setWorkflow(workflowTarget.name, workflowId)}
                    onClear={() => setWorkflow(workflowTarget.name, undefined)}
                    onClose={() => setWorkflowTarget(null)}
                />
            ) : null}
        </Drawer>
    );
}
