import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FileText, Film, LayoutTemplate, Music2 } from "lucide-react";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { ensureImagePreview, getImageBlob, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";

// Load only visible covers. Reuse image thumbnails; never decode a large video
// just to render a project card or persist transient preview URLs into projects.
export function CanvasProjectPreview({ project }: { project: CanvasProject }) {
    const ref = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [videoUrl, setVideoUrl] = useState("");
    const [originalUrl, setOriginalUrl] = useState("");
    const [failed, setFailed] = useState(false);
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const image = project.nodes.find(node => node.type === "image" && (node.metadata?.storageKey || node.metadata?.content || node.metadata?.images?.length));
    const video = project.nodes.find(node => (node.type === "video" || node.type.startsWith("video-tool:")) && (node.metadata?.storageKey || node.metadata?.content));
    const text = project.nodes.find(node => node.type === "text" && node.metadata?.content)?.metadata?.content;
    const audio = project.nodes.find(node => node.type === "audio");
    const imageData = image?.metadata?.images?.find(item => item.id === image.metadata?.primaryImageId) || image?.metadata?.images?.find(item => item.status === "success") || image?.metadata;
    const key = imageData?.storageKey;
    const imageUrl = key ? previewUrlFor(key) || originalUrl : imageData?.content;
    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "120px" });
        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        setOriginalUrl("");
        if (!visible || !key) return;
        let disposed = false, url = "";
        void (async () => {
            if (await ensureImagePreview(key) || disposed) return;
            const blob = await getImageBlob(key);
            if (disposed || !blob) return;
            // Small originals do not get a separate thumbnail in image-storage.
            if (blob.size <= 8 * 1024 ** 2) { url = URL.createObjectURL(blob); setOriginalUrl(url); }
        })().catch(() => { if (!disposed) setFailed(true); });
        return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
    }, [visible, key]);
    useEffect(() => {
        setFailed(false); setVideoUrl("");
        if (!visible || image || !video?.metadata?.storageKey || (video.metadata.bytes || 0) > 32 * 1024 ** 2) return;
        let disposed = false, url = "";
        void getMediaBlob(video.metadata.storageKey).then(blob => {
            if (disposed || !blob || blob.size > 32 * 1024 ** 2) return;
            url = URL.createObjectURL(blob); setVideoUrl(url);
        }).catch(() => { if (!disposed) setFailed(true); });
        return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
    }, [visible, image?.id, key, video?.metadata?.storageKey, video?.metadata?.bytes]);
    const Icon = video ? Film : audio ? Music2 : text ? FileText : LayoutTemplate;
    return <div ref={ref} className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-slate-100 dark:bg-stone-800" data-project-preview>
        {visible && imageUrl && !failed ? <img src={imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} />
            : videoUrl && !failed ? <video src={videoUrl} muted playsInline preload="metadata" className="h-full w-full object-contain" onError={() => setFailed(true)} />
            : text && !image && !video ? <p className="line-clamp-4 max-w-[34ch] whitespace-pre-wrap px-6 text-left text-sm leading-6 text-slate-600 dark:text-stone-300">{text}</p>
            : <div className="flex flex-col items-center gap-2 text-slate-500 dark:text-stone-400"><Icon className="size-7" strokeWidth={1.5} /><span className="text-xs">{failed ? "预览暂不可用" : image ? "图片项目" : video ? "视频项目" : audio ? "音频项目" : project.nodes.length ? `${project.nodes.length} 个节点` : "空白画布"}</span></div>}
    </div>;
}
