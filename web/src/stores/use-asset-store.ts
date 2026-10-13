import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage, reportStateReadError } from "@/lib/localforage-storage";
import { cleanupUnusedImages, ensureImagePreview, previewUrlFor, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { assetResourceKey, type AssetDraft } from "@/lib/canvas/canvas-assets";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: VideoAsset["data"] };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;
export type AssetFolder = { id: string; name: string };
export type AssetOrganization = { folders: AssetFolder[]; tags: string[] };
export type AssetDeletion = { id: string; deletedAt: string };
export type AssetOrganizationSync = AssetOrganization & { organizationUpdatedAt: string; deletedAssets: AssetDeletion[]; excludedCanvasResources: string[] };

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    folderId?: string;
    favorite?: boolean;
    deletedAt?: string;
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    folders: AssetFolder[];
    tags: string[];
    organizationUpdatedAt: string;
    deletedAssets: AssetDeletion[];
    excludedCanvasResources: string[];
    syncCanvasAssets: (assets: AssetDraft[]) => void;
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    updateAssets: (ids: string[], patch: { title?: string; folderId?: string | null; tags?: string[]; tagMode?: "replace" | "add" | "remove"; favorite?: boolean }) => void;
    addFolder: (name: string) => AssetFolder | null;
    renameFolder: (id: string, name: string) => void;
    removeFolder: (id: string) => void;
    addTag: (name: string) => void;
    renameTag: (name: string, nextName: string) => void;
    removeTag: (name: string) => void;
    trashAssets: (ids: string[]) => void;
    restoreAssets: (ids: string[]) => void;
    importAssets: (assets: Asset[], organization?: AssetOrganization) => number;
    removeAsset: (id: string) => void;
    removeAssets: (ids: string[]) => void;
    replaceAssets: (assets: Asset[], organization?: AssetOrganizationSync) => void;
    cleanupImages: (extra?: unknown) => void;
};

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
type PersistedAssetState = Pick<AssetStore, "assets" | "folders" | "tags" | "organizationUpdatedAt" | "deletedAssets" | "excludedCanvasResources">;
let queuedPersistState: PersistedAssetState | null = null;

const uniqueTags = (tags: string[]) => [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
const registeredTags = (tags: string[], assets: Asset[]) => uniqueTags([...tags, ...assets.flatMap((asset) => asset.tags || [])]);
const organizationTime = (previous: string) => new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
const assetChangeTime = (records: { updatedAt?: string; deletedAt?: string }[]) => new Date(records.reduce((time, record) => Math.max(time, (Date.parse(record.updatedAt || "") || 0) + 1, (Date.parse(record.deletedAt || "") || 0) + 1), Date.now())).toISOString();

function validateOrganization(state: Partial<PersistedAssetState>) {
    if (state.folders !== undefined && (!Array.isArray(state.folders) || state.folders.some((folder) => !folder || typeof folder.id !== "string" || !folder.id || typeof folder.name !== "string" || !folder.name.trim()) || new Set(state.folders.map((folder) => folder.id)).size !== state.folders.length)) throw new Error("资产文件夹记录无效，已保留原数据。");
    if (state.tags !== undefined && (!Array.isArray(state.tags) || state.tags.some((tag) => typeof tag !== "string"))) throw new Error("资产标签记录无效，已保留原数据。");
    if (state.organizationUpdatedAt !== undefined && (typeof state.organizationUpdatedAt !== "string" || (state.organizationUpdatedAt !== "" && !Number.isFinite(Date.parse(state.organizationUpdatedAt))))) throw new Error("资产分类时间记录无效，已保留原数据。");
    if (state.deletedAssets !== undefined && (!Array.isArray(state.deletedAssets) || state.deletedAssets.some((item) => !item || typeof item.id !== "string" || !item.id || typeof item.deletedAt !== "string" || !Number.isFinite(Date.parse(item.deletedAt))))) throw new Error("资产删除记录无效，已保留原数据。");
    if (state.excludedCanvasResources !== undefined && (!Array.isArray(state.excludedCanvasResources) || state.excludedCanvasResources.some((key) => typeof key !== "string"))) throw new Error("资产排除记录无效，已保留原数据。");
    for (const asset of state.assets || []) {
        if (asset.tags !== undefined && (!Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== "string"))) throw new Error("资产标签记录无效，已保留原数据。");
        if ((asset.folderId !== undefined && typeof asset.folderId !== "string") || (asset.favorite !== undefined && typeof asset.favorite !== "boolean") || (asset.deletedAt !== undefined && (typeof asset.deletedAt !== "string" || !Number.isFinite(Date.parse(asset.deletedAt))))) throw new Error("资产管理记录无效，已保留原数据。");
    }
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        if (!Array.isArray(parsed?.state?.assets)) throw new Error("资产记录格式无效，已保留原数据。");
        if (parsed.version !== undefined && parsed.version !== 0) throw new Error("资产记录版本不兼容，已保留原数据。");
        validateOrganization(parsed.state);
        parsed.state.folders ??= [];
        parsed.state.tags = registeredTags(parsed.state.tags || [], parsed.state.assets);
        parsed.state.organizationUpdatedAt ??= "";
        parsed.state.deletedAssets ??= [];
        parsed.state.excludedCanvasResources ??= [];
        let migratedInlineImage = false;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                asset = { ...asset, tags: uniqueTags(asset.tags || []) };
                if ((asset.kind === "video" || asset.kind === "audio") && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    void ensureImagePreview(asset.data.storageKey);
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                }
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                migratedInlineImage = true;
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        queuedPersistState = migratedInlineImage ? null : parsed.state as PersistedAssetState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedAssetState;
        const hydratedState = queuedPersistState;
        queuedPersistState = null;
        // Skip only the hydrated flag's unchanged write; later retries stay in localForage's save queue.
        if (hydratedState && Object.keys(nextState).every((key) => nextState[key as keyof PersistedAssetState] === hydratedState[key as keyof PersistedAssetState])) return;
        return localForageStorage.setItem(name, JSON.stringify(value));
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            folders: [],
            tags: [],
            organizationUpdatedAt: "",
            deletedAssets: [],
            excludedCanvasResources: [],
            syncCanvasAssets: (candidates) => {
                if (!get().hydrated) return;
                const state = get();
                const known = new Set([...state.assets.map(assetResourceKey), ...state.excludedCanvasResources]);
                const now = new Date().toISOString();
                const added: Asset[] = [];
                for (const asset of candidates) {
                    const key = assetResourceKey(asset);
                    if (known.has(key)) continue;
                    known.add(key);
                    added.push({ ...asset, id: nanoid(), createdAt: now, updatedAt: now } as Asset);
                }
                if (added.length) set({ assets: [...added.reverse(), ...state.assets], tags: registeredTags(state.tags, added) });
            },
            addAsset: (asset) => {
                const existing = get().assets.find((item) => !item.deletedAt && assetResourceKey(item) === assetResourceKey(asset));
                if (existing && asset.source === "Canvas") return existing.id;
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, tags: uniqueTags(asset.tags || []), id, createdAt: now, updatedAt: now } as Asset, ...state.assets], tags: registeredTags(state.tags, [asset as Asset]) }));
                return id;
            },
            updateAsset: (id, patch) => {
                const state = get();
                if (!state.assets.some((asset) => asset.id === id && !asset.deletedAt)) return;
                const assets = state.assets.map((asset) => asset.id === id ? ({ ...asset, ...patch, ...(patch.tags ? { tags: uniqueTags(patch.tags) } : {}), updatedAt: assetChangeTime([asset]) } as Asset) : asset);
                set({ assets, tags: registeredTags(state.tags, assets) });
            },
            updateAssets: (ids, patch) => {
                const state = get();
                const selected = new Set(ids);
                if (!state.assets.some((asset) => selected.has(asset.id) && !asset.deletedAt)) return;
                if (patch.folderId && !state.folders.some((folder) => folder.id === patch.folderId)) return;
                if (patch.title !== undefined && !patch.title.trim()) return;
                const now = assetChangeTime(state.assets.filter((asset) => selected.has(asset.id) && !asset.deletedAt));
                const assets = state.assets.map((asset) => {
                    if (!selected.has(asset.id) || asset.deletedAt) return asset;
                    const tags = patch.tags ? uniqueTags(patch.tags) : undefined;
                    return { ...asset,
                        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
                        ...(patch.folderId !== undefined ? { folderId: patch.folderId || undefined } : {}),
                        ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
                        ...(tags ? { tags: patch.tagMode === "add" ? uniqueTags([...asset.tags, ...tags]) : patch.tagMode === "remove" ? asset.tags.filter((tag) => !tags.includes(tag)) : tags } : {}),
                        updatedAt: now,
                    } as Asset;
                });
                set({ assets, tags: registeredTags(state.tags, assets) });
            },
            addFolder: (name) => {
                const state = get();
                const cleaned = name.trim();
                if (!cleaned) return null;
                const existing = state.folders.find((folder) => folder.name === cleaned);
                if (existing) return existing;
                const folder = { id: nanoid(), name: cleaned };
                set({ folders: [...state.folders, folder], organizationUpdatedAt: organizationTime(state.organizationUpdatedAt) });
                return folder;
            },
            renameFolder: (id, name) => {
                const state = get();
                const cleaned = name.trim();
                if (!cleaned || !state.folders.some((folder) => folder.id === id && folder.name !== cleaned) || state.folders.some((folder) => folder.id !== id && folder.name === cleaned)) return;
                set({ folders: state.folders.map((folder) => folder.id === id ? { ...folder, name: cleaned } : folder), organizationUpdatedAt: organizationTime(state.organizationUpdatedAt) });
            },
            removeFolder: (id) => {
                const state = get();
                if (!state.folders.some((folder) => folder.id === id)) return;
                const now = assetChangeTime([...state.assets.filter((asset) => asset.folderId === id), { updatedAt: state.organizationUpdatedAt }]);
                set({ folders: state.folders.filter((folder) => folder.id !== id), assets: state.assets.map((asset) => asset.folderId === id ? { ...asset, folderId: undefined, updatedAt: now } : asset), organizationUpdatedAt: now });
            },
            addTag: (name) => {
                const state = get();
                const cleaned = name.trim();
                if (!cleaned || state.tags.includes(cleaned)) return;
                set({ tags: [...state.tags, cleaned], organizationUpdatedAt: organizationTime(state.organizationUpdatedAt) });
            },
            renameTag: (name, nextName) => {
                const state = get();
                const cleaned = nextName.trim();
                if (!cleaned || cleaned === name || !state.tags.includes(name)) return;
                const now = assetChangeTime([...state.assets.filter((asset) => asset.tags.includes(name)), { updatedAt: state.organizationUpdatedAt }]);
                set({ tags: uniqueTags(state.tags.map((tag) => tag === name ? cleaned : tag)), assets: state.assets.map((asset) => asset.tags.includes(name) ? { ...asset, tags: uniqueTags(asset.tags.map((tag) => tag === name ? cleaned : tag)), updatedAt: now } : asset), organizationUpdatedAt: now });
            },
            removeTag: (name) => {
                const state = get();
                if (!state.tags.includes(name)) return;
                const now = assetChangeTime([...state.assets.filter((asset) => asset.tags.includes(name)), { updatedAt: state.organizationUpdatedAt }]);
                set({ tags: state.tags.filter((tag) => tag !== name), assets: state.assets.map((asset) => asset.tags.includes(name) ? { ...asset, tags: asset.tags.filter((tag) => tag !== name), updatedAt: now } : asset), organizationUpdatedAt: now });
            },
            trashAssets: (ids) => {
                const selected = new Set(ids);
                const state = get();
                if (!state.assets.some((asset) => selected.has(asset.id) && !asset.deletedAt)) return;
                const now = assetChangeTime(state.assets.filter((asset) => selected.has(asset.id) && !asset.deletedAt));
                set({ assets: state.assets.map((asset) => selected.has(asset.id) && !asset.deletedAt ? { ...asset, deletedAt: now, updatedAt: now } : asset) });
            },
            restoreAssets: (ids) => {
                const selected = new Set(ids);
                const state = get();
                if (!state.assets.some((asset) => selected.has(asset.id) && asset.deletedAt)) return;
                const now = assetChangeTime(state.assets.filter((asset) => selected.has(asset.id) && asset.deletedAt));
                set({ assets: state.assets.map((asset) => selected.has(asset.id) && asset.deletedAt ? { ...asset, deletedAt: undefined, updatedAt: now } : asset) });
            },
            importAssets: (incoming, organization) => {
                const state = get();
                const folders = [...state.folders];
                const folderIds = new Map<string, string>();
                for (const folder of organization?.folders || []) {
                    const name = folder.name.trim();
                    let target = folders.find((existing) => existing.name === name);
                    if (!target) { target = { id: nanoid(), name }; folders.push(target); }
                    folderIds.set(folder.id, target.id);
                }
                const now = assetChangeTime(incoming);
                const assets = incoming.filter((asset) => !asset.deletedAt).map((asset) => ({ ...asset, tags: uniqueTags(asset.tags || []), id: nanoid(), folderId: asset.folderId ? folderIds.get(asset.folderId) || (folders.some((folder) => folder.id === asset.folderId) ? asset.folderId : undefined) : undefined, createdAt: asset.createdAt || now, updatedAt: now }));
                if (!assets.length && folders.length === state.folders.length && !organization?.tags.length) return 0;
                set({ assets: [...assets.reverse(), ...state.assets], folders, tags: registeredTags([...state.tags, ...(organization?.tags || [])], assets), organizationUpdatedAt: organizationTime(state.organizationUpdatedAt) });
                return assets.length;
            },
            removeAsset: (id) => get().removeAssets([id]),
            removeAssets: (ids) => {
                const selected = new Set(ids);
                if (!selected.size) return;
                const state = get();
                const removed = state.assets.filter((asset) => selected.has(asset.id));
                if (!removed.length) return;
                const assets = state.assets.filter((asset) => !selected.has(asset.id));
                const now = assetChangeTime([...removed, ...state.deletedAssets.filter((item) => selected.has(item.id))]);
                set({ assets, excludedCanvasResources: [...new Set([...state.excludedCanvasResources, ...removed.map(assetResourceKey)])], deletedAssets: [...state.deletedAssets.filter((item) => !selected.has(item.id)), ...removed.map((asset) => ({ id: asset.id, deletedAt: now }))] });
                get().cleanupImages({ assets });
            },
            replaceAssets: (assets, organization) => {
                if (organization) validateOrganization({ assets, ...organization });
                set({ assets, ...(organization || {}), tags: registeredTags(organization?.tags || get().tags, assets) });
            },
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    if (!get().hydrated || !useCanvasStore.getState().hydrated) return;
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets, folders: state.folders, tags: state.tags, organizationUpdatedAt: state.organizationUpdatedAt, deletedAssets: state.deletedAssets, excludedCanvasResources: state.excludedCanvasResources }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (error) return reportStateReadError(ASSET_STORE_KEY, error);
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
