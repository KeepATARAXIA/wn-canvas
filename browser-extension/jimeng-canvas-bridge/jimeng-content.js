const EXTENSION_SOURCE = "jimeng-canvas-extension";
const RESULT_CHUNK_SIZE = 512 * 1024;
const jobs = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.source !== EXTENSION_SOURCE || !message.jobId) return;
  if (message.type === "START") jobs.set(message.jobId, { ...message, assets: new Map(), cancelled: false });
  if (message.type === "ASSET_CHUNK") {
    const job = jobs.get(message.jobId);
    if (job) {
      const asset = job.assets.get(message.assetIndex) || { name: message.name, mimeType: message.mimeType, chunks: [], total: message.total };
      asset.chunks[message.index] = message.chunk;
      job.assets.set(message.assetIndex, asset);
    }
  }
  if (message.type === "CANCEL") {
    const job = jobs.get(message.jobId);
    if (job) job.cancelled = true;
  }
  if (message.type === "COMMIT") void runJob(message.jobId);
  sendResponse({ ok: true });
});

async function runJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    progress(jobId, 10, "已连接即梦网页");
    const editor = await waitFor(() => findEditor(), 30000, "找不到即梦提示词输入框，请打开即梦生成页");
    const knownVideos = new Set(Array.from(document.querySelectorAll("video")).map(videoUrl).filter(Boolean));
    fillEditor(editor, job.prompt);
    progress(jobId, 28, "已填写提示词");
    if (job.assetCount) {
      const files = Array.from(job.assets.values()).map((asset) => base64File(asset.chunks.join(""), asset.name, asset.mimeType));
      const input = await findFileInput(editor);
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => document.body.innerText.includes("@图片") || document.body.innerText.includes("@视频") || document.body.innerText.includes("@音频"), 60000, "参考素材上传超时");
      progress(jobId, 45, "参考素材已上传");
    }
    await selectSetting(editor, job.ratio, [job.ratio]);
    await selectSetting(editor, `${job.seconds}s`, [`${job.seconds}s`, `${job.seconds}秒`]);
    progress(jobId, 55, "参数已设置");
    const submit = await waitFor(() => findSubmitButton(editor), 10000, "找不到即梦生成按钮");
    if (submit.disabled) throw new Error("即梦生成按钮不可用，请检查提示词或账号状态");
    submit.click();
    progress(jobId, 60, "即梦已开始生成");
    const resultUrl = await waitForVideo(job, knownVideos, jobId);
    progress(jobId, 96, "正在取回成片");
    const response = await fetch(resultUrl);
    if (!response.ok) throw new Error("成片地址受保护，请使用弹窗中的手动导回");
    const blob = await response.blob();
    if (!blob.type.startsWith("video/") && blob.size < 1024) throw new Error("没有取得有效视频，请使用手动导回");
    const base64 = await blobToBase64(blob);
    const total = Math.ceil(base64.length / RESULT_CHUNK_SIZE) || 1;
    for (let index = 0; index < total; index += 1) {
      await chrome.runtime.sendMessage({ source: EXTENSION_SOURCE, type: "RESULT_CHUNK", jobId, index, total, mimeType: blob.type || "video/mp4", fileName: "即梦生成视频.mp4", chunk: base64.slice(index * RESULT_CHUNK_SIZE, (index + 1) * RESULT_CHUNK_SIZE) });
    }
  } catch (error) {
    await chrome.runtime.sendMessage({ source: EXTENSION_SOURCE, type: "ERROR", jobId, message: error?.message || "即梦网页自动生成失败" });
  } finally {
    jobs.delete(jobId);
  }
}

function findEditor() {
  const candidates = [...document.querySelectorAll("textarea, [contenteditable='true']")].filter(visible);
  return candidates.sort((a, b) => area(b) - area(a))[0] || null;
}

function fillEditor(editor, text) {
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set;
    setter?.call(editor, text);
  } else {
    editor.textContent = text;
  }
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  editor.dispatchEvent(new Event("change", { bubbles: true }));
}

async function findFileInput(editor) {
  let input = document.querySelector("input[type='file'][multiple]") || document.querySelector("input[type='file']");
  if (input) return input;
  const container = composer(editor);
  const referenceButton = [...container.querySelectorAll("button, [role='button']")].find((element) => /参考|上传|素材/.test(element.innerText || element.getAttribute("aria-label") || ""));
  referenceButton?.click();
  return waitFor(() => document.querySelector("input[type='file']"), 5000, "找不到即梦素材上传入口");
}

async function selectSetting(editor, currentText, choices) {
  if (!currentText) return;
  const root = composer(editor);
  const control = [...root.querySelectorAll("button, [role='button']")].find((element) => visible(element) && choices.some((choice) => (element.innerText || "").trim().includes(choice)));
  if (control) return;
  const likely = [...root.querySelectorAll("button, [role='button']")].find((element) => visible(element) && (currentText.includes(":") ? /\d+\s*:\s*\d+/.test(element.innerText || "") : /\d+\s*(s|秒)/i.test(element.innerText || "")));
  if (!likely) return;
  likely.click();
  const option = await waitFor(() => [...document.querySelectorAll("[role='option'], li, button, [role='menuitem']")].find((element) => visible(element) && choices.includes((element.innerText || "").trim())), 3000).catch(() => null);
  option?.click();
}

function findSubmitButton(editor) {
  const root = composer(editor);
  const buttons = [...root.querySelectorAll("button")].filter(visible);
  return buttons.reverse().find((button) => !/参考|视频生成|Seedance|比例|清晰|秒|@/.test(button.innerText || "") && button.querySelector("svg")) || null;
}

function composer(editor) {
  let current = editor.parentElement;
  while (current?.parentElement && area(current) < 250000) current = current.parentElement;
  return current || document.body;
}

async function waitForVideo(job, knownVideos, jobId) {
  const started = Date.now();
  while (Date.now() - started < 30 * 60 * 1000) {
    if (job.cancelled) throw new DOMException("Aborted", "AbortError");
    const errorText = document.body.innerText.match(/(生成失败|审核未通过|余额不足|积分不足|网络异常)[^\n]{0,80}/)?.[0];
    if (errorText) throw new Error(errorText);
    const candidates = [...document.querySelectorAll("video")].filter(visible).map(videoUrl).filter((url) => url && !knownVideos.has(url));
    if (candidates.length) return candidates[candidates.length - 1];
    const elapsed = (Date.now() - started) / 1000;
    progress(jobId, Math.min(94, 60 + Math.round(elapsed / 18)), "即梦正在生成视频");
    await sleep(3000);
  }
  throw new Error("即梦生成等待超时，请在即梦网页查看任务后手动导回");
}

function videoUrl(video) { return video.currentSrc || video.src || video.querySelector("source")?.src || ""; }
function visible(element) { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"; }
function area(element) { const rect = element.getBoundingClientRect(); return rect.width * rect.height; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(read, timeout, error = "等待页面响应超时") { const end = Date.now() + timeout; while (Date.now() < end) { const value = read(); if (value) return value; await sleep(250); } throw new Error(error); }
function base64File(base64, name, type) { const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0)); return new File([bytes], name, { type }); }
function blobToBase64(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "").split(",")[1] || ""); reader.onerror = () => reject(new Error("成片读取失败")); reader.readAsDataURL(blob); }); }
function progress(jobId, value, message) { void chrome.runtime.sendMessage({ source: EXTENSION_SOURCE, type: "PROGRESS", jobId, progress: value, message }); }
