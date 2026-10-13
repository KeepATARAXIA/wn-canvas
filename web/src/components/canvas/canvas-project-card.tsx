import { Check, Download, Ellipsis, Pencil, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Dropdown, Input } from "antd";
import { useTranslation } from "react-i18next";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { CanvasProjectPreview } from "./canvas-project-preview";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const open = () => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    return (
        <article data-project-id={project.id} className="group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border transition-colors hover:!border-blue-500" style={{ background: theme.node.panel, borderColor: selected ? theme.node.activeStroke : theme.node.stroke }} onClick={() => !editing && open()}>
            <CanvasProjectPreview project={project} />
            <div className="flex items-start gap-3 px-4 pt-4">
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className="mt-1 size-4 shrink-0 accent-blue-600 dark:accent-stone-100"
                    aria-label={t("canvas.project.select", { name: project.title })}
                />
                {editing ? (
                    <Input className="min-w-0" value={editingTitle} aria-label={`${t("canvas.project.rename")}：${project.title}`} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveTitle(); if (event.key === "Escape") stopEditing(); }} autoFocus />
                ) : (
                    <button
                        type="button"
                        className="min-w-0 flex-1 cursor-pointer text-left"
                        title={project.title}
                        onClick={(event) => {
                            event.stopPropagation();
                            open();
                        }}
                    >
                        <h2 className="truncate text-base font-semibold">{project.title}</h2>
                        <p className="workspace-muted mt-1 text-xs leading-5">
                            {t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}
                        </p>
                    </button>
                )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
                <p className="workspace-muted text-xs">{t("canvas.project.updated", { date: new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</p>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                        <>
                            <Button type="text" size="small" shape="circle" icon={<Check className="size-4" />} onClick={saveTitle} aria-label={t("canvas.project.saveName")} />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label={t("canvas.project.cancelRename")} />
                        </>
                    ) : (
                        <Dropdown trigger={["click"]} autoFocus menu={{ items: [
                            { key: "export", label: t("canvas.project.export"), icon: <Download className="size-4" />, onClick: () => void exportCanvasProjects([project], project.title || t("canvas.title")).catch(error => message.error(String(error))) },
                            { key: "rename", label: t("canvas.project.rename"), icon: <Pencil className="size-4" />, onClick: () => startEditing(project.id, project.title) },
                            { key: "delete", label: t("canvas.project.delete"), icon: <Trash2 className="size-4" />, danger: true, onClick: () => setDeleteIds([project.id]) },
                        ] }}>
                            <Button type="text" shape="circle" icon={<Ellipsis className="size-4" />} aria-label={`更多操作：${project.title}`} />
                        </Dropdown>
                    )}
                </div>
            </div>
        </article>
    );
}
