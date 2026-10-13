const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/canvas/canvas-node-hover-toolbar.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exported = { exports: {} };
new Function('require', 'module', 'exports', code)(() => ({}), exported, exported.exports);
const place = overrides => exported.exports.positionCanvasNodeToolbar({ canvasWidth: 840, canvasHeight: 800, toolbarWidth: 256, toolbarHeight: 50, nodeCenterX: 420, nodeTop: 140, scale: 1, ...overrides });

function assertInsideCanvas(result, width, height, toolbarWidth, toolbarHeight) {
    assert.ok(result.left - toolbarWidth / 2 >= 80, 'creation dock stays clear');
    assert.ok(result.left + toolbarWidth / 2 <= width - 16, 'toolbar stays inside canvas');
    assert.ok(result.top - toolbarHeight >= 76, 'header stays clear');
    assert.ok(result.top <= height - 76, 'bottom controls stay clear');
}

test('top-edge toolbar uses content edge without covering the node title', () => {
    const result = place();
    assert.equal(result.placement, 'inside');
    assert.ok(result.top - 50 >= 140 + 8);
    assertInsideCanvas(result, 840, 800, 256, 50);
});

test('toolbar stays above the title when there is enough room', () => {
    const result = place({ nodeTop: 320 });
    assert.equal(result.placement, 'above');
    assert.ok(result.top <= 320 - 28 - 8);
    assertInsideCanvas(result, 840, 800, 256, 50);
});

test('image toolbar clears the raised image actions and title', () => {
    const result = place({ nodeTop: 320, nodeBottom: 690, labelOffset: 70, preferOutside: true });
    assert.equal(result.placement, 'above');
    assert.ok(result.top <= 320 - 70 - 8);
});

test('image toolbar fits above a picture near the canvas header', () => {
    const result = place({ nodeTop: 190, nodeBottom: 550, labelOffset: 70, preferOutside: true });
    assert.equal(result.placement, 'above');
    assert.ok(result.top - 50 >= 60);
    assert.ok(result.top <= 190 - 70 - 8);
});

test('image toolbar uses space below the picture when the upper row is crowded', () => {
    const result = place({ nodeTop: 140, nodeBottom: 500, labelOffset: 70, preferOutside: true });
    assert.equal(result.placement, 'below');
    assert.ok(result.top - 50 >= 500 + 8);
    assertInsideCanvas(result, 840, 800, 256, 50);
});

test('half, normal and double zoom preserve a readable toolbar and title gap', () => {
    for (const scale of [0.5, 1, 2]) {
        const nodeTop = 140 * scale;
        const result = place({ nodeTop, scale });
        const titleTop = nodeTop - 28 * scale, titleBottom = nodeTop - 4 * scale;
        assert.ok(result.top <= titleTop - 8 || result.top - 50 >= titleBottom + 8);
        assertInsideCanvas(result, 840, 800, 256, 50);
    }
});

test('wide and wrapped toolbars fit a canvas narrowed by Agent resizing', () => {
    for (const width of [520, 840, 1280]) {
        const toolbarWidth = Math.min(640, width - 96);
        const toolbarHeight = width === 520 ? 146 : 98;
        for (const nodeCenterX of [-160, 420, 1600]) {
            const result = place({ canvasWidth: width, toolbarWidth, toolbarHeight, nodeCenterX });
            assertInsideCanvas(result, width, 800, toolbarWidth, toolbarHeight);
            assert.ok(result.top - toolbarHeight >= 140 + 8);
        }
    }
});

test('a selected node beyond either vertical edge leaves its toolbar reachable', () => {
    for (const nodeTop of [-400, 1100]) {
        const result = place({ nodeTop });
        assertInsideCanvas(result, 840, 800, 256, 50);
    }
});

test('toolbar moves above the editing panel with a twelve pixel gap', () => {
    for (const toolbarHeight of [42, 82]) {
        const panelBounds = { left: 100, right: 620, top: 220, bottom: 500 };
        const result = place({ nodeTop: 510, nodeBottom: 800, preferOutside: true, toolbarHeight, panelBounds });
        assert.equal(result.placement, 'above-panel');
        assert.equal(result.top, panelBounds.top - 12);
        assert.ok(result.top - toolbarHeight >= 60);
    }
});

test('a panel outside the toolbar does not displace it', () => {
    const options = { nodeTop: 350, preferOutside: true };
    assert.deepEqual(place({ ...options, panelBounds: { left: 0, right: 100, top: 200, bottom: 400 } }), place(options));
});
