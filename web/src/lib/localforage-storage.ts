import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
    driver: localforage.INDEXEDDB,
});

type StorageStatus = { pending: number; readError: string; writeError: string };
const readable = new Set<string>();
const pending = new Map<string, { value: string }>();
const writes = new Map<string, Promise<void>>();
const readErrors = new Map<string, string>();
const writeErrors = new Map<string, string>();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let status: StorageStatus = { pending: 0, readError: "", writeError: "" };

function publishStatus() {
    status = { pending: pending.size, readError: [...readErrors.values()].join("\n"), writeError: [...writeErrors.values()].join("\n") };
    listeners.forEach((listener) => listener());
}

export const getStateStorageStatus = () => status;
export function subscribeStateStorage(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function reportStateReadError(name: string, error: unknown) {
    readable.delete(name);
    readErrors.set(name, `${name}：${error instanceof Error ? error.message : String(error)}`);
    publishStatus();
}

async function writePending(name: string) {
    const currentWrite = writes.get(name);
    if (currentWrite) return currentWrite;
    const operation = (async () => {
        while (pending.has(name) && readable.has(name)) {
            const record = pending.get(name)!;
            try {
                await localforage.setItem(name, record.value);
                // A newer edit may have arrived while this transaction was running.
                if (pending.get(name) === record) pending.delete(name);
                writeErrors.delete(name);
            } catch (error) {
                writeErrors.set(name, `${name}：${error instanceof Error ? error.message : String(error)}`);
                break;
            } finally {
                publishStatus();
            }
        }
    })();
    writes.set(name, operation);
    try {
        await operation;
    } finally {
        writes.delete(name);
    }
}

export async function flushStateWrites() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    await Promise.all([...pending.keys()].map(writePending));
}

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        // Rehydration must not replace edits that are still waiting to be saved.
        if (readable.has(name) && pending.has(name)) return pending.get(name)!.value;
        try {
            // Never turn a failed read into an empty store. Media also requires IndexedDB.
            const value = await localforage.getItem<string>(name);
            const fallback = window.localStorage.getItem(name);
            if (fallback !== null && value !== null && fallback !== value) {
                throw new Error("检测到两份不同的本地记录，已保留原数据并暂停写入。请先备份并核对这两份记录。");
            }
            if (fallback !== null) {
                if (value === null) await localforage.setItem(name, fallback);
                window.localStorage.removeItem(name);
            }
            readable.add(name);
            readErrors.delete(name);
            publishStatus();
            return value ?? fallback;
        } catch (error) {
            reportStateReadError(name, error);
            throw error;
        }
    },
    setItem: (name, value) => {
        if (typeof window === "undefined") return;
        if (!readable.has(name)) {
            if (!readErrors.has(name)) reportStateReadError(name, new Error("本地数据尚未完成读取，已暂停写入。"));
            return;
        }
        pending.set(name, { value });
        publishStatus();
        // Continuous edits must still reach disk, rather than postponing every save.
        if (!saveTimer) saveTimer = setTimeout(() => { void flushStateWrites(); }, 400);
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        if (!readable.has(name)) throw new Error("本地数据未安全加载，不能清除。");
        pending.delete(name);
        await writes.get(name);
        await localforage.removeItem(name);
        window.localStorage.removeItem(name);
        writeErrors.delete(name);
        publishStatus();
    },
};

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", (event) => {
        if (!pending.size) return;
        void flushStateWrites();
        event.preventDefault();
        event.returnValue = "";
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void flushStateWrites();
    });
}
