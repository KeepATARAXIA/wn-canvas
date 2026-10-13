const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.join(__dirname, '../src');
const jsx = (type, props) => ({ type, props });
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function find(node, predicate) {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
    if (predicate(node)) return node;
    return find(node.props?.children, predicate);
}

function harness(component = 'CanvasZoomControls') {
    let zoomOpen = false;
    const theme = { toolbar: { panel: '#fff', border: '#ddd', item: '#333', itemHover: '#eee', activeBg: '#eee', activeText: '#111' } };
    const modules = {
        react: { useState: () => [zoomOpen, (next) => { zoomOpen = next; }] },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': new Proxy({}, { get: (_, key) => key }),
        antd: { Button: 'Button', Dropdown: 'Dropdown', Tooltip: 'Tooltip' },
        'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
        '@/stores/use-theme-store': { useThemeStore: (select) => select({ theme: 'dark' }) },
        '@/lib/canvas-theme': { canvasThemes: { dark: theme } },
        '@/lib/canvas/node-registry': { getNodePluginId: () => 'builtin', listNodeDefinitions: () => [], useNodeRegistryVersion: () => {} },
        '@/services/api/canvas-video-tools': { videoOperationLabels: {} },
    };
    const exports = {};
    const file = component === 'CanvasToolbar' ? 'canvas-toolbar.tsx' : 'canvas-zoom-controls.tsx';
    new Function('exports', 'require', compile(fs.readFileSync(path.join(root, 'components/canvas', file), 'utf8')))(exports, (name) => { assert.ok(name in modules, name); return modules[name]; });
    let resets = 0;
    const props = {
        scale: 0.91, canvasTool: 'select', isMiniMapOpen: false, showConnections: true,
        onCanvasToolChange: (tool) => { props.canvasTool = tool; },
        onToggleMiniMap: () => { props.isMiniMapOpen = !props.isMiniMapOpen; },
        onToggleConnections: () => { props.showConnections = !props.showConnections; },
        onScaleChange: (scale) => { props.scale = scale; },
        onReset: () => { resets++; },
    };
    const render = () => exports[component](props);
    const button = (label) => {
        const node = find(render(), (node) => ['button', 'Button'].includes(node.type) && node.props['aria-label'] === label);
        assert.ok(node, label);
        return node.props;
    };
    const dropdown = () => find(render(), (node) => node.type === 'Dropdown').props;
    return { props, render, button, dropdown, resets: () => resets };
}

test('left creation dock selection and pan toggle both ways and follow external tool changes', () => {
    const h = harness('CanvasToolbar');
    h.button('canvas.toolbar.select').onClick();
    assert.equal(h.props.canvasTool, 'pan');
    assert.equal(h.button('canvas.toolbar.pan').icon.type, 'Hand');
    assert.equal(h.button('canvas.toolbar.pan')['aria-pressed'], true);
    h.button('canvas.toolbar.pan').onClick();
    assert.equal(h.props.canvasTool, 'select');
    h.props.canvasTool = 'pan';
    assert.equal(h.button('canvas.toolbar.pan').icon.type, 'Hand');
});

test('map and connection toggles expose their updated state and next action', () => {
    const h = harness();
    h.button('canvas.miniMapOpen').onClick();
    assert.equal(h.button('canvas.miniMapClose')['aria-pressed'], true);
    h.button('canvas.miniMapClose').onClick();
    assert.equal(h.props.isMiniMapOpen, false);
    h.button('隐藏连线').onClick();
    assert.equal(h.button('显示连线')['aria-pressed'], false);
    h.button('显示连线').onClick();
    assert.equal(h.props.showConnections, true);
});

test('zoom menu applies presets, tracks actual scale and closes after selection or Escape', () => {
    const h = harness();
    assert.deepEqual(h.button('canvas.zoom').children, [91, '%']);
    h.dropdown().onOpenChange(true);
    assert.equal(h.button('canvas.zoom')['aria-expanded'], true);
    h.dropdown().menu.onClick({ key: '150' });
    assert.equal(h.props.scale, 1.5);
    assert.equal(h.dropdown().open, false);
    h.dropdown().menu.onClick({ key: 'reset' });
    assert.equal(h.resets(), 1);
    h.dropdown().onOpenChange(true);
    let stopped = false;
    h.dropdown().popupRender(null).props.onKeyDown({ key: 'Escape', stopPropagation: () => { stopped = true; } });
    assert.ok(stopped);
    assert.equal(h.dropdown().open, false);
});

test('precise zoom stays inside the popup and covers 5–500 percent', () => {
    const h = harness();
    assert.equal(find(h.render(), (node) => node.type === 'input'), undefined);
    const slider = find(h.dropdown().popupRender(null), (node) => node.type === 'input').props;
    for (const value of [5, 91, 500]) {
        slider.onChange({ target: { value: String(value) } });
        assert.equal(h.props.scale, value / 100);
    }
    for (const event of ['onPointerDown', 'onMouseDown', 'onKeyDown', 'onKeyUp']) {
        let stopped = false;
        h.render().props[event]({ stopPropagation: () => { stopped = true; } });
        assert.ok(stopped, event);
    }
});

const page = ts.createSourceFile('project.tsx', fs.readFileSync(path.join(root, 'pages/canvas/project.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function pagePart(predicate) {
    let found;
    function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit); }
    visit(page);
    assert.ok(found);
    return found;
}
function evaluate(source, bindings) {
    return new Function('exports', ...Object.keys(bindings), compile('return (' + source + ');'))({}, ...Object.values(bindings));
}

test('actual page connection toggle clears invisible selection without changing graph data or node menus', () => {
    const attr = pagePart((node) => ts.isJsxAttribute(node) && node.name.getText(page) === 'onToggleConnections');
    const graph = { nodes: [{ id: 'a' }, { id: 'b' }], connections: [{ id: 'c', fromNodeId: 'a', toNodeId: 'b' }] };
    const before = structuredClone(graph);
    let visible = true, selected = 'c', menu = { type: 'connection', connectionId: 'c' };
    const toggle = evaluate(attr.initializer.expression.getText(page), {
        setShowConnections: (update) => { visible = update(visible); },
        setSelectedConnectionId: (value) => { selected = value; },
        setContextMenu: (update) => { menu = update(menu); },
    });
    toggle();
    assert.equal(visible, false);
    assert.equal(selected, null);
    assert.equal(menu, null);
    menu = { type: 'node', nodeId: 'a' };
    toggle();
    assert.equal(visible, true);
    assert.deepEqual(menu, { type: 'node', nodeId: 'a' });
    assert.deepEqual(graph, before);
    const render = pagePart((node) => ts.isJsxExpression(node) && node.expression?.getText(page).startsWith('showConnections && visibleConnections.map'));
    const bindings = { require: () => ({ jsx, jsxs: jsx }), visibleConnections: [{ connection: graph.connections[0], from: graph.nodes[0], to: graph.nodes[1] }], ConnectionPath: 'ConnectionPath', selectedConnectionId: null, viewport: { k: 1 }, relatedHighlight: { connectionIds: new Set() } };
    assert.equal(evaluate(render.expression.getText(page), { ...bindings, showConnections: false }), false);
    assert.equal(evaluate(render.expression.getText(page), { ...bindings, showConnections: true }).length, 1);
});

test('actual page zoom keeps the canvas center fixed and clamps out-of-range scales', () => {
    const declaration = pagePart((node) => ts.isVariableDeclaration(node) && node.name.getText(page) === 'setZoomScale');
    let viewport = { x: -140, y: 75, k: 0.91 };
    const size = { width: 1200, height: 720 };
    const worldCenter = () => [(size.width / 2 - viewport.x) / viewport.k, (size.height / 2 - viewport.y) / viewport.k];
    const initialCenter = worldCenter();
    const zoom = evaluate(declaration.initializer.arguments[0].getText(page), { size, setViewport: (update) => { viewport = update(viewport); }, setContextMenu: () => {} });
    for (const [requested, expected] of [[1.5, 1.5], [0.01, 0.05], [10, 5]]) {
        zoom(requested);
        assert.equal(viewport.k, expected);
        worldCenter().forEach((value, index) => assert.ok(Math.abs(value - initialCenter[index]) < 1e-8));
    }
});
