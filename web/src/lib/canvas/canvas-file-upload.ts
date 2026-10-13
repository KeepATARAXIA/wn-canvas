import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export async function readCanvasUploadFile(file: File): Promise<Pick<CanvasNodeData, "type" | "title" | "width" | "height" | "metadata">> {
    if (!file.size) throw new Error("文件为空，请选择有内容的文件");
    // Some file pickers omit MIME types; infer common media extensions in that case.
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const fallbackTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", opus: "audio/opus" };
    const mimeType = !file.type || file.type === "application/octet-stream" ? fallbackTypes[extension] || file.type : file.type;
    const input = mimeType && mimeType !== file.type ? new Blob([file], { type: mimeType }) : file;
    if (["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/svg+xml", "image/bmp", "image/avif", "image/x-icon", "image/vnd.microsoft.icon"].includes(mimeType)) {
        const image = await uploadImage(input);
        return { type: CanvasNodeType.Image, title: file.name, ...fitNodeSize(image.width, image.height), metadata: imageMetadata(image) };
    }
    if (mimeType.startsWith("video/")) {
        const video = await uploadMediaFile(input, "video");
        return { type: CanvasNodeType.Video, title: file.name, ...fitNodeSize(video.width || 1280, video.height || 720, 420, 420), metadata: videoMetadata(video) };
    }
    if (mimeType.startsWith("audio/")) {
        const audio = await uploadMediaFile(input, "audio");
        const { width, height } = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        return { type: CanvasNodeType.Audio, title: file.name, width, height, metadata: audioMetadata(audio) };
    }
    const uploaded = await uploadMediaFile(file);
    const { width, height } = NODE_DEFAULT_SIZE[CanvasNodeType.Upload];
    return { type: CanvasNodeType.Upload, title: file.name, width, height, metadata: { content: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, status: "success" } };
}
