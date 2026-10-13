import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button, Dropdown, Tag } from "antd";
import { ArrowUpRight, Copy, Download, MoreHorizontal, RotateCcw, Star, Trash2 } from "lucide-react";

import { CanvasMediaViewer, type CanvasViewerItem } from "@/components/canvas/canvas-image-viewer";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import "./asset-preview-window.css";

type Props = {
    asset: Asset | null;
    assets: Asset[];
    openRequest?: number;
    source: (asset: Asset) => string;
    onClose: () => void;
    onChange: (asset: Asset, index: number) => void;
    onCopy: (asset: Asset) => void;
    onDownload: (asset: Asset) => void;
    onInsert: (asset: Asset) => void;
    onFavorite: (asset: Asset) => void;
    onDelete: (asset: Asset) => void;
    onRestore: (asset: Asset) => void;
};

export function AssetPreviewWindow(props: Props) {
    return props.asset ? <OpenAssetPreviewWindow {...props} asset={props.asset} /> : null;
}

function OpenAssetPreviewWindow({ asset, assets, openRequest, source, onClose, onChange, onCopy, onDownload, onInsert, onFavorite, onDelete, onRestore }: Props & { asset: Asset }) {
    const storedAssets = useAssetStore((state) => state.assets);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const assetById = useMemo(() => {
        const latest = new Map(storedAssets.map((item) => [item.id, item]));
        return new Map(assets.map((item) => [item.id, latest.get(item.id) || item]));
    }, [assets, storedAssets]);
    const selected = assetById.get(asset.id) || asset;
    const [resolved, setResolved] = useState<{ id: string; fallback: string; storageKey?: string; url: string } | null>(null);
    const fallback = assetContent(selected);
    const storageKey = selected.kind === "text" ? undefined : selected.data.storageKey;

    // Only resolve the active original. The gallery can contain thousands of entries.
    useEffect(() => {
        if (selected.kind === "text") return;
        let cancelled = false;
        const resolve = selected.kind === "image" ? resolveImageUrl : resolveMediaUrl;
        void resolve(storageKey, fallback).then((url) => {
            if (!cancelled) setResolved({ id: selected.id, fallback, storageKey, url });
        }, () => {
            if (!cancelled) setResolved({ id: selected.id, fallback, storageKey, url: fallback });
        });
        return () => { cancelled = true; };
    }, [selected.id, selected.kind, storageKey, fallback]);

    useEffect(() => { if (!assets.length) onClose(); }, [assets.length, onClose]);

    const gallery = useMemo<CanvasViewerItem[]>(() => assets.map((item) => {
        const latest = assetById.get(item.id)!;
        const original = assetContent(latest);
        const key = latest.kind === "text" ? undefined : latest.data.storageKey;
        const content = resolved?.id === latest.id && resolved.fallback === original && resolved.storageKey === key ? resolved.url : original;
        return { id: latest.id, kind: latest.kind, title: latest.title, content };
    }), [assets, assetById, resolved]);
    const changeItem = useCallback((item: CanvasViewerItem, index: number) => {
        const latest = assetById.get(item.id);
        if (latest) onChange(latest, index);
    }, [assetById, onChange]);
    if (!gallery.length) return null;

    return <CanvasMediaViewer src={fallback} title={selected.title} gallery={gallery} initialImageId={selected.id} openRequest={openRequest} onActiveItemChange={changeItem} onClose={onClose} renderDetails={(item) => {
        const current = assetById.get(item.id)!;
        const model = metadataText(current, "model");
        const prompt = metadataText(current, "prompt");
        const fileName = metadataText(current, "fileName");
        const trash = Boolean(current.deletedAt);
        const menu = trash ? [{ key: "delete", label: "彻底删除", danger: true, icon: <Trash2 className="size-4" /> }] : [
            current.kind === "text" ? { key: "copy", label: "复制正文", icon: <Copy className="size-4" /> } : { key: "download", label: "下载原文件", icon: <Download className="size-4" /> },
            { key: "delete", label: "移入回收站", danger: true, icon: <Trash2 className="size-4" /> },
        ];
        return <div className="asset-preview-details" data-asset-preview-details={current.id}>
            <div className="asset-preview-details-heading"><h3>素材信息</h3><Tag>{kindLabel(current)}</Tag></div>
            <div className="asset-preview-actions">
                {trash ? <Button type="primary" icon={<RotateCcw className="size-4" />} onClick={() => onRestore(current)}>恢复素材</Button> : <>
                    <Button type="primary" icon={<ArrowUpRight className="size-4" />} onClick={() => onInsert(current)}>插入画布</Button>
                    <Button aria-label={current.favorite ? "取消收藏素材" : "收藏素材"} title={current.favorite ? "取消收藏" : "收藏"} aria-pressed={Boolean(current.favorite)} icon={<Star className="size-4" fill={current.favorite ? "currentColor" : "none"} />} onClick={() => onFavorite(current)} />
                </>}
                <Dropdown trigger={["click"]} getPopupContainer={(trigger) => trigger.parentElement!} menu={{ items: menu, onClick: ({ key }) => {
                    if (key === "copy") onCopy(current);
                    else if (key === "download") onDownload(current);
                    else onDelete(current);
                } }}><Button aria-label="更多素材操作" title="更多" icon={<MoreHorizontal className="size-4" />} /></Dropdown>
            </div>
            <dl className="asset-preview-fields" style={{ "--asset-preview-muted": theme.node.muted } as CSSProperties}>
                <dt>来源</dt><dd>{source(current) || "来源未记录"}</dd>
                {model ? <><dt>模型</dt><dd data-asset-preview-model>{model}</dd></> : null}
                {fileName ? <><dt>原文件名</dt><dd data-asset-preview-filename>{fileName}</dd></> : null}
                {current.kind !== "text" ? <>
                    {current.kind !== "audio" ? <><dt>尺寸</dt><dd>{current.data.width > 0 && current.data.height > 0 ? `${current.data.width} × ${current.data.height}` : "未记录"}</dd></> : null}
                    <dt>格式</dt><dd>{current.data.mimeType || "未记录"}</dd>
                    <dt>大小</dt><dd>{formatBytes(current.data.bytes)}</dd>
                </> : null}
                <dt>收录时间</dt><dd>{formatDate(current.createdAt)}</dd>
                <dt>更新时间</dt><dd>{formatDate(current.updatedAt)}</dd>
            </dl>
            {prompt ? <section className="asset-preview-note"><h4 style={{ color: theme.node.muted }}>提示词</h4><p data-asset-preview-prompt>{prompt}</p></section> : null}
            {current.note?.trim() ? <section className="asset-preview-note"><h4 style={{ color: theme.node.muted }}>备注</h4><p>{current.note}</p></section> : null}
        </div>;
    }} />;
}

function assetContent(asset: Asset) {
    return asset.kind === "text" ? asset.data.content : asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
}

function metadataText(asset: Asset, key: string) {
    const value = asset.metadata?.[key];
    return typeof value === "string" ? value.trim() : "";
}

function kindLabel(asset: Asset) {
    return { image: "图片", video: "视频", audio: "音频", text: "文本" }[asset.kind];
}

function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "时间未记录" : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(value: number) {
    if (!(value > 0)) return "未记录";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
