const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/canvas/canvas-safe-node-panel.tsx'), 'utf8');
const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Run the actual component's layout and event handlers without a browser or user data.
function harness({ width = 680, canvas = {}, target = {}, contentHeight = 244 } = {}) {
    const rect = value => ({ ...value, right: value.left + value.width, bottom: value.top + value.height });
    const canvasRect = { left: 100, top: 50, width: 1400, height: 900, ...canvas };
    const targetRect = { left: 500, top: 180, width: 390, height: 390, ...target };
    const listeners = new Map();
    const capturedListeners = new Map();
    const frames = new Map();
    const observers = [];
    const effects = [];
    let nextFrame = 0;
    let measuredContentHeight = contentHeight;
    class Element {
        constructor(parentElement = null, safePanel = false) {
            this.parentElement = parentElement;
            this.safePanel = safePanel;
            this.listeners = new Map();
        }
        closest(selector) {
            if (selector !== '[data-canvas-safe-panel]') return null;
            return this.safePanel ? this : this.parentElement?.closest(selector) || null;
        }
        addEventListener(name, callback) {
            if (!this.listeners.has(name)) this.listeners.set(name, new Set());
            this.listeners.get(name).add(callback);
        }
        removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
        dispatchEvent(event) {
            Object.defineProperty(event, 'target', { value: this, configurable: true });
            // Native scroll does not bubble, but window capture and local listeners receive it.
            for (const callback of capturedListeners.get(event.type) || []) callback(event);
            for (const callback of this.listeners.get(event.type) || []) callback(event);
            return true;
        }
    }
    const panel = Object.assign(new Element(null, true), {
        style: {}, dataset: {},
        getBoundingClientRect() {
            const height = Math.min(measuredContentHeight, parseFloat(this.style.maxHeight) || Infinity);
            return rect({ left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: parseFloat(this.style.width) || width, height });
        },
    });
    const surface = Object.assign(new Element(), { getBoundingClientRect: () => rect(canvasRect), querySelectorAll: () => [] });
    const node = { getBoundingClientRect: () => rect(targetRect), getAttribute: () => 'image-node' };
    const anchor = { closest: selector => selector === '[data-node-id]' ? node : selector === '[data-canvas-surface]' ? surface : null };
    const jsx = (type, props) => {
        if (props?.ref) props.ref.current = type === 'span' ? anchor : panel;
        return { type, props };
    };
    const window = {
        addEventListener(name, callback, capture = false) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(callback);
            if (capture) {
                if (!capturedListeners.has(name)) capturedListeners.set(name, new Set());
                capturedListeners.get(name).add(callback);
            }
        },
        removeEventListener(name, callback) {
            listeners.get(name)?.delete(callback);
            capturedListeners.get(name)?.delete(callback);
        },
        dispatchEvent(event) {
            Object.defineProperty(event, 'target', { value: window, configurable: true });
            for (const callback of listeners.get(event.type) || []) callback(event);
        },
    };
    class ResizeObserver {
        constructor(callback) { this.callback = callback; this.observed = new Set(); observers.push(this); }
        observe(element) { this.observed.add(element); }
        disconnect() { this.observed.clear(); }
    }
    const dependencies = {
        react: { useRef: () => ({ current: null }), useLayoutEffect: callback => effects.push(callback) },
        'react-dom': { createPortal: child => child },
        'react/jsx-runtime': { jsx, jsxs: jsx },
    };
    const exports = {};
    new Function('exports', 'require', 'window', 'document', 'Element', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', code)(
        exports, name => {
            assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
            return dependencies[name];
        }, window, { body: {} }, Element, ResizeObserver,
        callback => { const id = ++nextFrame; frames.set(id, callback); return id; },
        id => frames.delete(id),
    );
    exports.CanvasSafeNodePanel({ width, children: 'generation controls' });
    let cleanup = effects[0]();
    const flush = () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback();
    };
    return {
        panel, surface, targetRect, canvasRect, listeners, frames, observers, flush,
        queueEvent(name, target) { (target || window).dispatchEvent(new Event(name)); },
        panelChild: () => new Element(panel),
        anotherPanelChild: () => new Element(new Element(null, true)),
        observeAnchor() {
            const observed = { local: [], captured: [], layout: [] };
            // Represent open popup consumers measuring their button after the panel moves.
            const buttonRect = () => {
                const bounds = panel.getBoundingClientRect();
                return { left: bounds.left + 24, top: bounds.top + 48 };
            };
            const local = () => observed.local.push(buttonRect());
            const captured = () => observed.captured.push(buttonRect());
            const layout = () => observed.layout.push(buttonRect());
            panel.addEventListener('scroll', local);
            window.addEventListener('scroll', captured, true);
            window.addEventListener('canvas-node-panel-layout', layout);
            return { ...observed, buttonRect, stop() {
                panel.removeEventListener('scroll', local);
                window.removeEventListener('scroll', captured);
                window.removeEventListener('canvas-node-panel-layout', layout);
            } };
        },
        event(name) { window.dispatchEvent(new Event(name)); flush(); },
        resize(element = surface) { for (const observer of observers) if (observer.observed.has(element)) observer.callback(); flush(); },
        changeContentHeight(value) { measuredContentHeight = value; this.resize(panel); },
        rerender() { cleanup(); cleanup = effects[0](); },
        unmount() { cleanup(); },
        position() { return { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top), width: parseFloat(panel.style.width) }; },
        assertAnchored() {
            const position = this.position();
            assert.equal(position.top, targetRect.top + targetRect.height + 16, 'panel stays sixteen pixels below the node');
            assert.equal(position.left + position.width / 2, targetRect.left + targetRect.width / 2, 'panel stays centered on the node');
        },
    };
}

test('a node near the bottom keeps its panel below instead of moving above it', () => {
    const h = harness({ target: { top: 610, height: 300 } });
    h.assertAnchored();
    h.unmount();
});

test('nodes beyond the left and right canvas edges retain a centered panel', () => {
    for (const left of [-250, 1550]) {
        const h = harness({ target: { left } });
        h.assertAnchored();
        h.unmount();
    }
});

test('large nodes keep their bottom anchor through zoom, pan and scroll updates', () => {
    const h = harness();
    for (const scale of [0.5, 1, 2]) {
        Object.assign(h.targetRect, { left: -120 + 320 * scale, top: -300 + 240 * scale, width: 850 * scale, height: 800 * scale });
        h.rerender();
        h.assertAnchored();
        h.targetRect.left += 125;
        h.targetRect.top -= 180;
        h.event('scroll');
        h.assertAnchored();
    }
    h.unmount();
});

test('content height changes and toolbar size notifications preserve the node anchor', () => {
    const h = harness({ target: { top: 410, height: 300 }, contentHeight: 120 });
    h.assertAnchored();
    h.changeContentHeight(520);
    h.assertAnchored();
    h.event('canvas-node-toolbar-size');
    h.assertAnchored();
    h.unmount();
});

test('canvas resizing limits the panel width on narrow screens while keeping it centered', () => {
    const h = harness();
    h.assertAnchored();
    h.canvasRect.width = 360;
    h.targetRect.left = 180;
    h.event('resize');
    assert.equal(h.position().width, 336);
    h.assertAnchored();
    h.canvasRect.width = 1200;
    h.resize();
    assert.equal(h.position().width, 680);
    h.assertAnchored();
    h.unmount();
});

test('unmount removes layout listeners and observers and cancels queued placement', () => {
    const h = harness();
    assert.equal(h.panel.dataset.panelNodeId, 'image-node');
    assert.equal(h.panel.style.visibility, 'visible');
    for (const callback of h.listeners.get('resize')) callback();
    assert.equal(h.frames.size, 1);
    h.unmount();
    assert.equal(h.frames.size, 0);
    assert.ok(h.observers.every(observer => observer.observed.size === 0));
    assert.ok([...h.listeners.values()].every(callbacks => callbacks.size === 0));
});

test('open popup consumers remeasure the final button anchor after node movement', () => {
    const h = harness();
    const popup = h.observeAnchor();
    const before = popup.buttonRect();
    h.targetRect.left += 100;
    h.targetRect.top += 60;
    h.rerender();
    assert.deepEqual(popup.local.at(-1), { left: before.left + 100, top: before.top + 60 }, 'popup listening to its real scroll ancestor follows the button');
    assert.deepEqual(popup.captured.at(-1), popup.buttonRect(), 'window capture consumers receive the final position');
    assert.deepEqual(popup.layout.at(-1), popup.buttonRect(), 'existing image layout consumers continue to receive the final position');
    assert.equal(h.frames.size, 0, 'the position notification does not schedule another placement');
    popup.stop();
    h.unmount();
});

test('scroll inside this or another safe panel cannot create a placement feedback loop', () => {
    const h = harness();
    for (const target of [h.panel, h.panelChild(), h.anotherPanelChild()]) {
        h.queueEvent('scroll', target);
        assert.equal(h.frames.size, 0, 'panel scrolling updates consumers without moving safe panels again');
    }
    h.flush();
    assert.equal(h.frames.size, 0);
    h.assertAnchored();
    h.unmount();
});

test('canvas and window scroll updates coalesce and notify popups once after placement', () => {
    const h = harness();
    const popup = h.observeAnchor();
    h.targetRect.left -= 90;
    h.targetRect.top += 125;
    h.queueEvent('scroll', h.surface);
    h.queueEvent('scroll');
    h.queueEvent('scroll', h.surface);
    assert.equal(h.frames.size, 1);
    h.flush();
    h.assertAnchored();
    assert.deepEqual(popup.local, [popup.buttonRect()], 'the popup sees the coalesced final position');
    assert.deepEqual(popup.captured.at(-1), popup.buttonRect());
    assert.deepEqual(popup.layout.at(-1), popup.buttonRect());
    assert.equal(h.frames.size, 0);
    h.flush();
    assert.equal(popup.local.length, 1, 'idle frames produce no further notifications');
    popup.stop();
    h.unmount();
});

test('unmount leaves no pending popup reposition after a queued canvas scroll', () => {
    const h = harness();
    const popup = h.observeAnchor();
    h.queueEvent('scroll', h.surface);
    assert.equal(h.frames.size, 1);
    popup.stop();
    h.unmount();
    assert.equal(h.frames.size, 0);
    h.flush();
    h.queueEvent('scroll', h.surface);
    assert.equal(h.frames.size, 0);
    assert.equal(popup.local.length, 0);
    assert.ok(h.observers.every(observer => observer.observed.size === 0));
    assert.ok([...h.listeners.values()].every(callbacks => callbacks.size === 0));
});
