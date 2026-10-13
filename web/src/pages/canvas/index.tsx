import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Dropdown, Input, Pagination, Select, Skeleton } from "antd";
import { ArrowRight, Download, Ellipsis, FileUp, FolderOpen, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { prepareCanvasImport } from "@/lib/canvas/canvas-package";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const [keyword, setKeyword] = useState("");
    const [sort, setSort] = useState("recent");
    const [page, setPage] = useState(1);
    const [importing, setImporting] = useState(false);
    const recent = useMemo(() => [...projects].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))[0], [projects]);
    const filtered = useMemo(() => projects.filter(project => String(project.title || "").toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())).sort((a, b) => sort === "name" ? String(a.title || "").localeCompare(String(b.title || ""), "zh-CN", { numeric: true }) : sort === "created" ? (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) : (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)), [projects, keyword, sort]);
    const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 12)));

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${id}${agentQuery}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const createAndEnter = () => enterProject(createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));
    const importCanvas = async (file?: File) => {
        if (!file || importing) return;
        setImporting(true);
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = prepareCanvasImport(JSON.parse(await projectFile.text()), zip);
            await Promise.all(data.assets.map(item => item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, item.blob) : setMediaBlob(item.storageKey, item.blob)));
            data.projects.forEach(importProject);
            setKeyword(""); setPage(1); setSort("recent");
            message.success(t("canvas.imported", { count: data.projects.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.importFailed"));
        } finally {
            setImporting(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(t("canvas.defaultTitle", { count: projects.length + 1 })) : recent?.id || createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));
    }, [createProject, hydrated, mode, projects, recent, t]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    return (
        <main className="workspace-page h-full overflow-auto px-4 py-8 sm:px-6" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6">
                <header className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold">我的项目</h1>
                        <p className="workspace-muted mt-2 text-sm">继续创作，或从一张空白画布开始。</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {selectedIds.length ? <span className="workspace-muted text-xs">已选择 {selectedIds.length} 个项目</span> : null}
                        <Dropdown trigger={["click"]} autoFocus menu={{ items: [
                            { key: "import", label: t("canvas.import"), icon: <FileUp className="size-4" />, disabled: !hydrated || importing, onClick: () => inputRef.current?.click() },
                            ...(selectedIds.length ? [
                                { key: "export-selected", label: t("canvas.exportSelected"), icon: <Download className="size-4" />, disabled: !hydrated, onClick: () => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `${t("canvas.title")}-${selectedIds.length}`).catch(error => message.error(String(error))) },
                                { key: "delete-selected", label: t("canvas.deleteSelected"), danger: true, disabled: !hydrated, onClick: () => setDeleteIds(selectedIds) },
                            ] : []),
                            ...(projects.length ? [{ key: "delete-all", danger: true, label: t("canvas.deleteAll"), disabled: !hydrated, onClick: () => setDeleteIds(projects.map(project => project.id)) }] : []),
                        ] }}><Button type="text" disabled={!hydrated} loading={importing} aria-label="项目管理" icon={<Ellipsis className="size-4" />}>更多</Button></Dropdown>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </div>
                </header>

                {hydrated && recent && <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
                    <div className="flex min-w-0 flex-1 items-center gap-3"><FolderOpen className="size-5 shrink-0" style={{ color: theme.node.activeStroke }} /><div className="min-w-0"><p className="workspace-muted text-xs">最近编辑</p><h2 className="mt-1 truncate text-base font-medium" title={recent.title}>{recent.title}</h2></div></div>
                    <Button onClick={() => enterProject(recent.id)} icon={<ArrowRight className="size-4" />} iconPlacement="end">继续创作</Button>
                </section>}

                {hydrated && projects.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3">
                    <Input className="!w-full sm:!w-80" prefix={<Search className="mr-1 size-4" style={{ color: theme.node.muted }} />} placeholder="搜索项目名称" aria-label="搜索项目名称" value={keyword} allowClear onChange={event => { setKeyword(event.target.value); setPage(1); }} />
                    <div className="flex items-center gap-3"><span className="workspace-muted text-sm">{filtered.length} 个项目</span><Select aria-label="项目排序" value={sort} className="w-36" onChange={value => { setSort(value); setPage(1); }} options={[{ value: "recent", label: "最近编辑" }, { value: "created", label: "最近创建" }, { value: "name", label: "名称排序" }]} /></div>
                </div>}

                {!hydrated ? (
                    <section aria-label={t("canvas.loading")} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(key => <Skeleton key={key} active paragraph={{ rows: 5 }} />)}</section>
                ) : projects.length ? (
                    filtered.length ? <><div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-5">
                        {filtered.slice((currentPage - 1) * 12, currentPage * 12).map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>{filtered.length > 12 && <Pagination className="self-center" current={currentPage} pageSize={12} total={filtered.length} showSizeChanger={false} onChange={setPage} />}</> : <section className="py-16 text-center"><h2 className="text-base font-medium">没有找到匹配的项目</h2><p className="workspace-muted mt-2 text-sm">换个关键词，或查看全部项目。</p><Button className="mt-4" onClick={() => setKeyword("")}>清除搜索</Button></section>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border px-6 text-center" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
                        <h2 className="text-xl font-medium">{t("canvas.empty")}</h2>
                        <p className="workspace-muted mt-3 max-w-lg text-sm leading-6">新建画布后即可放入素材、连接生成步骤。已有项目 ZIP 也可以直接导入。</p>
                        <Button className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {t("canvas.create")}
                        </Button>
                    </section>
                )}
                <footer className="workspace-muted border-t pt-4 text-xs leading-5" style={{ borderColor: theme.node.stroke }}>项目保存在当前浏览器。换电脑或清理浏览器前，请导出项目备份。<a href="/about" className="ml-3 underline underline-offset-4">关于无限画布</a></footer>
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
