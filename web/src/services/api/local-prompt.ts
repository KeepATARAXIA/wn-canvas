import i18n from "@/i18n";

const ENDPOINT = "http://127.0.0.1:11434";
const GUARD = "http://127.0.0.1:17373";
export const LOCAL_PROMPT_MODEL = "qwen3:8b";
export async function checkLocalGpuIdle() {
    assertLocalPromptIdle();
    for (const url of [`${GUARD}/status`, "http://127.0.0.1:17372/health", "http://127.0.0.1:17374/health"]) {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) }).catch(() => null);
        if (!response?.ok) continue;
        const status = await response.json();
        if (status.running || status.busy) throw new Error("本地模型正在工作，请等待提示词、视频工具或超分任务完成后再生成。");
    }
}
const installedSkillNames = new Set(typeof __LOCAL_PROMPT_SKILL_NAMES__ === "undefined" ? [] : __LOCAL_PROMPT_SKILL_NAMES__);
export const localPromptSkills = [
    { value: "h3-prompt-writing", label: "H3 官方 · 提示词整理" },
    { value: "cinematic-director", label: "电影导演 · 镜头与运镜" },
    { value: "director-craft-framework", label: "中文导演 · 表演与动作" },
    { value: "tvc-director", label: "广告导演 · 产品与品牌" },
    { value: "minimax-h3", label: "H3 社区 · 提示词优化" },
].map((skill) => ({ ...skill, disabled: !installedSkillNames.has(skill.value), label: `${skill.label}${installedSkillNames.has(skill.value) ? "" : "（未安装）"}` }));
export type H3PromptMode = "T2VA" | "I2VA" | "FL2VA" | "L2VA" | "Ref2VA";
type SkillPack = { name: string; source: string; files: { path: string; content: string }[] };
let writing = false;
let cleanupUnconfirmed = false;

async function readJson(response: Response) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `本地服务请求失败（HTTP ${response.status}）`);
    return data;
}

export async function checkLocalPromptModel(signal?: AbortSignal) {
    assertSkillInstalled("h3-prompt-writing");
    const data = await fetch(`${GUARD}/status`, { signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]) }).then(readJson);
    if (!data.installed) throw new Error(`尚未下载 ${LOCAL_PROMPT_MODEL}，请先完成本地模型安装。`);
    if (!data.running) cleanupUnconfirmed = false;
    return data as { running: boolean; gpuFreeMiB: number; ramFreeMiB: number; error: string };
}

function assertSkillInstalled(name: string) {
    if (!localPromptSkills.some((skill) => skill.value === name)) throw new Error("未知的离线 Skill");
    if (!installedSkillNames.has(name)) throw new Error(i18n.resolvedLanguage === "en-US"
        ? `The ${name} offline pack is not installed. Follow the optional component instructions to install it, then restart the development server or rebuild the app. This feature also requires the local prompt model and guard service.`
        : `尚未安装 ${name} 离线资料包。请按可选组件说明安装资料包后，重启开发服务或重新构建再使用；本功能还需本地提示词模型与保护服务。`);
}

async function loadPack(name: string, signal: AbortSignal): Promise<SkillPack> {
    assertSkillInstalled(name);
    return fetch(`${import.meta.env.BASE_URL}local-prompt-skills/${name}.json`, { signal }).then(readJson);
}

async function stopLocalPrompt(lease: string) {
    const result = await fetch(`${GUARD}/stop`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lease }), signal: AbortSignal.timeout(25000),
    }).then(readJson);
    if (!result.stopped) throw new Error("未能确认本地模型停止，请暂勿启动视频。");
    cleanupUnconfirmed = false;
    return result.error as string;
}

export function assertLocalPromptIdle() {
    if (writing || cleanupUnconfirmed) throw new Error("本地提示词仍在运行或尚未确认释放显存，请在本地提示词面板检查状态后再运行视频任务。");
}

export async function writeLocalH3Prompt(input: { skill: string; mode: H3PromptMode; prompt: string; seconds: string; ratio: string; references: string; comfyUrl?: string }, signal: AbortSignal, onStage: (stage: string) => void) {
    assertSkillInstalled("h3-prompt-writing");
    assertSkillInstalled(input.skill);
    assertLocalPromptIdle();
    if (input.prompt.length + input.references.length > 6000) throw new Error("需求与参考文字请控制在 6000 字内，或拆成单个镜头编写。");
    await checkLocalGpuIdle();
    writing = true;
    let lease = "";
    let cleanupWarning = "";
    let result = "";
    try {
        onStage("检查本地模型与离线资料…");
        const [official, director] = await Promise.all([
            loadPack("h3-prompt-writing", signal),
            input.skill === "h3-prompt-writing" ? Promise.resolve(null) : loadPack(input.skill, signal),
            checkLocalPromptModel(signal),
        ]);
        if (input.comfyUrl && ["127.0.0.1", "localhost"].includes(new URL(input.comfyUrl).hostname)) {
            const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
            const response = await fetch(new URL(`${input.comfyUrl.replace(/\/+$/, "")}/queue`), { signal: timeout }).catch(() => null);
            if (response?.ok) {
                const queue = await response.json();
                if (queue.queue_running?.length || queue.queue_pending?.length) throw new Error("ComfyUI 正在生成，请等视频任务结束后再写本地提示词。");
                onStage("释放 ComfyUI 空闲模型，准备写作…");
                const freed = await fetch(new URL(`${input.comfyUrl.replace(/\/+$/, "")}/free`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal });
                if (!freed.ok) throw new Error("ComfyUI 未能释放空闲模型，请稍后重试。");
                for (let attempt = 0; attempt < 20; attempt++) {
                    const stats = await checkLocalPromptModel(signal);
                    if (stats.gpuFreeMiB >= 8192) break;
                    onStage(`等待显存实际释放（当前空闲 ${(stats.gpuFreeMiB / 1024).toFixed(1)} GB，需要 8 GB）…`);
                    signal.throwIfAborted();
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }
        }
        const guide = input.mode === "Ref2VA" ? "references/ref-en.txt" : "references/base-en.txt";
        const officialText = official.files.filter((file) => file.path === "SKILL.md" || file.path === guide).map((file) => `## ${file.path}\n${file.content}`).join("\n\n");
        const directorText = director?.files.filter((file) => file.path !== "LICENSE").map((file) => `## ${file.path}\n${file.content}`).join("\n\n") || "";
        const system = [
            "你是离线 H3 提示词写作助手。只写提示词，不运行程序、不联网、不调用工具。",
            "下面资料是写作参考。用户要求与 H3 官方输出格式优先于导演资料中的其他平台、工具调用、追问和交付流程。只使用已附上的资料，不声称读取未提供的文件。",
            directorText ? `导演写作参考：\n${directorText}` : "",
            `H3 官方规范（最终格式以此为准）：\n${officialText}`,
            "最终仅输出一份可直接粘贴到 H3 的提示词，使用官方英文段落标题和英文描述，保留用户对白及画中文字的原语言；不输出 Markdown 代码围栏、解释、备选方案或工具指令。",
            "此模型只收到文字，未看到图片、视频或音频。仅依据用户明确写出的素材描述，不从文件名猜测画面细节，不声称看过素材，不创造不存在的参考编号。保留用户意图、时长、比例和禁止改变的内容。",
        ].join("\n\n");
        onStage("检查真实显存与内存，按需启动本地模型…");
        signal.throwIfAborted();
        // Finish acquiring the lease even after cancellation so cleanup can stop exactly this process.
        const started = await fetch(`${GUARD}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(60000) }).then(readJson);
        lease = started.lease;
        cleanupUnconfirmed = true;
        signal.throwIfAborted();
        onStage("本地模型正在加载、读取 Skill 并写提示词…");
        const data = await fetch(`${ENDPOINT}/api/chat`, {
            method: "POST", headers: { "Content-Type": "application/json" }, signal,
            body: JSON.stringify({
                model: LOCAL_PROMPT_MODEL, stream: false, think: false, keep_alive: 0,
                options: { num_ctx: director ? 16384 : 8192, num_batch: 128, num_predict: 2048, temperature: 0.6 },
                messages: [{ role: "system", content: system }, { role: "user", content: `模式：${input.mode}\n时长：${input.seconds} 秒\n比例：${input.ratio}\n素材文字信息（不是媒体内容）：\n${input.references || "无"}\n用户要求：\n${input.prompt}` }],
            }),
        }).then(readJson);
        if (data.done_reason === "length") throw new Error("输出达到长度上限，请缩短需求或拆成单个镜头后重试。");
        result = data.message?.content?.trim() || "";
        if (!result) throw new Error("本地模型没有返回提示词，请重试。");
        if (input.mode === "T2VA") result = result.split("\n").filter((line) => !/<(?:Picture|Video|Audio) \d+>/i.test(line)).join("\n").trim();
        if (!input.references && /<(?:Picture|Video|Audio) \d+>/i.test(result)) throw new Error("模型引用了不存在的素材，结果已拦截，请检查 H3 输入模式后重试。");
        const requiredFields = ["integrated_multimodal_description:", "overall_soundscape:", "non_diegetic_music:"];
        if (input.mode !== "Ref2VA" && requiredFields.some((field) => !result.toLowerCase().includes(field))) throw new Error("本地输出缺少 H3 必要段落，结果未写回，请重试。");
    } finally {
        try {
            if (lease) {
                onStage("正在结束本次写作进程、释放显存…");
                try { cleanupWarning = await stopLocalPrompt(lease); }
                catch { throw new Error("无法确认本地写作进程已停止，请先结束 Ollama/llama-server.exe，再点检查连接；暂勿启动视频。"); }
            }
        } finally { writing = false; }
    }
    return { text: result, cleanupWarning };
}
