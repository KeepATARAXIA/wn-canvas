import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Select } from "antd";
import { Cpu, Square } from "lucide-react";
import { checkLocalPromptModel, LOCAL_PROMPT_MODEL, localPromptSkills, writeLocalH3Prompt, type H3PromptMode } from "@/services/api/local-prompt";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

const modes: { value: H3PromptMode; label: string }[] = [
    { value: "T2VA", label: "文生视频" }, { value: "I2VA", label: "首帧图生视频" },
    { value: "FL2VA", label: "首尾帧" }, { value: "L2VA", label: "尾帧" }, { value: "Ref2VA", label: "全能参考" },
];

export default function CanvasLocalPromptDialog({ prompt, seconds, ratio, references, comfyUrl, onApply, onClose }: {
    prompt: string; seconds: string; ratio: string; references: CanvasResourceReference[]; comfyUrl: string;
    onApply: (prompt: string) => void; onClose: () => void;
}) {
    const [skill, setSkill] = useState("h3-prompt-writing");
    const [mode, setMode] = useState<H3PromptMode>(references.some((item) => item.kind !== "text") ? "Ref2VA" : "T2VA");
    const [draft, setDraft] = useState(prompt);
    const [result, setResult] = useState("");
    const [ready, setReady] = useState(false);
    const [checking, setChecking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [stage, setStage] = useState("");
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState("");
    const [warning, setWarning] = useState("");
    const [memory, setMemory] = useState("");
    const controller = useRef<AbortController | null>(null);
    const hasMedia = references.some((item) => item.kind !== "text");

    const check = async (signal?: AbortSignal) => {
        setChecking(true);
        setError("");
        try {
            const status = await checkLocalPromptModel(signal);
            setReady(!status.running);
            setMemory(`空闲显存 ${(status.gpuFreeMiB / 1024).toFixed(1)} GB · 内存 ${(status.ramFreeMiB / 1024).toFixed(1)} GB`);
            if (status.running) setError("已有本地写作任务，请先完成或停止原任务。");
        }
        catch (error) {
            if (signal?.aborted) return;
            setReady(false);
            setError(error instanceof TypeError ? "本地提示词保护服务未连接。基础画布启动不包含此服务，请先按可选组件说明配置并启动本地提示词服务。" : error instanceof Error ? error.message : "本地服务不可用");
        } finally { setChecking(false); }
    };

    useEffect(() => {
        const checkController = new AbortController();
        void check(checkController.signal);
        return () => { checkController.abort(); controller.current?.abort(); };
    }, []);

    useEffect(() => {
        if (!busy) return;
        const started = Date.now();
        setElapsed(0);
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, [busy]);

    const generate = async () => {
        if (busy || !draft.trim() || !ready) return;
        controller.current = new AbortController();
        setBusy(true);
        setError("");
        setWarning("");
        setResult("");
        try {
            const response = await writeLocalH3Prompt({ skill, mode, prompt: draft.trim(), seconds, ratio, comfyUrl,
                references: references.map((item) => `${item.kind} · ${item.title}${item.kind === "text" && item.text ? `：${item.text}` : "（未提供媒体内容，请以用户文字描述为准）"}`).join("\n"),
            }, AbortSignal.any([controller.current.signal, AbortSignal.timeout(8 * 60 * 1000)]), setStage);
            setResult(response.text);
            setWarning(response.cleanupWarning);
            setStage(response.cleanupWarning ? "提示词已生成，请检查显存释放提醒" : "已完成，本次 Ollama 进程已结束");
        } catch (error) {
            setStage("");
            setError(error instanceof Error && error.name === "AbortError" ? "已停止写作，原节点提示词未改动。" : error instanceof TypeError ? "本地连接中断，请检查 Ollama 服务后重试。不会转用云端模型。" : error instanceof Error ? error.message : "本地写作失败");
        } finally { setBusy(false); controller.current = null; }
    };

    return (
        <Modal open title="本地离线提示词" onCancel={onClose} closable={!busy} keyboard={!busy} maskClosable={!busy} footer={null} width={720} centered>
            <div data-canvas-no-zoom className="space-y-4 pt-2" onWheel={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 text-xs opacity-70">
                    <span>{LOCAL_PROMPT_MODEL} · {ready ? "按需启动已就绪" : "尚未就绪"} · 不消耗云端额度</span>
                    <Button type="text" size="small" loading={checking} disabled={busy} onClick={() => void check()}>检查连接</Button>
                </div>
                <p className="text-xs opacity-65">{memory} · 加载前需至少 8 GB 空闲显存、16 GB 空闲内存</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm"><span>写作 Skill</span><Select className="w-full" value={skill} options={localPromptSkills} onChange={setSkill} disabled={busy} /></label>
                    <label className="space-y-1 text-sm"><span>H3 输入模式</span><Select className="w-full" value={mode} options={modes} onChange={setMode} disabled={busy} /></label>
                </div>
                <p className="text-xs leading-5 opacity-65">{seconds} 秒 · {ratio} · 导演资料用于构思，最终统一按 H3 官方规范输出。离线模式只写作，不执行 Skill 脚本或访问网络资料。</p>
                <div className="space-y-1 text-sm leading-6">
                    <p className="font-medium">{hasMedia ? "已连接参考素材，但文字模型不能直接看图、看视频或听音频。" : "文字模型不能直接看图、看视频或听音频。"}</p>
                    <p className="opacity-65">点击「本地编写」才启动模型。会先释放 ComfyUI 空闲模型，再检查实际显存；完成或停止后结束本次 Ollama。请勿同时在其他页面运行视频或超分任务。</p>
                </div>
                {error ? <Alert type="error" showIcon title={error} /> : null}
                {warning ? <Alert type="warning" showIcon title={warning} /> : null}
                <label className="block space-y-2 text-sm"><span>你的要求 / 参考素材文字描述</span><Input.TextArea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} autoSize={{ minRows: 4, maxRows: 8 }} maxLength={6000} showCount placeholder="例如：5 秒，未来城市低机位仰拍，镜头缓慢抬升。保持参考图建筑布局，只让云层流动。" /></label>
                {result ? <label className="block space-y-2 text-sm"><span>结果预览（可编辑，确认后才写回）</span><Input.TextArea value={result} onChange={(event) => setResult(event.target.value)} autoSize={{ minRows: 6, maxRows: 12 }} /></label> : null}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <span className="text-xs opacity-65" role="status">{stage}{busy ? ` · ${elapsed} 秒` : ""}</span>
                    <div className="flex gap-2">
                        {busy ? <Button icon={<Square className="size-3" />} onClick={() => controller.current?.abort()}>停止</Button> : <Button icon={<Cpu className="size-4" />} disabled={!ready || !draft.trim()} onClick={() => void generate()}>{result ? "重新编写" : "本地编写"}</Button>}
                        <Button type="primary" disabled={busy || !result.trim()} onClick={() => onApply(result.trim())}>写回当前节点</Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
