import { useState } from "react";
import { App, Button, Empty, Input, Popover } from "antd";
import { Bookmark, BookOpen, Search } from "lucide-react";
import { useAssetStore, type TextAsset } from "@/stores/use-asset-store";

export function PromptFavorites({ value, onApply }: { value: string; onApply: (text: string) => void }) {
    const { message } = App.useApp();
    const assets = useAssetStore(state => state.assets);
    const addAsset = useAssetStore(state => state.addAsset);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState("");
    const [title, setTitle] = useState("");
    const prompts = assets.filter((a): a is TextAsset => a.kind === "text" && !a.deletedAt).filter(a => `${a.title} ${a.data.content} ${a.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
    function save() {
        if (!value.trim() || !title.trim()) return;
        const exists = assets.some(a => a.kind === "text" && !a.deletedAt && a.data.content === value.trim());
        if (exists) { message.info("这条提示词已经保存在我的资产中"); setSaving(false); return; }
        addAsset({kind: "text", title: title.trim(), coverUrl: "", tags: ["常用提示词"], source: "画布", data: {content: value.trim()} });
        message.success("已收藏到我的资产"); setSaving(false);
    }
    return <div className="flex flex-wrap gap-1" data-canvas-shortcuts-ignore>
        <Popover trigger="click" open={open} onOpenChange={setOpen} title="常用提示词" content={<div className="w-72 max-w-[70vw] space-y-3" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
            <Input aria-label="搜索常用提示词" prefix={<Search className="size-4" />} placeholder="搜索标题、内容或标签" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="max-h-64 space-y-1 overflow-y-auto">
                {prompts.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录，可先收藏当前提示词" />}
                {prompts.map(p => <button key={p.id} type="button" className="block w-full rounded-lg px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { onApply(p.data.content); setOpen(false); message.success("已填入提示词"); }}>
                    <strong className="block truncate text-sm">{p.title}</strong><span className="line-clamp-2 text-xs opacity-60">{p.data.content}</span>
                </button>)}
            </div><p className="text-xs opacity-50">点击替换当前输入。可在我的资产中编辑、分类或导出。</p>
        </div>}><Button type="text" size="small" icon={<BookOpen className="size-3.5" />}>常用提示词</Button></Popover>
        <Popover trigger="click" open={saving} onOpenChange={next => { setSaving(next); if(next) setTitle(value.trim().split("\n")[0].slice(0,32)); }} title="收藏提示词" content={<div className="w-64 space-y-3" onPointerDown={e => e.stopPropagation()}><Input aria-label="提示词名称" maxLength={80} placeholder="给提示词起个名字" value={title} onChange={e => setTitle(e.target.value)} onPressEnter={save} /><Button block type="primary" disabled={!title.trim() || !value.trim()} onClick={save}>保存到我的资产</Button></div>}><Button type="text" size="small" disabled={!value.trim()} icon={<Bookmark className="size-3.5" />}>收藏当前</Button></Popover>
    </div>;
}
