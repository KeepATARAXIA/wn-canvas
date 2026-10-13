const JIMENG_URL = "https://jimeng.jianying.com/ai-tool/generate?enter_from=ai_feature&from_page=explore&ai_feature_name=video";
const PAGE_SOURCE = "infinite-canvas-jimeng-bridge";
const EXTENSION_SOURCE = "jimeng-canvas-extension";
const jobs = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(() => sendResponse({ ok: true })).catch((error) => {
    if (message?.jobId) void routeToCanvas(message.jobId, { source: EXTENSION_SOURCE, type: "ERROR", jobId: message.jobId, message: error?.message || "即梦桥接失败" });
    sendResponse({ ok: false, error: error?.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  if (message?.source === PAGE_SOURCE) {
    if (!sender.tab?.id) throw new Error("找不到无限画布标签页");
    if (message.type === "START") {
      const jimengTab = await findOrCreateJimengTab();
      jobs.set(message.jobId, { canvasTabId: sender.tab.id, jimengTabId: jimengTab.id });
      await sendWhenReady(jimengTab.id, { ...message, source: EXTENSION_SOURCE });
      return;
    }
    const job = jobs.get(message.jobId);
    if (!job) throw new Error("即梦任务已失效，请重新开始");
    await chrome.tabs.sendMessage(job.jimengTabId, { ...message, source: EXTENSION_SOURCE });
    if (message.type === "CANCEL") jobs.delete(message.jobId);
    return;
  }
  if (message?.source === EXTENSION_SOURCE && sender.tab?.id) {
    const job = jobs.get(message.jobId);
    if (!job || job.jimengTabId !== sender.tab.id) return;
    await routeToCanvas(message.jobId, message);
    if (message.type === "ERROR" || message.type === "RESULT_CHUNK" && message.index === message.total - 1) jobs.delete(message.jobId);
  }
}

async function findOrCreateJimengTab() {
  const tabs = await chrome.tabs.query({ url: "https://jimeng.jianying.com/*" });
  const tab = tabs.find((item) => item.url?.includes("/ai-tool/generate")) || tabs[0];
  if (tab?.id) {
    if (!tab.url?.includes("/ai-tool/generate")) await chrome.tabs.update(tab.id, { url: JIMENG_URL });
    return { ...tab, id: tab.id };
  }
  return chrome.tabs.create({ url: JIMENG_URL, active: false });
}

async function sendWhenReady(tabId, message) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("即梦网页未就绪，请确认已经登录后重试");
}

async function routeToCanvas(jobId, message) {
  const tabId = jobs.get(jobId)?.canvasTabId;
  if (tabId) await chrome.tabs.sendMessage(tabId, message);
}
