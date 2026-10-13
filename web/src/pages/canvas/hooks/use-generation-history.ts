import { useCallback, useEffect, useReducer, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import { backfillGenerationHistory, recordGenerationChanges, type GenerationRecord } from "@/lib/canvas/generation-history";
import type { CanvasNodeData } from "@/types/canvas";
import { completedGenerationPreferences, type GenerationPreferenceCompletions } from "@/lib/canvas/generation-preferences";
import { modelMatchesCapability, useConfigStore } from "@/stores/use-config-store";
import { ensureGroupColors } from "@/lib/canvas/canvas-group-colors";

type State = { nodes: CanvasNodeData[]; history: GenerationRecord[]; completed: GenerationPreferenceCompletions };
type Action = { type: "restore"; nodes: CanvasNodeData[]; history: GenerationRecord[]; now: number }
    | { type: "update"; value: SetStateAction<CanvasNodeData[]>; now: number; id: string; track: boolean };

function reducer(state: State, action: Action): State {
    if (action.type === "restore") {
        const nodes = ensureGroupColors(action.nodes);
        return { nodes, history: backfillGenerationHistory(nodes, action.history, action.now), completed: {} };
    }
    // Color new/legacy groups once; preserve snapshot colors during undo/redo.
    const nodes = ensureGroupColors(typeof action.value === "function" ? action.value(state.nodes) : action.value, action.track ? state.nodes : undefined);
    if (nodes === state.nodes) return state;
    const history = action.track ? recordGenerationChanges(state.nodes, nodes, state.history, action.now, action.id) : state.history;
    const completed = action.track ? completedGenerationPreferences(state.nodes, nodes, history) : {};
    return { nodes, history, completed: completed.image || completed.video ? { ...state.completed, ...completed } : state.completed };
}

export function useGenerationHistory() {
    const [state, dispatch] = useReducer(reducer, { nodes: [], history: [], completed: {} });
    useEffect(() => {
        const { config, updateConfig } = useConfigStore.getState();
        const { image, video } = state.completed;
        if (image && modelMatchesCapability(config, image.model, "image") && image.completedAt > (config.lastImageGeneration?.completedAt || 0)) updateConfig("lastImageGeneration", image);
        if (video && modelMatchesCapability(config, video.model, "video") && video.completedAt > (config.lastVideoGeneration?.completedAt || 0)) updateConfig("lastVideoGeneration", video);
    }, [state.completed]);
    // Timestamp outside the reducer: React may replay an updater in Strict Mode.
    const setNodes = useCallback((value: SetStateAction<CanvasNodeData[]>) => dispatch({ type: "update", value, now: Date.now(), id: nanoid(), track: true }), []);
    const setNodesWithoutHistory = useCallback((value: SetStateAction<CanvasNodeData[]>) => dispatch({ type: "update", value, now: Date.now(), id: nanoid(), track: false }), []);
    const restoreNodes = useCallback((nodes: CanvasNodeData[], history: GenerationRecord[]) => dispatch({ type: "restore", nodes, history, now: Date.now() }), []);
    return { ...state, setNodes, setNodesWithoutHistory, restoreNodes };
}
