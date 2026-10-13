import { useEffect, useRef } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";

export function useCanvasPanelLayout() {
    const agentOpen = useAgentStore(state => state.panelOpen);
    const agentWidth = useAgentStore(state => state.width);
    const historyOpen = useCanvasSidePanelStore(state => state.panelOpen);
    const historyWidth = useCanvasSidePanelStore(state => state.width);
    const previous = useRef({ agentOpen, historyOpen });
    useEffect(() => {
        const historyJustOpened = historyOpen && !previous.current.historyOpen;
        const fit = () => {
            if (!agentOpen || !historyOpen || window.innerWidth - agentWidth - historyWidth >= 800) return;
            if (historyJustOpened) useAgentStore.getState().closePanel();
            else useCanvasSidePanelStore.getState().closePanel();
        };
        fit();
        previous.current = { agentOpen, historyOpen };
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, [agentOpen, historyOpen, agentWidth, historyWidth]);
}
