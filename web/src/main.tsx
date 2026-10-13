import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { runWithCanvasEditor } from "@/lib/single-editor";

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

const root = createRoot(document.getElementById("root")!);
function showStartupMessage(title: string, description: string) {
    root.render(
        <main className="flex min-h-screen items-center justify-center bg-stone-50 p-8 text-stone-900">
            <section className="max-w-lg rounded-xl border border-stone-200 bg-white p-8">
                <h1 className="text-xl font-semibold">{title}</h1>
                <p className="mt-3 text-sm leading-6 text-stone-600">{description}</p>
                <button className="mt-6 rounded-md bg-stone-900 px-4 py-2 text-sm text-white" onClick={() => window.location.reload()}>重新打开</button>
            </section>
        </main>,
    );
}

void runWithCanvasEditor(
    async () => { const { renderApp } = await import("./app"); renderApp(root); },
    () => showStartupMessage("画布已在另一个页面打开", "请回到原页面继续编辑。若要在这里操作，请等待原页面保存完成并关闭它，再点击重新打开。"),
).catch((error) => showStartupMessage("暂时无法打开画布", error instanceof Error ? error.message : String(error)));
