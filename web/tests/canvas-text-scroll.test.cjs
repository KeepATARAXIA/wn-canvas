const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.join(__dirname, '../src');
const jsx = (type, props) => ({ type, props });
const theme = { canvas: { background: '#fff' }, node: { fill: '#eee', text: '#111', panel: '#fff', stroke: '#ddd', faint: '#ddd', muted: '#777' }, toolbar: { panel: '#fff', border: '#ddd', activeText: '#111' } };

function load(relative, modules, bindings = {}) {
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exported = {};
    new Function('exports', 'require', ...Object.keys(bindings), code)(exported, (name) => {
        assert.ok(name in modules, 'Unexpected dependency: ' + name);
        return modules[name];
    }, ...Object.values(bindings));
    return exported;
}

function find(node, predicate) {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
    if (predicate(node)) return node;
    return find(node.props?.children, predicate);
}

// Small DOM stand-in for selectors used by the actual event handlers. It also
// supports descendant selectors so nested paragraphs and batch cards are covered.
class Element {
    constructor({ attributes = {}, classes = [], tag = 'div', parent = null } = {}) {
        Object.assign(this, { attributes, classes, tag, parent });
    }
    matches(selector) {
        if (selector.startsWith('[')) {
            const match = /^\[([^=\]]+)(?:=['"]([^'"]+)['"])?\]$/.exec(selector);
            return Boolean(match && match[1] in this.attributes && (match[2] === undefined || this.attributes[match[1]] === match[2]));
        }
        if (selector.startsWith('.')) return this.classes.includes(selector.slice(1));
        return this.tag === selector;
    }
    closest(selectors) {
        for (let current = this; current; current = current.parent) {
            for (const selector of selectors.split(',')) {
                const parts = selector.trim().split(/\s+/);
                if (!current.matches(parts.at(-1))) continue;
                if (parts.length === 1 || current.parent?.closest(parts.slice(0, -1).join(' '))) return current;
            }
        }
        return null;
    }
}

function domText(selected, batch = false) {
    const node = new Element({ attributes: { 'data-node-id': 'text', ...(selected ? { 'data-canvas-text-scroll': true } : {}) } });
    const card = batch ? new Element({ parent: node }) : node;
    const rich = new Element({ classes: ['canvas-rich-text'], parent: card });
    return { node, rich, paragraph: new Element({ tag: 'p', parent: rich }) };
}

function canvasHarness(tool = 'select') {
    const effects = [], windowListeners = new Map(), nativeListeners = new Map(), changes = [];
    const container = {
        addEventListener: (name, callback, options) => nativeListeners.set(name, { callback, options }),
        removeEventListener: (name, callback) => { assert.equal(nativeListeners.get(name).callback, callback); nativeListeners.delete(name); },
        getBoundingClientRect: () => ({ left: 20, top: 30 }),
    };
    const modules = {
        react: { useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}], useLayoutEffect: () => {}, useEffect: (effect) => effects.push(effect) },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        '@/lib/canvas-theme': { canvasThemes: { light: theme } },
        '@/stores/use-theme-store': { useThemeStore: (select) => select({ theme: 'light' }) },
    };
    const bindings = {
        Element, HTMLInputElement: class {}, HTMLTextAreaElement: class {}, HTMLSelectElement: class {},
        window: { addEventListener: (name, callback) => windowListeners.set(name, callback), removeEventListener: () => {} },
        document: { body: { style: {} } },
        cancelAnimationFrame: () => {},
    };
    const { InfiniteCanvas } = load('components/canvas/infinite-canvas.tsx', modules, bindings);
    let backgroundClicks = 0, deselections = 0;
    const viewport = { x: 70, y: -40, k: 1 };
    const tree = InfiniteCanvas({ containerRef: { current: container }, viewport, tool, children: null,
        onViewportChange: (value) => changes.push(value), onCanvasMouseDown: () => { backgroundClicks++; }, onCanvasDeselect: () => { deselections++; },
    });
    const cleanups = effects.map((effect) => effect()).filter(Boolean);
    return { tree, changes, viewport, nativeListeners, windowListeners, cleanups,
        backgroundClicks: () => backgroundClicks, deselections: () => deselections };
}

function wheel(h, target, deltaY = 100, richElement) {
    const event = { target, deltaY, clientX: 260, clientY: 180, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
    // Native canvas listeners run before React's delegated child handlers.
    h.nativeListeners.get('wheel').callback(event);
    richElement?.props.onWheel?.(event);
    if (!event.stopped) h.tree.props.onWheel(event);
    return event;
}

function nodeHarness(type = 'text', selected = true, metadata = { content: 'long text' }) {
    const react = { default: { memo: (component) => component }, useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}],
        useEffect: () => {}, useMemo: (compute) => compute(), useCallback: (callback) => callback, useSyncExternalStore: () => {} };
    const modules = {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': new Proxy({}, { get: (_, key) => key }),
        'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
        '@/lib/canvas-theme': { canvasThemes: { light: theme } }, '@/stores/use-theme-store': { useThemeStore: (select) => select({ theme: 'light' }) },
        '@/lib/canvas/node-registry': { getNodeDefinition: () => undefined },
        '@/types/canvas': { CanvasNodeType: { Text: 'text', Image: 'image', Video: 'video', Audio: 'audio', Group: 'group', Config: 'config' } },
        './canvas-node-appearance': { textNodeColors: () => ({ background: '#eee', color: '#111' }), NodeColorLabel: 'NodeColorLabel' },
        '@/lib/canvas/canvas-group-colors': {}, '@/lib/canvas/video-tool-preview': {}, '@/lib/canvas/plugin-node-context': {},
        '@/lib/image-utils': {}, '@/lib/image-thumbnail': {}, '@/services/image-storage': {},
        './canvas-safe-node-panel': {}, './canvas-text-editor': {}, './canvas-video-player': {}, './generation-dots': {},
    };
    modules['@/lib/canvas/text-rich-content'] = load('lib/canvas/text-rich-content.ts', {});
    const component = load('components/canvas/canvas-node.tsx', modules, { Element });
    let drags = 0;
    const data = { id: 'text', title: 'text', type, position: { x: 100, y: 100 }, width: 300, height: 200, metadata };
    const tree = component.CanvasNode({ data, scale: 1, isSelected: selected, isRelated: false, isFocusRelated: false,
        isConnectionTarget: false, isConnecting: false, showPanel: false, showImageInfo: false,
        onMouseDown: () => { drags++; }, onHoverStart: () => {}, onHoverEnd: () => {}, onContextMenu: () => {} });
    const nodeContent = find(tree, (item) => typeof item.type === 'function' && item.props.node === data);
    const textContent = type === 'text' ? nodeContent.type(nodeContent.props) : null;
    const textTree = textContent?.type(textContent.props);
    const rich = find(textTree, (item) => item.type === 'div' && item.props.className?.split(' ').includes('canvas-rich-text'));
    return { tree, rich, textTree, drags: () => drags };
}

test('only selected text nodes enable text scrolling, and deselection removes the marker', () => {
    for (const [type, selected, expected] of [['text', true, true], ['text', false, undefined], ['image', true, undefined], ['video', true, undefined]]) {
        assert.equal(nodeHarness(type, selected).tree.props['data-canvas-text-scroll'], expected);
    }
});

test('selected text and nested batch paragraphs allow native scrolling without changing the viewport', () => {
    for (const batch of [false, true]) for (const direction of [-100, 100]) {
        const h = canvasHarness();
        const event = wheel(h, domText(true, batch).paragraph, direction, nodeHarness().rich);
        assert.equal(event.defaultPrevented, false);
        assert.deepEqual(h.changes, []);
    }
});

test('unselected text restores canvas zoom in both directions and keeps the mouse anchor fixed', () => {
    for (const deltaY of [-100, 100]) {
        const h = canvasHarness();
        const event = wheel(h, domText(false).paragraph, deltaY, nodeHarness('text', false).rich);
        assert.equal(event.defaultPrevented, true);
        assert.equal(h.changes.length, 1);
        const next = h.changes[0], mouse = { x: 240, y: 150 };
        assert.equal(next.k, Math.pow(1.1, -deltaY / 100));
        assert.equal((mouse.x - next.x) / next.k, (mouse.x - h.viewport.x) / h.viewport.k);
        assert.equal((mouse.y - next.y) / next.k, (mouse.y - h.viewport.y) / h.viewport.k);
    }
});

test('selected node titles, borders and action buttons still zoom the canvas', () => {
    const { node } = domText(true);
    for (const target of [node, new Element({ tag: 'button', parent: node }), new Element({ attributes: { 'data-node-title': true }, parent: node })]) {
        const h = canvasHarness();
        assert.equal(wheel(h, target).defaultPrevented, true);
        assert.equal(h.changes.length, 1);
    }
});

test('native wheel registration remains nonpassive and is removed on unmount', () => {
    const h = canvasHarness();
    assert.equal(h.nativeListeners.get('wheel').options.passive, false);
    h.cleanups.forEach((cleanup) => cleanup());
    assert.equal(h.nativeListeners.has('wheel'), false);
});

test('editor portals and existing popup exclusions retain native scrolling and suppress canvas zoom', () => {
    for (const target of [new Element({ attributes: { 'data-canvas-no-zoom': true } }), new Element({ classes: ['ant-modal'] }), new Element({ classes: ['ant-select-dropdown'] })]) {
        const h = canvasHarness();
        assert.equal(wheel(h, target).defaultPrevented, false);
        assert.deepEqual(h.changes, []);
    }
});

test('text wheel marker leaves ordinary node dragging and middle-button canvas panning available', () => {
    const node = nodeHarness();
    const body = find(node.tree, (item) => item.props['data-node-body'] !== undefined);
    const target = domText(true).paragraph;
    let prevented = false;
    body.props.onMouseDown({ button: 0, target, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(node.drags(), 1);
    const h = canvasHarness();
    let captured = false;
    h.tree.props.onPointerDown({ button: 1, target, clientX: 100, clientY: 100, pointerId: 1, preventDefault: () => {}, currentTarget: { setPointerCapture: () => { captured = true; } } });
    assert.equal(captured, true);
});

test('blank canvas clicks continue deselection paths in selection and pan tools', () => {
    for (const tool of ['select', 'pan']) {
        const h = canvasHarness(tool);
        h.tree.props.onPointerDown({ button: 0, target: new Element(), clientX: 100, clientY: 100, pointerId: 1, preventDefault: () => {}, currentTarget: { setPointerCapture: () => {} } });
        if (tool === 'select') assert.equal(h.backgroundClicks(), 1);
        else { h.windowListeners.get('pointerup')(); assert.equal(h.deselections(), 1); }
        assert.equal(wheel(h, domText(false).paragraph).defaultPrevented, true);
        assert.equal(h.changes.length, 1);
    }
});

test('main and expanded text bodies contain overscroll at their top and bottom edges', () => {
    const h = nodeHarness('text', true, { content: 'main', texts: [{ id: 'a', content: 'main' }, { id: 'b', content: 'candidate' }], primaryTextId: 'a' });
    assert.ok(h.rich.props.className.split(' ').includes('overscroll-contain'));
    // Build the actual expanded renderer from the NodeContent tree.
    const expandedRoot = find(h.tree, (item) => typeof item.type === 'function' && item.props.node?.id === 'text');
    const content = expandedRoot.type({ ...expandedRoot.props, batchExpanded: true });
    const batch = content.type(content.props);
    const card = find(batch, (item) => typeof item.type === 'function' && item.props.text?.id === 'b');
    const rich = find(card.type(card.props), (item) => item.type === 'div' && item.props.className?.split(' ').includes('canvas-rich-text'));
    assert.ok(rich.props.className.split(' ').includes('overscroll-contain'));
    const canvas = canvasHarness();
    assert.equal(wheel(canvas, domText(true, true).paragraph, 100, rich).defaultPrevented, false);
    assert.deepEqual(canvas.changes, []);
});
