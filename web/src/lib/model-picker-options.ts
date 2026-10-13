import { decodeChannelModel, encodeChannelModel, modelOptionLabel, modelOptionName, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

export type ModelPickerOption = { value: string; values: string[]; label: string; detail: string; channel?: string };

const qwenPairs = [
    { label: "千问 2.1", name: "Qwen-Image 2.1", generation: "builtin:qwen-image21-t2i", edit: "builtin:qwen-image21-edit" },
    { label: "千问 2.1 Turbo", name: "Qwen-Image 2.1 Turbo", generation: "builtin:qwen-image21-turbo-t2i", edit: "builtin:qwen-image21-turbo-edit" },
];

/** Collapse only the untouched built-in pairs; renamed and custom entries remain individually selectable. */
export function modelPickerOptions(config: AiConfig, values: string[], capability?: ModelCapability): ModelPickerOption[] {
    const pairs = capability === "image" ? config.channels.flatMap((channel) => qwenPairs.flatMap((pair) => {
        const generation = channel.models.filter((model) => model.capability === "image" && model.workflowId?.trim() === pair.generation);
        const edit = channel.models.filter((model) => model.capability === "image" && model.workflowId?.trim() === pair.edit);
        if (generation.length !== 1 || edit.length !== 1 || generation[0].name !== `${pair.name} · 生图` || edit[0].name !== `${pair.name} · 编辑` || generation[0].script?.trim() || edit[0].script?.trim()) return [];
        const members = [encodeChannelModel(channel.id, generation[0].name), encodeChannelModel(channel.id, edit[0].name)];
        return members.every((value) => values.includes(value)) ? [{ values: members, label: pair.label }] : [];
    })) : [];
    const used = new Set<string>();
    const options = values.flatMap((value) => {
        if (used.has(value)) return [];
        const pair = pairs.find((item) => item.values.includes(value));
        const members = pair?.values || [value];
        members.forEach((member) => used.add(member));
        return [{ value: members[0], values: members, label: pair?.label || (capability === "image" ? modelOptionName(value) : modelOptionLabel(config, value)), detail: members.map((member) => modelOptionLabel(config, member)).join("\n") }];
    });
    if (capability !== "image") return options;
    return options.map((option) => {
        if (options.filter((item) => item.label === option.label).length < 2) return option;
        const channelId = decodeChannelModel(option.value)?.channelId;
        const channelName = config.channels.find((channel) => channel.id === channelId)?.name || channelId;
        const matchingChannels = options.filter((item) => item.label === option.label && config.channels.find((channel) => channel.id === decodeChannelModel(item.value)?.channelId)?.name === channelName);
        return { ...option, channel: matchingChannels.length > 1 ? `${channelName} · ${channelId}` : channelName };
    });
}
