const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
test('reference safety and submission retry updates migrate only exact previous built-in scripts', () => {
    let settings;
    const source = fs.readFileSync(path.join(__dirname, '../src/stores/use-config-store.ts'), 'utf8');
    const output = {};
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const dependencies = { react: { useMemo: f => f() }, zustand: require('../node_modules/zustand'), 'zustand/middleware': { persist: (f, opts) => { settings = opts; return f; } }, nanoid: { nanoid: () => 'test' }, '@/i18n': { t: s => s }, '@/lib/h3-video-size': { normalizeH3Resolution: v => v } };
    new Function('exports', 'require', code)(output, name => name.endsWith('?raw') ? fs.readFileSync(path.join(__dirname, '../src', name.slice(2, -4)), 'utf8') : dependencies[name]);
    const current = fs.readFileSync(path.join(__dirname, '../src/services/api/templates/comfyui-minimax-h3.js'), 'utf8').trim();
    for (const name of ['reference-preflight', 'submission-retry']) {
      const old = fs.readFileSync(path.join(__dirname, `../src/services/api/templates/comfyui-minimax-h3-before-${name}.txt`), 'utf8');
      for (const script of [old, old.replace(/\r\n/g, '\n'), old + '\n// custom']) {
        const migrated = settings.merge({ config: { ...output.defaultConfig, videoH3Mode: 'turbo', channels: [{ ...output.defaultConfig.channels[0], models: [{ name: 'MiniMax-H3', capability: 'video', script }] }] } }, output.useConfigStore.getState());
        assert.equal(migrated.config.channels[0].models[0].script.trim(), script.includes('// custom') ? script.trim() : current);
        assert.equal(migrated.config.videoH3Mode, 'turbo');
      }
    }
});
