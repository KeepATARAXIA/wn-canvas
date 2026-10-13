const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.join(__dirname, '../src');

function load(file, overrides = {}) {
    const filename = path.resolve(root, file);
    const output = {};
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function('exports', 'require', code)(output, (name) => {
        if (name in overrides) return overrides[name];
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts', overrides);
        throw new Error('Unexpected dependency: ' + name);
    });
    return output;
}

const { snapCanvasNodeDrag: snap } = load('lib/canvas/canvas-node-snapping.ts');
const geometry = load('lib/canvas/canvas-node-geometry.ts');
function node(id, x, y, width = 100, height = 100, type = 'video', metadata = {}) {
    return { id, position: { x, y }, width, height, type, metadata };
}
test('new image placement clears a large reference without hiding the result', () => {
    const reference = node('reference', 280, 108, 640, 640, 'image');
    const draft = node('new', 550, 330, 340, 240, 'image');
    const placed = geometry.placeNewCanvasNode(draft, [reference], { x: 0, y: 0, k: 1 }, { width: 1440, height: 900 });
    assert.deepEqual(placed, { position: { x: 952, y: 330 }, visible: true });
    assert.ok(placed.position.x >= reference.position.x + reference.width + 32);
    const constrained = geometry.placeNewCanvasNode(draft, [reference], { x: 0, y: 0, k: 1 }, { width: 1200, height: 900 });
    assert.equal(constrained.visible, false);
    assert.ok(constrained.position.x >= reference.position.x + reference.width + 32 || constrained.position.y >= reference.position.y + reference.height + 32);
});
const initial = (nodes) => new Map(nodes.map((n) => [n.id, { ...n.position }]));
const zero = { x: 0, y: 0 };

const { snapCanvasNodeResize: resizeSnap } = load('lib/canvas/canvas-node-snapping.ts');
const resizeOptions = { corner: 'bottom-right', minWidth: 220, minHeight: 160, videoRatio: 0 };
test('resize snaps all four corners while preserving the opposite corner', () => {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        const left = corner.includes('left'), top = corner.includes('top');
        const a = node('a', left ? 3 : 0, top ? 3 : 0, 297, 197);
        const target = node('b', left ? 0 : 300, top ? 0 : 200, 500, 500);
        const result = resizeSnap([a, target], a, 1, { ...resizeOptions, corner });
        assert.equal(result.width, 300); assert.equal(result.height, 200);
        assert.deepEqual(result.position, zero); assert.equal(result.guides.length, 2);
    }
});
test('resize threshold follows zoom, releases cleanly and respects minimum size and reach', () => {
    for (const scale of [0.05, 0.5, 1, 2, 5]) {
        const target = node('b', 1000, -200, 800, 100);
        for (const offset of [5, 7]) {
            const a = node('a', 0, 0, 1000 - offset / scale, 400);
            const result = resizeSnap([a, target], a, scale, resizeOptions);
            assert.equal(result.width, offset === 5 ? 1000 : a.width);
        }
    }
    const a = node('a', 0, 0, 220, 160);
    assert.equal(resizeSnap([a, node('b', 216, -300)], a, 1, resizeOptions).width, 220);
    assert.equal(resizeSnap([a, node('b', 223, 1400)], a, 1, resizeOptions).guides.length, 0);
});
test('video resize retains inner aspect ratio and group resize excludes children', () => {
    const a = node('a', 0, 0, 400, 202);
    const result = resizeSnap([a, node('b', 403, -200)], a, 1, { ...resizeOptions, videoRatio: 2 });
    assert.equal(result.width, 403); assert.equal((result.width - 4) / (result.height - 4), 2);
    const child = node('child', 403, -200, 100, 100, 'text', { groupId: 'a' });
    assert.equal(resizeSnap([a, child], a, 1, resizeOptions).guides.length, 0);
});

test('equal width nodes snap their left, center and right edges and draw all three guides', () => {
    const a = node('a', 103, 210), b = node('b', 100, 0);
    const result = snap([a, b], initial([a]), zero, 1);
    assert.deepEqual(result.nodes[0].position, { x: 100, y: 210 });
    assert.deepEqual(result.guides.map((g) => [g.axis, g.coordinate]), [['x', 100], ['x', 150], ['x', 200]]);
    assert.ok(result.guides.every((g) => g.start === 0 && g.end === 310));
    assert.equal(result.nodes[1], b);
    assert.equal(a.position.x, 103, 'inputs remain unchanged');
});

test('horizontal layout snaps tops, centers and bottoms', () => {
    const a = node('a', 220, 104), b = node('b', 0, 100);
    const result = snap([a, b], initial([a]), zero, 1);
    assert.deepEqual(result.nodes[0].position, { x: 220, y: 100 });
    assert.deepEqual(result.guides.map((g) => [g.axis, g.coordinate]), [['y', 100], ['y', 150], ['y', 200]]);
});

test('different size and type nodes align by center', () => {
    const a = node('a', 138, 210, 40, 100, 'text'), b = node('b', 100, 0, 110, 100, 'image');
    const result = snap([a, b], initial([a]), zero, 1);
    assert.equal(result.nodes[0].position.x, 135);
    assert.deepEqual(result.guides.map((g) => g.coordinate), [155]);
});

test('the six screen pixel threshold stays constant across zoom levels', () => {
    for (const scale of [0.05, 0.5, 1, 2, 5]) {
        // Make anchor spacing large enough to isolate the intended edge at low zoom.
        const b = node('b', 1000, 0, 1000, 100);
        const a = node('a', 1000 + 5 / scale, 100 + 20 / scale, 1000, 100);
        assert.equal(snap([a, b], initial([a]), zero, scale).nodes[0].position.x, 1000);
        const c = { ...a, position: { x: 1000 + 7 / scale, y: a.position.y } };
        assert.equal(snap([c, b], initial([c]), zero, scale).nodes[0].position.x, c.position.x);
    }
});

test('dragging out of range releases the snap without accumulating offsets', () => {
    const a = node('a', 100, 210), b = node('b', 100, 0);
    const positions = initial([a]);
    const first = snap([a, b], positions, { x: 4, y: 0 }, 1);
    const next = snap(first.nodes, positions, { x: 12, y: 0 }, 1);
    assert.equal(first.nodes[0].position.x, 100);
    assert.equal(next.nodes[0].position.x, 112);
    assert.equal(next.guides.length, 0);
});

test('nearest target wins and distant rows do not attract the dragged node', () => {
    const a = node('a', 104, 210), b = node('b', 100, 0), c = node('c', 106, 0);
    assert.equal(snap([a, b, c], initial([a]), zero, 1).nodes[0].position.x, 106);
    const distant = node('distant', 104, 2000);
    assert.equal(snap([a, distant], initial([a]), zero, 1).guides.length, 0);
});

test('long-distance alignment reaches 1200 screen pixels in both axes at every zoom', () => {
    for (const scale of [0.05, 0.5, 1, 2, 5]) {
        for (const axis of ['x', 'y']) {
            for (const gap of [330, 1199, 1200, 1201]) {
                const target = node('target', 0, 0, 1000 / scale, 1000 / scale);
                const offset = 4 / scale;
                const separation = (1000 + gap) / scale;
                const moving = node('moving', axis === 'x' ? offset : separation, axis === 'y' ? offset : separation, target.width, target.height);
                const result = snap([moving, target], initial([moving]), zero, scale);
                const inRange = gap <= 1200;
                assert.equal(result.nodes[0].position[axis], inRange ? 0 : offset, `${axis}, zoom ${scale}, gap ${gap}`);
                assert.equal(result.guides.length, inRange ? 3 : 0);
                assert.ok(result.guides.every((guide) => guide.axis === axis && guide.start === 0 && Math.abs(guide.end - (separation + target.width)) < 0.001));
            }
        }
    }
});

test('multi-selection snaps as a block and keeps relative offsets', () => {
    const a = node('a', 103, 210), child = node('child', 303, 210), target = node('target', 100, 0, 300);
    const result = snap([a, child, target], initial([a, child]), zero, 1);
    assert.equal(result.nodes[0].position.x, 100);
    assert.equal(result.nodes[1].position.x, 300);
    assert.equal(result.nodes[1].position.x - result.nodes[0].position.x, 200);
    assert.equal(result.nodes[2], target);
});

test('dragging a group moves its children once and never snaps to itself', () => {
    const group = node('group', 103, 210, 300, 300, 'group');
    const child = node('child', 130, 250, 100, 100, 'image', { groupId: 'group' });
    const target = node('target', 100, 0, 300);
    const positions = initial([group, child]);
    const result = snap([group, child, target], positions, zero, 1);
    assert.equal(result.nodes[0].position.x, 100);
    assert.equal(result.nodes[1].position.x, 127);
    assert.equal(snap([group, child], positions, { x: 11, y: 8 }, 1).guides.length, 0);
});

test('group frames do not interfere when rearranging their contents', () => {
    const group = node('group', 100, 100, 500, 500, 'group');
    const child = node('child', 103, 230, 100, 100, 'image', { groupId: 'group' });
    const result = snap([group, child], initial([child]), zero, 1);
    assert.equal(result.nodes[1].position.x, 103);
    assert.equal(result.guides.length, 0);
});

function pageCallback(name, bindings) {
    const file = ts.createSourceFile('project.tsx', fs.readFileSync(path.join(root, 'pages/canvas/project.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    const visit = (part) => {
        if (ts.isVariableDeclaration(part) && part.name.getText(file) === name) callback = part.initializer.arguments[0].getText(file);
        ts.forEachChild(part, visit);
    };
    visit(file);
    assert.ok(callback, name);
    const code = ts.transpileModule('return (' + callback + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

function dragHarness() {
    const a = node('a', 20, 210), b = node('b', 100, 0);
    const nodesRef = { current: [a, b] };
    const dragRef = { current: { isDraggingNode: true, hasMoved: false, startX: 10, startY: 10, initialSelectedNodes: initial([a]), movedIds: new Set(['a']) } };
    let guides = [], frame, openedPanel = null;
    const bindings = {
        nodesRef, dragRef, viewportRef: { current: { x: 0, y: 0, k: 1 } }, rafRef: { current: null },
        historyPausedRef: { current: true }, nodeDraggingRef: { current: true },
        setIsNodeDragging: () => {}, setDropTargetGroupId: () => {},
        setAlignmentGuides: (next) => { guides = next; },
        setNodes: (update) => { nodesRef.current = update(nodesRef.current); },
        setDialogNodeId: (id) => { openedPanel = id; }, getNodeDefinition: () => undefined,
        snapCanvasNodeDrag: snap, ...geometry, CanvasNodeType: { Group: 'group' },
        cancelAnimationFrame: () => { frame = null; }, requestAnimationFrame: (fn) => { frame = fn; return 1; },
    };
    const finish = pageCallback('finishNodeDrag', bindings);
    const move = pageCallback('handleGlobalMouseMove', { ...bindings, finishNodeDrag: finish });
    return { move, finish, nodesRef, dragRef, flush: () => { const fn = frame; frame = null; fn?.(); }, get guides() { return guides; }, get openedPanel() { return openedPanel; } };
}

test('real drag preview and mouse release agree even when mouseup beats the animation frame', () => {
    const h = dragHarness();
    h.move({ clientX: 93, clientY: 10 }); // Raw x=103, snaps to 100.
    h.flush();
    assert.equal(h.nodesRef.current[0].position.x, 100);
    assert.equal(h.guides.length, 3);
    h.move({ clientX: 94, clientY: 10 });
    h.finish(94, 10);
    h.flush();
    assert.equal(h.nodesRef.current[0].position.x, 100);
    assert.equal(h.guides.length, 0);
    assert.equal(h.dragRef.current.isDraggingNode, false);
    assert.equal(h.openedPanel, null);
});

test('click jitter does not move nodes, and interruption clears guides', () => {
    const click = dragHarness();
    click.move({ clientX: 12, clientY: 10 });
    click.flush();
    click.finish(12, 10);
    assert.equal(click.nodesRef.current[0].position.x, 20);
    assert.equal(click.openedPanel, 'a');
    const h = dragHarness();
    h.move({ clientX: 93, clientY: 10 }); h.flush();
    assert.ok(h.guides.length);
    h.finish();
    assert.equal(h.guides.length, 0);
    assert.equal(h.dragRef.current.isDraggingNode, false);
});

test('legacy grid backgrounds become dots while blank remains intentional', () => {
    const { resolveCanvasBackgroundMode: resolve } = load('lib/canvas-theme.ts');
    assert.equal(resolve('lines'), 'dots');
    assert.equal(resolve('dots'), 'dots');
    assert.equal(resolve(undefined), 'dots');
    assert.equal(resolve('blank'), 'blank');
});
