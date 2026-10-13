import { useEffect, useId, useMemo, useState } from "react";
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { modelPickerOptions, type ModelPickerOption } from "@/lib/model-picker-options";
import { decodeChannelModel, modelOptionLabel, modelOptionName, normalizeModelOptionValue, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    detailed?: boolean;
    ariaLabel?: string;
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, detailed = false, ariaLabel, placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => modelPickerOptions(config, Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))), capability), [capability, config, value]);
    const current = value || "";
    const isImage = capability === "image";
    const selected = options.find((option) => option.values.includes(normalizeModelOptionValue(current, config.channels)));
    const currentLabel = isImage ? selected?.label || modelOptionName(current) : modelOptionName(current);
    const channelName = isImage ? selected?.channel : config.channels.find((channel) => channel.id === decodeChannelModel(current)?.channelId)?.name;
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={isImage ? selected?.value || current : current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    detailed && "h-auto min-h-14 items-center rounded-lg py-2 data-[size=default]:h-auto",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? selected?.detail || modelOptionLabel(config, current) : pickerPlaceholder}
                aria-label={ariaLabel}
            >
                <Cpu aria-hidden="true" className="size-4 shrink-0 opacity-70" />
                {detailed ? <span className="min-w-0 flex-1 whitespace-normal text-left leading-5 [overflow-wrap:anywhere]">
                    <span className="block font-medium">{current ? currentLabel : pickerPlaceholder}</span>
                    {channelName ? <span className="mt-0.5 block text-xs text-slate-600 dark:text-stone-300">{channelName}</span> : null}
                </span> : <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? isImage ? `${currentLabel}${selected?.channel ? ` · ${selected.channel}` : ""}` : fullWidth ? modelOptionLabel(config, current) : modelOptionName(current) : pickerPlaceholder}</span>}
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className={cn("z-[1200] max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl [&_[data-radix-select-viewport]]:min-w-0", isImage ? "w-80" : "w-96")}
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((option) => (
                        <SelectItem key={option.value} value={option.value} textValue={`${option.label}${option.channel ? ` ${option.channel}` : ""}`} title={option.detail} className="py-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1">
                            <ModelLabel option={option} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ option }: { option: ModelPickerOption }) {
    return (
        <span className="flex min-w-0 flex-1 items-start gap-2">
            <Cpu aria-hidden="true" className="size-4 shrink-0 opacity-70" />
            <span className="min-w-0 whitespace-normal text-left leading-5 [overflow-wrap:anywhere]">
                <span>{option.label}</span>
                {option.channel ? <span className="mt-0.5 block text-xs opacity-60">{option.channel}</span> : null}
            </span>
        </span>
    );
}
