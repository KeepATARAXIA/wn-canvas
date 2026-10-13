const PAGE_SOURCE = "infinite-canvas-jimeng-bridge";
const EXTENSION_SOURCE = "jimeng-canvas-extension";
let queue = Promise.resolve();

window.addEventListener("message", (event) => {
  const data = event.data;
  if (event.source !== window || event.origin !== location.origin || data?.source !== PAGE_SOURCE) return;
  if (data.type === "PING") {
    window.postMessage({ source: EXTENSION_SOURCE, type: "PONG", jobId: data.jobId }, location.origin);
    return;
  }
  queue = queue.then(() => chrome.runtime.sendMessage(data)).catch((error) => {
    window.postMessage({ source: EXTENSION_SOURCE, type: "ERROR", jobId: data.jobId, message: error?.message || "扩展通信失败" }, location.origin);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.source !== EXTENSION_SOURCE) return;
  window.postMessage(message, location.origin);
});
