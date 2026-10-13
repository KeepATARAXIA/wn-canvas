import { useEffect, useRef } from "react";
import type { CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasNodeData } from "@/types/canvas";
import { getVideoToolRuntime, registerVideoProject } from "@/lib/canvas/video-tool-runtime";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { flushStateWrites, getStateStorageStatus } from "@/lib/localforage-storage";

export function useVideoTools(projectId: string, host: CanvasPluginHost, nodes: CanvasNodeData[], ready: boolean) {
    const hostRef = useRef(host);
    hostRef.current = host;
    useEffect(() => {
        if (ready) return registerVideoProject(projectId, () => hostRef.current, async (nodeId, jobId) => {
            // A submission may finish after the user switches projects. Save to
            // the original project without writing into the new page's nodes.
            const store = useCanvasStore.getState();
            const project = store.projects.find(project => project.id === projectId);
            if (!project?.nodes.some(node => node.id === nodeId)) return;
            store.updateProject(projectId, { nodes: project.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, videoToolJobId: jobId } } : node) });
            await flushStateWrites();
            const storage = getStateStorageStatus();
            if (storage.readError || storage.writeError) throw new Error(`任务标识 ${jobId} 本地保存失败，请保留此标识并检查浏览器存储`);
        });
    }, [projectId, ready]);
    useEffect(() => {
        if (ready) getVideoToolRuntime(projectId)?.sync(nodes);
    }, [projectId, nodes, ready]);
    useEffect(() => {
        if (!ready) return;
        let frame = 0;
        const openCreated = (event: Event) => {
            const id = (event as CustomEvent<string>).detail;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (hostRef.current.getNode(id)?.type === "video-tool:restore") hostRef.current.openPanel(id);
            });
        };
        window.addEventListener("canvas-focus-created-video", openCreated);
        return () => { cancelAnimationFrame(frame); window.removeEventListener("canvas-focus-created-video", openCreated); };
    }, [projectId, ready]);
}
