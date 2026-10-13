import { getComfyWorkflowPreset } from "@/services/comfy-workflow-storage";
import { isQwenImageEditWorkflow } from "@/lib/qwen-image-mode";
import { resolveModelScript, resolveModelWorkflowId, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import type { ComfyWorkflowPreset } from "@/types/comfy-workflow";

export async function comfyWorkflowScript(workflowId: string, capability: ModelCapability) {
    const preset = await getComfyWorkflowPreset(workflowId);
    if (!preset) throw new Error("找不到这个 ComfyUI 工作流，请重新导入并映射");
    if (preset.capability !== capability) throw new Error(`工作流输出类型是${capabilityLabel(preset.capability)}，不能用于${capabilityLabel(capability)}`);
    const script = buildComfyWorkflowScript(preset);
    return isQwenImageEditWorkflow(workflowId) ? `if (!images?.length) throw new Error("Qwen-Image 2.1 编辑需要至少一张参考图片");\n${script}` : script;
}

export async function resolveModelExecutionScript(config: AiConfig, value: string, capability: ModelCapability) {
    const workflowId = resolveModelWorkflowId(config, value);
    return workflowId ? comfyWorkflowScript(workflowId, capability) : resolveModelScript(config, value);
}

export function buildComfyWorkflowScript(preset: ComfyWorkflowPreset) {
    const workflowJson = JSON.stringify(preset.workflow);
    const mappingJson = JSON.stringify(preset.mapping);
    const capabilityJson = JSON.stringify(preset.capability);
    const targetedCancelJson = JSON.stringify(preset.id.startsWith("builtin:qwen-image21-"));
    return `// Infinite Canvas ComfyUI workflow mapper
const WORKFLOW_TEMPLATE = ${workflowJson};
const MAPPING = ${mappingJson};
const OUTPUT_CAPABILITY = ${capabilityJson};
const TARGETED_CANCEL = ${targetedCancelJson};
const workflow = typeof structuredClone === "function" ? structuredClone(WORKFLOW_TEMPLATE) : JSON.parse(JSON.stringify(WORKFLOW_TEMPLATE));
const comfyUrl = String(baseUrl || "").replace(/\\/+$/, "");
if (!/^https?:\\/\\//i.test(comfyUrl)) throw new Error("Base URL 必须是 ComfyUI 地址，例如 http://127.0.0.1:8188");

function setBinding(binding, value) {
  if (!binding) return;
  const node = workflow[binding.nodeId];
  if (!node?.inputs) throw new Error(\`映射节点 \${binding.nodeId} 不存在\`);
  node.inputs[binding.inputName] = value;
}

function removeNodeAndReferences(nodeId) {
  delete workflow[nodeId];
  for (const [dependentId, node] of Object.entries(workflow)) {
    if (!node?.inputs) continue;
    let unusedAlphaJoin = false;
    for (const [name, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && String(value[0]) === String(nodeId)) {
        delete node.inputs[name];
        if (node.class_type === "JoinImageWithAlpha") unusedAlphaJoin = true;
      }
    }
    if (unusedAlphaJoin) removeNodeAndReferences(dependentId);
  }
}

function applyCustomDimensions(value) {
  const match = String(value || "").match(/^(\\d+)x(\\d+)$/i);
  if (!match || !MAPPING.ratio) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const sourceNodeId = String(MAPPING.ratio.nodeId);
  const sourceNode = workflow[sourceNodeId];
  if (!/resolution|size|dimension/i.test(\`\${sourceNode?.class_type || ""} \${sourceNode?._meta?.title || ""}\`)) return false;
  let replaced = false;
  for (const node of Object.values(workflow)) {
    if (!node?.inputs) continue;
    for (const [name, input] of Object.entries(node.inputs)) {
      if (!Array.isArray(input) || String(input[0]) !== sourceNodeId) continue;
      if (Number(input[1]) === 0) { node.inputs[name] = width; replaced = true; }
      if (Number(input[1]) === 1) { node.inputs[name] = height; replaced = true; }
    }
  }
  if (replaced) delete workflow[sourceNodeId];
  return replaced;
}

function setRatioBinding(binding, value) {
  if (!binding) return;
  const labels = {
    "1:1": "1:1 (Square)", "2:3": "2:3 (Portrait Photo)", "3:2": "3:2 (Photo)", "3:4": "3:4 (Portrait Standard)",
    "4:3": "4:3 (Standard)", "9:16": "9:16 (Portrait Widescreen)", "16:9": "16:9 (Widescreen)", "21:9": "21:9 (Ultrawide)",
  };
  const node = workflow[binding.nodeId];
  const current = node?.inputs?.[binding.inputName];
  const mapped = labels[value];
  setBinding(binding, mapped && (/resolutionselector/i.test(node?.class_type || "") || /^\\d+:\\d+\\s*\\(/.test(String(current || ""))) ? mapped : value);
}

function errorDetail(error) {
  const data = error?.response?.data;
  if (!data) return error?.message || String(error);
  if (typeof data === "string") return data;
  try { return JSON.stringify(data); } catch { return error?.message || String(error); }
}

async function mediaBlob(media, label) {
  if (media?.blob instanceof Blob) return media.blob;
  const source = typeof media === "string" ? media : media?.url;
  if (!source) throw new Error(\`\${label}没有可读取的文件\`);
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error(\`读取\${label}失败（HTTP \${response.status}）\`);
  return response.blob();
}

function extensionFor(name, type, fallback) {
  const existing = String(name || "").match(/\\.([a-z0-9]{1,8})$/i);
  if (existing) return \`.\${existing[1].toLowerCase()}\`;
  const byMime = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/flac": ".flac", "audio/ogg": ".ogg" };
  return byMime[String(type || "").toLowerCase()] || fallback;
}

async function uploadInput(value, kind, index) {
  const media = typeof value === "string" ? { url: value, name: \`reference_\${index + 1}\` } : value;
  const blob = await mediaBlob(media, \`第 \${index + 1} 个\${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}\`);
  const suffix = extensionFor(media?.name, blob.type, kind === "image" ? ".png" : kind === "video" ? ".mp4" : ".wav");
  const unique = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : \`\${Date.now()}_\${Math.random().toString(36).slice(2)}\`;
  const form = new FormData();
  form.append("image", blob, \`canvas_\${kind}_\${index + 1}_\${unique}\${suffix}\`);
  form.append("type", "input");
  form.append("subfolder", "infinite-canvas");
  form.append("overwrite", "true");
  const uploaded = await request({ method: "post", url: \`\${comfyUrl}/upload/image\`, data: form });
  if (!uploaded?.name) throw new Error("ComfyUI 上传接口没有返回文件名");
  return [uploaded.subfolder, uploaded.name].filter(Boolean).join("/");
}

async function applySlots(bindings, values, kind) {
  if (values.length > bindings.length) throw new Error(\`当前工作流最多支持 \${bindings.length} 个\${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}参考，实际收到 \${values.length} 个\`);
  const paths = await Promise.all(values.map((value, index) => uploadInput(value, kind, index)));
  bindings.forEach((binding, index) => paths[index] ? setBinding(binding, paths[index]) : removeNodeAndReferences(binding.nodeId));
}

try { await request({ method: "get", url: \`\${comfyUrl}/system_stats\` }); }
catch (error) { throw new Error(\`无法连接 ComfyUI（\${comfyUrl}）。请确认服务已启动并允许跨域访问。\${errorDetail(error)}\`); }

setBinding(MAPPING.prompt, prompt);
setBinding(MAPPING.duration, Math.max(1, Number(params.seconds) || 1));
const customDimensionsApplied = applyCustomDimensions(params.ratio || params.size);
if (!customDimensionsApplied) {
  setRatioBinding(MAPPING.ratio, params.ratio || params.size || "1:1");
  const resolution = Number.parseFloat(String(params.resolution || ""));
  setBinding(MAPPING.resolution, Number.isFinite(resolution) ? resolution : params.resolution);
}
setBinding(MAPPING.seed, Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
await applySlots(MAPPING.imageSlots || [], images || [], "image");
await applySlots(MAPPING.videoSlots || [], videos || [], "video");
await applySlots(MAPPING.audioSlots || [], audios || [], "audio");

const clientId = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : \`canvas_\${Date.now()}\`;
let socket = null;
if (typeof WebSocket === "function" && typeof onProgress === "function") {
  try {
    const wsUrl = comfyUrl.replace(/^http/i, "ws") + "/ws?clientId=" + encodeURIComponent(clientId);
    socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ComfyUI WebSocket 连接超时")), 5000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("ComfyUI WebSocket 连接失败")); }, { once: true });
    });
  } catch { socket = null; }
}
let queued;
try {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  queued = await request({ method: "post", url: \`\${comfyUrl}/prompt\`, headers: { "Content-Type": "application/json" }, data: { prompt: workflow, client_id: clientId }, ignoreAbort: TARGETED_CANCEL });
}
catch (error) {
  if (socket) socket.close();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  throw new Error(\`ComfyUI 拒绝了工作流：\${errorDetail(error)}\`);
}
if (!queued?.prompt_id) {
  if (socket) socket.close();
  throw new Error("ComfyUI 没有返回任务 ID");
}
const promptId = queued.prompt_id;
const closeSocket = () => { if (socket) { try { socket.close(); } catch {} socket = null; } };
let cancelPromise = null;
const cancelPrompt = () => {
  if (!TARGETED_CANCEL || cancelPromise) return;
  cancelPromise = request({ method: "post", url: \`\${comfyUrl}/api/jobs/\${encodeURIComponent(promptId)}/cancel\`, timeout: 10000, ignoreAbort: true })
    .catch((error) => { throw new Error(\`取消 ComfyUI 任务失败：\${errorDetail(error)}\`); });
};
if (signal?.aborted) cancelPrompt();
signal?.addEventListener("abort", cancelPrompt, { once: true });
if (socket) {
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message?.type === "progress" && message.data?.prompt_id === promptId && typeof message.data?.value === "number" && message.data?.max > 0) {
        onProgress(Math.max(0, Math.min(100, (message.data.value / message.data.max) * 100)));
      }
    } catch { /* ignore non-JSON frames */ }
  });
}
let outputFile;
try {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  outputFile = await poll(
  () => request({ method: "get", url: \`\${comfyUrl}/history/\${encodeURIComponent(promptId)}\` }),
  (history) => {
    const entry = history?.[promptId];
    if (!entry) return null;
    if (entry.status?.status_str === "error") {
      const failure = (entry.status?.messages || []).find((item) => item?.[0] === "execution_error")?.[1];
      throw new Error(\`ComfyUI 执行失败：\${failure?.exception_message || failure?.exception_type || "未知错误"}\`);
    }
    const output = entry.outputs?.[MAPPING.outputNodeId];
    const files = output ? Object.values(output).flatMap((value) => Array.isArray(value) ? value : []) : [];
    const pattern = OUTPUT_CAPABILITY === "image" ? /\\.(png|jpe?g|webp|gif)(\\?.*)?$/i : OUTPUT_CAPABILITY === "audio" ? /\\.(mp3|wav|flac|ogg|m4a|aac)(\\?.*)?$/i : /\\.(mp4|mov|webm|mkv)(\\?.*)?$/i;
    const file = files.find((item) => item?.filename && pattern.test(item.filename)) || files.find((item) => item?.filename);
    if (file) return file;
    if (entry.status?.completed === true || entry.status?.status_str === "success") throw new Error(\`输出节点 \${MAPPING.outputNodeId} 没有返回\${OUTPUT_CAPABILITY === "image" ? "图片" : OUTPUT_CAPABILITY === "audio" ? "音频" : "视频"}文件\`);
    return null;
  },
  { intervalMs: 2500, timeoutMs: 3600000 },
  );
} catch (error) {
  if (signal?.aborted && TARGETED_CANCEL) {
    cancelPrompt();
    await cancelPromise;
    throw new DOMException("Aborted", "AbortError");
  }
  throw error;
} finally {
  signal?.removeEventListener("abort", cancelPrompt);
  closeSocket();
}

const query = new URLSearchParams({ filename: outputFile.filename, subfolder: outputFile.subfolder || "", type: outputFile.type || "output" });
const outputBlob = await request({ method: "get", url: \`\${comfyUrl}/view?\${query.toString()}\`, responseType: "blob" });
if (OUTPUT_CAPABILITY === "video") return { blob: outputBlob };
if (OUTPUT_CAPABILITY === "audio") return outputBlob;
return URL.createObjectURL(outputBlob);`;
}

function capabilityLabel(capability: string) {
    return capability === "image" ? "图片" : capability === "audio" ? "音频" : capability === "video" ? "视频" : "文本";
}
