import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { useAssetStore } from "@/stores/use-asset-store";
import { prepareAssetInsertPayload } from "./asset-payload";

type Options = {
    ready: boolean;
    onInsert: (payload: InsertAssetPayload, isCurrent: () => boolean) => Promise<void>;
    onError: (message: string) => void;
};

// The canvas owns its edit lock and insertion behavior. This hook only consumes
// the explicit project/asset request once the destination has finished loading.
export function useAssetInsertRequest({ ready, onInsert, onError }: Options) {
    const location = useLocation();
    const navigate = useNavigate();
    const current = useRef({ ...location, ready, visit: 0 });
    // A return to the same path is a new visit. Agent query/hash updates keep the
    // current visit so they cannot restart an insertion that is still decoding.
    const visit = current.current.visit + (current.current.pathname === location.pathname ? 0 : 1);
    current.current = { ...location, ready, visit };
    const mounted = useRef(false);
    const claimed = useRef<{ key: string } | null>(null);
    const handlers = useRef({ onInsert, onError });
    handlers.current = { onInsert, onError };

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        const assetId = new URLSearchParams(location.search).get("asset");
        if (!assetId) { claimed.current = null; return; }
        if (!ready) { claimed.current = null; return; }
        const requestVisit = current.current.visit;
        const requestKey = `${requestVisit}:${location.pathname}:${assetId}`;
        if (claimed.current?.key === requestKey) return;
        const request = { key: requestKey };
        claimed.current = request;
        const isCurrent = () => mounted.current && current.current.ready && current.current.visit === requestVisit && claimed.current === request && current.current.pathname === location.pathname && new URLSearchParams(current.current.search).get("asset") === assetId;
        const consume = () => {
            if (!isCurrent()) return;
            const query = new URLSearchParams(current.current.search);
            query.delete("asset");
            navigate({ pathname: current.current.pathname, search: query.toString() ? `?${query}` : "", hash: current.current.hash }, { replace: true, state: current.current.state });
        };
        const asset = useAssetStore.getState().assets.find((item) => item.id === assetId && !item.deletedAt);
        if (!asset) {
            handlers.current.onError("素材已被移除或尚未导入，请回到资产库重新选择。");
            consume();
            return;
        }
        void (async () => {
            try {
                const payload = await prepareAssetInsertPayload(asset);
                if (!useAssetStore.getState().assets.some((item) => item.id === assetId && !item.deletedAt)) throw new Error("素材已被移除或移入回收站，请先恢复后再插入。");
                if (isCurrent()) await handlers.current.onInsert(payload, isCurrent);
            } catch (error) {
                if (isCurrent()) handlers.current.onError(error instanceof Error && error.message ? `插入失败：${error.message}` : "插入失败，原素材已保留，请回到资产库重试。");
            } finally {
                consume();
            }
        })();
    }, [ready, location.key, location.pathname, location.search, navigate]);
}
