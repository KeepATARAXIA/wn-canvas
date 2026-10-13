const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadQueue() {
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas/generation-queue.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    new Function('exports', code)(exports);
    return exports;
}

const queued = (id, nodeId) => ({ id, nodeId, mode: 'image', status: 'queued' });

test('node waiting positions exclude the running job and follow queue reorder, removal and start', () => {
    const { waitingGenerationByNode } = loadQueue();
    const active = { ...queued('active', 'running-node'), status: 'running' };
    const first = queued('first', 'first-node'), second = queued('second', 'second-node');
    let waiting = waitingGenerationByNode([active, first, second]);
    assert.equal(waiting.has('running-node'), false);
    assert.deepEqual(waiting.get('first-node'), { position: 1, count: 1, running: false });
    assert.deepEqual(waiting.get('second-node'), { position: 2, count: 1, running: false });
    waiting = waitingGenerationByNode([active, second, first]);
    assert.equal(waiting.get('first-node').position, 2);
    assert.equal(waiting.get('second-node').position, 1);
    waiting = waitingGenerationByNode([active, first]);
    assert.equal(waiting.has('second-node'), false);
    waiting = waitingGenerationByNode([{ ...first, status: 'running' }, second]);
    assert.equal(waiting.has('first-node'), false);
    assert.equal(waiting.get('second-node').position, 1);
    assert.equal(waitingGenerationByNode([]).size, 0);
});

test('multiple tasks on one node retain the first position and prioritize active source and output nodes', () => {
    const { waitingGenerationByNode } = loadQueue();
    const queue = [
        { ...queued('active', 'same-node'), status: 'running', targetNodeIds: ['output-node'] },
        queued('another', 'other-node'), queued('same-one', 'same-node'), queued('same-two', 'same-node'),
        queued('output-retry', 'output-node'), queued('tool-retry', 'tool-node'),
    ];
    const original = JSON.stringify(queue);
    const waiting = waitingGenerationByNode(queue, 'tool-node');
    assert.deepEqual(waiting.get('same-node'), { position: 2, count: 2, running: true });
    assert.deepEqual(waiting.get('output-node'), { position: 4, count: 1, running: true });
    assert.equal(waiting.get('tool-node').running, true);
    assert.equal(waiting.get('other-node').running, false);
    assert.equal(JSON.stringify(queue), original, 'presentation must not write loading statuses or timestamps');
});

function loadOverlay() {
    const source = fs.readFileSync(path.join(__dirname, '../src/components/canvas/canvas-node.tsx'), 'utf8');
    const file = ts.createSourceFile('canvas-node.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const overlay = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'QueueWaitingOverlay');
    assert.ok(overlay, 'queue state must render on the actual node');
    const code = ts.transpileModule(overlay.getText(file) + '\nexports.overlay = QueueWaitingOverlay;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports = {};
    const light = { node: { fill: '#eef1f5', text: '#17212b' }, canvas: { background: '#f4f6f8' }, toolbar: { panel: '#fff', border: '#dde2e8' } };
    const dark = { node: { fill: '#222c3b', text: '#f1f5f9' }, canvas: { background: '#11151d' }, toolbar: { panel: '#181f2b', border: '#364359' } };
    new Function('exports', 'require', 'Clock3', 'canvasThemes', code)(exports, name => {
        if (name === 'react/jsx-runtime') return require('../node_modules/react/jsx-runtime');
        throw new Error(name);
    }, 'clock-icon', { light, dark });
    return { overlay: exports.overlay, light, dark };
}

function elements(tree) {
    if (!tree || typeof tree !== 'object') return [];
    return [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
}

test('waiting overlay is readable in both themes, retains interaction and never shows a generation timer or percentage', () => {
    const { overlay, light, dark } = loadOverlay();
    for (const theme of [light, dark]) {
        const tree = overlay({ theme, waiting: { position: 2, count: 1, running: false }, placeholder: true });
        const all = elements(tree);
        assert.ok(tree.props.className.includes('pointer-events-none'), 'the node must remain draggable and selectable');
        const label = all.find(element => element.props?.role === 'status');
        assert.ok(label);
        assert.equal(label.props['aria-label'], '排队中 · 第 2 位');
        assert.equal(all.some(element => element.props?.role === 'progressbar'), false);
        assert.ok(all.some(element => element.type === 'clock-icon'));
        assert.equal(all.some(element => /animate-/.test(element.props?.className || '')), false, 'static edge light also respects reduced motion');
    }
    const { overlay: render, dark: theme } = loadOverlay();
    const running = elements(render({ theme, waiting: { position: 2, count: 3, running: true }, placeholder: true }));
    assert.equal(running.find(element => element.props?.role === 'status').props['aria-label'], '生成中 · 另有 3 个排队');
    assert.equal(running.some(element => element.props?.['data-queue-waiting-shade']), false, 'active generation must not be dimmed');
});
