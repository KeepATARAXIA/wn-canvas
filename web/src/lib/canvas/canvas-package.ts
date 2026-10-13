import { nanoid } from "nanoid";
import type { CanvasExportFile } from "@/types/canvas-export";

export function collectProjectStorageKeys(value: unknown, keys = new Set<string>()): string[] {
    if (typeof value === "string" && /^(image|video|audio|file):[^/]/.test(value)) keys.add(value);
    if (value && typeof value === "object") {
        if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey) keys.add(value.storageKey);
        Object.values(value).forEach(item => collectProjectStorageKeys(item, keys));
    }
    return [...keys];
}

// Validate the entire package before writing any media or adding a project.
export function prepareCanvasImport(input: unknown, zip: Map<string, Blob>) {
    const data = input as CanvasExportFile;
    if (data?.app !== "infinite-canvas" || data.version !== 3 || !Array.isArray(data.projects) || !data.projects.length) throw new Error("画布备份格式或版本不支持");
    const assets = new Map<string, { storageKey: string; blob: Blob }>();
    const remap = new Map<string, string>();
    for (const item of data.projects) {
        if (!item.project || !Array.isArray(item.project.nodes) || !Array.isArray(item.project.connections) || !Array.isArray(item.files)) throw new Error("画布备份缺少节点、连线或文件清单");
        if (item.project.title !== undefined && typeof item.project.title !== "string") throw new Error("画布备份的项目名称必须是文本");
        for (const field of ["createdAt", "updatedAt"] as const) {
            const value = item.project[field];
            if (value !== undefined && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) throw new Error(`画布备份的项目日期无效：${field}`);
        }
        if (item.project.nodes.some(node => !node || typeof node.id !== "string" || typeof node.type !== "string" || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y) || !Number.isFinite(node.width) || !Number.isFinite(node.height))) throw new Error("画布备份包含无效节点");
        const listed = new Set(item.files.map(file => file.storageKey));
        for (const key of collectProjectStorageKeys(item.project)) if (!listed.has(key)) throw new Error(`备份不完整，文件清单缺少素材：${key}`);
        for (const file of item.files) {
            if (typeof file.storageKey !== "string" || !file.storageKey.includes(":")) throw new Error("备份素材标识无效");
            const blob = zip.get(file.path);
            if (!blob || blob.size !== file.bytes || !blob.size) throw new Error(`备份素材缺失或大小不符：${file.path}`);
            // Fresh keys keep an import from overwriting an existing project's media.
            if (!remap.has(file.storageKey)) remap.set(file.storageKey, `${file.storageKey.split(":")[0]}:${nanoid()}`);
            assets.set(file.storageKey, { storageKey: remap.get(file.storageKey)!, blob: blob.slice(0, blob.size, file.mimeType) });
        }
    }
    const rewrite = (value: unknown): unknown => {
        if (typeof value === "string") return remap.get(value) || value;
        if (Array.isArray(value)) return value.map(rewrite);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
        return value;
    };
    return { projects: data.projects.map(item => rewrite(item.project) as typeof item.project), assets: [...assets.values()] };
}
