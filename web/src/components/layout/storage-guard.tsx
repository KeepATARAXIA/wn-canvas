import { useSyncExternalStore, type ReactNode } from "react";
import { Alert, Button, Spin } from "antd";

import { flushStateWrites, getStateStorageStatus, subscribeStateStorage } from "@/lib/localforage-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";

export function StorageGuard({ children }: { children: ReactNode }) {
    const status = useSyncExternalStore(subscribeStateStorage, getStateStorageStatus);
    const canvasReady = useCanvasStore((state) => state.hydrated);
    const assetsReady = useAssetStore((state) => state.hydrated);

    if (status.readError) {
        return (
            <main className="flex min-h-screen items-center justify-center p-8">
                <Alert className="max-w-2xl" type="error" showIcon message="本地数据未能安全加载"
                    description={<><p>已暂停编辑和写入。请勿清除浏览器数据。</p><p className="mt-2 whitespace-pre-wrap break-all">{status.readError}</p></>}
                    action={<Button onClick={() => window.location.reload()}>重新加载</Button>} />
            </main>
        );
    }
    if (!canvasReady || !assetsReady) return <main className="flex min-h-screen items-center justify-center"><Spin tip="正在读取本地作品"><div className="h-16 w-48" /></Spin></main>;

    return <>
        {status.writeError ? (
            <div className="fixed inset-x-4 top-3 z-[2000] mx-auto max-w-3xl">
                <Alert type="error" showIcon message="修改尚未保存，请保留此页面"
                    description={<><p>修改仍在当前页面中。请释放存储空间后重试，或先使用画布导出备份。</p><p className="mt-2 break-all">{status.writeError}</p></>}
                    action={<Button onClick={() => void flushStateWrites()}>重试保存</Button>} />
            </div>
        ) : null}
        {children}
    </>;
}
