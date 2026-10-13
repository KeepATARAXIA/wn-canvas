// Acquire before importing the application: its stores hydrate during module evaluation.
export async function runWithCanvasEditor(start: () => Promise<void>, unavailable: () => void) {
    if (!navigator.locks) throw new Error("当前浏览器无法保护多页面编辑，请使用最新版 Chrome 或 Edge 打开本地画布。");
    await navigator.locks.request("infinite-canvas:editor", { ifAvailable: true }, async (lock) => {
        if (!lock) return unavailable();
        await start();
        // The browser releases this lock when the document closes, reloads, or crashes.
        await new Promise<void>(() => {});
    });
}
