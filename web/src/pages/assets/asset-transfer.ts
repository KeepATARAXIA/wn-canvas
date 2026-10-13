import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import type { Asset, AssetOrganization } from "@/stores/use-asset-store";
import { withLocalProxy } from "@/stores/use-config-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
    organization?: AssetOrganization;
};

export type ImportedAssets = Asset[] & { packageOrganization?: AssetOrganization };

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], filename: string, organization?: AssetOrganization) {
    const zip = await buildAssetArchive(assets, organization);
    saveAs(zip, filename.endsWith(".zip") ? filename : `${filename}.zip`);
}

export async function buildAssetArchive(assets: Asset[], organization?: AssetOrganization) {
    const exported = structuredClone(assets.filter((asset) => !asset.deletedAt));
    if (organization) {
        const folderIds = new Set(organization.folders.map((folder) => folder.id));
        for (const asset of exported) if (asset.folderId && !folderIds.has(asset.folderId)) asset.folderId = undefined;
    }
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const packed = new Map<string, AssetExportItem>();
    // Limit simultaneous media reads to one; large libraries should not download
    // every remote video at once while building the in-memory ZIP.
    for (const asset of exported) {
        if (asset.kind === "text") continue;
        let storageKey = asset.data.storageKey;
        const existing = storageKey ? packed.get(storageKey) : undefined;
        if (!existing) {
            const blob = storageKey
                ? asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey)
                : await downloadAssetFile(asset.kind === "image" ? asset.data.dataUrl : asset.data.url, asset.title);
            if (!blob?.size) throw new Error(`「${asset.title}」的本地素材文件缺失，未导出不完整备份。`);
            storageKey ||= `${asset.kind}:${nanoid()}`;
            const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type, asset.kind)}`;
            const file = { storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size };
            files.push(file);
            packed.set(storageKey, file);
            zipFiles.push({ name: path, data: blob });
        }
        const file = packed.get(storageKey!)!;
        asset.data = { ...asset.data, storageKey: file.storageKey, bytes: file.bytes, mimeType: file.mimeType };
    }

    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets: exported, files, ...(organization ? { organization: structuredClone(organization) } : {}) };
    return createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
}

export async function readAssetPackage(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("备份缺少 assets.json，未导入任何素材。");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    if (data?.app !== "infinite-canvas" || data.version !== 1 || !Array.isArray(data.assets) || !Array.isArray(data.files)) throw new Error("素材备份格式或版本不支持。");
    if (data.organization !== undefined) {
        if (!data.organization || typeof data.organization !== "object") throw new Error("素材备份的文件夹或标签无效。");
        const { folders, tags } = data.organization;
        if (!Array.isArray(folders) || folders.some((folder) => !folder || typeof folder.id !== "string" || !folder.id || typeof folder.name !== "string" || !folder.name.trim()) || new Set(folders.map((folder) => folder.id)).size !== folders.length || !Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) throw new Error("素材备份的文件夹或标签无效。");
    }
    const prepared = new Map<string, { storageKey: string; blob: Blob }>();
    for (const item of data.files) {
        if (!item || typeof item.storageKey !== "string" || !/^(image|video|audio|file):/.test(item.storageKey) || typeof item.path !== "string" || prepared.has(item.storageKey)) throw new Error("素材备份文件清单无效。");
        const blob = zip.get(item.path);
        if (!blob?.size || blob.size !== item.bytes) throw new Error(`备份素材缺失或大小不符：${item.path}。未导入任何素材。`);
        prepared.set(item.storageKey, { storageKey: `${item.storageKey.split(":")[0]}:${nanoid()}`, blob: blob.slice(0, blob.size, item.mimeType || "application/octet-stream") });
    }
    const assets = structuredClone(data.assets);
    for (const asset of assets) {
        if (!asset || !["text", "image", "video", "audio"].includes(asset.kind) || typeof asset.title !== "string" || !asset.data || typeof asset.data !== "object") throw new Error("素材备份包含无效记录。");
        if ([asset.coverUrl, asset.source, asset.note].some((value) => value !== undefined && typeof value !== "string")) throw new Error("素材备份的封面、来源或备注无效。");
        if (asset.tags !== undefined && (!Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== "string"))) throw new Error("素材备份的标签无效。");
        if ((asset.folderId !== undefined && typeof asset.folderId !== "string") || (asset.favorite !== undefined && typeof asset.favorite !== "boolean") || (asset.deletedAt !== undefined && (typeof asset.deletedAt !== "string" || !Number.isFinite(Date.parse(asset.deletedAt))))) throw new Error("素材备份的资产管理记录无效。");
        if (data.organization && asset.folderId && !data.organization.folders.some((folder) => folder.id === asset.folderId)) throw new Error("素材备份缺少资产所属文件夹。");
        if ([asset.createdAt, asset.updatedAt].some((value) => value !== undefined && (typeof value !== "string" || !Number.isFinite(new Date(value).getTime())))) throw new Error("素材备份的时间记录无效。");
        asset.coverUrl ||= "";
        asset.tags ||= [];
        if (asset.kind === "text") {
            if (typeof asset.data.content !== "string") throw new Error("备份中的文本内容无效。");
            continue;
        }
        if ([asset.data.width, asset.data.height, asset.data.bytes].some((value) => value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) || (asset.data.mimeType !== undefined && typeof asset.data.mimeType !== "string")) throw new Error("素材备份的文件信息无效。");
        if (asset.data.storageKey) {
            if (!prepared.has(asset.data.storageKey)) throw new Error(`「${asset.title}」缺少本地素材文件，未导入任何素材。`);
            if ((asset.kind === "image") !== asset.data.storageKey.startsWith("image:")) throw new Error("素材备份的文件类型与存储标识不符。");
        } else {
            // Complete legacy packages can contain inline media instead of files.
            const blob = await downloadAssetFile(asset.kind === "image" ? asset.data.dataUrl : asset.data.url, asset.title);
            const key = `${asset.kind}:${nanoid()}`;
            asset.data.storageKey = key;
            prepared.set(key, { storageKey: key, blob });
        }
    }
    // Nothing is written until every manifest entry and asset reference passed.
    const restored = new Map<string, { storageKey: string; url: string; blob: Blob }>();
    for (const [oldKey, { storageKey, blob }] of prepared) {
        const url = await (storageKey.startsWith("image:") ? setImageBlob(storageKey, blob) : setMediaBlob(storageKey, blob));
        restored.set(oldKey, { storageKey, url, blob });
    }
    for (const asset of assets) {
        if (asset.kind === "text") continue;
        const media = restored.get(asset.data.storageKey!)!;
        if (asset.kind === "image") {
            if (!asset.coverUrl || asset.coverUrl === asset.data.dataUrl || asset.coverUrl.startsWith("blob:")) asset.coverUrl = media.url;
            asset.data = { ...asset.data, dataUrl: media.url, storageKey: media.storageKey, bytes: media.blob.size, mimeType: media.blob.type };
        } else {
            if (asset.coverUrl.startsWith("blob:")) asset.coverUrl = "";
            asset.data = { ...asset.data, url: media.url, storageKey: media.storageKey, bytes: media.blob.size, mimeType: media.blob.type };
        }
    }
    const imported = assets.filter((asset) => !asset.deletedAt) as ImportedAssets;
    if (data.organization) Object.defineProperty(imported, "packageOrganization", { value: structuredClone(data.organization), enumerable: false });
    return imported;
}

async function downloadAssetFile(url: string, title: string) {
    if (typeof url !== "string" || !url || !/^(https?:|blob:|data:)/.test(url)) throw new Error(`「${title}」缺少可用的素材文件。`);
    let response: Response;
    try {
        response = await fetch(withLocalProxy(url), { signal: AbortSignal.timeout(60_000) });
    } catch {
        throw new Error(`「${title}」的素材链接无法下载，请检查连接后重试。`);
    }
    if (!response.ok) throw new Error(`「${title}」素材下载失败（HTTP ${response.status}）。`);
    const blob = await response.blob();
    if (!blob.size || /text\/html|application\/json/.test(blob.type)) throw new Error(`「${title}」的链接没有返回有效素材文件。`);
    return blob;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return kind === "image" ? "png" : "bin";
}
