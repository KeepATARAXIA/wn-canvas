import { Alert, App, Button, Drawer, Segmented } from "antd";
import { ArrowRight, BookOpen, Cloud, Copy, Download, HardDrive, PlugZap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";

import { comfyStartCommand, type LocalSetupModel } from "@/lib/model-setup";
import qwenGuide from "../../../public/model-setup/qwen.md?raw";
import h3Guide from "../../../public/model-setup/h3.md?raw";
import "./config-model-setup.css";

type SetupPath = "install" | "connect" | "cloud";

export function ConfigModelSetup({ onConfigureLocal, onConfigureCloud }: { onConfigureLocal: (kind: LocalSetupModel) => void; onConfigureCloud: () => void }) {
    const { i18n } = useTranslation();
    const { message } = App.useApp();
    const en = i18n.resolvedLanguage === "en-US";
    const [path, setPath] = useState<SetupPath | null>(null);
    const [model, setModel] = useState<LocalSetupModel>("qwen");
    const name = model === "qwen" ? "Qwen-Image 2.1" : "MiniMax-H3";
    const address = `http://127.0.0.1:${model === "qwen" ? "8189" : "8188"}`;
    const localOrigin = typeof window !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) && ["http:", "https:"].includes(window.location.protocol);
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
    const command = localOrigin ? comfyStartCommand(model, origin) : "";
    const choices = [
        { key: "install" as const, icon: Download, title: en ? "Install local models" : "安装本地模型", description: en ? "Downloads, folders and startup steps" : "查看下载地址、放置位置与启动步骤" },
        { key: "connect" as const, icon: PlugZap, title: en ? "Connect an existing service" : "连接已有服务", description: en ? "Use your running Qwen or H3 environment" : "接入已经能生成的千问或 H3 环境" },
        { key: "cloud" as const, icon: Cloud, title: en ? "Configure a cloud API" : "配置云端 API", description: en ? "Use your provider account; no model download" : "使用自己的服务账号，无需下载模型" },
    ];
    const configure = () => {
        setPath(null);
        if (path === "cloud") onConfigureCloud();
        else onConfigureLocal(model);
    };
    const copyCommand = async () => {
        try {
            await navigator.clipboard.writeText(command);
            message.success(en ? "Startup command copied" : "已复制启动命令");
        } catch {
            message.info(en ? "Select and copy the command below." : "请选中下方命令手动复制。");
        }
    };

    return <>
        <section className="config-section config-surface" aria-label={en ? "Model setup" : "模型安装与接入"}>
            <h2 className="config-section-heading">{en ? "Start using AI" : "开始使用 AI"}</h2>
            <p className="config-section-description">{en ? "This package includes the canvas. Choose how to provide its model service." : "画布已就绪，选择一种方式接入模型服务。"}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {choices.map((choice) => <button key={choice.key} type="button" onClick={() => setPath(choice.key)} className="rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-stone-700 dark:bg-stone-950/50">
                    <choice.icon className="mb-3 size-5 text-blue-600 dark:text-blue-300" />
                    <span className="flex items-center justify-between gap-2 text-sm font-semibold">{choice.title}<ArrowRight className="size-4 shrink-0" /></span>
                    <span className="mt-2 block text-xs leading-5 text-slate-600 dark:text-stone-300">{choice.description}</span>
                </button>)}
            </div>
        </section>
        <Drawer open={path !== null} onClose={() => setPath(null)} width={920} title={choices.find((choice) => choice.key === path)?.title} styles={{ body: { paddingTop: 16 } }}>
            {path === "cloud" ? <div className="space-y-5">
                <p className="text-sm leading-6">{en ? "Use the API address, key and supported model names from your provider. This does not install models on your computer." : "准备服务商提供的接口地址、API Key 和可用模型名称，无需在电脑上安装模型。"}</p>
                <ol className="list-decimal space-y-3 pl-5 text-sm leading-6">
                    <li>{en ? "Create a channel and choose the protocol supported by your provider." : "新建渠道，按服务商文档选择协议并填写接口地址。"}</li>
                    <li>{en ? "Enter your own key, select models and assign image, video, text or audio capabilities." : "填写自己的密钥，添加模型，并选择图片、视频、文本或音频能力。"}</li>
                    <li>{en ? "Test the connection, save, then select the model on a generation node." : "测试连接并保存，再到生成节点选择该模型。"}</li>
                </ol>
                <Alert type="info" showIcon message={en ? "Check the provider's usage and billing terms" : "费用与模型权限以服务商规则为准"} description={en ? "A successful connection does not prove generation compatibility. Keep configuration files containing keys private." : "连接成功仅确认接口可访问；模型能否生成还需实际验证。含密钥的配置文件请私下保存。"} />
                <Button type="primary" icon={<Cloud className="size-4" />} onClick={configure}>{en ? "Create an API channel" : "新建 API 渠道"}</Button>
            </div> : path ? <div className="space-y-5">
                <Segmented block value={model} onChange={(value) => setModel(value as LocalSetupModel)} aria-label={en ? "Local model type" : "本地模型类型"} options={[{ label: en ? "Qwen · images" : "千问 · 图片", value: "qwen" }, { label: en ? "H3 · video" : "H3 · 视频", value: "h3" }]} />
                {path === "install" ? <>
                    <Alert type={model === "qwen" ? "info" : "warning"} showIcon
                        message={model === "qwen" ? (en ? "Start with the Turbo image workflow" : "先从 Turbo 图片工作流开始") : (en ? "H3 requires a compatible backend" : "H3 需要配套的兼容后端")}
                        description={model === "qwen" ? (en ? "Turbo 1K generation and single-image editing passed with the official portable runtime on our RTX 5070 Ti 16GB. Start with 1024×1024 and one image. Read the license and hardware requirements before downloading." : "官方运行包下的 Turbo 1K 生图与单图编辑已在 RTX 5070 Ti 16GB 验证。首次请选择 1024×1024、1 张；下载前查看模型许可与硬件要求。") : (en ? "The full WN reference workflow uses additional backend patches. Read the compatibility limits before downloading large files." : "WN 的完整参考工作流依赖额外后端补丁。从零安装尚未形成完整交付，请先阅读兼容说明，已有可用环境可直接连接。")} />
                    <div className="flex flex-wrap gap-2">
                        <Button icon={<BookOpen className="size-4" />} href="https://docs.comfy.org/installation/comfyui_portable_windows" target="_blank" rel="noopener noreferrer">{en ? "ComfyUI official guide" : "ComfyUI 官方安装说明"}</Button>
                        <Button icon={<Download className="size-4" />} href={`${import.meta.env.BASE_URL}model-setup/${model}.md`} download={`${model}-installation.md`}>{en ? "Save this guide" : "保存安装指南"}</Button>
                    </div>
                    {en ? <p className="text-xs text-slate-500">The detailed installation guides are currently available in Chinese.</p> : null}
                    <div className="model-setup-markdown"><Streamdown mode="static" skipHtml components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{model === "qwen" ? qwenGuide : h3Guide}</Streamdown></div>
                </> : <div className="space-y-4">
                    <p className="text-sm leading-6">{en ? `Confirm ${name} can generate directly in your backend, then connect it here.` : `先确认 ${name} 能在后端独立生成，再接入画布。现有环境无需重新下载模型。`}</p>
                    <Alert type="info" showIcon message={en ? "Review the address before saving" : "保存前核对接口地址"} description={en ? `The usual direct address is ${address}. Existing channel settings are preserved; edit the address if your port differs.` : `常用直连地址为 ${address}。已有渠道的地址、密钥和自定义模型会保留；端口不同时请按实际地址修改。`} />
                    {model === "h3" ? <p className="text-sm leading-6 text-amber-800 dark:text-amber-300">{en ? "This portable canvas does not provide the old /api/comfyui proxy. Replace that address with your backend's direct address in the channel editor." : "本运行包不提供旧的 /api/comfyui 代理。如果渠道仍使用该地址，请在编辑框中改为后端直连地址。"}</p> : null}
                    {model === "h3" ? <p className="text-sm leading-6">{en ? "A standard H3 backend may lack WN's reference-video extension. Check compatibility in the installation guide before connecting. For your first test, choose Native Quality and leave SageAttention off." : "普通 H3 后端可能缺少 WN 的参考视频扩展，请先查看安装指南中的兼容说明。首次测试选择“原生质量”，并保持“SageAttention 注意力加速”关闭。"}</p> : null}
                </div>}
                <section className="rounded-lg border border-slate-200 p-4 dark:border-stone-700" aria-label={en ? "Startup and connection" : "启动与连接"}>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4" />{en ? "Allow this canvas to connect" : "允许当前画布连接"}</h3>
                    <p className="mb-3 text-sm leading-6">{en ? "In a prepared official portable environment, run this in its root folder. Finish the installation steps above first; other launchers should use the equivalent port and CORS settings." : "完成上方安装准备后，可在官方便携环境的根目录运行下方命令。使用其他启动器时，设置对应端口和 CORS 参数即可。"}</p>
                    {command ? <>
                        <pre className="whitespace-pre-wrap break-all rounded-md bg-slate-100 p-3 text-xs leading-6 dark:bg-stone-900"><code>{command}</code></pre>
                        <Button className="mt-2" icon={<Copy className="size-4" />} onClick={() => void copyCommand()}>{en ? "Copy startup command" : "复制启动命令"}</Button>
                    </> : <Alert type="warning" showIcon message={en ? "Open the local canvas to get its CORS command" : "请从本机画布地址打开，获取对应 CORS 命令"} />}
                    <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-stone-300">{en ? "Keep the backend running. The command uses this page's origin; update CORS if you change the canvas port. Do not start another process on an occupied port." : "保持后端运行。命令使用当前画布地址；换画布端口后需同步调整 CORS。端口已被占用时，先确认现有服务，不要重复启动。"}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <Button type="primary" icon={<PlugZap className="size-4" />} onClick={configure}>{en ? `Configure ${name}` : `配置 ${name} 连接`}</Button>
                        {path === "install" ? <Button onClick={() => setPath("connect")}>{en ? "I already have a service" : "我已经有可用服务"}</Button> : <Button onClick={() => setPath("install")}>{en ? "View installation guide" : "查看安装指南"}</Button>}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-stone-300">{en ? "The next screen opens a draft. Test the connection and save explicitly. Then make a small generation to verify models, nodes and GPU compatibility." : "下一步打开渠道草稿，测试连接后再保存。最后做一次小尺寸生成，确认模型、节点和显存实际可用。"}</p>
                </section>
            </div> : null}
        </Drawer>
    </>;
}
