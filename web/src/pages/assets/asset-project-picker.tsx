import { useMemo, useState } from "react";
import { Button, Input, Modal, Select } from "antd";
import { ArrowRight, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { Asset } from "@/stores/use-asset-store";

export function AssetProjectPicker({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
    const navigate = useNavigate();
    const projects = useCanvasStore((state) => state.projects);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const [projectId, setProjectId] = useState<string>();
    const [creating, setCreating] = useState(false);
    const [title, setTitle] = useState("");
    const options = useMemo(() => [...projects].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)).map((project) => ({ value: project.id, label: project.title })), [projects]);
    const isNew = creating || !projects.length;
    const canInsert = hydrated && (isNew ? Boolean(title.trim()) : projects.some((project) => project.id === projectId));

    const insert = () => {
        if (!asset || !canInsert) return;
        const targetId = isNew ? createProject(title.trim()) : projectId;
        navigate(`/canvas/${targetId}?asset=${encodeURIComponent(asset.id)}`);
        onClose();
    };

    return (
        <Modal title="插入画布" open={Boolean(asset)} onCancel={onClose} onOk={insert} okText={isNew ? "新建并插入" : "打开并插入"} okButtonProps={{ disabled: !canInsert, icon: <ArrowRight className="size-4" /> }} cancelText="取消" destroyOnHidden afterClose={() => { setProjectId(undefined); setCreating(false); setTitle(""); }}>
            <p className="mb-5 break-words text-sm text-slate-600 dark:text-stone-300">选择「{asset?.title}」要插入的项目。原素材会保留在资产库。</p>
            {isNew ? (
                <div className="space-y-3">
                    <label htmlFor="asset-new-project" className="block text-sm font-medium">{projects.length ? "新项目名称" : "先创建一个项目"}</label>
                    <Input id="asset-new-project" autoFocus value={title} maxLength={200} placeholder="例如：秋季产品短片" onChange={(event) => setTitle(event.target.value)} onPressEnter={insert} />
                    {projects.length ? <Button type="link" className="!px-0" onClick={() => setCreating(false)}>选择已有项目</Button> : null}
                </div>
            ) : (
                <div className="space-y-3">
                    <label htmlFor="asset-target-project" className="block text-sm font-medium">目标项目</label>
                    <Select id="asset-target-project" className="w-full" showSearch optionFilterProp="label" placeholder="选择要继续创作的项目" value={projectId} options={options} onChange={setProjectId} loading={!hydrated} />
                    <Button type="link" className="!px-0" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>新建项目并插入</Button>
                </div>
            )}
        </Modal>
    );
}
