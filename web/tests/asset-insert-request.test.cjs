const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies) {
    const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((id) => { if (!(id in dependencies)) throw new Error('Unmocked ' + id); return dependencies[id]; }, module, module.exports);
    return module.exports;
}

function harness(onInsert = async () => {}) {
    const refs = [], effects = [], navigations = [], errors = [];
    let refIndex = 0, effectIndex = 0;
    let location = { key: 'request-1', pathname: '/canvas/target', search: '?agent=1&asset=text-1', hash: '#agent-session', state: { from: 'assets' } };
    let assets = [{ id: 'text-1', kind: 'text', title: 'Saved text', data: { content: 'Original content' } }];
    const navigate = (...args) => navigations.push(args);
    const payloads = load('pages/assets/asset-payload.ts', {
        '@/services/image-storage': {}, '@/services/file-storage': {},
    });
    const { useAssetInsertRequest } = load('pages/assets/use-asset-insert-request.ts', {
        react: {
            useRef: (value) => refs[refIndex++] ||= { current: value },
            useEffect: (setup, deps) => {
                const index = effectIndex++;
                const previous = effects[index];
                if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) effects[index] = { setup, deps, pending: true, cleanup: previous?.cleanup };
            },
        },
        'react-router-dom': { useLocation: () => location, useNavigate: () => navigate },
        '@/stores/use-asset-store': { useAssetStore: { getState: () => ({ assets }) } },
        './asset-payload': payloads,
    });
    function render(ready = true) {
        refIndex = effectIndex = 0;
        useAssetInsertRequest({ ready, onInsert, onError: (error) => errors.push(error) });
        for (const effect of effects) if (effect.pending) { effect.cleanup?.(); effect.cleanup = effect.setup(); effect.pending = false; }
    }
    return {
        render, navigations, errors,
        strictReplay: () => { effects.forEach((effect) => effect.cleanup?.()); effects.forEach((effect) => { effect.cleanup = effect.setup(); }); },
        leave: () => { location = { ...location, key: 'other', pathname: '/canvas/other' }; render(); },
        visit: (pathname, ready) => { location = { ...location, key: location.key + '-visit', pathname }; render(ready); },
        changeAgentState: () => { location = { ...location, key: 'agent-changed', search: '?agent=2&asset=text-1', hash: '#another-session' }; render(); },
        unmount: () => effects.forEach((effect) => effect.cleanup?.()),
        setAssets: (next) => { assets = next; },
    };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('asset request waits for destination readiness and inserts once under StrictMode replay', async () => {
    const inserted = [];
    const h = harness(async (payload) => inserted.push(payload));
    h.render(false);
    assert.equal(inserted.length, 0);
    h.render(true);
    h.strictReplay();
    await settle();
    assert.deepEqual(inserted, [{ kind: 'text', title: 'Saved text', content: 'Original content' }]);
    assert.equal(h.navigations.length, 1);
    assert.deepEqual(h.navigations[0], [{ pathname: '/canvas/target', search: '?agent=1', hash: '#agent-session' }, { replace: true, state: { from: 'assets' } }]);
});

test('unknown asset is reported and consumed without inserting', async () => {
    let inserted = false;
    const h = harness(async () => { inserted = true; });
    h.setAssets([]);
    h.render();
    h.strictReplay();
    await settle();
    assert.equal(inserted, false);
    assert.equal(h.errors.length, 1);
    assert.match(h.errors[0], /素材已被移除/);
    assert.equal(h.navigations.length, 1);
});

test('direct asset requests exclude records in the recycle bin', async () => {
    let inserted = false;
    const h = harness(async () => { inserted = true; });
    h.setAssets([{ id: 'text-1', kind: 'text', deletedAt: '2026-10-11T00:00:00Z', data: { content: 'recoverable' } }]);
    h.render(); await settle();
    assert.equal(inserted, false);
    assert.equal(h.errors.length, 1);
    assert.equal(h.navigations.length, 1);
});

test('failed insertion keeps the asset and consumes the request instead of retrying on render', async () => {
    let attempts = 0;
    const h = harness(async () => { attempts++; throw new Error('image decode failed'); });
    h.render();
    await settle();
    h.render();
    assert.equal(attempts, 1);
    assert.match(h.errors[0], /image decode failed/);
    assert.equal(h.navigations.length, 1);
});

test('leaving while media decodes invalidates the original request without navigating back', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const inserted = [];
    const h = harness(async (payload, isCurrent) => { await gate; if (isCurrent()) inserted.push(payload); });
    h.render();
    h.unmount();
    release();
    await settle();
    assert.equal(inserted.length, 0);
    assert.equal(h.errors.length, 0);
    assert.equal(h.navigations.length, 0);
});

test('an unrelated query change during decoding does not duplicate insertion and is preserved', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let attempts = 0;
    const h = harness(async () => { attempts++; await gate; });
    h.render();
    await settle();
    h.changeAgentState();
    release();
    await settle();
    assert.equal(attempts, 1);
    assert.deepEqual(h.navigations[0][0], { pathname: '/canvas/target', search: '?agent=2', hash: '#another-session' });
});

test('a pending insert cannot write while the current destination becomes unready', async () => {
    let release, isCurrent;
    const gate = new Promise((resolve) => { release = resolve; });
    const inserted = [];
    const h = harness(async (payload, current) => { isCurrent = current; await gate; if (current()) inserted.push(payload); });
    h.render();
    await settle();
    h.render(false);
    const allowedWhileLoading = isCurrent();
    release();
    await settle();
    assert.equal(allowedWhileLoading, false);
    assert.equal(inserted.length, 0);
    assert.equal(h.navigations.length, 0);
    h.render(true);
    await settle();
    assert.equal(inserted.length, 1);
    assert.equal(h.navigations.length, 1);
});

test('leaving and returning before restore completes permanently invalidates the old insert', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const requests = [], inserted = [];
    const h = harness(async (payload, isCurrent) => { requests.push(isCurrent); await gate; if (isCurrent()) inserted.push(payload); });
    h.render();
    await settle();
    h.visit('/canvas/other', false);
    h.visit('/canvas/target', false);
    const oldAllowedBeforeRestore = requests[0]();
    h.render(true);
    await settle();
    const oldAllowedAfterRestore = requests[0]();
    release();
    await settle();
    assert.equal(oldAllowedBeforeRestore, false);
    assert.equal(oldAllowedAfterRestore, false);
    assert.equal(requests.length, 2);
    assert.equal(inserted.length, 1);
    assert.equal(h.navigations.length, 1);
});
