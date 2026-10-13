import { buildApiUrl, channelRequiresApiKey, decodeChannelModel, withLocalProxy, type AiConfig, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { bearerAuthHeaders } from "@/services/api/auth-headers";

export type ChannelConfigIssue = "missing-url" | "invalid-url" | "missing-key" | "missing-models";
export type ChannelProbe = {
    state: "reachable" | "unreachable" | "unknown";
    reason: "status" | "models" | "network" | "timeout" | "auth" | "http" | "response";
    checkedAt: number;
    modelNames?: string[];
    httpStatus?: number;
};

export function channelConfigIssue(channel: ModelChannel): ChannelConfigIssue | undefined {
    if (!channel.baseUrl.trim()) return "missing-url";
    try {
        if (!["http:", "https:"].includes(new URL(channel.baseUrl.trim()).protocol)) return "invalid-url";
    } catch { return "invalid-url"; }
    if (channelRequiresApiKey(channel) && !channel.apiKey.trim()) return "missing-key";
    if (!channel.models.length) return "missing-models";
}

export function configuredCapability(config: AiConfig, capability: ModelCapability) {
    const value = config[`${capability}Model`];
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded
        ? config.channels.find((item) => item.id === decoded.channelId)
        : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name && item.capability === capability);
    return { channel, model, name };
}

// These are the same read-only endpoints used by channel connection testing.
// A response confirms only the endpoint; it does not prove model execution or GPU capacity.
export async function probeChannel(channel: ModelChannel, signal: AbortSignal, timeoutMs = 6000): Promise<ChannelProbe> {
    const base = channel.baseUrl.trim().replace(/\/+$/, "");
    const comfy = channel.serviceType === "comfyui";
    const gemini = !comfy && channel.apiFormat === "gemini";
    const geminiBase = /\/v1(?:beta)?$/i.test(base) ? base : `${base}/v1beta`;
    const url = comfy ? `${base}/system_stats` : gemini ? withLocalProxy(`${geminiBase}/models`) : buildApiUrl(base, "/models");
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const result = (state: ChannelProbe["state"], reason: ChannelProbe["reason"], extra: Partial<ChannelProbe> = {}): ChannelProbe => ({ state, reason, checkedAt: Date.now(), ...extra });
    try {
        const response = await fetch(url, {
            method: "GET", cache: "no-store", signal: controller.signal,
            headers: gemini ? { "x-goog-api-key": channel.apiKey } : bearerAuthHeaders(channel.apiKey),
        });
        if (!response.ok) return result("unreachable", response.status === 401 || response.status === 403 ? "auth" : "http", { httpStatus: response.status });
        let data;
        try { data = await response.json(); }
        catch (error) {
            if (controller.signal.aborted) throw error;
            return result("unknown", "response");
        }
        if (!data || typeof data !== "object" || data.error) return result("unknown", "response");
        if (comfy) return data.system && typeof data.system === "object" && Array.isArray(data.devices)
            ? result("reachable", "status") : result("unknown", "response");
        const models = gemini ? data.models : data.data;
        if (!Array.isArray(models)) return result("unknown", "response");
        const modelNames = models.flatMap((model: unknown) => {
            if (!model || typeof model !== "object") return [];
            const name = gemini ? (model as { name?: unknown }).name : (model as { id?: unknown }).id;
            return typeof name === "string" ? [name.replace(/^models\//, "")] : [];
        });
        return result("reachable", "models", { modelNames });
    } catch (error) {
        if (signal.aborted) throw signal.reason || error;
        return result(timedOut ? "unreachable" : "unknown", timedOut ? "timeout" : "network");
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
    }
}
