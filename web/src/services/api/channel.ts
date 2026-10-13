import i18n from "@/i18n";
import { probeChannel } from "@/lib/config-capability-status";
import type { ModelChannel } from "@/stores/use-config-store";
import { fetchChannelModels } from "./image";

export type ChannelConnectionResult = { modelCount?: number };

export async function testChannelConnection(channel: ModelChannel): Promise<ChannelConnectionResult> {
    if (channel.serviceType === "comfyui") {
        const result = await probeChannel(channel, new AbortController().signal);
        if (result.state !== "reachable") {
            const keys = { response: "connectionResponse", auth: "connectionAuth", timeout: "connectionTimeout", network: "connectionNetwork", http: "connectionHttp", status: "connectionFailed", models: "connectionFailed" };
            throw new Error(i18n.t(`config.channelEditor.${keys[result.reason]}`, { status: result.httpStatus }));
        }
        return {};
    }
    const models = await fetchChannelModels(channel);
    return { modelCount: models.length };
}
