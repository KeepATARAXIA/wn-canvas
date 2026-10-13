export const APP_VERSION = __APP_VERSION__ || "dev";

// The source edition discovers local plugins only unless a registry is explicitly configured.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL?.trim() || "/plugins/index.json";
