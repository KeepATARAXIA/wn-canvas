import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Empty, Form, Input, Modal, Pagination, Popconfirm, Select } from "antd";
import { ArrowLeft, Check, FileText, FolderClosed, Music2, PencilLine, Plus, Search, Trash2, Upload, Video } from "lucide-react";

import { cn } from "@/lib/utils";
import { uploadMediaFile } from "@/services/file-storage";
import { getImagePreviewRevision, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { assetCoverUrl, useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { InsertAssetPayload } from "./asset-picker-modal";

type Props = {
    open: boolean;
    onInsert: (payload: InsertAssetPayload) => void | Promise<void>;
    onClose: () => void;
};

type AssetEditValues = { title: string; tags: string[]; note?: string; content?: string };
const PAGE_SIZE = 24;
const FILTERS: { value: AssetKind | "all"; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "image", label: "图片" },
    { value: "video", label: "视频" },
    { value: "audio", label: "音频" },
    { value: "text", label: "文本" },
];

export function CanvasAssetLibraryModal({ open, onInsert, onClose }: Props) {
    const { message, modal } = App.useApp();
    const dark = useThemeStore((state) => state.theme) === "dark";
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const trashAssets = useAssetStore((state) => state.trashAssets);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    // undefined: library grid; null: new text; Asset: edit an existing asset.
    const [editingAsset, setEditingAsset] = useState<Asset | null | undefined>(undefined);
    const [dirty, setDirty] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [inserting, setInserting] = useState(false);
    const busy = uploading || inserting;
    const selected = assets.find((asset) => asset.id === selectedId && !asset.deletedAt);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => !asset.deletedAt && (kindFilter === "all" || asset.kind === kindFilter)
            && (!query || [asset.title, ...asset.tags, asset.note || "", asset.kind === "text" ? asset.data.content : ""].join(" ").toLowerCase().includes(query)));
    }, [assets, keyword, kindFilter]);
    const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
    const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    const leaveEditor = (next: () => void) => {
        if (busy) return;
        if (!dirty) return next();
        modal.confirm({
            title: "放弃未保存的修改？",
            content: "关闭后，本次尚未保存的编辑将丢失。",
            okText: "放弃修改",
            cancelText: "继续编辑",
            onOk: () => { setDirty(false); next(); },
        });
    };

    const saveAsset = (values: AssetEditValues) => {
        const patch = { title: values.title.trim(), tags: values.tags || [], note: values.note?.trim() || "" };
        let savedId: string;
        if (editingAsset) {
            // Patch metadata only: retain media storage keys, dimensions and other asset fields.
            if (!useAssetStore.getState().assets.some((asset) => asset.id === editingAsset.id && !asset.deletedAt)) {
                message.error("该资产已被移除，请返回资产库重新选择。");
                return;
            }
            updateAsset(editingAsset.id, editingAsset.kind === "text" ? { ...patch, data: { ...editingAsset.data, content: values.content || "" } } : patch);
            savedId = editingAsset.id;
        } else {
            savedId = addAsset({ ...patch, kind: "text", coverUrl: "", source: "Canvas", data: { content: values.content || "" } });
        }
        setSelectedId(savedId);
        setDirty(false);
        setEditingAsset(undefined);
        setKeyword("");
        setKindFilter("all");
        setPage(Math.floor(useAssetStore.getState().assets.filter((asset) => !asset.deletedAt).findIndex((asset) => asset.id === savedId) / PAGE_SIZE) + 1);
        message.success("资产已保存");
    };

    const handleFiles = async (fileList: FileList | null) => {
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
                        addAsset({ kind: "image", title: file.name, coverUrl: image.url, tags: [], data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
                    } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
                        const kind = file.type.startsWith("audio/") ? "audio" : "video";
                        const media = await uploadMediaFile(file, kind);
                        addAsset({ kind, title: file.name, coverUrl: "", tags: [], data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } });
                    } else {
                        failed += 1;
                        continue;
                    }
                    added += 1;
                } catch (error) {
                    console.error("Asset upload failed:", file.name, error);
                    failed += 1;
                }
            }
            if (added) {
                setKeyword("");
                setKindFilter("all");
                setPage(1);
                message.success(`已添加 ${added} 个资产`);
            }
            if (failed) message.warning(`${failed} 个文件未添加，请检查文件是否为有效的图片、视频或音频后重试。`);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const insertSelected = async () => {
        if (!selected || busy) return;
        setInserting(true);
        try {
            const asset = selected;
            const payload: InsertAssetPayload = asset.kind === "text"
                ? { kind: "text", content: asset.data.content, title: asset.title }
                : asset.kind === "video" || asset.kind === "audio"
                    ? { kind: asset.kind, url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height }
                    : { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
            await onInsert(payload);
        } catch (error) {
            console.error("Asset insertion failed:", error);
            message.error("插入失败，资产已保留，可重试。");
        } finally {
            setInserting(false);
        }
    };

    return (
        <Modal
            title={<span className="flex items-center gap-2.5 text-base"><FolderClosed className="size-4" />资产库</span>}
            open={open}
            onCancel={() => leaveEditor(onClose)}
            centered
            width={960}
            footer={null}
            destroyOnHidden
            mask={{ closable: false }}
            closable={!busy}
            keyboard={!busy}
            wrapProps={{ "data-canvas-shortcuts-ignore": true, "data-canvas-no-zoom": true }}
            afterClose={() => { setEditingAsset(undefined); setDirty(false); setSelectedId(null); setKeyword(""); setKindFilter("all"); setPage(1); }}
            styles={{
                container: { borderRadius: 24, padding: 24, background: dark ? "#1b1b1b" : "#fafafa" },
                header: { background: "transparent", marginBottom: 20 },
                body: { height: "min(620px, calc(100dvh - 160px))", minHeight: 0 },
            }}
        >
            {editingAsset !== undefined ? (
                <AssetEditor key={editingAsset?.id || "new"} asset={editingAsset} onDirty={() => setDirty(true)} onSave={saveAsset} onBack={() => leaveEditor(() => setEditingAsset(undefined))} />
            ) : (
                <div className="flex h-full min-h-0 flex-col gap-4" aria-busy={busy}>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex gap-5" aria-label="资产类型">
                            {FILTERS.map(({ value, label }) => (
                                <button key={value} type="button" aria-pressed={kindFilter === value} onClick={() => { setKindFilter(value); setPage(1); setSelectedId(null); }} className={cn("border-b-2 pb-2 text-sm transition-colors", kindFilter === value ? "border-current font-medium text-stone-950 dark:text-white" : "border-transparent text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white")}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <Input className="!w-48 sm:!ml-auto" placeholder="搜索名称、标签、内容" aria-label="搜索资产" prefix={<Search className="size-4 opacity-45" />} value={keyword} allowClear onChange={(event) => { setKeyword(event.target.value); setPage(1); setSelectedId(null); }} />
                        <Button icon={<Plus className="size-4" />} disabled={busy} onClick={() => setEditingAsset(null)}>新建文本</Button>
                        <Button icon={<Upload className="size-4" />} loading={uploading} disabled={inserting} onClick={() => fileInputRef.current?.click()}>上传</Button>
                        <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={(event) => void handleFiles(event.target.files)} />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg">
                        {visible.length ? (
                            <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 lg:grid-cols-6">
                                {visible.map((asset) => (
                                    <button key={asset.id} type="button" aria-label={`选择资产：${asset.title}`} aria-pressed={selectedId === asset.id} disabled={busy} onClick={() => setSelectedId(selectedId === asset.id ? null : asset.id)} className={cn("group relative aspect-square overflow-hidden rounded-sm bg-stone-200 text-left outline-offset-[-3px] transition focus-visible:outline-2 dark:bg-stone-800", selectedId === asset.id && "ring-2 ring-inset ring-blue-400")}>
                                        <AssetPreview asset={asset} />
                                        <span className={cn("pointer-events-none absolute inset-0 border-2", selectedId === asset.id ? "border-blue-400" : "border-transparent")} />
                                        <span className={cn("absolute left-2 top-2 grid size-4 place-items-center rounded border border-white/50", selectedId === asset.id ? "bg-blue-500 text-white" : "bg-black/45")}>
                                            {selectedId === asset.id ? <Check className="size-3" /> : null}
                                        </span>
                                        {asset.kind === "video" ? <Video className="absolute right-2 top-2 size-4 text-white drop-shadow" /> : null}
                                        <span className={cn("absolute inset-x-0 bottom-0 truncate bg-black/65 px-2 py-2 text-xs text-white transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100", selectedId === asset.id ? "opacity-100" : "opacity-0")}>{asset.title}</span>
                                    </button>
                                ))}
                            </div>
                        ) : <div className="grid h-full place-items-center"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={assets.length ? "没有匹配的资产" : "暂无资产，生成或导入画布的素材会自动收录"} /></div>}
                    </div>
                    {filtered.length > PAGE_SIZE ? <Pagination size="small" className="self-center" current={currentPage} total={filtered.length} pageSize={PAGE_SIZE} showSizeChanger={false} onChange={(nextPage) => { setPage(nextPage); setSelectedId(null); }} /> : null}
                    <div className="flex flex-wrap items-center gap-2 border-t border-black/5 pt-3 dark:border-white/5">
                        <span className="min-w-0 flex-1 truncate text-xs text-stone-500 dark:text-stone-400">{selected ? `已选择 1 个素材 · ${selected.title}` : `共 ${filtered.length} 个资产`}</span>
                        <Button type="text" icon={<PencilLine className="size-4" />} disabled={!selected || busy} onClick={() => setEditingAsset(selected)}>编辑</Button>
                        <Popconfirm title="将此资产移入回收站？" description="可以在我的资产中恢复，画布中已插入的节点会保留。" okText="移入回收站" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => { if (selected) { trashAssets([selected.id]); setSelectedId(null); message.success("资产已移入回收站"); } }}>
                            <Button type="text" danger icon={<Trash2 className="size-4" />} disabled={!selected || busy}>删除</Button>
                        </Popconfirm>
                        <Button type="primary" disabled={!selected || uploading} loading={inserting} onClick={() => void insertSelected()}>插入画布</Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}

function AssetPreview({ asset, controls = false }: { asset: Asset; controls?: boolean }) {
    const cover = assetCoverUrl(asset);
    if (asset.kind === "audio") return <div className="flex h-full flex-col items-center justify-center gap-3 p-3"><Music2 className="size-8 opacity-50" />{controls ? <audio src={asset.data.url} controls className="w-full" /> : <span className="max-w-full truncate text-xs opacity-60">{asset.title}</span>}</div>;
    if (asset.kind === "text") return <div className="h-full overflow-hidden whitespace-pre-wrap break-words p-4 text-xs leading-6 text-stone-600 dark:text-stone-300">{asset.data.content}</div>;
    if (asset.kind === "video" && (controls || !cover)) return <video src={asset.data.url} controls={controls} muted={!controls} playsInline preload="metadata" className={cn("size-full", controls ? "object-contain" : "pointer-events-none object-cover")} />;
    return <img src={cover} alt={asset.title} loading="lazy" className={cn("size-full", controls ? "object-contain" : "object-cover")} />;
}

function AssetEditor({ asset, onDirty, onSave, onBack }: { asset: Asset | null; onDirty: () => void; onSave: (values: AssetEditValues) => void; onBack: () => void }) {
    const [form] = Form.useForm<AssetEditValues>();
    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <button type="button" onClick={onBack} className="flex w-fit items-center gap-2 text-sm text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"><ArrowLeft className="size-4" />返回资产库</button>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="aspect-square max-h-96 overflow-hidden rounded-xl bg-stone-100 dark:bg-black/25">
                        {asset ? <AssetPreview asset={asset} controls /> : <div className="flex h-full flex-col items-center justify-center gap-3 text-stone-400"><FileText className="size-9" /><span className="text-sm">新建文本资产</span></div>}
                    </div>
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ title: asset?.title || "", tags: asset?.tags || [], note: asset?.note || "", content: asset?.kind === "text" ? asset.data.content : "" }} onValuesChange={onDirty} onFinish={onSave}>
                        <Form.Item name="title" label="名称" rules={[{ required: true, whitespace: true, message: "请输入资产名称" }]}><Input autoFocus maxLength={200} /></Form.Item>
                        <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入标签后按回车" /></Form.Item>
                        <Form.Item name="note" label="备注"><Input.TextArea rows={3} placeholder="可选" /></Form.Item>
                        {!asset || asset.kind === "text" ? <Form.Item name="content" label="文本内容" rules={[{ required: true, whitespace: true, message: "请输入文本内容" }]}><Input.TextArea rows={7} /></Form.Item> : null}
                    </Form>
                </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/5 pt-3 dark:border-white/5"><Button onClick={onBack}>取消</Button><Button type="primary" onClick={() => form.submit()}>保存</Button></div>
        </div>
    );
}
