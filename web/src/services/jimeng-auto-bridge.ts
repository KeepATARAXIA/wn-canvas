import { nanoid } from "nanoid";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

const PAGE_SOURCE = "infinite-canvas-jimeng-bridge";
const EXTENSION_SOURCE = "jimeng-canvas-extension";
const CHUNK_SIZE = 512 * 1024;

type BridgeEvent = { source?: string; type?: string; jobId?: string; progress?: number; message?: string; chunk?: string; index?: number; total?: number; mimeType?: string; fileName?: string };

export async function isJimengExtensionAvailable() {
    const requestId = nanoid();
    return new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => finish(false), 1200);
        const onMessage = (event: MessageEvent<BridgeEvent>) => {
            if (event.source !== window || event.data?.source !== EXTENSION_SOURCE || event.data.type !== "PONG" || event.data.jobId !== requestId) return;
            finish(true);
        };
        const finish = (available: boolean) => {
            window.clearTimeout(timer);
            window.removeEventListener("message", onMessage);
            resolve(available);
        };
        window.addEventListener("message", onMessage);
        window.postMessage({ source: PAGE_SOURCE, type: "PING", jobId: requestId }, window.location.origin);
    });
}

export async function generateWithJimengExtension({ prompt, seconds, ratio, references, signal, onProgress }: { prompt: string; seconds: string; ratio: string; references: CanvasResourceReference[]; signal?: AbortSignal; onProgress?: (percent: number, message?: string) => void }) {
    if (!(await isJimengExtensionAvailable())) throw new Error("未检测到即梦画布扩展，请先安装并启用扩展");
    const jobId = nanoid();
    const mediaReferences = references.filter((reference) => reference.kind !== "text" && reference.previewUrl);
    if (mediaReferences.length > 12) throw new Error("即梦最多支持 12 个参考素材，请减少画布连线后重试");
    const assets = await Promise.all(
        mediaReferences.map(async (reference) => {
            const response = await fetch(reference.previewUrl!);
            if (!response.ok) throw new Error(`无法读取参考素材：${reference.title}`);
            const blob = await response.blob();
            return { name: safeFileName(reference.title, reference.kind, blob.type), mimeType: blob.type || fallbackMime(reference.kind), base64: await blobToBase64(blob) };
        }),
    );
    const textReferences = references.filter((reference) => reference.kind === "text" && reference.text?.trim()).map((reference) => `${reference.label}：${reference.text!.trim()}`);
    const finalPrompt = [prompt.trim(), ...textReferences].filter(Boolean).join("\n\n");

    return new Promise<File>((resolve, reject) => {
        const resultChunks: string[] = [];
        let resultTotal = 0;
        let resultMime = "video/mp4";
        let resultName = "即梦生成视频.mp4";
        const onMessage = (event: MessageEvent<BridgeEvent>) => {
            const data = event.data;
            if (event.source !== window || data?.source !== EXTENSION_SOURCE || data.jobId !== jobId) return;
            if (data.type === "PROGRESS") onProgress?.(Math.max(0, Math.min(99, Number(data.progress) || 0)), data.message);
            if (data.type === "ERROR") finish(() => reject(new Error(data.message || "即梦网页自动生成失败")));
            if (data.type === "RESULT_CHUNK" && typeof data.index === "number" && typeof data.chunk === "string") {
                resultChunks[data.index] = data.chunk;
                resultTotal = Number(data.total) || resultTotal;
                resultMime = data.mimeType || resultMime;
                resultName = data.fileName || resultName;
                if (resultTotal > 0 && resultChunks.filter(Boolean).length === resultTotal) {
                    const blob = base64ChunksToBlob(resultChunks, resultMime);
                    onProgress?.(100, "视频已返回画布");
                    finish(() => resolve(new File([blob], resultName, { type: resultMime })));
                }
            }
        };
        const onAbort = () => {
            window.postMessage({ source: PAGE_SOURCE, type: "CANCEL", jobId }, window.location.origin);
            finish(() => reject(new DOMException("Aborted", "AbortError")));
        };
        const finish = (done: () => void) => {
            window.removeEventListener("message", onMessage);
            signal?.removeEventListener("abort", onAbort);
            done();
        };
        window.addEventListener("message", onMessage);
        signal?.addEventListener("abort", onAbort, { once: true });
        window.postMessage({ source: PAGE_SOURCE, type: "START", jobId, prompt: finalPrompt, seconds, ratio, assetCount: assets.length }, window.location.origin);
        assets.forEach((asset, assetIndex) => {
            const total = Math.ceil(asset.base64.length / CHUNK_SIZE) || 1;
            for (let index = 0; index < total; index += 1) {
                window.postMessage({ source: PAGE_SOURCE, type: "ASSET_CHUNK", jobId, assetIndex, index, total, name: asset.name, mimeType: asset.mimeType, chunk: asset.base64.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE) }, window.location.origin);
            }
        });
        window.postMessage({ source: PAGE_SOURCE, type: "COMMIT", jobId }, window.location.origin);
    });
}

function blobToBase64(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.onerror = () => reject(new Error("参考素材读取失败"));
        reader.readAsDataURL(blob);
    });
}

function base64ChunksToBlob(chunks: string[], mimeType: string) {
    return new Blob(chunks.map((chunk) => Uint8Array.from(atob(chunk), (value) => value.charCodeAt(0))), { type: mimeType });
}

function fallbackMime(kind: CanvasResourceReference["kind"]) {
    return kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg";
}

function safeFileName(title: string, kind: CanvasResourceReference["kind"], mimeType: string) {
    const clean = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "reference";
    if (/\.[a-z0-9]{2,5}$/i.test(clean)) return clean;
    const subtype = mimeType.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg") || (kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3");
    return `${clean}.${subtype}`;
}
