import i18n from "@/i18n";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { downloadWebdavFile, uploadWebdavFile, webdavFileMatches, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import type { Asset, AssetDeletion, AssetFolder, AssetOrganizationSync } from "@/stores/use-asset-store";
import { useAssetStore } from "@/stores/use-asset-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";
import type { CanvasDeletedProject, CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export type AppSyncDomainKey = "canvas" | "assets";
type DomainKey = AppSyncDomainKey;
type CanvasDomainData = { projects: CanvasProject[]; deleted: CanvasDeletedProject[] };
type AssetDomainData = { assets: Asset[]; folders?: AssetFolder[]; tags?: string[]; organizationUpdatedAt?: string; deletedAssets?: AssetDeletion[]; excludedCanvasResources?: string[] };

type AppSyncFile = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

type DomainManifest<T> = {
    app: "infinite-canvas";
    version: 1;
    domain: DomainKey;
    exportedAt: string;
    data: T;
    files: AppSyncFile[];
};

type SyncDomainOptions<T> = {
    key: DomainKey;
    label: string;
    localData: () => Promise<T>;
    emptyData: T;
    mergeData: (local: T, remote: T) => T;
    assertUnchanged: (snapshot: T) => void;
    applyData: (data: T, snapshot: T) => Promise<T>;
};

type SyncDomainResult<T> = {
    data: T;
    mergedRemote: boolean;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncResult = {
    syncedAt: string;
    mergedRemote: boolean;
    projects: number;
    assets: number;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncProgressEvent = {
    domain?: AppSyncDomainKey;
    label?: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

export type AppSyncProgress = (event: AppSyncProgressEvent) => void;

const FILE_CONCURRENCY = 3;
const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):/;

export async function syncAppDataToWebdav(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {
    emitProgress(onProgress, { stage: "等待本地数据加载" });
    await Promise.all([waitForHydration(useCanvasStore), waitForHydration(useAssetStore)]);

    const [canvasResult, assetsResult] = await Promise.allSettled([
        syncDomain<CanvasDomainData>(config, onProgress, {
            key: "canvas",
            label: "画布",
            emptyData: { projects: [], deleted: [] },
            localData: async () => {
                const { projects, deletedProjects } = useCanvasStore.getState();
                return { projects, deleted: deletedProjects };
            },
            mergeData: mergeCanvasData,
            assertUnchanged: assertCanvasUnchanged,
            applyData: async (data, snapshot) => {
                // Compare and replace without an await: async generation may edit the canvas during downloads.
                assertCanvasUnchanged(snapshot);
                useCanvasStore.getState().replaceProjects(data.projects, data.deleted);
                return data;
            },
        }),
        syncDomain<AssetDomainData>(config, onProgress, {
            key: "assets",
            label: "我的资产",
            emptyData: { assets: [] },
            localData: async () => assetSnapshot(),
            mergeData: mergeAssetData,
            assertUnchanged: assertAssetsUnchanged,
            applyData: async (data, snapshot) => {
                const hydrated = { ...data, assets: await Promise.all(data.assets.map(hydrateAsset)) };
                assertAssetsUnchanged(snapshot);
                const organization: AssetOrganizationSync = { folders: hydrated.folders || [], tags: hydrated.tags || [], organizationUpdatedAt: hydrated.organizationUpdatedAt || "", deletedAssets: hydrated.deletedAssets || [], excludedCanvasResources: hydrated.excludedCanvasResources || [] };
                useAssetStore.getState().replaceAssets(hydrated.assets, organization);
                return assetSnapshot();
            },
        }),
    ]);

    // Finish both independent domains before the UI enables retry or changes its final status.
    if (canvasResult.status === "rejected" || assetsResult.status === "rejected") {
        const errors = [canvasResult, assetsResult].flatMap((item) => item.status === "rejected" ? [item.reason instanceof Error ? item.reason.message : i18n.t("config.webdav.errors.syncFailed")] : []);
        throw new Error(errors.join("\n"));
    }
    const canvas = canvasResult.value;
    const assets = assetsResult.value;
    const result = {
        syncedAt: new Date().toISOString(),
        mergedRemote: [canvas, assets].some((item) => item.mergedRemote),
        projects: canvas.data.projects.length,
        assets: assets.data.assets.filter((asset) => !asset.deletedAt).length,
        files: canvas.files + assets.files,
        manifestBytes: canvas.manifestBytes + assets.manifestBytes,
        uploadedFiles: canvas.uploadedFiles + assets.uploadedFiles,
        uploadedBytes: canvas.uploadedBytes + assets.uploadedBytes,
    };
    emitProgress(onProgress, { stage: "同步完成", status: "success" });
    return result;
}

async function syncDomain<T>(config: WebdavSyncConfig, onProgress: AppSyncProgress | undefined, options: SyncDomainOptions<T>): Promise<SyncDomainResult<T>> {
    try {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取远端清单", status: "active" });
        const remoteManifest = await readDomainManifest(config, options.key, options.emptyData);
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取本地数据", status: "active" });
        const localData = await options.localData();
        const mergedData = remoteManifest ? options.mergeData(localData, remoteManifest.data) : localData;
        let appliedSnapshot = localData;

        if (remoteManifest) {
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "下载缺失媒体", status: "active" });
            await downloadMissingFiles(config, options.key, mergedData, remoteManifest.files, onProgress);
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "写入本地合并结果", status: "active" });
            appliedSnapshot = await options.applyData(mergedData, localData);
        }

        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "上传新增媒体", status: "active" });
        options.assertUnchanged(appliedSnapshot);
        const uploaded = await uploadChangedFiles(config, options.key, mergedData, remoteManifest?.files || [], onProgress);
        const manifest: DomainManifest<T> = { app: "infinite-canvas", version: 1, domain: options.key, exportedAt: new Date().toISOString(), data: mergedData, files: uploaded.files };
        const manifestFile = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: `上传清单 ${formatBytes(manifestFile.size)}`, status: "active" });
        options.assertUnchanged(appliedSnapshot);
        await uploadWebdavFile(config, domainPath(options.key, WEBDAV_MANIFEST_FILE_NAME), manifestFile, "application/json");
        options.assertUnchanged(appliedSnapshot);
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "完成", current: 1, total: 1, status: "success" });

        return {
            data: mergedData,
            mergedRemote: Boolean(remoteManifest),
            files: uploaded.files.length,
            manifestBytes: manifestFile.size,
            uploadedFiles: uploaded.uploadedFiles,
            uploadedBytes: uploaded.uploadedBytes,
        };
    } catch (error) {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: error instanceof Error ? error.message : i18n.t("config.webdav.errors.syncFailed"), status: "exception" });
        throw error;
    }
}

function assertCanvasUnchanged(snapshot: CanvasDomainData) {
    const current = useCanvasStore.getState();
    if (current.projects !== snapshot.projects || current.deletedProjects !== snapshot.deleted) throw syncChangedError();
}

function assertAssetsUnchanged(snapshot: AssetDomainData) {
    const current = assetSnapshot();
    if ((Object.keys(current) as (keyof AssetDomainData)[]).some((key) => current[key] !== snapshot[key])) throw syncChangedError();
}

function assetSnapshot(): AssetDomainData {
    const { assets, folders, tags, organizationUpdatedAt, deletedAssets, excludedCanvasResources } = useAssetStore.getState();
    return { assets, folders, tags, organizationUpdatedAt, deletedAssets, excludedCanvasResources };
}

function syncChangedError() {
    return new Error("同步期间本地数据有新编辑，本次同步已停止。新编辑已保留，请完成编辑后再次同步。");
}

async function readDomainManifest<T>(config: WebdavSyncConfig, domain: DomainKey, emptyData: T): Promise<DomainManifest<T> | null> {
    const file = await downloadWebdavFile(config, domainPath(domain, WEBDAV_MANIFEST_FILE_NAME));
    if (!file) return null;
    const data = JSON.parse(await file.text()) as DomainManifest<T>;
    if (data.app !== "infinite-canvas" || data.domain !== domain) throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    if (domain === "assets" && data.data) validateAssetSyncData(data.data as unknown as AssetDomainData);
    return {
        app: "infinite-canvas",
        version: 1,
        domain,
        exportedAt: data.exportedAt || new Date().toISOString(),
        data: data.data || emptyData,
        files: Array.isArray(data.files) ? data.files : [],
    };
}

async function downloadMissingFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const tasks: AppSyncFile[] = [];
    const missing: string[] = [];
    const storageKeys = collectStorageKeys(domain === "assets" ? (data as AssetDomainData).assets : data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const localBlob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        scanned += 1;
        if (localBlob?.size) {
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const remoteFile = remoteFileMap.get(storageKey);
        if (remoteFile) tasks.push(remoteFile);
        else missing.push(storageKey);
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
    }
    if (!tasks.length) {
        if (missing.length) throw missingMediaError(domain, data, missing);
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体已齐全", current: 1, total: 1, status: "active" });
        return;
    }
    let downloaded = 0;
    await runWithConcurrency(tasks, FILE_CONCURRENCY, async (remoteFile) => {
        const blob = await downloadWebdavFile(config, remoteFile.path);
        if (!blob?.size || blob.size !== remoteFile.bytes) {
            missing.push(remoteFile.storageKey);
            return;
        }
        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, remoteFile.mimeType);
        await (remoteFile.storageKey.startsWith("image:") ? setImageBlob(remoteFile.storageKey, typedBlob) : setMediaBlob(remoteFile.storageKey, typedBlob));
        downloaded += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "下载媒体", current: downloaded, total: tasks.length, status: "active" });
    });
    if (missing.length) throw missingMediaError(domain, data, missing);
}

async function uploadChangedFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const files: AppSyncFile[] = [];
    const tasks: Array<{ item: AppSyncFile; blob: Blob }> = [];
    const missing: string[] = [];
    let uploadedFiles = 0;
    let uploadedBytes = 0;

    const storageKeys = collectStorageKeys(domain === "assets" ? (data as AssetDomainData).assets : data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        const remoteFile = remoteFileMap.get(storageKey);
        if (!blob?.size) {
            missing.push(storageKey);
            scanned += 1;
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const item: AppSyncFile = {
            storageKey,
            path: remoteFile?.path || domainPath(domain, `files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`),
            mimeType: blob.type || remoteFile?.mimeType || "application/octet-stream",
            bytes: blob.size,
        };
        files.push(item);
        // A manifest entry can outlive its media file; repair it from the local copy.
        if (!remoteFile || remoteFile.bytes !== blob.size || !await webdavFileMatches(config, remoteFile.path, blob.size)) tasks.push({ item, blob });
        scanned += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
    }

    if (missing.length) throw missingMediaError(domain, data, missing);
    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体无需上传", current: 1, total: 1, status: "active" });
        return { files, uploadedFiles, uploadedBytes };
    }

    await runWithConcurrency(tasks, FILE_CONCURRENCY, async ({ item, blob }) => {
        await uploadWebdavFile(config, item.path, blob, item.mimeType);
        uploadedFiles += 1;
        uploadedBytes += blob.size;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: `上传媒体 ${formatBytes(blob.size)}`, current: uploadedFiles, total: tasks.length, status: "active" });
    });

    return { files, uploadedFiles, uploadedBytes };
}

function missingMediaError<T>(domain: DomainKey, data: T, keys: string[]) {
    const records = domain === "canvas" ? (data as CanvasDomainData).projects : (data as AssetDomainData).assets;
    const details = keys.map((key) => {
        const owners = records.filter((record) => collectStorageKeys(record).includes(key));
        const names = owners.map((record) => record.title || record.id);
        return `${names.join("、") || domainLabel(domain)}：${key}`;
    });
    return new Error(`${domainLabel(domain)}同步未完成：${keys.length} 项媒体缺失或不完整（${details.join("；")}）。请恢复素材后重试。`);
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
    }
    if ((asset.kind === "video" || asset.kind === "audio") && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, url } };
    }
    return asset;
}

function mergeCanvasData(local: CanvasDomainData, remote: CanvasDomainData): CanvasDomainData {
    const localDeleted = local.deleted || [];
    const remoteDeleted = remote.deleted || [];
    const deletedAtById = new Map<string, string>();
    for (const item of [...remoteDeleted, ...localDeleted]) {
        if (!item.id || !item.deletedAt) continue;
        const current = deletedAtById.get(item.id);
        if (!current || item.deletedAt >= current) deletedAtById.set(item.id, item.deletedAt);
    }

    const projects = mergeById(local.projects || [], remote.projects || [], "updatedAt").filter((project) => {
        const deletedAt = deletedAtById.get(project.id);
        if (!deletedAt) return true;
        if (getTime(project as Record<string, unknown>, "updatedAt") > Date.parse(deletedAt)) {
            deletedAtById.delete(project.id);
            return true;
        }
        return false;
    });

    return {
        projects,
        deleted: [...deletedAtById.entries()].map(([id, deletedAt]) => ({ id, deletedAt })),
    };
}

function validateAssetSyncData(data: AssetDomainData) {
    const invalidFolders = data.folders !== undefined && (!Array.isArray(data.folders) || data.folders.some((folder) => !folder || typeof folder.id !== "string" || !folder.id || typeof folder.name !== "string" || !folder.name.trim()) || new Set(data.folders.map((folder) => folder.id)).size !== data.folders.length);
    const invalidTags = data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string"));
    const invalidDeleted = data.deletedAssets !== undefined && (!Array.isArray(data.deletedAssets) || data.deletedAssets.some((item) => !item || typeof item.id !== "string" || typeof item.deletedAt !== "string" || !Number.isFinite(Date.parse(item.deletedAt))));
    const invalidExclusions = data.excludedCanvasResources !== undefined && (!Array.isArray(data.excludedCanvasResources) || data.excludedCanvasResources.some((key) => typeof key !== "string"));
    if (Array.isArray(data.assets) && data.assets.some((asset) => asset?.tags !== undefined && (!Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== "string")))) throw new Error("远端资产管理记录无效，本地数据已保留。");
    if (!Array.isArray(data.assets) || data.assets.some((asset) => !asset || (asset.folderId !== undefined && typeof asset.folderId !== "string") || (asset.favorite !== undefined && typeof asset.favorite !== "boolean") || (asset.deletedAt !== undefined && (typeof asset.deletedAt !== "string" || !Number.isFinite(Date.parse(asset.deletedAt))))) || invalidFolders || invalidTags || invalidDeleted || invalidExclusions || (data.organizationUpdatedAt !== undefined && (typeof data.organizationUpdatedAt !== "string" || (data.organizationUpdatedAt !== "" && !Number.isFinite(Date.parse(data.organizationUpdatedAt)))))) throw new Error("远端资产管理记录无效，本地数据已保留。");
}

function mergeAssetData(local: AssetDomainData, remote: AssetDomainData): AssetDomainData {
    const deletedById = new Map<string, string>();
    for (const item of [...(remote.deletedAssets || []), ...(local.deletedAssets || [])]) {
        if (!deletedById.has(item.id) || item.deletedAt >= deletedById.get(item.id)!) deletedById.set(item.id, item.deletedAt);
    }
    const assets = mergeById(local.assets, remote.assets, "updatedAt").filter((asset) => {
        const deletedAt = deletedById.get(asset.id);
        if (!deletedAt) return true;
        if (getTime(asset as unknown as Record<string, unknown>, "updatedAt") > Date.parse(deletedAt)) { deletedById.delete(asset.id); return true; }
        return false;
    });
    // Folder/tag names form one registry snapshot; the latest explicit organization edit wins.
    const organization = (Date.parse(local.organizationUpdatedAt || "") || 0) >= (Date.parse(remote.organizationUpdatedAt || "") || 0) ? local : remote;
    const folders = organization.folders || [];
    const folderIds = new Set(folders.map((folder) => folder.id));
    return {
        assets: assets.map((asset) => asset.folderId && !folderIds.has(asset.folderId) ? { ...asset, folderId: undefined } : asset),
        folders,
        tags: [...new Set([...(organization.tags || []), ...assets.flatMap((asset) => asset.tags || [])])],
        organizationUpdatedAt: organization.organizationUpdatedAt || "",
        deletedAssets: [...deletedById].map(([id, deletedAt]) => ({ id, deletedAt })),
        excludedCanvasResources: [...new Set([...(local.excludedCanvasResources || []), ...(remote.excludedCanvasResources || [])])],
    };
}

function mergeById<T extends { id?: string }>(local: T[], remote: T[], timeKey: string) {
    const items = new Map<string, T>();
    remote.forEach((item) => {
        const id = item.id || "";
        if (id) items.set(id, item);
    });
    local.forEach((item) => {
        const id = item.id || "";
        if (!id) return;
        const current = items.get(id);
        if (!current || getTime(item as Record<string, unknown>, timeKey) >= getTime(current as Record<string, unknown>, timeKey)) items.set(id, item);
    });
    return Array.from(items.values()).sort((a, b) => getTime(b as Record<string, unknown>, timeKey) - getTime(a as Record<string, unknown>, timeKey));
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (storageKeyPattern.test(value)) keys.add(value);
        return [...keys];
    }
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && storageKeyPattern.test(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function domainPath(domain: DomainKey, path: string) {
    return `${domain}/${path}`;
}

function domainLabel(domain: DomainKey) {
    if (domain === "canvas") return "画布";
    return "我的资产";
}

function emitProgress(onProgress: AppSyncProgress | undefined, event: AppSyncProgressEvent) {
    onProgress?.(event);
}

function getTime(item: Record<string, unknown>, key: string) {
    const value = item[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") return Date.parse(value) || 0;
    return 0;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return storageKey.startsWith("image:") ? "png" : "bin";
}

function waitForHydration<T extends { hydrated: boolean }>(store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void }) {
    if (store.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                results[index] = await worker(items[index], index);
            }
        }),
    );
    return results;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
