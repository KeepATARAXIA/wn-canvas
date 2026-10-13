import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import type { Asset } from "@/stores/use-asset-store";
import { getImageBlob, resolveImageUrl } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";

export function assetInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "image") return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
    return { kind: asset.kind, url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
}

export async function prepareAssetInsertPayload(asset: Asset): Promise<InsertAssetPayload> {
    if (asset.deletedAt) throw new Error("素材已移入回收站，请先恢复后再插入。");
    const payload = assetInsertPayload(asset);
    if (payload.kind === "text") return payload;
    if (payload.storageKey) {
        const blob = payload.kind === "image" ? await getImageBlob(payload.storageKey) : await getMediaBlob(payload.storageKey);
        if (!blob?.size) throw new Error("本地素材文件缺失，请先从备份恢复。");
        if (payload.kind === "image") return { ...payload, dataUrl: await resolveImageUrl(payload.storageKey) };
        return { ...payload, url: await resolveMediaUrl(payload.storageKey) };
    }
    if (!(payload.kind === "image" ? payload.dataUrl : payload.url)) throw new Error("素材没有可用的文件或链接。");
    return payload;
}
