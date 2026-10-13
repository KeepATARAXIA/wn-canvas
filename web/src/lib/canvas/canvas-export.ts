import { nanoid } from "nanoid";
import { withLocalProxy } from "@/stores/use-config-store";
import { collectProjectStorageKeys } from "./canvas-package";
import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { createZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { CanvasExportAsset, CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export async function exportCanvasProjects(projects: CanvasProject[], fileName = i18n.t("canvas.export.defaultProjectName")) {
    const zip = await buildCanvasProjectArchive(projects);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

export async function buildCanvasProjectArchive(projects: CanvasProject[]) {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exportedProjects = await Promise.all(
        projects.map(async (source) => {
            const project = structuredClone(source);
            const files: CanvasExportAsset[] = [];
            const append = (storageKey: string, blob: Blob) => {
                const path = `projects/${project.id}/files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
                files.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
                zipFiles.push({ name: path, data: blob });
            };
            // URL-only results must become actual files inside the portable copy.
            const remote = new Map<string, string>();
            const packUrl = async (url: string, kind: string) => {
                if (remote.has(url)) return remote.get(url)!;
                const response = await fetch(withLocalProxy(url));
                if (!response.ok) throw new Error(`「${project.title}」素材下载失败（HTTP ${response.status}），未导出不完整备份`);
                const blob = await response.blob();
                if (!blob.size || /text\/html|application\/json/.test(blob.type)) throw new Error(`「${project.title}」素材链接未返回有效文件，未导出不完整备份`);
                const mediaType = blob.type.split("/")[0];
                const key = `${["image", "video", "audio"].includes(mediaType) ? mediaType : kind}:${nanoid()}`;
                append(key, blob); remote.set(url, key);
                return key;
            };
            const embed = async (value: unknown, kind = "") => {
                if (!value || typeof value !== "object") return;
                const record = value as Record<string, unknown>;
                const mediaKind = String(record.type || record.kind || kind).replace(/^video-tool:.*/, "video");
                if (!record.storageKey && ["image", "video", "audio"].includes(mediaKind)) {
                    for (const field of ["content", "dataUrl", "url"]) {
                        if (typeof record[field] === "string" && /^(https?:|blob:)/.test(record[field])) record.storageKey = await packUrl(record[field], mediaKind);
                    }
                }
                if (Array.isArray(record.references)) for (let i = 0; i < record.references.length; i++) {
                    const ref = record.references[i];
                    if (typeof ref === "string" && /^(https?:|blob:)/.test(ref)) record.references[i] = await packUrl(ref, "image");
                }
                for (const [key, child] of Object.entries(record)) await embed(child, key === "images" ? "image" : mediaKind);
            };
            const localKeys = collectProjectStorageKeys(project);
            await embed(project);
            await Promise.all(
                localKeys.map(async (storageKey) => {
                    const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                    if (!blob?.size) throw new Error(`「${project.title}」缺少素材 ${storageKey}，未导出不完整备份。请恢复该素材后重试。`);
                    append(storageKey, blob);
                }),
            );
            return { project, files };
        }),
    );

    const data: CanvasExportFile = { app: "infinite-canvas", version: 3, exportedAt: new Date().toISOString(), projects: exportedProjects };
    return createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
}

export async function exportCanvasNodes(nodes: CanvasNodeData[], fileName = i18n.t("canvas.export.defaultNodesName")) {
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const used = new Set<string>();
    const uniqueName = (base: string, ext: string) => {
        const safe = safeFileName(base) || i18n.t("canvas.export.item");
        let name = `${safe}.${ext}`;
        for (let i = 1; used.has(name); i += 1) name = `${safe}-${i}.${ext}`;
        used.add(name);
        return name;
    };

    await Promise.all(
        nodes.map(async (node) => {
            const title = node.title || node.type;
            const storageKey = node.metadata?.storageKey || "";
            if (storageKey) {
                const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                if (blob) return void zipFiles.push({ name: uniqueName(title, fileExtension(blob.type, storageKey)), data: blob });
            }
            if (node.type === CanvasNodeType.Text) return void zipFiles.push({ name: uniqueName(title, "txt"), data: node.metadata?.content || node.metadata?.prompt || "" });
            const content = node.metadata?.content;
            if (content && content.startsWith("data:")) {
                const blob = await (await fetch(content)).blob();
                return void zipFiles.push({ name: uniqueName(title, fileExtension(blob.type, storageKey)), data: blob });
            }
            zipFiles.push({ name: uniqueName(title, "json"), data: JSON.stringify(node, null, 2) });
        }),
    );

    const zip = await createZip(zipFiles);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
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
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    return storageKey.startsWith("image:") ? "png" : "bin";
}
