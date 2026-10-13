import { Alert, App, Button, Empty, Input, Modal, Select, Spin } from "antd";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getComfyWorkflowPreset, parseComfyWorkflow, saveComfyWorkflowPreset } from "@/services/comfy-workflow-storage";
import type { ComfyInputBinding, ComfyWorkflow, ComfyWorkflowMapping } from "@/types/comfy-workflow";

type WorkflowCapability = "image" | "video" | "audio";

const emptyMapping = (): ComfyWorkflowMapping => ({ imageSlots: [], videoSlots: [], audioSlots: [], outputNodeId: "" });

export function ComfyWorkflowMapperModal({
    open,
    capability,
    modelName,
    workflowId,
    onSave,
    onClear,
    onClose,
}: {
    open: boolean;
    capability: WorkflowCapability;
    modelName: string;
    workflowId?: string;
    onSave: (workflowId: string) => void;
    onClear: () => void;
    onClose: () => void;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [workflow, setWorkflow] = useState<ComfyWorkflow | null>(null);
    const [mapping, setMapping] = useState<ComfyWorkflowMapping>(emptyMapping);
    const [name, setName] = useState(modelName || t("config.workflowMapper.untitled"));
    const [sourceFileName, setSourceFileName] = useState("");

    useEffect(() => {
        if (!open) return;
        let active = true;
        setName(modelName || t("config.workflowMapper.untitled"));
        setWorkflow(null);
        setMapping(emptyMapping());
        setSourceFileName("");
        if (!workflowId) return () => void (active = false);
        setLoading(true);
        void getComfyWorkflowPreset(workflowId)
            .then((preset) => {
                if (!active || !preset) return;
                setName(preset.name);
                setWorkflow(preset.workflow);
                setMapping(preset.mapping);
                setSourceFileName(preset.sourceFileName || "");
            })
            .finally(() => active && setLoading(false));
        return () => void (active = false);
    }, [modelName, open, t, workflowId]);

    const bindingOptions = useMemo(() => buildBindingOptions(workflow), [workflow]);
    const nodeOptions = useMemo(() => buildNodeOptions(workflow), [workflow]);

    const importWorkflow = async (file: File) => {
        try {
            const parsed = parseComfyWorkflow(JSON.parse(await file.text()));
            setWorkflow(parsed);
            setSourceFileName(file.name);
            setName(modelName || file.name.replace(/\.json$/i, ""));
            setMapping(guessMapping(parsed, capability));
            message.success(t("config.workflowMapper.imported", { count: Object.keys(parsed).length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.workflowMapper.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const save = async () => {
        if (!workflow) return message.error(t("config.workflowMapper.importFirst"));
        if (!mapping.prompt) return message.error(t("config.workflowMapper.promptRequired"));
        if (!mapping.outputNodeId) return message.error(t("config.workflowMapper.outputRequired"));
        const normalizedMapping = {
            ...mapping,
            imageSlots: mapping.imageSlots.filter((binding) => binding.nodeId && binding.inputName),
            videoSlots: mapping.videoSlots.filter((binding) => binding.nodeId && binding.inputName),
            audioSlots: mapping.audioSlots.filter((binding) => binding.nodeId && binding.inputName),
        };
        setSaving(true);
        try {
            const preset = await saveComfyWorkflowPreset({ id: workflowId, name: name.trim() || modelName || t("config.workflowMapper.untitled"), capability, workflow, mapping: normalizedMapping, sourceFileName: sourceFileName || undefined });
            onSave(preset.id);
            message.success(t("config.workflowMapper.saved"));
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.workflowMapper.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={open}
            width={920}
            centered
            title={t("config.workflowMapper.title", { model: modelName })}
            onCancel={onClose}
            footer={
                <div className="flex items-center justify-between gap-3">
                    <Button
                        danger
                        disabled={!workflowId}
                        onClick={() => {
                            onClear();
                            onClose();
                        }}
                    >
                        {t("config.workflowMapper.clear")}
                    </Button>
                    <div className="flex gap-2">
                        <Button onClick={onClose}>{t("common.cancel")}</Button>
                        <Button type="primary" loading={saving} onClick={() => void save()}>
                            {t("common.save")}
                        </Button>
                    </div>
                </div>
            }
        >
            <Spin spinning={loading}>
                <div className="space-y-4">
                    <Alert type="info" showIcon message={t("config.workflowMapper.noticeTitle")} description={t("config.workflowMapper.noticeDescription")} />
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <Button icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {workflow ? t("config.workflowMapper.replaceFile") : t("config.workflowMapper.importFile")}
                        </Button>
                        <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void importWorkflow(event.target.files[0])} />
                        <div className="min-w-0 flex-1 text-xs text-stone-500">
                            {workflow ? t("config.workflowMapper.fileSummary", { file: sourceFileName || t("config.workflowMapper.importedFile"), count: Object.keys(workflow).length }) : t("config.workflowMapper.fileHint")}
                        </div>
                    </div>

                    {!workflow ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("config.workflowMapper.empty")} />
                    ) : (
                        <>
                            <label className="block">
                                <span className="mb-1 block text-sm font-medium">{t("config.workflowMapper.name")}</span>
                                <Input value={name} onChange={(event) => setName(event.target.value)} />
                            </label>
                            <div className="grid gap-4 md:grid-cols-2">
                                <BindingField label={t("config.workflowMapper.prompt")} value={mapping.prompt} options={bindingOptions} required onChange={(prompt) => setMapping((current) => ({ ...current, prompt }))} />
                                <BindingField label={t("config.workflowMapper.duration")} value={mapping.duration} options={bindingOptions} onChange={(duration) => setMapping((current) => ({ ...current, duration }))} />
                                <BindingField label={t("config.workflowMapper.ratio")} value={mapping.ratio} options={bindingOptions} onChange={(ratio) => setMapping((current) => ({ ...current, ratio }))} />
                                <BindingField label={t("config.workflowMapper.resolution")} value={mapping.resolution} options={bindingOptions} onChange={(resolution) => setMapping((current) => ({ ...current, resolution }))} />
                                <BindingField label={t("config.workflowMapper.seed")} value={mapping.seed} options={bindingOptions} onChange={(seed) => setMapping((current) => ({ ...current, seed }))} />
                            </div>

                            <div className="grid gap-4 md:grid-cols-3">
                                <SlotEditor title={t("config.workflowMapper.imageSlots")} values={mapping.imageSlots} options={bindingOptions} onChange={(imageSlots) => setMapping((current) => ({ ...current, imageSlots }))} />
                                <SlotEditor title={t("config.workflowMapper.videoSlots")} values={mapping.videoSlots} options={bindingOptions} onChange={(videoSlots) => setMapping((current) => ({ ...current, videoSlots }))} />
                                <SlotEditor title={t("config.workflowMapper.audioSlots")} values={mapping.audioSlots} options={bindingOptions} onChange={(audioSlots) => setMapping((current) => ({ ...current, audioSlots }))} />
                            </div>

                            <label className="block">
                                <span className="mb-1 block text-sm font-medium">{t("config.workflowMapper.outputNode")} *</span>
                                <Select className="w-full" showSearch optionFilterProp="label" value={mapping.outputNodeId || undefined} options={nodeOptions} placeholder={t("config.workflowMapper.selectNode")} onChange={(outputNodeId) => setMapping((current) => ({ ...current, outputNodeId }))} />
                            </label>
                        </>
                    )}
                </div>
            </Spin>
        </Modal>
    );
}

function BindingField({ label, value, options, required = false, onChange }: { label: string; value?: ComfyInputBinding; options: Array<{ label: string; value: string }>; required?: boolean; onChange: (binding?: ComfyInputBinding) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-sm font-medium">
                {label} {required ? "*" : ""}
            </span>
            <Select className="w-full" allowClear showSearch optionFilterProp="label" value={value ? encodeBinding(value) : undefined} options={options} onChange={(next) => onChange(next ? decodeBinding(next) : undefined)} />
        </label>
    );
}

function SlotEditor({ title, values, options, onChange }: { title: string; values: ComfyInputBinding[]; options: Array<{ label: string; value: string }>; onChange: (values: ComfyInputBinding[]) => void }) {
    const { t } = useTranslation();
    return (
        <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{title}</span>
                <Button type="text" size="small" icon={<Plus className="size-3.5" />} onClick={() => onChange([...values, { nodeId: "", inputName: "" }])}>
                    {t("common.add")}
                </Button>
            </div>
            <div className="space-y-2">
                {values.map((binding, index) => (
                    <div key={`${index}-${binding.nodeId}-${binding.inputName}`} className="flex items-center gap-1">
                        <span className="w-5 shrink-0 text-xs text-stone-400">{index + 1}</span>
                        <Select
                            className="min-w-0 flex-1"
                            size="small"
                            showSearch
                            optionFilterProp="label"
                            value={binding.nodeId ? encodeBinding(binding) : undefined}
                            options={options}
                            onChange={(next) => onChange(values.map((item, itemIndex) => (itemIndex === index ? decodeBinding(next) : item)))}
                        />
                        <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))} />
                    </div>
                ))}
                {!values.length ? <div className="py-2 text-center text-xs text-stone-400">{t("config.workflowMapper.noSlots")}</div> : null}
            </div>
        </div>
    );
}

function buildBindingOptions(workflow: ComfyWorkflow | null) {
    if (!workflow) return [];
    return Object.entries(workflow).flatMap(([nodeId, node]) =>
        Object.keys(node.inputs).map((inputName) => ({ value: encodeBinding({ nodeId, inputName }), label: `${nodeId} · ${node._meta?.title || node.class_type || "Node"} · ${inputName}` })),
    );
}

function buildNodeOptions(workflow: ComfyWorkflow | null) {
    if (!workflow) return [];
    return Object.entries(workflow).map(([nodeId, node]) => ({ value: nodeId, label: `${nodeId} · ${node._meta?.title || node.class_type || "Node"}` }));
}

function guessMapping(workflow: ComfyWorkflow, capability: WorkflowCapability): ComfyWorkflowMapping {
    const bindings = Object.entries(workflow).flatMap(([nodeId, node]) => Object.keys(node.inputs).map((inputName) => ({ nodeId, inputName, node })));
    const find = (pattern: RegExp) => bindings.find((item) => pattern.test(`${item.inputName} ${item.node.class_type || ""} ${item.node._meta?.title || ""}`));
    const slots = (kind: "image" | "video" | "audio") =>
        bindings
            .filter((item) => {
                if (typeof item.node.inputs[item.inputName] !== "string") return false;
                const nodeLabel = `${item.node.class_type || ""} ${item.node._meta?.title || ""}`;
                return new RegExp(`load.*${kind}`, "i").test(nodeLabel) || new RegExp(`(^|[_\\s])${kind}($|[_\\s])`, "i").test(item.inputName);
            })
            .map(({ nodeId, inputName }) => ({ nodeId, inputName }));
    const output = Object.entries(workflow)
        .reverse()
        .find(([, node]) => /save|preview|combine|output/i.test(`${node.class_type || ""} ${node._meta?.title || ""}`));
    const clean = (binding?: (typeof bindings)[number]) => (binding ? { nodeId: binding.nodeId, inputName: binding.inputName } : undefined);
    const workflowNodeIds = Object.keys(workflow);
    return {
        prompt: clean(find(/(^|[_\s])(prompt|text|positive)($|[_\s])/i)),
        duration: clean(find(/(^|[_\s])(duration|seconds|length)($|[_\s])/i)),
        ratio: clean(find(/aspect[_\s-]*ratio|(^|[_\s])ratio($|[_\s])/i)),
        resolution: clean(find(/megapixels?|resolution|(^|[_\s])pixels?($|[_\s])/i)),
        seed: clean(find(/seed/i)),
        imageSlots: slots("image"),
        videoSlots: slots("video"),
        audioSlots: slots("audio"),
        outputNodeId: output?.[0] || (capability === "image" ? workflowNodeIds[workflowNodeIds.length - 1] || "" : ""),
    };
}

function encodeBinding(binding: ComfyInputBinding) {
    return `${binding.nodeId}\u0000${binding.inputName}`;
}

function decodeBinding(value: string): ComfyInputBinding {
    const [nodeId, inputName] = value.split("\u0000");
    return { nodeId, inputName };
}
