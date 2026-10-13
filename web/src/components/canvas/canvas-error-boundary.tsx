import { Component, type ErrorInfo, type ReactNode } from "react";

// Keep recovery independent of the UI library: its portals may be the failing subtree.
export class CanvasErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; componentStack: string }> {
    state = { error: null as Error | null, componentStack: "" };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(_error: Error, info: ErrorInfo) {
        this.setState({ componentStack: info.componentStack || "" });
    }

    render() {
        const { error, componentStack } = this.state;
        if (!error) return this.props.children;
        return <main className="flex h-dvh items-center justify-center overflow-auto bg-background p-8 text-foreground">
            <div className="w-full max-w-3xl space-y-4">
                <h1 className="text-xl font-semibold">画布暂时无法显示</h1>
                <p>界面发生错误。可以重新打开；此操作不会清除已保存的画布和素材。</p>
                <div className="flex gap-4">
                    <button className="rounded-lg border px-4 py-2" onClick={() => window.location.reload()}>重新打开</button>
                    <a className="rounded-lg border px-4 py-2" href="/canvas">返回画布列表</a>
                </div>
                <details open>
                    <summary className="cursor-pointer">错误详情（可复制给我排查）</summary>
                    <pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border p-3 text-xs select-text">{`${error.stack || error.message}\n\n组件位置：${componentStack || "正在获取…"}`}</pre>
                </details>
            </div>
        </main>;
    }
}
