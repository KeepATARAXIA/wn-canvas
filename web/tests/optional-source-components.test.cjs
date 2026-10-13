const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

function load(relative, globals = {}, dependencies = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const output = {};
    new Function('exports', 'require', ...Object.keys(globals), code)(output, name => {
        if (name in dependencies) return dependencies[name];
        if (name === '@/i18n') return { default: { resolvedLanguage: 'zh-CN' } };
        throw new Error('Unexpected dependency: ' + name);
    }, ...Object.values(globals));
    return output;
}

const input = { skill: 'h3-prompt-writing', mode: 'T2VA', prompt: 'A quiet garden', seconds: '5', ratio: '16:9', references: '' };

test('missing official prompt pack is shown as uninstalled and makes no service or pack requests', async () => {
    const requests = [];
    const api = load('services/api/local-prompt.ts', {
        __LOCAL_PROMPT_SKILL_NAMES__: ['cinematic-director'],
        fetch: async url => { requests.push(url); throw new Error('Must not fetch'); },
    });
    assert.equal(api.localPromptSkills.find(item => item.value === 'h3-prompt-writing').disabled, true);
    assert.match(api.localPromptSkills[0].label, /未安装/);
    await assert.rejects(api.checkLocalPromptModel(), /尚未安装 h3-prompt-writing/);
    await assert.rejects(api.writeLocalH3Prompt({ ...input, skill: 'cinematic-director' }, new AbortController().signal, () => {}), /尚未安装 h3-prompt-writing/);
    assert.deepEqual(requests, []);
    assert.doesNotThrow(api.assertLocalPromptIdle);
});

test('an unavailable selected director pack is rejected before GPU status or generation requests', async () => {
    const requests = [];
    const api = load('services/api/local-prompt.ts', {
        __LOCAL_PROMPT_SKILL_NAMES__: ['h3-prompt-writing'],
        fetch: async url => { requests.push(url); throw new Error('Must not fetch'); },
    });
    await assert.rejects(api.writeLocalH3Prompt({ ...input, skill: 'cinematic-director' }, new AbortController().signal, () => {}), /尚未安装 cinematic-director/);
    await assert.rejects(api.writeLocalH3Prompt({ ...input, skill: 'unknown' }, new AbortController().signal, () => {}), /未知的离线 Skill/);
    assert.deepEqual(requests, []);
});

test('English missing-pack guidance distinguishes restarting development from rebuilding the app', async () => {
    const api = load('services/api/local-prompt.ts', {
        __LOCAL_PROMPT_SKILL_NAMES__: [],
        fetch: async () => { throw new Error('Must not fetch'); },
    }, { '@/i18n': { default: { resolvedLanguage: 'en-US' } } });
    await assert.rejects(api.checkLocalPromptModel(), /restart the development server or rebuild the app/);
});

test('an installed official pack still requires the optional local model', async () => {
    const requests = [];
    const api = load('services/api/local-prompt.ts', {
        __LOCAL_PROMPT_SKILL_NAMES__: ['h3-prompt-writing'],
        fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ installed: false }) }; },
    });
    await assert.rejects(api.checkLocalPromptModel(), /尚未下载 qwen3:8b/);
    assert.deepEqual(requests, ['http://127.0.0.1:17373/status']);
});

test('local plugin URL arrays are left to local discovery, including an empty installation', async () => {
    for (const manifest of [[], ['/plugins/example.js']]) {
        const requests = [];
        const api = load('lib/canvas/plugin-registry.ts', {
            fetch: async url => { requests.push(url); return { ok: true, json: async () => manifest }; },
        }, { '@/constant/env': { PLUGIN_REGISTRY_URL: '/plugins/index.json' }, '@/i18n': { default: { t: key => key } } });
        assert.deepEqual(await api.fetchOfficialPlugins(), []);
        assert.deepEqual(requests, ['/plugins/index.json']);
    }
});

test('explicit registries retain remote entries and correctly resolve relative URLs', async () => {
    const api = load('lib/canvas/plugin-registry.ts', {
        window: { location: { href: 'http://127.0.0.1:3000/canvas/project' } },
        fetch: async () => ({ ok: true, json: async () => ({ plugins: [{ id: 'example', entry: './example.js' }] }) }),
    }, { '@/constant/env': { PLUGIN_REGISTRY_URL: '/plugins/index.json' }, '@/i18n': { default: { t: key => key } } });
    assert.equal((await api.fetchOfficialPlugins('https://plugins.example.test/stable/index.json'))[0].url, 'https://plugins.example.test/stable/example.js');
    assert.equal((await api.fetchOfficialPlugins('/registry/index.json'))[0].url, 'http://127.0.0.1:3000/registry/example.js');
});

test('opening the plugin manager with an empty registry does not repeatedly request the manifest', async () => {
    const state = [], effectDeps = [];
    let stateIndex = 0, effectIndex = 0, effects = [], requests = 0;
    const react = {
        useState(initial) {
            const index = stateIndex++;
            if (!(index in state)) state[index] = initial;
            return [state[index], value => { state[index] = value; }];
        },
        useMemo: fn => fn(),
        useCallback: fn => fn,
        useEffect(fn, deps) {
            const index = effectIndex++;
            if (!effectDeps[index] || deps.some((value, i) => value !== effectDeps[index][i])) effects.push(fn);
            effectDeps[index] = deps;
        },
    };
    const theme = { node: { muted: '#777', stroke: '#ddd', fill: '#fff', text: '#111' }, toolbar: { activeBg: '#eee' } };
    const jsx = (type, props) => ({ type, props });
    const api = load('components/canvas/canvas-plugin-manager-modal.tsx', {}, {
        react,
        'react/jsx-runtime': { jsx, jsxs: jsx },
        antd: { App: { useApp: () => ({ message: {} }) } },
        'lucide-react': {},
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        '@/lib/canvas-theme': { canvasThemes: { light: theme } },
        '@/lib/canvas/plugin-loader': {},
        '@/lib/canvas/plugin-registry': { fetchOfficialPlugins: async () => { requests++; return []; } },
        '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'light' }) },
        '@/stores/canvas/use-plugin-store': { usePluginStore: select => select({ plugins: [] }) },
    });
    for (let render = 0; render < 8; render++) {
        stateIndex = 0; effectIndex = 0; effects = [];
        api.CanvasPluginManagerModal({ open: true, onClose() {} });
        for (const effect of effects) effect();
        await Promise.resolve();
        await Promise.resolve();
    }
    assert.equal(requests, 1);
});
