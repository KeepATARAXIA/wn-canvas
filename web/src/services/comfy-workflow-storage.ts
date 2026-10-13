import localforage from "localforage";
import { nanoid } from "nanoid";

import qwenImage21T2i from "@/services/api/templates/qwen-image21-t2i-api.json?raw";
import qwenImage21Edit from "@/services/api/templates/qwen-image21-edit-api.json?raw";
import qwenImage21TurboT2i from "@/services/api/templates/qwen-image21-turbo-t2i-api.json?raw";
import qwenImage21TurboEdit from "@/services/api/templates/qwen-image21-turbo-edit-api.json?raw";
import type { ComfyWorkflow, ComfyWorkflowPreset } from "@/types/comfy-workflow";

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "comfy_workflows" });

export async function saveComfyWorkflowPreset(input: Omit<ComfyWorkflowPreset, "id" | "updatedAt"> & { id?: string }) {
    const preset: ComfyWorkflowPreset = { ...input, id: input.id || `workflow:${nanoid()}`, updatedAt: new Date().toISOString() };
    await store.setItem(preset.id, preset);
    return preset;
}

export async function getComfyWorkflowPreset(id: string) {
    const saved = await store.getItem<ComfyWorkflowPreset>(id);
    if (saved) return saved;
    if (id === "builtin:qwen-image21-t2i") return {
        id,
        name: "Qwen-Image 2.1 · 生图",
        capability: "image",
        workflow: parseComfyWorkflow(JSON.parse(qwenImage21T2i)),
        mapping: {
            prompt: { nodeId: "4", inputName: "prompt" },
            ratio: { nodeId: "5", inputName: "aspect_ratio" },
            seed: { nodeId: "7", inputName: "seed" },
            imageSlots: [], videoSlots: [], audioSlots: [], outputNodeId: "9",
        },
        updatedAt: "2026-09-23T00:00:00.000Z",
    } satisfies ComfyWorkflowPreset;
    if (id === "builtin:qwen-image21-edit") return {
        id,
        name: "Qwen-Image 2.1 · 编辑",
        capability: "image",
        workflow: parseComfyWorkflow(JSON.parse(qwenImage21Edit)),
        mapping: {
            prompt: { nodeId: "4", inputName: "prompt" },
            seed: { nodeId: "6", inputName: "seed" },
            imageSlots: Array.from({ length: 10 }, (_, index) => ({ nodeId: String(index + 10), inputName: "image" })),
            videoSlots: [], audioSlots: [], outputNodeId: "8",
        },
        updatedAt: "2026-09-23T00:00:00.000Z",
    } satisfies ComfyWorkflowPreset;
    if (id === "builtin:qwen-image21-turbo-t2i") return {
        id,
        name: "Qwen-Image 2.1 Turbo · 生图",
        capability: "image",
        workflow: parseComfyWorkflow(JSON.parse(qwenImage21TurboT2i)),
        mapping: {
            prompt: { nodeId: "4", inputName: "prompt" },
            ratio: { nodeId: "5", inputName: "aspect_ratio" },
            seed: { nodeId: "7", inputName: "noise_seed" },
            imageSlots: [], videoSlots: [], audioSlots: [], outputNodeId: "9",
        },
        updatedAt: "2026-10-10T00:00:00.000Z",
    } satisfies ComfyWorkflowPreset;
    if (id === "builtin:qwen-image21-turbo-edit") return {
        id,
        name: "Qwen-Image 2.1 Turbo · 编辑",
        capability: "image",
        workflow: parseComfyWorkflow(JSON.parse(qwenImage21TurboEdit)),
        mapping: {
            prompt: { nodeId: "4", inputName: "prompt" },
            seed: { nodeId: "6", inputName: "noise_seed" },
            imageSlots: Array.from({ length: 10 }, (_, index) => ({ nodeId: String(index + 10), inputName: "image" })),
            videoSlots: [], audioSlots: [], outputNodeId: "8",
        },
        updatedAt: "2026-10-10T00:00:00.000Z",
    } satisfies ComfyWorkflowPreset;
    return null;
}

export async function deleteComfyWorkflowPreset(id: string) {
    await store.removeItem(id);
}

export function parseComfyWorkflow(value: unknown): ComfyWorkflow {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工作流 JSON 根节点必须是对象");
    const workflow = value as Record<string, unknown>;
    const entries = Object.entries(workflow);
    if (!entries.length) throw new Error("工作流中没有节点");
    for (const [nodeId, node] of entries) {
        if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error(`节点 ${nodeId} 格式不正确`);
        const inputs = (node as { inputs?: unknown }).inputs;
        if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new Error(`节点 ${nodeId} 缺少 inputs；请从 ComfyUI 导出 API 格式工作流`);
    }
    return workflow as ComfyWorkflow;
}
