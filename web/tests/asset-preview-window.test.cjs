const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const jsx = (type, props, key) => ({ type, props, key });
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const theme = { canvas: { background: '#111' }, node: { panel: '#222', fill: '#333', stroke: '#444', text: '#fff', muted: '#aaa' }, toolbar: { item: '#aaa', activeBg: '#222', activeText: '#fff' } };

function all(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(all);
    return [node, ...all(node.props?.children)];
}
const find = (node, predicate) => all(node).find(predicate);
const text = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(text).join('');
    return typeof node === 'object' ? text(node.props?.children) : String(node);
};

// Execute the production component and effects with isolated state/media DOM.
// Real layout, fullscreen permissions and playback are covered by browser QA.
function harness(file, initialProps, extra = {}) {
    const slots = [], mounted = new Map(), listeners = new Map();
    let cursor = 0, dirty = false, pending = [], tree, closed = 0;
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, value => { const next = typeof value === 'function' ? value(slots[index].value) : value; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }];
        },
        useRef(initial) { const index = cursor++; return (slots[index] ||= { current: initial }); },
        useMemo(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { value: fn(), deps }; return slots[index].value; },
        useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
        useEffect(fn, deps) {
            const index = cursor++;
            if (!same(slots[index]?.deps, deps)) { pending.push({ index, fn, cleanup: slots[index]?.cleanup }); slots[index] = { deps }; }
        },
    };
    class Element {
        constructor(tag = 'div', key) { this.tag = tag; this.key = key; this.pauses = 0; this.paused = true; }
        closest(selector) { return selector.split(',').some(part => part.trim() === this.tag || this.editable && part.includes('contenteditable') || this.role && part.includes(`[role='${this.role}']`)) ? this : null; }
        pause() { this.pauses++; this.paused = true; }
        play() { this.paused = false; return Promise.resolve(); }
        focus() {}
        requestFullscreen() { document.fullscreenElement = this; listeners.get('fullscreenchange')?.(); return Promise.resolve(); }
    }
    const document = {
        body: {}, fullscreenElement: null,
        addEventListener: (event, handler) => listeners.set(event, handler),
        removeEventListener: event => listeners.delete(event),
        exitFullscreen() { this.fullscreenElement = null; listeners.get('fullscreenchange')?.(); return Promise.resolve(); },
    };
    const modules = {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-dom': { createPortal: node => node },
        antd: { Modal: 'Modal', Button: 'Button', Dropdown: 'Dropdown', Tag: 'Tag' }, 'lucide-react': new Proxy({}, { get: (_, key) => key }),
        '@/lib/canvas-theme': { canvasThemes: { dark: theme } }, '@/stores/use-theme-store': { useThemeStore: select => select({ theme: 'dark' }) }, ...extra,
    };
    const exports = {};
    new Function('exports', 'require', 'Element', 'document', 'ResizeObserver', compile(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')))(exports, id => {
        if (id.endsWith('.css')) return {};
        assert.ok(id in modules, id); return modules[id];
    }, Element, document, class { observe() {} disconnect() {} });
    const component = exports.CanvasMediaViewer || exports.AssetPreviewWindow;
    const props = { onClose: () => closed++, ...initialProps };
    function render() {
        for (let attempt = 0; attempt < 15; attempt++) {
            cursor = 0; pending = []; dirty = false;
            tree = component(props);
            if (typeof tree?.type === 'function') tree = tree.type(tree.props);
            const refs = new Set();
            for (const node of all(tree)) {
                const ref = node.props?.ref;
                if (!ref || typeof ref !== 'object') continue;
                refs.add(ref);
                let element = mounted.get(ref);
                if (!element || element.tag !== node.type || element.key !== node.key) element = new Element(node.type, node.key);
                mounted.set(ref, element); ref.current = element;
            }
            for (const ref of mounted.keys()) if (!refs.has(ref)) { ref.current = null; mounted.delete(ref); }
            for (const effect of pending) { effect.cleanup?.(); slots[effect.index].cleanup = effect.fn(); }
            if (!dirty) return tree;
        }
        throw new Error('Component effects failed to settle');
    }
    const button = label => { const node = find(render(), node => node.props?.['aria-label'] === label); assert.ok(node, label); return node.props; };
    const root = () => find(render(), node => node.props?.['data-media-viewer'] !== undefined);
    const key = (value, target = new Element(), options = {}) => {
        const event = { key: value, target, nativeEvent: { isComposing: false }, stopPropagation() {}, preventDefault() { this.prevented = true; }, ...options };
        root().props.onKeyDown(event); render(); return event;
    };
    render();
    return { props, render, root, button, key, Element, document, get closed() { return closed; }, media: tag => find(render(), node => node.type === tag)?.props.ref.current, unmount: () => slots.forEach(slot => slot.cleanup?.()) };
}

const gallery = Array.from({ length: 15 }, (_, index) => ({ id: 'asset-' + index, kind: 'image', title: '图片 ' + index, content: 'blob:original-' + index }));

test('mixed gallery crosses page boundaries, preserves ID across reorder/update and does not reset to lagging initial ID', () => {
    const changes = [];
    const h = harness('components/canvas/canvas-image-viewer.tsx', { src: gallery[11].content, title: '旧标题', gallery, initialImageId: gallery[11].id, onActiveItemChange: (item, index) => changes.push([item.id, index]) });
    h.button('最大化查看器').onClick();
    h.button('下一个素材').onClick();
    assert.equal(h.root().props['data-media-preview-id'], 'asset-12');
    assert.equal(text(find(h.render(), node => node.type === 'h2')), '图片 12');
    assert.equal(h.root().props['data-window-mode'], 'maximized');
    h.props.gallery = gallery.map(item => ({ ...item, title: item.id === 'asset-12' ? '改名实时' : item.title }));
    assert.equal(h.root().props['data-media-preview-id'], 'asset-12');
    assert.equal(text(find(h.render(), node => node.type === 'h2')), '改名实时');
    h.key('ArrowRight');
    assert.equal(h.root().props['data-media-preview-id'], 'asset-13');
    h.props.initialImageId = 'asset-12';
    assert.equal(h.root().props['data-media-preview-id'], 'asset-13');
    h.props.initialImageId = 'asset-13';
    assert.equal(h.root().props['data-media-preview-id'], 'asset-13');
    h.props.gallery = [h.props.gallery[13], ...h.props.gallery.filter(item => item.id !== 'asset-13')];
    assert.equal(h.root().props['data-media-preview-id'], 'asset-13');
    assert.deepEqual(changes.at(-1), ['asset-13', 0]);
    assert.equal(h.button('上一个素材').disabled, true);
    const count = changes.length; h.render(); h.render(); assert.equal(changes.length, count);
});

test('a different background asset request restores the minimized window and keeps its maximized mode', async () => {
    const h = harness('components/canvas/canvas-image-viewer.tsx', { src: gallery[0].content, title: '', gallery, initialImageId: 'asset-0', openRequest: 0 });
    h.button('最大化查看器').onClick(); h.render();
    await h.button('最小化查看器').onClick();
    assert.ok(find(h.render(), node => node.props?.['data-media-viewer-minimized'] !== undefined));
    h.props.initialImageId = 'asset-4'; h.props.openRequest = 1; h.render();
    assert.equal(find(h.render(), node => node.props?.['data-media-viewer-minimized'] !== undefined), undefined);
    assert.equal(h.root().props['data-media-preview-id'], 'asset-4');
    assert.equal(h.root().props['data-window-mode'], 'maximized');
});

test('same-ID explicit reopen restores minimized window while gallery and original URL updates keep it minimized', async () => {
    const h = harness('components/canvas/canvas-image-viewer.tsx', { src: gallery[0].content, title: '', gallery, initialImageId: 'asset-0', openRequest: 3 });
    h.button('最大化查看器').onClick(); h.render();
    await h.button('最小化查看器').onClick(); h.render();
    h.props.gallery = gallery.map(item => ({ ...item, title: '更新标题', content: item.content + '?resolved' }));
    assert.ok(find(h.render(), node => node.props?.['data-media-viewer-minimized'] !== undefined));
    h.props.openRequest = 4; h.render();
    assert.equal(find(h.render(), node => node.props?.['data-media-viewer-minimized'] !== undefined), undefined);
    assert.equal(h.root().props['data-media-preview-id'], 'asset-0');
    assert.equal(h.root().props['data-window-mode'], 'maximized');
});

test('video to audio to text navigation pauses old media and removes visual zoom tools for nonvisual kinds', () => {
    const items = [{ id: 'v', kind: 'video', title: '视频', content: 'blob:video' }, { id: 'a', kind: 'audio', title: '音频', content: 'blob:audio' }, { id: 't', kind: 'text', title: '正文', content: '第一行\n第二行' }];
    const h = harness('components/canvas/canvas-image-viewer.tsx', { src: 'blob:video', title: '', gallery: items, initialImageId: 'v' });
    const video = h.media('video'); video.paused = false;
    h.button('下一个素材').onClick();
    assert.ok(video.pauses > 0); assert.equal(video.paused, true);
    assert.equal(find(h.render(), node => node.props?.['aria-label'] === '放大预览'), undefined);
    const audio = h.media('audio'); audio.paused = false;
    h.key('ArrowRight');
    assert.ok(audio.pauses > 0); assert.equal(audio.paused, true);
    assert.equal(text(find(h.render(), node => node.props?.['data-media-preview-text'] !== undefined)), '第一行\n第二行');
    assert.equal(h.button('下一个素材').disabled, true);
});

test('editing, contenteditable and native media controls retain arrow keys; plain viewport navigation still works', () => {
    const h = harness('components/canvas/canvas-image-viewer.tsx', { src: gallery[0].content, title: '', gallery });
    const targets = ['input', 'textarea', 'select', 'audio', 'video'].map(tag => new h.Element(tag));
    const editable = new h.Element(); editable.editable = true; targets.push(editable);
    for (const role of ['slider', 'combobox', 'textbox', 'menuitem', 'listbox']) { const target = new h.Element(); target.role = role; targets.push(target); }
    for (const target of targets) { assert.equal(h.key('ArrowRight', target).prevented, undefined); assert.equal(h.root().props['data-media-preview-id'], 'asset-0'); }
    h.key('ArrowRight', new h.Element(), { nativeEvent: { isComposing: true } });
    assert.equal(h.root().props['data-media-preview-id'], 'asset-0');
    h.key('ArrowRight'); assert.equal(h.root().props['data-media-preview-id'], 'asset-1');
});

test('Escape exits browser fullscreen first, then closes; audio pauses on minimize, close and unmount', async () => {
    const h = harness('components/canvas/canvas-image-viewer.tsx', { src: 'blob:audio', title: '音频', gallery: [{ id: 'a', kind: 'audio', content: 'blob:audio' }] });
    await h.button('全屏预览').onClick(); h.render();
    assert.equal(h.root().props['data-window-mode'], 'fullscreen');
    h.key('Escape'); await Promise.resolve(); h.render();
    assert.equal(h.document.fullscreenElement, null); assert.equal(h.closed, 0);
    const audio = h.media('audio'); audio.paused = false;
    await h.button('最小化查看器').onClick(); h.render();
    assert.ok(audio.pauses > 0); h.button('恢复音频查看器').onClick(); h.render();
    h.key('Escape'); await Promise.resolve(); assert.equal(h.closed, 1);
    const before = audio.pauses; h.unmount(); assert.ok(audio.pauses > before);
});

test('legacy Canvas image groups retain original labels, natural dimensions, navigation and no metadata sidebar', () => {
    const h = harness('components/canvas/canvas-image-viewer.tsx', { kind: 'image', src: 'blob:1', title: 'Canvas标题', images: [{ id: 'one', content: 'blob:1' }, { id: 'two', content: 'blob:2' }], initialImageId: 'one' });
    const image = find(h.render(), node => node.type === 'img');
    image.props.onLoad({ currentTarget: { naturalWidth: 320, naturalHeight: 240 } });
    assert.equal(text(find(h.render(), node => node.props?.['data-media-preview-dimensions'] !== undefined)), '320 × 240');
    assert.equal(find(h.render(), node => node.props?.['data-media-preview-details'] !== undefined), undefined);
    h.button('下一张图片').onClick();
    assert.equal(find(h.render(), node => node.type === 'img').props.src, 'blob:2');
    assert.equal(text(find(h.render(), node => node.type === 'h2')), 'Canvas标题');
});

const asset = (id, kind = 'image') => ({ id, kind, title: '可修改标题', coverUrl: 'blob:thumbnail', tags: [], source: '本地上传', createdAt: '2026-10-11T01:00:00Z', updatedAt: '2026-10-11T02:00:00Z', data: kind === 'text' ? { content: '正文' } : { dataUrl: 'blob:original-' + id, url: 'blob:media-' + id, storageKey: kind + ':' + id, width: 320, height: 240, bytes: 1024, mimeType: kind + '/test' } });
function assetHarness(assets) {
    const state = { assets }, resolves = [], actions = [];
    const props = { asset: assets[0], assets, source: item => item.source, onChange: (item, index) => actions.push(['change', item.id, index]), ...Object.fromEntries(['Copy', 'Download', 'Insert', 'Favorite', 'Delete', 'Restore'].map(action => ['on' + action, item => actions.push([action, item])])) };
    const h = harness('pages/assets/asset-preview-window.tsx', props, {
        '@/components/canvas/canvas-image-viewer': { CanvasMediaViewer: 'Viewer' },
        '@/stores/use-asset-store': { useAssetStore: select => select(state) },
        '@/services/image-storage': { resolveImageUrl: async (key, fallback) => { resolves.push([key, fallback]); return fallback; } },
        '@/services/file-storage': { resolveMediaUrl: async (key, fallback) => { resolves.push([key, fallback]); return fallback; } },
    });
    return { ...h, state, resolves, actions, details: id => h.render().props.renderDetails(h.render().props.gallery.find(item => item.id === id)) };
}

test('asset window uses original data, resolves only current media and displays optional provenance only when recorded', async () => {
    const first = asset('one'); first.metadata = { model: '真实模型', prompt: '真实提示词', fileName: 'original.png' };
    const h = assetHarness([first, asset('two')]);
    await Promise.resolve();
    const viewer = h.render().props;
    assert.equal(viewer.gallery[0].content, 'blob:original-one');
    assert.equal(h.resolves.length, 1); assert.deepEqual(h.resolves[0], ['image:one', 'blob:original-one']);
    const detail = text(h.details('one'));
    for (const value of ['真实模型', '真实提示词', 'original.png', '收录时间', '更新时间']) assert.ok(detail.includes(value), value);
    const missing = text(h.details('two'));
    assert.ok(!missing.includes('模型')); assert.ok(!missing.includes('原文件名')); assert.ok(!missing.includes('提示词'));
    viewer.onActiveItemChange(viewer.gallery[1], 1); assert.deepEqual(h.actions.at(-1), ['change', 'two', 1]);
});

test('asset actions and details use latest store record rather than the opening snapshot; trash exposes only restore/delete', () => {
    const original = asset('one'), h = assetHarness([original]);
    const fresh = { ...original, favorite: true, title: '最新标题' }; h.state.assets = [fresh];
    assert.equal(h.render().props.gallery[0].title, '最新标题');
    const favorite = find(h.details('one'), node => node.props?.['aria-label'] === '取消收藏素材');
    assert.ok(favorite); favorite.props.onClick(); assert.equal(h.actions.at(-1)[1], fresh);
    h.state.assets = [{ ...fresh, deletedAt: '2026-10-11T03:00:00Z' }];
    const detail = h.details('one');
    assert.ok(!text(detail).includes('插入画布')); assert.equal(find(detail, node => node.props?.['aria-label'] === '收藏素材'), undefined);
    assert.ok(text(detail).includes('恢复素材'));
    const menu = find(detail, node => node.type === 'Dropdown').props.menu;
    assert.deepEqual(menu.items.map(item => item.key), ['delete']);
    menu.onClick({ key: 'delete' }); assert.ok(h.actions.at(-1)[1].deletedAt);
});
