import { ArrowUpRight, Check, Copy, Download, Folder, Heart, LayoutGrid, List, ListChecks, Menu, MoreHorizontal, PencilLine, Plus, RotateCcw, Search, Star, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { App, Button, Dropdown, Empty, Form, Input, Modal, Pagination, Select, Skeleton, Space, Typography } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { getImageBlob, getImagePreviewRevision, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { assetCoverUrl, useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";
import { AssetProjectPicker } from "./asset-project-picker";
import { AssetPreviewWindow } from "./asset-preview-window";
import "./assets-workspace.css";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = ["all", "text", "image", "video", "audio"] as const;
type AssetView = "all" | "favorites" | "trash";

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const mediaInputRef = useRef<HTMLInputElement>(null);
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const hydrated = useAssetStore((state) => state.hydrated);
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders);
    const registeredTags = useAssetStore((state) => state.tags);
    const projects = useCanvasStore((state) => state.projects);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAssets = useAssetStore((state) => state.removeAssets);
    const trashAssets = useAssetStore((state) => state.trashAssets);
    const restoreAssets = useAssetStore((state) => state.restoreAssets);
    const updateAssets = useAssetStore((state) => state.updateAssets);
    const importAssets = useAssetStore((state) => state.importAssets);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [view, setView] = useState<AssetView>("all");
    const [sortBy, setSortBy] = useState("added");
    const [layout, setLayout] = useState<"grid" | "list">("grid");
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(12);
    const [selecting, setSelecting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [deletingSelectedIds, setDeletingSelectedIds] = useState<string[] | null>(null);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [previewOpenRequest, setPreviewOpenRequest] = useState(0);
    const [insertingAsset, setInsertingAsset] = useState<Asset | null>(null);
    const [uploading, setUploading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [imageDraftFileName, setImageDraftFileName] = useState<string | null>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const content = Form.useWatch("content", form) || "";
    const allAssets = useMemo(() => assets.filter((asset) => kindOptions.includes(asset.kind)), [assets]);
    const validAssets = useMemo(() => allAssets.filter((asset) => !asset.deletedAt), [allAssets]);
    const tagNames = useMemo(() => [...new Set([...registeredTags, ...allAssets.flatMap((asset) => asset.tags || [])])].filter((tag) => tag.trim()).sort((a, b) => a.localeCompare(b, "zh-CN")), [registeredTags, allAssets]);
    const viewAssets = useMemo(() => view === "trash" ? allAssets.filter((asset) => asset.deletedAt) : view === "favorites" ? validAssets.filter((asset) => asset.favorite) : validAssets, [allAssets, validAssets, view]);
    const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.title])), [projects]);
    const hasFilters = Boolean(keyword.trim()) || kindFilter !== "all";
    const navigateView = (nextView: AssetView) => { setKeyword(""); setKindFilter("all"); setPage(1); setSelectedIds([]); setView(nextView); setSidebarOpen(false); };
    const changeFilter = (change: () => void) => { change(); setPage(1); setSelectedIds([]); };
    const isTrash = view === "trash";
    const viewTitle = view === "trash" ? "回收站" : view === "favorites" ? "收藏" : t("assets.title");
    const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedAssets = useMemo(() => viewAssets.filter((asset) => selectedIdSet.has(asset.id)), [viewAssets, selectedIdSet]);
    const deletingSelectedAssets = useMemo(() => viewAssets.filter((asset) => deletingSelectedIds?.includes(asset.id)), [viewAssets, deletingSelectedIds]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return viewAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return `${assetSearchText(asset)} ${assetSource(asset, projectNames)}`.toLowerCase().includes(query);
        }).sort((a, b) => {
            const direction = sortBy === "name" || sortBy === "type" ? 1 : -1;
            const comparison = sortBy === "name" ? a.title.localeCompare(b.title, "zh-CN") : sortBy === "type" ? a.kind.localeCompare(b.kind) : sortBy === "size" ? assetBytes(a) - assetBytes(b) : assetTime(a, sortBy === "updated" ? "updatedAt" : isTrash ? "deletedAt" : "createdAt") - assetTime(b, sortBy === "updated" ? "updatedAt" : isTrash ? "deletedAt" : "createdAt");
            return direction * comparison;
        });
    }, [viewAssets, keyword, kindFilter, projectNames, sortBy, isTrash]);
    const activePreviewAsset = previewAsset ? filteredAssets.find((asset) => asset.id === previewAsset.id) || null : null;

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    useEffect(() => {
        const validIds = new Set(viewAssets.map((asset) => asset.id));
        setSelectedIds((ids) => ids.every((id) => validIds.has(id)) ? ids : ids.filter((id) => validIds.has(id)));
    }, [viewAssets]);

    useEffect(() => {
        if (previewAsset && !activePreviewAsset) setPreviewAsset(null);
    }, [previewAsset, activePreviewAsset]);

    const cancelSelection = () => { setSelecting(false); setSelectedIds([]); };
    const toggleSelected = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
    const allVisibleSelected = visibleAssets.length > 0 && visibleAssets.every((asset) => selectedIdSet.has(asset.id));
    const toggleVisibleSelected = () => {
        const visibleIds = new Set(visibleAssets.map((asset) => asset.id));
        setSelectedIds((ids) => allVisibleSelected ? ids.filter((id) => !visibleIds.has(id)) : [...new Set([...ids, ...visibleIds])]);
    };
    const requestBatchDelete = () => setDeletingSelectedIds(selectedAssets.map((asset) => asset.id));

    useEffect(() => {
        if (!selecting) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || isAssetOpen || previewAsset || insertingAsset || deletingAsset || deletingSelectedIds) return;
            if (event.key === "Delete" && selectedAssets.length) {
                const target = event.target;
                if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="menu"], [role="dialog"]')) return;
                event.preventDefault();
                setDeletingSelectedIds(selectedAssets.map((asset) => asset.id));
            } else if (event.key === "Escape") {
                event.preventDefault();
                setSelecting(false);
                setSelectedIds([]);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [selecting, selectedAssets, isAssetOpen, previewAsset, insertingAsset, deletingAsset, deletingSelectedIds]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setImageDraftFileName(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", source: t("assets.manual"), note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        setImageDraftFileName(null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields().catch(() => null);
        if (!values) return;
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: editingAsset?.tags || [],
            folderId: editingAsset?.folderId,
            favorite: editingAsset?.favorite,
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: { ...(editingAsset?.metadata || { source: "manual" }), ...(values.kind === "image" && imageDraftFileName ? { fileName: imageDraftFileName } : {}) },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error(t("assets.selectImage"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? t("assets.updated") : t("assets.saved"));
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        try {
            const image = await uploadImage(file);
            const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
            setImageDraft(draft);
            setImageDraftFileName(file.name);
            if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch {
            message.error("图片无法读取，请选择有效的图片文件。");
        }
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = async (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio") return;
        try {
            const blob = await readAssetMediaBlob(asset);
            if (!blob) {
                message.error(t("assets.downloadFailed"));
                return;
            }
            const ext = asset.data.mimeType?.split("/")[1]?.split("+")[0] || (asset.kind === "video" ? "mp4" : "png");
            saveAs(blob, `${asset.title || "asset"}.${ext}`);
        } catch {
            message.error(t("assets.downloadFailed"));
        }
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        setExporting(true);
        try {
            await exportAssets(validAssets, t("assets.packageName"), { folders, tags: tagNames });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败，素材已保留，请重试。");
        } finally {
            setExporting(false);
        }
    };

    const uploadFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        let added = 0;
        let failed = 0;
        try {
            for (const file of files) {
                try {
                    if (file.type.startsWith("image/")) {
                        const image = await uploadImage(file);
                        addAsset({ kind: "image", title: file.name, coverUrl: image.url, tags: [], source: "本地上传", metadata: { fileName: file.name }, data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
                    } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
                        const kind = file.type.startsWith("audio/") ? "audio" : "video";
                        const media = await uploadMediaFile(file, kind);
                        addAsset({ kind, title: file.name, coverUrl: "", tags: [], source: "本地上传", metadata: { fileName: file.name }, data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } });
                    } else {
                        failed += 1;
                        continue;
                    }
                    added += 1;
                } catch {
                    failed += 1;
                }
            }
            if (added) { navigateView("all"); message.success(`已添加 ${added} 个素材`); }
            if (failed) message.warning(`${failed} 个文件未添加，请检查格式后重试。`);
        } finally {
            setUploading(false);
            if (mediaInputRef.current) mediaInputRef.current.value = "";
        }
    };

    const importAssetZip = async (file?: File) => {
        if (!file || importing) return;
        setImporting(true);
        try {
            const importedAssets = await readAssetPackage(file);
            importAssets(importedAssets, importedAssets.packageOrganization);
            navigateView("all");
            message.success(t("assets.imported", { count: importedAssets.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("assets.importFailed"));
        } finally {
            setImporting(false);
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = () => {
        if (!deletingAsset) return;
        deletingAsset.deletedAt ? removeAssets([deletingAsset.id]) : trashAssets([deletingAsset.id]);
        message.success(deletingAsset.deletedAt ? "已彻底删除素材" : "已移入回收站");
        setDeletingAsset(null);
    };

    const confirmBatchDelete = () => {
        const ids = deletingSelectedAssets.map((asset) => asset.id);
        if (ids.length) {
            isTrash ? removeAssets(ids) : trashAssets(ids);
            message.success(isTrash ? `已彻底删除 ${ids.length} 个素材` : `已将 ${ids.length} 个素材移入回收站`);
        }
        setDeletingSelectedIds(null);
        setSelectedIds([]);
    };

    const restoreSelected = () => { restoreAssets(selectedAssets.map((asset) => asset.id)); setSelectedIds([]); message.success("所选素材已恢复"); };
    const workspaceStyle = {
        "--asset-bg": theme.canvas.background, "--asset-panel": theme.node.panel, "--asset-border": theme.toolbar.border,
        "--asset-text": theme.node.text, "--asset-muted": theme.node.muted, "--asset-active-bg": theme.toolbar.activeBg,
        "--asset-active-text": theme.toolbar.activeText, "--asset-accent": theme.node.activeStroke,
        background: theme.canvas.background, color: theme.node.text,
    } as CSSProperties;

    return (
        <div className="assets-workspace" data-sidebar-open={sidebarOpen ? "true" : "false"} style={workspaceStyle}>
            <div className="assets-workspace-layout">
                <aside className="assets-sidebar" aria-label="资产导航">
                    <Button className="assets-sidebar-close" type="text" icon={<X className="size-4" />} aria-label="关闭资产导航" onClick={() => setSidebarOpen(false)}>收起导航</Button>
                    <nav className="assets-sidebar-nav" aria-label="资产视图">
                        <SidebarItem label="我的资产" icon={<Folder className="size-4" />} active={view === "all"} onClick={() => navigateView("all")} />
                        <SidebarItem label="收藏" icon={<Heart className="size-4" />} active={view === "favorites"} onClick={() => navigateView("favorites")} />
                        <SidebarItem label="回收站" icon={<Trash2 className="size-4" />} active={isTrash} onClick={() => navigateView("trash")} />
                    </nav>
                </aside>
                <main className="assets-main workspace-page" aria-label="素材工作台">
                    <header className="assets-header">
                        <div>
                            <div className="flex items-center gap-2">
                                <Button className="assets-mobile-sidebar-toggle" type="text" icon={sidebarOpen ? <X className="size-4" /> : <Menu className="size-4" />} aria-label={sidebarOpen ? "关闭资产导航" : "打开资产导航"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)} />
                                <h1 className="assets-title">{viewTitle}</h1>
                            </div>
                            <p className="assets-subtitle">{isTrash ? "删除的素材暂存于此，可恢复到原位置。" : "收藏创作素材，随时复用。"}</p>
                        </div>
                        <div className="assets-header-actions">
                            <div className="assets-view-controls assets-segmented" aria-label="显示方式">
                                <button type="button" aria-label="网格视图" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><LayoutGrid className="size-4" /></button>
                                <button type="button" aria-label="列表视图" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List className="size-4" /></button>
                            </div>
                            <Dropdown trigger={["click"]} menu={{ items: [
                                { key: "select", label: selecting ? "退出多选" : "多选", icon: <ListChecks className="size-4" />, disabled: !hydrated || (!selecting && !viewAssets.length), onClick: () => selecting ? cancelSelection() : setSelecting(true) },
                                { key: "upload", label: uploading ? "正在上传…" : "上传文件", icon: <Upload className="size-4" />, disabled: !hydrated || uploading || isTrash, onClick: () => mediaInputRef.current?.click() },
                                { key: "add", label: t("assets.add"), icon: <Plus className="size-4" />, disabled: !hydrated || isTrash, onClick: openCreate },
                                { key: "import", label: importing ? "正在导入…" : t("assets.import"), icon: <Upload className="size-4" />, disabled: !hydrated || importing, onClick: () => assetInputRef.current?.click() },
                                { key: "export", label: exporting ? "正在导出…" : t("assets.export"), icon: <Download className="size-4" />, disabled: !validAssets.length || exporting, onClick: () => void exportAllAssets() },
                            ] }}><Button icon={<MoreHorizontal className="size-4" />} loading={exporting || importing || uploading} aria-label="素材更多操作">更多</Button></Dropdown>
                        </div>
                    </header>
                    <div className="assets-toolbar">
                        <Input className="assets-search" allowClear prefix={<Search className="size-4" style={{ color: theme.node.muted }} />} value={keyword} placeholder="搜索素材…" aria-label="搜索素材" onChange={(event) => changeFilter(() => setKeyword(event.target.value))} />
                        <div className="assets-kinds" aria-label="素材类型">
                            {(["all", "image", "video", "audio", "text"] as const).map((option) => <button key={option} type="button" aria-pressed={kindFilter === option} onClick={() => changeFilter(() => setKindFilter(option))}>{option === "all" ? "全部" : option === "audio" ? "音频" : option === "text" ? "文本" : t("assets.kinds." + option)}</button>)}
                        </div>
                        <div className="assets-filters">
                            <Select aria-label="素材排序" value={sortBy} options={[{ value: "added", label: isTrash ? "最近删除" : "最近添加" }, { value: "updated", label: "最近更新" }, { value: "name", label: "名称" }, { value: "type", label: "类型" }, { value: "size", label: "文件大小" }]} onChange={(value) => { setSortBy(value); setPage(1); }} />
                        </div>
                    </div>
                    {selecting ? <div role="toolbar" aria-label="批量操作" className="assets-selection-toolbar">
                        <span className="text-sm font-medium" aria-live="polite">已选 {selectedAssets.length} 项</span>
                        <Button disabled={!visibleAssets.length} onClick={toggleVisibleSelected}>{allVisibleSelected ? "取消本页全选" : "全选本页"}</Button>
                        {isTrash ? <Button icon={<RotateCcw className="size-4" />} disabled={!selectedAssets.length} onClick={restoreSelected}>恢复所选</Button> : null}
                        <Button danger icon={<Trash2 className="size-4" />} disabled={!selectedAssets.length} onClick={requestBatchDelete}>{isTrash ? "彻底删除所选" : "删除所选"}</Button>
                        <Button type="text" onClick={cancelSelection}>取消</Button>
                        <span className="workspace-muted text-xs sm:ml-auto">翻页保留选择 · Delete 删除 · Esc 退出</span>
                    </div> : null}
                    <div className="assets-content-scroll">
                        {!hydrated ? <div className="assets-grid" aria-label="正在加载素材"><Skeleton active /><Skeleton active /><Skeleton active /></div> : visibleAssets.length ? (
                            <div className={layout === "grid" ? "assets-grid" : "assets-list"}>
                                {visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} layout={layout} selecting={selecting} selected={selectedIdSet.has(asset.id)} onSelect={() => { setSelecting(true); toggleSelected(asset.id); }} onFavorite={() => updateAssets([asset.id], { favorite: !asset.favorite })} onRestore={() => { restoreAssets([asset.id]); message.success("素材已恢复"); }} onOpen={() => { setPreviewAsset(asset); setPreviewOpenRequest((request) => request + 1); }} onInsert={() => setInsertingAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} />)}
                            </div>
                        ) : <div className="rounded-xl border px-6 py-16 text-center" style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}>
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: theme.node.text }}>{hasFilters ? "没有匹配的素材" : isTrash ? "回收站是空的" : view === "favorites" ? "还没有收藏的素材" : "素材库还是空的"}</span>} />
                            <p className="workspace-muted mx-auto mt-2 max-w-lg text-sm leading-6">{hasFilters ? "试试其他关键词或素材类型。" : isTrash ? "移入回收站的素材会显示在这里，可随时恢复。" : view === "favorites" ? "打开素材预览，收藏常用素材。" : "从“更多”上传文件或新增素材。画布中生成的素材也会自动收录。"}</p>
                        </div>}
                    </div>
                    <footer className="assets-footer">
                        <span aria-live="polite">{selectedAssets.length ? "已选择 " + selectedAssets.length + " 项 · " : ""}{filteredAssets.length ? "显示 " + ((page - 1) * pageSize + 1) + "–" + Math.min(page * pageSize, filteredAssets.length) + " / " + filteredAssets.length + " 个素材" : "共 0 个素材"}</span>
                        {hydrated && filteredAssets.length ? <Pagination current={page} pageSize={pageSize} total={filteredAssets.length} showSizeChanger pageSizeOptions={[12, 24, 48]} onChange={(nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); }} /> : null}
                    </footer>
                </main>
            </div>

            <Modal title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text" }}>
                        <Form.Item name="kind" label={t("assets.type")}>
                            <Select
                                options={[
                                    { label: t("assets.kinds.text"), value: "text" },
                                    { label: t("assets.kinds.image"), value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("assets.fields.title")} rules={[{ required: true, whitespace: true, message: t("assets.fields.titleRequired") }]}>
                            <Input size="large" placeholder={t("assets.fields.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.fields.coverPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("common.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("assets.fields.source")}>
                                <Input placeholder={t("assets.fields.sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("assets.fields.note")}>
                                <Input placeholder={t("assets.fields.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.fields.textContent")} rules={[{ required: true, whitespace: true, message: t("assets.fields.textRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets.fields.textPlaceholder")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("assets.fields.imageContent")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("assets.selectImageFile")}
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets.noImageSelected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>{t("assets.preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {formKind === "text" ? (
                                <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 text-slate-700 dark:text-stone-200">{content || "文本内容会显示在这里"}</div>
                            ) : coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("assets.noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets.untitled")}
                                </Typography.Text>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetPreviewWindow asset={activePreviewAsset} assets={filteredAssets} openRequest={previewOpenRequest} source={(asset) => assetSource(asset, projectNames)} onClose={() => setPreviewAsset(null)} onChange={(asset, index) => { setPreviewAsset(asset); setPage(Math.floor(index / pageSize) + 1); }} onCopy={copyAssetText} onDownload={downloadImage} onInsert={(asset) => { if (!asset.deletedAt) { setInsertingAsset(asset); setPreviewAsset(null); } }} onFavorite={(asset) => { if (!asset.deletedAt) updateAssets([asset.id], { favorite: !asset.favorite }); }} onDelete={(asset) => { setPreviewAsset(null); setDeletingAsset(asset); }} onRestore={(asset) => { setPreviewAsset(null); restoreAssets([asset.id]); message.success("素材已恢复"); }} />
            <AssetProjectPicker asset={insertingAsset} onClose={() => setInsertingAsset(null)} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />
            <input ref={mediaInputRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />

            <Modal title={deletingAsset?.deletedAt ? "彻底删除素材" : "移入回收站"} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={deletingAsset?.deletedAt ? "彻底删除" : "移入回收站"} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                <p>{deletingAsset?.deletedAt ? "确定彻底删除「" + deletingAsset.title + "」吗？此操作无法恢复。" : "将「" + deletingAsset?.title + "」移入回收站？之后可恢复。"}</p>
                <p className="mt-2 text-sm" style={{ color: theme.node.muted }}>画布中已插入的节点会保留。</p>
            </Modal>
            <Modal title={isTrash ? "彻底删除所选素材" : "删除所选素材"} open={deletingSelectedIds !== null} onCancel={() => setDeletingSelectedIds(null)} onOk={confirmBatchDelete} okText={isTrash ? "彻底删除" : "移入回收站"} okButtonProps={{ danger: true, disabled: !deletingSelectedAssets.length }} cancelText={t("common.cancel")}>
                <p>{isTrash ? "确定彻底删除所选的 " : "将所选的 "}{deletingSelectedAssets.length} 个素材{isTrash ? "吗？此操作无法恢复。" : "移入回收站？之后可恢复。"}{deletingSelectedAssets.length > visibleAssets.filter((asset) => deletingSelectedIds?.includes(asset.id)).length ? "包含其他页面中选中的素材。" : ""}</p>
                <p className="mt-2 text-sm" style={{ color: theme.node.muted }}>画布中已插入的节点会保留。</p>
            </Modal>
        </div>
    );
}

function SidebarItem({ label, icon, active, onClick }: { label: string; icon: ReactNode; active: boolean; onClick: () => void }) {
    return <button type="button" className="assets-sidebar-item" aria-pressed={active} onClick={onClick}>{icon}<span>{label}</span></button>;
}

type AssetCardProps = { asset: Asset; layout: "grid" | "list"; selecting: boolean; selected: boolean; onSelect: () => void; onFavorite: () => void; onRestore: () => void; onOpen: () => void; onInsert: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void };

function AssetCard({ asset, layout, selecting, selected, onSelect, onFavorite, onRestore, onOpen, onInsert, onEdit, onCopy, onDownload, onDelete }: AssetCardProps) {
    const { t } = useTranslation();
    const [menuOpen, setMenuOpen] = useState(false);
    const list = layout === "list";
    const menuItems = asset.deletedAt ? [
        { key: "restore", label: "恢复素材", icon: <RotateCcw className="size-4" />, onClick: onRestore },
        { key: "delete", label: "彻底删除", icon: <Trash2 className="size-4" />, danger: true, onClick: onDelete },
    ] : [
        ...(asset.kind === "text" || asset.kind === "image" ? [{ key: "edit", label: t("common.edit"), icon: <PencilLine className="size-4" />, onClick: onEdit }] : []),
        asset.kind === "text" ? { key: "copy", label: t("assets.copyText"), icon: <Copy className="size-4" />, onClick: () => onCopy(asset) } : { key: "download", label: t("common.download"), icon: <Download className="size-4" />, onClick: () => onDownload(asset) },
        { key: "delete", label: "移入回收站", icon: <Trash2 className="size-4" />, danger: true, onClick: onDelete },
    ];
    const actions = <div className={list ? "assets-list-actions" : "assets-card-actions assets-workspace-card-actions"}>
        {asset.deletedAt ? <Button type="text" icon={<RotateCcw className="size-3.5" />} aria-label={"恢复素材：" + asset.title} title="恢复" onClick={onRestore}>{list ? "恢复" : null}</Button> : <Button type="text" icon={<ArrowUpRight className="size-3.5" />} aria-label={"插入画布：" + asset.title} title="插入画布" onClick={onInsert}>{list ? "插入画布" : null}</Button>}
        {list ? <Button type="text" onClick={onOpen}>详情</Button> : null}
        <Dropdown trigger={["click"]} open={menuOpen} onOpenChange={setMenuOpen} menu={{ items: menuItems }}><Button type="text" icon={<MoreHorizontal className="size-4" />} aria-label={"更多操作：" + asset.title} /></Dropdown>
    </div>;
    const metadata = <div className="assets-list-meta">
        <span>{asset.kind === "audio" ? "音频" : asset.kind === "text" ? "文本" : t("assets.kinds." + asset.kind)}</span>
        <span>{asset.kind === "text" ? asset.data.content.length + " 字" : asset.data.bytes > 0 ? formatBytes(asset.data.bytes) : "大小未记录"}</span>
    </div>;
    return <article data-asset-card={asset.id} data-selected={selected ? "true" : undefined} data-selecting={selecting ? "true" : undefined} data-menu-open={menuOpen ? "true" : undefined} className={list ? "assets-workspace-card assets-list-row" : "assets-workspace-card"}>
        <div inert={selecting} className={list ? "flex min-w-0 flex-1 items-center gap-3" : undefined}>
            <div className={list ? "assets-list-preview" : "relative"}>
                <AssetPreview asset={asset} onOpen={onOpen} />
            </div>
            <div className={list ? "assets-list-info" : "assets-card-body"}>
                <button type="button" className="assets-card-title" onClick={onOpen} title={asset.title}><h2>{asset.title}</h2></button>
                {!list && !selecting ? actions : null}
            </div>
            {list ? metadata : null}
            {list && !selecting ? actions : null}
        </div>
        {!asset.deletedAt && !selecting ? <button type="button" className="assets-card-favorite" aria-label={(asset.favorite ? "取消收藏：" : "收藏素材：") + asset.title} aria-pressed={Boolean(asset.favorite)} onClick={onFavorite}><Star className="size-4" /></button> : null}
        {selecting ? <button type="button" className="absolute inset-0 z-[3] rounded-lg text-left outline-offset-[-3px] focus-visible:outline-2" onClick={onSelect} aria-label={"选择素材：" + asset.title} aria-pressed={selected}>
            <span aria-hidden="true" className="assets-card-checkbox" aria-pressed={selected}>{selected ? <Check className="size-4" /> : <span className="size-3 rounded-sm border border-current" />}</span>
        </button> : <button type="button" className="assets-card-checkbox" aria-label={"选择素材：" + asset.title} aria-pressed={false} onClick={onSelect}><span className="size-3 rounded-sm border border-current" /></button>}
    </article>;
}

function AssetPreview({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const containerRef = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (asset.kind !== "video" || !containerRef.current) return;
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "100px" });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [asset.kind]);
    const cover = assetCoverUrl(asset);
    const mediaUrl = asset.kind === "video" ? asset.data.url : "";
    useEffect(() => setFailed(false), [cover, mediaUrl]);
    return (
        <div ref={containerRef} className="assets-preview">
            <button type="button" className="size-full outline-offset-[-3px] focus-visible:outline-2" onClick={onOpen} aria-label={"预览素材：" + asset.title}>
                {!failed && cover ? <img src={cover} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} /> : !failed && asset.kind === "video" && mediaUrl ? <video src={visible ? mediaUrl : undefined} muted playsInline preload="metadata" className="size-full object-contain pointer-events-none" aria-hidden="true" onError={() => setFailed(true)} /> : null}
            </button>
        </div>
    );
}

async function readAssetMediaBlob(asset: Extract<Asset, { kind: "image" | "video" | "audio" }>) {
    const storageKey = asset.data.storageKey;
    if (storageKey) {
        const stored = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (stored) return stored;
    }
    const url = asset.kind === "image" ? asset.data.dataUrl || asset.coverUrl : asset.data.url;
    if (!url) return null;
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
}

function assetSource(asset: Asset, projectNames: Map<string, string>) {
    const projectId = typeof asset.metadata?.projectId === "string" ? asset.metadata.projectId : "";
    if (projectId) return `画布 · ${projectNames.get(projectId) || "原项目已移除"}`;
    return asset.source === "Canvas" ? "画布" : asset.source || "来源未记录";
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}

function assetBytes(asset: Asset) {
    return asset.kind === "text" ? new TextEncoder().encode(asset.data.content).length : asset.data.bytes || 0;
}

function assetTime(asset: Asset, field: "createdAt" | "updatedAt" | "deletedAt") {
    return Date.parse(asset[field] || "") || 0;
}
