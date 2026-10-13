import { useEffect, useRef, useState } from "react";
import { App, Modal } from "antd";
import { useBlocker } from "react-router-dom";

export function CanvasGenerationLeaveGuard({ count, onDiscard }: { count: number; onDiscard: () => Promise<void> }) {
    const blocker = useBlocker(({ currentLocation, nextLocation }) => count > 0 && currentLocation.pathname !== nextLocation.pathname);
    const [leaving, setLeaving] = useState(false);
    const leavingRef = useRef(false);
    const { message } = App.useApp();
    useEffect(() => {
        if (!count) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [count]);
    useEffect(() => {
        if (!count && blocker.state === "blocked" && !leavingRef.current) blocker.proceed();
    }, [count, blocker]);
    return <Modal title="还有未完成的生成任务" open={blocker.state === "blocked"} centered okText="停止任务并离开" cancelText="留在画布" okButtonProps={{ danger: true, loading: leaving }} cancelButtonProps={{ disabled: leaving }} closable={!leaving} maskClosable={!leaving} keyboard={!leaving} onCancel={() => { if (!leaving && blocker.state === "blocked") blocker.reset(); }} onOk={async () => {
        if (leavingRef.current || blocker.state !== "blocked") return;
        leavingRef.current = true;
        setLeaving(true);
        try {
            await onDiscard();
            blocker.proceed();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败，请留在画布重试");
            blocker.reset();
        } finally {
            leavingRef.current = false;
            setLeaving(false);
        }
    }} wrapProps={{ "data-canvas-shortcuts-ignore": true, "data-canvas-no-zoom": true }}>
        <p className="text-sm leading-6">本画布还有 {count} 个任务。离开会请求停止正在执行的生成，并移除等待任务；等待队列无法在重新进入后恢复。已保存的作品和历史记录会保留。</p>
    </Modal>;
}
