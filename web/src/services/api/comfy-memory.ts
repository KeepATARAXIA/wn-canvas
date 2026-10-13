type CleanupState = { enabled: boolean; blocked: boolean; localWork: boolean; idle: boolean; onStatus?: (releasing: boolean, message: string) => void };
type Timer = ReturnType<typeof setTimeout>;

export function createComfyAutoRelease({ fetchImpl = fetch, setTimer = (callback: () => void, ms: number) => setTimeout(callback, ms), clearTimer = (timer: Timer) => clearTimeout(timer) } = {}) {
    let state: CleanupState = { enabled: false, blocked: false, localWork: false, idle: false };
    let armed = false;
    let timer: Timer | null = null;
    let requestTimeout: Timer | null = null;
    let controller: AbortController | null = null;
    let running = false;

    function cancelPending() {
        if (timer !== null) clearTimer(timer);
        timer = null;
    }

    function schedule() {
        if (!state.enabled || state.blocked || !state.idle || !armed || running || timer !== null) return;
        timer = setTimer(() => void release(), 3000);
    }

    async function release() {
        timer = null;
        if (!state.enabled || state.blocked || !state.idle || !armed || running) return;
        armed = false;
        running = true;
        controller = new AbortController();
        requestTimeout = setTimer(() => controller?.abort(), 10000);
        state.onStatus?.(true, "正在自动请求释放显存…");
        try {
            // The endpoint rechecks both actual queues and applies the shared release lock.
            const response = await fetchImpl("/api/local-resources/release", { method: "POST", headers: { "X-Canvas-Resource-Action": "release" }, signal: controller.signal });
            const result = await response.json() as { message: string };
            if (response.status === 409) {
                armed = state.enabled;
                state.onStatus?.(false, "任务或释放请求仍在进行，空闲后自动重试。");
            } else {
                state.onStatus?.(false, `自动释放：${result.message}`);
            }
        } catch {
            state.onStatus?.(false, "自动释放请求未确认，请检查本地服务；可以手动释放显存。");
        } finally {
            if (requestTimeout !== null) clearTimer(requestTimeout);
            requestTimeout = null;
            controller = null;
            running = false;
            schedule();
        }
    }

    return {
        update(next: CleanupState) {
            state = next;
            if (!state.enabled) { armed = false; cancelPending(); return; }
            if (state.localWork) armed = true;
            if (state.blocked || !state.idle) cancelPending();
            else schedule();
        },
        markComplete() {
            if (!state.enabled) return;
            armed = true;
            schedule();
        },
        cancelPending,
        acknowledgeRelease() { armed = false; cancelPending(); },
        dispose() {
            state = { enabled: false, blocked: false, localWork: false, idle: false };
            armed = false;
            cancelPending();
            if (requestTimeout !== null) clearTimer(requestTimeout);
            requestTimeout = null;
            controller?.abort();
        },
    };
}

export const autoComfyCleanup = createComfyAutoRelease();

export function isManagedLocalComfy(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && (["8188", "8189"].includes(url.port) || url.pathname.replace(/\/+$/, "") === "/api/comfyui");
    } catch {
        return false;
    }
}

// Retain completion hooks used by H3 and image upscale; the shared preference now governs them.
export function resetComfyIdleCleanup(baseUrl: string) {
    if (isManagedLocalComfy(baseUrl)) autoComfyCleanup.markComplete();
}

export function cancelComfyIdleCleanup() {
    autoComfyCleanup.cancelPending();
}

export function shouldAutoCleanComfy(baseUrl: string, model: string) {
    if (!/minimax[\s_-]*h3/i.test(model)) return false;
    try {
        return ["127.0.0.1", "localhost", "::1"].includes(new URL(baseUrl).hostname);
    } catch {
        return false;
    }
}
