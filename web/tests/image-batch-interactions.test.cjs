const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

function pageCallback(name, bindings) {
    const file = ts.createSourceFile('project.tsx', fs.readFileSync(path.join(__dirname, '../src/pages/canvas/project.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) callback = node.initializer.arguments[0].getText(file);
        ts.forEachChild(node, visit);
    }
    visit(file);
    assert.ok(callback, name);
    const code = ts.transpileModule('return (' + callback + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

const image = (id, status, content = '') => ({ id, status, content, storageKey: content ? `key-${id}` : undefined, naturalWidth: content ? 240 : 0, naturalHeight: content ? 360 : 0, bytes: content ? 100 : 0, mimeType: content ? 'image/png' : '' });

function blankCanvasHarness() {
    const state = {
        expanded: new Set(['batch-one', 'batch-two']), selected: new Set(['batch-one']),
        connection: 'connection', menu: { type: 'node' }, box: null,
        hovered: 'batch-one', toolbar: 'batch-one', dialog: 'batch-one', cancellations: 0,
    };
    const bindings = {
        cancelPendingConnectionCreate: () => { state.cancellations++; },
        pendingConnectionCreateRef: { current: null },
        selectedNodeIdsRef: { current: state.selected }, selectionBoxRef: { current: null },
        screenToCanvas: (x, y) => ({ x: x / 2, y: y / 2 }),
        setExpandedBatchNodeIds: (value) => { state.expanded = value; },
        setSelectedNodeIds: (value) => { state.selected = value; bindings.selectedNodeIdsRef.current = value; },
        setSelectedConnectionId: (value) => { state.connection = value; },
        setContextMenu: (value) => { state.menu = value; },
        setSelectionBox: (value) => { state.box = value; },
        setHoveredNodeId: (value) => { state.hovered = value; },
        setToolbarNodeId: (value) => { state.toolbar = value; },
        setDialogNodeId: (value) => { state.dialog = value; },
        setNodeCreatePosition: () => {},
    };
    return { state, bindings, down: pageCallback('handleCanvasMouseDown', bindings), deselect: pageCallback('deselectCanvas', bindings) };
}

test('left background press collapses batches and keeps normal and additive box selection', () => {
    for (const shiftKey of [false, true]) {
        const h = blankCanvasHarness();
        h.down({ button: 0, shiftKey, clientX: 120, clientY: 80 });
        assert.equal(h.state.expanded.size, 0);
        assert.deepEqual([...h.state.selected], shiftKey ? ['batch-one'] : []);
        assert.deepEqual(h.state.box, {
            startWorldX: 60, startWorldY: 40, currentWorldX: 60, currentWorldY: 40,
            additive: shiftKey, initialSelectedNodeIds: shiftKey ? ['batch-one'] : [],
        });
        assert.equal(h.bindings.selectionBoxRef.current, h.state.box);
        assert.equal(h.state.connection, null);
    }
});

test('non-left background press leaves expanded batches and selection intact', () => {
    for (const button of [1, 2]) {
        const h = blankCanvasHarness();
        h.down({ button, clientX: 120, clientY: 80 });
        assert.deepEqual([...h.state.expanded], ['batch-one', 'batch-two']);
        assert.deepEqual([...h.state.selected], ['batch-one']);
        assert.equal(h.state.box, null);
    }
});

test('canvas deselect collapses all batches and closes the selected node controls', () => {
    const h = blankCanvasHarness();
    h.deselect();
    assert.equal(h.state.expanded.size, 0);
    assert.equal(h.state.selected.size, 0);
    for (const field of ['connection', 'menu', 'box', 'hovered', 'toolbar', 'dialog']) assert.equal(h.state[field], null, field);
    assert.equal(h.state.cancellations, 1);
});

function canvasCallback(name, bindings) {
    const file = ts.createSourceFile('infinite-canvas.tsx', fs.readFileSync(path.join(__dirname, '../src/components/canvas/infinite-canvas.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) callback = node.initializer.getText(file);
        ts.forEachChild(node, visit);
    }
    visit(file);
    assert.ok(callback, name);
    const code = ts.transpileModule('return (' + callback + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

test('pan tool collapses batches on a blank click and preserves them while dragging', () => {
    for (const drag of [false, true]) {
        const h = blankCanvasHarness();
        const frames = [];
        class Element { closest() { return null; } }
        const bindings = {
            Element, tool: 'pan', isSpacePressed: false, viewport: { x: 0, y: 0, k: 1 },
            panState: { current: { isPanning: false } }, scaleRef: { current: 1 },
            frameRef: { current: null }, nextViewportRef: { current: null },
            setIsPanning: () => {}, document: { body: { style: {} } },
            onCanvasMouseDown: h.down, onCanvasDeselect: h.deselect,
            onViewportChange: (value) => { bindings.viewport = value; },
            requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
        };
        const down = canvasCallback('handlePointerDown', bindings);
        const move = canvasCallback('handlePointerMove', bindings);
        const up = canvasCallback('handlePointerUp', bindings);
        down({ button: 0, pointerId: 1, clientX: 120, clientY: 80, target: new Element(), currentTarget: { setPointerCapture: () => {} }, preventDefault: () => {} });
        assert.deepEqual([...h.state.expanded], ['batch-one', 'batch-two']);
        if (drag) {
            move({ clientX: 160, clientY: 110 });
            frames[0]();
            assert.deepEqual(bindings.viewport, { x: 40, y: 30, k: 1 });
        }
        up();
        assert.deepEqual([...h.state.expanded], drag ? ['batch-one', 'batch-two'] : []);
        assert.equal(h.state.box, null);
    }
});

test('removing a failed primary selects a successful image and updates download metadata', () => {
    const failed = image('failed', 'error');
    const good = image('good', 'success', 'good-url');
    const nodesRef = { current: [{ id: 'batch', type: 'image', metadata: { images: [failed, good], primaryImageId: 'failed', content: 'deleted-url', storageKey: 'deleted-key', status: 'success' } }] };
    const remove = pageCallback('deleteBatchImage', {
        nodesRef, generationRequestsRef: { current: new Map() },
        setExpandedBatchNodeIds: () => {},
        setNodes: (update) => { nodesRef.current = update(nodesRef.current); },
        NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error', NODE_STATUS_IDLE: 'idle',
    });
    remove('batch', 'failed');
    const metadata = nodesRef.current[0].metadata;
    assert.equal(metadata.primaryImageId, 'good');
    assert.equal(metadata.content, 'good-url');
    assert.equal(metadata.storageKey, 'key-good');
    assert.equal(metadata.naturalWidth, 240);
    assert.equal(metadata.status, 'success');
});

test('removing the last successful image clears the old primary and its file reference', () => {
    const good = image('good', 'success', 'good-url');
    const failed = image('failed', 'error');
    const nodesRef = { current: [{ id: 'batch', type: 'image', metadata: { images: [good, failed], primaryImageId: 'good', content: good.content, storageKey: good.storageKey, status: 'success' } }] };
    const remove = pageCallback('deleteBatchImage', {
        nodesRef, generationRequestsRef: { current: new Map() },
        setExpandedBatchNodeIds: () => {},
        setNodes: (update) => { nodesRef.current = update(nodesRef.current); },
        NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error', NODE_STATUS_IDLE: 'idle',
    });
    remove('batch', 'good');
    const metadata = nodesRef.current[0].metadata;
    assert.equal(metadata.primaryImageId, 'failed');
    assert.equal(metadata.content, undefined);
    assert.equal(metadata.storageKey, undefined);
    assert.equal(metadata.status, 'error');
});

test('repeated copies occupy different positions without covering the source', () => {
    const candidate = image('candidate', 'success', 'image-url');
    const source = { id: 'batch', type: 'image', title: 'batch', position: { x: 200, y: 200 }, width: 240, height: 360, metadata: { images: [candidate] } };
    const nodesRef = { current: [source] };
    let viewport = { x: 0, y: 0, k: 1 };
    let nextId = 0;
    const copy = pageCallback('duplicateBatchImage', {
        nodesRef, viewport, size: { width: 1280, height: 800 },
        fitNodeSize: () => ({ width: 240, height: 360 }), nanoid: () => `copy-${++nextId}`,
        CanvasNodeType: { Image: 'image' }, NODE_STATUS_SUCCESS: 'success',
        setExpandedBatchNodeIds: () => {},
        setNodes: (update) => { nodesRef.current = update(nodesRef.current); },
        setViewport: (update) => { viewport = update(viewport); },
        setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {}, setDialogNodeId: () => {},
    });
    copy(source, 'candidate');
    copy(source, 'candidate');
    const [first, second] = nodesRef.current.slice(1);
    assert.notDeepEqual(first.position, second.position);
    assert.ok(first.position.x >= source.position.x + source.width || first.position.y >= source.position.y + source.height);
    assert.ok(second.position.x >= first.position.x + first.width || second.position.y >= first.position.y + first.height || second.position.x + second.width <= first.position.x || second.position.y + second.height <= first.position.y);
});

test('a second retry on the same batch waits until the first request finishes', async () => {
    const batchRetryLocksRef = { current: new Set() };
    const generationRequestsRef = { current: new Map() };
    let release;
    const calls = [];
    const retry = pageCallback('retryBatchImage', {
        batchRetryLocksRef, generationRequestsRef,
        handleRetryNode: (node, imageId) => { calls.push(imageId); return new Promise((resolve) => { release = resolve; }); },
    });
    retry({ id: 'batch' }, 'one');
    retry({ id: 'batch' }, 'two');
    assert.deepEqual(calls, ['one']);
    release();
    await new Promise(setImmediate);
    retry({ id: 'batch' }, 'two');
    assert.deepEqual(calls, ['one', 'two']);
    release();
});
