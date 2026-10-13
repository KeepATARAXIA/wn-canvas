const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.join(__dirname, '../src');

// Render the real component with isolated hooks/store and invoke its user actions.
// No browser storage, files, model requests or user assets are modified.
function harness(initialAssets = [], options = {}) {
    const states = [];
    let cursor = 0;
    let tree;
    let closed = 0;
    const confirmations = [];
    const notices = [];
    const inserted = [];
    const store = {
        assets: structuredClone(initialAssets),
        addAsset(asset) { const id = 'new-' + this.assets.length; this.assets.unshift({ ...asset, id, createdAt: 'now', updatedAt: 'now' }); return id; },
        updateAsset(id, patch) { this.assets = this.assets.map((asset) => asset.id === id ? { ...asset, ...patch, updatedAt: 'updated' } : asset); },
        removeAsset(id) { this.assets = this.assets.filter((asset) => asset.id !== id); },
        trashAssets(ids) { this.assets = this.assets.map((asset) => ids.includes(asset.id) ? { ...asset, deletedAt: '2026-10-11T00:00:00Z' } : asset); },
    };
    for (const key of ['addAsset', 'updateAsset', 'removeAsset', 'trashAssets']) store[key] = store[key].bind(store);
    const useAssetStore = Object.assign((select) => select(store), { getState: () => store });
    function useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    }
    const components = { Button: 'Button', Empty: 'Empty', Input: 'Input', Modal: 'Modal', Pagination: 'Pagination', Popconfirm: 'Popconfirm', Select: 'Select', Form: 'Form' };
    const modules = {
        react: { useState, useMemo: (fn) => fn(), useRef: (value) => useState({ current: value })[0], useSyncExternalStore: () => 0 },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        antd: { ...components, App: { useApp: () => ({ message: Object.fromEntries(['success', 'warning', 'error'].map((kind) => [kind, (value) => notices.push({ kind, value })])), modal: { confirm: (config) => confirmations.push(config) } }) } },
        'lucide-react': new Proxy({}, { get: (_, name) => name }),
        '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
        '@/services/file-storage': { uploadMediaFile: options.uploadMediaFile || (async () => ({ url: 'video-url', storageKey: 'video-key', width: 1920, height: 1080, bytes: 100, mimeType: 'video/mp4' })) },
        '@/services/image-storage': { getImagePreviewRevision: () => 0, subscribeImagePreviews: () => () => {}, uploadImage: options.uploadImage || (async () => ({ url: 'image-url', storageKey: 'image-key', width: 800, height: 600, bytes: 20, mimeType: 'image/png' })) },
        '@/stores/use-asset-store': { useAssetStore, assetCoverUrl: (asset) => asset.coverUrl },
        '@/stores/use-theme-store': { useThemeStore: (select) => select({ theme: 'dark' }) },
    };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, 'components/canvas/canvas-asset-library-modal.tsx'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports = {};
    new Function('exports', 'require', 'console', code)(exports, (name) => { assert.ok(name in modules, name); return modules[name]; }, { error() {} });
    const props = { open: true, onClose: () => { closed++; }, onInsert: options.onInsert || (async (value) => inserted.push(value)) };
    const render = () => { cursor = 0; tree = exports.CanvasAssetLibraryModal(props); return tree; };
    function find(predicate, node = tree) {
        if (!node || typeof node !== 'object') return undefined;
        if (Array.isArray(node)) return node.map((item) => find(predicate, item ?? null)).find(Boolean);
        if (predicate(node)) return node;
        return find(predicate, node.props?.children ?? null);
    }
    const button = (label) => { const found = find((node) => ['Button', 'button'].includes(node.type) && (node.props.children === label || node.props['aria-label'] === label)); assert.ok(found, label); return found.props; };
    const select = (title) => { button('选择资产：' + title).onClick(); render(); };
    const editor = () => { const node = find((item) => item.type?.name === 'AssetEditor'); assert.ok(node); return node.props; };
    render();
    return { store, render, find, button, select, editor, confirmations, notices, inserted, closed: () => closed, flush: () => new Promise((resolve) => setImmediate(resolve)) };
}

const text = { id: 'text', kind: 'text', title: '说明', tags: ['灵感'], note: '', coverUrl: '', source: 'Canvas', createdAt: 'old', metadata: { nodeId: 'original' }, data: { content: '原始内容' } };
const image = { ...text, id: 'image', kind: 'image', title: '图片', coverUrl: 'cover', data: { dataUrl: 'blob:image', storageKey: 'stored-image', width: 800, height: 600, bytes: 123, mimeType: 'image/png' } };
const video = { ...text, id: 'video', kind: 'video', title: '视频', data: { url: 'blob:video', storageKey: 'stored-video', width: 1920, height: 1080, bytes: 456, mimeType: 'video/mp4' } };

test('editing image and video metadata preserves their files, identity and provenance', () => {
    for (const asset of [image, video]) {
        const h = harness([asset]);
        h.select(asset.title);
        h.button('编辑').onClick(); h.render();
        h.editor().onSave({ title: ' 新名称 ', tags: ['新标签'], note: ' 新备注 ', content: 'must not replace media' });
        const saved = h.store.assets[0];
        assert.equal(saved.title, '新名称');
        assert.equal(saved.note, '新备注');
        assert.deepEqual(saved.tags, ['新标签']);
        for (const key of ['data', 'kind', 'id', 'coverUrl', 'createdAt', 'source', 'metadata']) assert.deepEqual(saved[key], asset[key], key);
    }
});

test('unsaved edits need confirmation and cancel/back never writes to assets', () => {
    const h = harness([text]);
    h.select(text.title); h.button('编辑').onClick(); h.render();
    h.editor().onDirty(); h.render();
    h.render().props.onCancel();
    assert.equal(h.closed(), 0);
    assert.equal(h.confirmations.length, 1);
    assert.deepEqual(h.store.assets, [text]);
    h.confirmations[0].onOk();
    assert.equal(h.closed(), 1);
    assert.deepEqual(h.store.assets, [text]);
});

test('text editing and creation retain content whitespace and create independent assets', () => {
    const h = harness([text]);
    h.select(text.title); h.button('编辑').onClick(); h.render();
    h.editor().onSave({ title: '更新正文', tags: [], content: '  第一行\n第二行  ' }); h.render();
    assert.equal(h.store.assets[0].data.content, '  第一行\n第二行  ');
    h.button('新建文本').onClick(); h.render();
    h.editor().onSave({ title: '新文档', tags: ['新建'], content: '另一个正文' }); h.render();
    assert.equal(h.store.assets.length, 2);
    assert.equal(h.store.assets[0].kind, 'text');
    assert.equal(h.store.assets[0].data.content, '另一个正文');
    assert.notEqual(h.store.assets[0].id, text.id);
});

test('searching content and changing type clear selection to prevent hidden insertions', () => {
    const h = harness([text, image, video]);
    h.select(image.title);
    h.find((node) => node.type === 'Input').props.onChange({ target: { value: '原始内容' } }); h.render();
    assert.ok(h.button('选择资产：说明'));
    assert.equal(h.find((node) => node.props?.['aria-label'] === '选择资产：图片'), undefined);
    assert.equal(h.button('插入画布').disabled, true);
    h.select(text.title); h.button('视频').onClick(); h.render();
    assert.equal(h.button('插入画布').disabled, true);
});

test('trashed records are unavailable to selection and editing in the canvas library', () => {
    const h = harness([text, { ...image, deletedAt: '2026-10-11T00:00:00Z' }]);
    assert.ok(h.button('选择资产：说明'));
    assert.equal(h.find(node => node.props?.['aria-label'] === '选择资产：图片'), undefined);
    assert.equal(h.button('插入画布').disabled, true);
});

test('insertion passes the original storage references for all asset kinds', async () => {
    for (const asset of [text, image, video]) {
        const h = harness([asset]);
        h.select(asset.title); h.button('插入画布').onClick(); await h.flush();
        const payload = h.inserted[0];
        assert.equal(payload.kind, asset.kind);
        assert.equal(payload.title, asset.title);
        if (asset.kind === 'text') assert.equal(payload.content, asset.data.content);
        else assert.equal(payload.storageKey, asset.data.storageKey);
        if (asset.kind === 'video') assert.equal(payload.width, 1920);
        assert.deepEqual(h.store.assets, [asset]);
    }
});

test('insertion failure leaves the library open and allows retry without losing assets', async () => {
    const h = harness([image], { onInsert: async () => { throw new Error('image read failed'); } });
    h.select(image.title); h.button('插入画布').onClick(); await h.flush(); h.render();
    assert.equal(h.closed(), 0);
    assert.equal(h.button('插入画布').loading, false);
    assert.ok(h.notices.some((notice) => notice.kind === 'error'));
    assert.deepEqual(h.store.assets, [image]);
});

test('mixed uploads keep successful files, report failures and release the busy state', async () => {
    const h = harness([], { uploadImage: async () => { throw new Error('invalid image'); } });
    h.find((node) => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'bad.png', type: 'image/png' }, { name: 'clip.mp4', type: 'video/mp4' }, { name: 'skip.bin', type: 'application/octet-stream' }] } });
    assert.equal(h.render().props.closable, false);
    await h.flush(); h.render();
    assert.equal(h.store.assets.length, 1);
    assert.equal(h.store.assets[0].data.storageKey, 'video-key');
    assert.equal(h.render().props.closable, true);
    assert.ok(h.notices.some((notice) => notice.kind === 'warning' && notice.value.startsWith('2')));
});

test('removal retains the recoverable record and clamps pagination after trashing the last page', () => {
    const h = harness(Array.from({ length: 25 }, (_, i) => ({ ...text, id: String(i), title: '文档' + i })));
    h.find((node) => node.type === 'Pagination').props.onChange(2); h.render();
    h.select('文档24');
    assert.equal(h.store.assets.length, 25);
    h.find((node) => node.type === 'Popconfirm').props.onConfirm(); h.render();
    assert.equal(h.store.assets.length, 25);
    assert.equal(h.store.assets.filter(asset => !asset.deletedAt).length, 24);
    assert.equal(h.store.assets.find(asset => asset.id === '24').data.content, text.data.content);
    assert.ok(h.button('选择资产：文档0'));
    assert.equal(h.button('插入画布').disabled, true);
});

test('saving an asset on a later page returns to the page containing its selection', () => {
    const h = harness(Array.from({ length: 25 }, (_, i) => ({ ...text, id: String(i), title: '文档' + i })));
    h.find((node) => node.type === 'Pagination').props.onChange(2); h.render();
    h.select('文档24'); h.button('编辑').onClick(); h.render();
    h.editor().onSave({ title: '更新的末页文档', tags: [], content: '已修改' }); h.render();
    assert.equal(h.button('选择资产：更新的末页文档')['aria-pressed'], true);
    assert.equal(h.find((node) => node.type === 'Pagination').props.current, 2);
});

test('asset metadata edits survive actual store persistence and rehydration', async () => {
    const disk = new Map([['infinite-canvas:asset_store', JSON.stringify({ state: { assets: [text, image, video] }, version: 0 })]]);
    const source = fs.readFileSync(path.join(root, 'stores/use-asset-store.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const modules = {
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': require('../node_modules/zustand/middleware'),
        nanoid: { nanoid: () => 'new-asset' },
        '@/lib/localforage-storage': { localForageStorage: { getItem: async (key) => disk.get(key), setItem: async (key, value) => disk.set(key, value), removeItem: async (key) => disk.delete(key) }, reportStateReadError: (_, error) => assert.fail(error) },
        '@/services/image-storage': { ensureImagePreview: async () => {}, resolveImageUrl: async (_, fallback) => fallback },
        '@/services/file-storage': { resolveMediaUrl: async (_, fallback) => fallback },
    };
    const loadStore = () => { const exports = {}; new Function('exports', 'require', code)(exports, (name) => modules[name]); return exports.useAssetStore; };
    const first = loadStore(); await new Promise(setImmediate);
    assert.equal(first.getState().hydrated, true);
    first.getState().updateAsset(image.id, { title: '持久化图片', tags: ['已编辑'], note: '保留文件' });
    first.getState().updateAsset(text.id, { data: { content: '持久化正文' } });
    await new Promise(setImmediate);
    const reopened = loadStore(); await new Promise(setImmediate);
    const savedImage = reopened.getState().assets.find((asset) => asset.id === image.id);
    assert.equal(savedImage.title, '持久化图片');
    assert.deepEqual(savedImage.data, image.data);
    assert.deepEqual(savedImage.tags, ['已编辑']);
    assert.equal(reopened.getState().assets.find((asset) => asset.id === text.id).data.content, '持久化正文');
    assert.deepEqual(reopened.getState().assets.find((asset) => asset.id === video.id).data, video.data);
});

function pageHandler(name, bindings) {
    const file = ts.createSourceFile('project.tsx', fs.readFileSync(path.join(root, 'pages/canvas/project.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) callback = (ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer).getText(file);
        ts.forEachChild(node, visit);
    }
    visit(file); assert.ok(callback, name);
    const code = ts.transpileModule('return (' + callback + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

test('canvas waits for image insertion before closing and keeps the dialog on failure', async () => {
    let resolveImage;
    let closed = 0;
    const insert = pageHandler('handleAssetInsert', { insertAssistantImage: () => new Promise((resolve) => { resolveImage = resolve; }), setAssetPickerOpen: () => { closed++; } });
    const pending = insert({ kind: 'image', title: '图片', dataUrl: 'blob:image', storageKey: 'key' });
    assert.equal(closed, 0);
    resolveImage(); await pending;
    assert.equal(closed, 1);
    const fail = pageHandler('handleAssetInsert', { insertAssistantImage: async () => { throw new Error('read failed'); }, setAssetPickerOpen: () => assert.fail('must remain open') });
    await assert.rejects(fail({ kind: 'image', title: '图片', dataUrl: 'broken' }), /read failed/);
});

test('canvas keyboard shortcuts do nothing while asset library is open', () => {
    const handler = pageHandler('handleKeyDown', { assetPickerOpen: true });
    for (const key of ['Delete', 'Backspace', 'Escape', 'z', 'v', 'a']) handler({ key, ctrlKey: true });
});
