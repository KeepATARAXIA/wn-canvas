import { strToU8, zipSync } from "fflate";
import { saveAs } from "file-saver";

import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export const JIMENG_VIDEO_URL = "https://jimeng.jianying.com/ai-tool/generate?enter_from=ai_feature&from_page=explore&ai_feature_name=video";

export async function exportJimengPackage(prompt: string, seconds: string, ratio: string, references: CanvasResourceReference[]) {
    const files: Record<string, Uint8Array> = {
        "即梦任务.txt": strToU8([`提示词：\n${prompt}`, `画面比例：${ratio}`, `时长：${seconds} 秒`, "", "请在即梦网页中选择相同参数后生成。"].join("\n")),
    };
    await Promise.all(
        references.map(async (reference, index) => {
            if (reference.kind === "text") {
                files[uniqueName(`${index + 1}-${reference.title}.txt`, files)] = strToU8(reference.text || "");
                return;
            }
            if (!reference.previewUrl) return;
            const response = await fetch(reference.previewUrl);
            if (!response.ok) throw new Error(`无法读取参考素材：${reference.title}`);
            const blob = await response.blob();
            const extension = extensionFor(reference.kind, blob.type);
            files[uniqueName(`${index + 1}-${reference.title}.${extension}`, files)] = new Uint8Array(await blob.arrayBuffer());
        }),
    );
    saveAs(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" }), "即梦参考素材.zip");
}

function uniqueName(name: string, files: Record<string, Uint8Array>) {
    const safe = name.replace(/[\\/:*?"<>|]/g, "_");
    if (!files[safe]) return safe;
    const dot = safe.lastIndexOf(".");
    return `${dot > 0 ? safe.slice(0, dot) : safe}-副本${dot > 0 ? safe.slice(dot) : ""}`;
}

function extensionFor(kind: CanvasResourceReference["kind"], mimeType: string) {
    const subtype = mimeType.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg");
    if (subtype && /^[a-z0-9.+-]+$/i.test(subtype)) return subtype;
    return kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3";
}
