import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { parseChangelog } from "./src/lib/release";
import { localResourcesPlugin } from "./local-resources.mjs";
import { localUpdaterPlugin } from "./local-updater.mjs";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const localPromptSkillsDir = resolve(webDir, "public/local-prompt-skills");
const localPromptSkillNames = existsSync(localPromptSkillsDir)
    ? readdirSync(localPromptSkillsDir).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5))
    : [];

// Expose /plugins/index.json with local plugin files from public/plugins.
// The frontend can discover and list them when enabled; development reads the directory live, while builds emit a static registry.
function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(webDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    cacheDir: ".vite",
    plugins: [react(), localPluginsManifest(), localUpdaterPlugin(), localResourcesPlugin()],
    server: {
        host: "localhost",
        port: 3000,
        strictPort: true,
        watch: { ignored: ["**/public/video-suite/**"] },
        proxy: {
            "/api/comfyui": {
                target: "http://127.0.0.1:8188",
                ws: true,
                changeOrigin: false,
                rewrite: (path) => path.replace(/^\/api\/comfyui/, ""),
            },
        },
    },
    preview: { host: "localhost", port: 3000, strictPort: true },
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
        __LOCAL_PROMPT_SKILL_NAMES__: JSON.stringify(localPromptSkillNames),
    },
});
