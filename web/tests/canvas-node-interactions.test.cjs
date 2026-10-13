const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.join(__dirname, '../src');

// Exercise the actual page callback with state and model requests isolated.
// No browser data, model API, GPU, or network is touched by this harness.
function pageCallback(name, bindings) {
    const file = ts.createSourceFile('project.tsx', fs.readFileSync(path.join(root, 'pages/canvas/project.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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

function batchHarness({ count = 1, content, failAt, cancelAt, cancelFailure } = {}) {
    const original = { id: 'source', type: 'video', title: 'Video', position: { x: 10, y: 20 }, width: 300, height: 200, metadata: { videoCount: count, content, labelColor: '#a855f7', videoH3Mode: 'turbo' } };
    const nodesRef = { current: [original] };
    const connectionsRef = { current: [] };
    const requests = new Map();
    const calls = [];
    const errors = [];
    let id = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    let rootController;
    let running;
    const config = { model: 'MiniMax-H3', size: '16:9', videoSeconds: '5', vquality: '480', videoH3Mode: 'turbo', videoH3SageAttention: 'true', videoH3TeSpeed: 'false', count: '12' };
    const bindings = {
        nodesRef, connectionsRef, effectiveConfig: config,
        buildGenerationConfig: () => config,
        isAiConfigReady: () => true, openConfigDialog: () => assert.fail('unexpected config dialog'),
        getNodeDefinition: () => undefined,
        setRunningNodeId: (value) => { running = value; },
        startGenerationRequest: (target, origin, runningId, controller = new AbortController()) => { requests.set(target, { controller, origin, runningId }); rootController ||= controller; return controller; },
        finishGenerationRequest: (target, controller) => { if (requests.get(target)?.controller === controller) requests.delete(target); },
        CanvasNodeType: { Video: 'video', Text: 'text', Image: 'image', Config: 'config', Audio: 'audio' },
        hydrateNodeGenerationContext: async (value) => value,
        buildNodeGenerationContext: (_, __, ___, prompt) => ({ prompt, referenceImages: ['image-ref'], referenceVideos: ['video-ref'], referenceAudios: ['audio-ref'] }),
        generationReferenceUrls: () => ['image:1', 'video:1'],
        nodeSizeFromRatio: () => null, NODE_DEFAULT_SIZE: { video: { width: 300, height: 200 } },
        nanoid: () => 'generated-' + ++id,
        createGeneratedTitle: (kind) => `${kind === 'video' ? '视频' : '图片'}${nodesRef.current.filter((node) => node.type === kind && /^视频\d+$/.test(node.title)).length + 1}`,
        NODE_STATUS_LOADING: 'loading', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error',
        setNodes: (update) => { nodesRef.current = update(nodesRef.current); },
        setConnections: (update) => { connectionsRef.current = update(connectionsRef.current); },
        isGenerationCanceled: (error) => error.name === 'AbortError',
        isVideoTaskFailed: () => true,
        t: (key) => key, message: { error: (text) => errors.push(text) },
        completeVideoNodeTask: async (target, actualConfig, prompt, images, signal, extra, videos, audios) => {
            assert.ok(requests.has('source'), 'the batch must retain a cancellable root request');
            calls.push({ target, config: actualConfig, prompt, images, videos, audios, extra });
            maxInFlight = Math.max(maxInFlight, ++inFlight);
            await Promise.resolve();
            inFlight--;
            if (calls.length === cancelAt) {
                rootController.abort();
                if (cancelFailure) throw new Error('无法确认后台任务已取消');
                throw new DOMException('Canceled', 'AbortError');
            }
            if (calls.length === failAt) throw new Error('model failed');
            nodesRef.current = nodesRef.current.map((node) => node.id === target ? { ...node, metadata: { ...node.metadata, ...extra, content: 'result-' + calls.length, status: 'success' } } : node);
        },
    };
    bindings.setNodesWithoutHistory = bindings.setNodes;
    const run = pageCallback('executeGenerateNode', bindings);
    return { run: () => run('source', 'video', 'Scene'), nodesRef, connectionsRef, calls, errors, requests, original, get maxInFlight() { return maxInFlight; }, get running() { return running; } };
}

test('empty video writes back once and generates the selected count sequentially', async () => {
    const h = batchHarness({ count: 4 });
    await h.run();
    assert.equal(h.calls.length, 4);
    assert.equal(h.nodesRef.current.length, 4);
    assert.deepEqual(h.nodesRef.current.map((node) => node.title), ['视频1', '视频2', '视频3', '视频4']);
    assert.equal(h.maxInFlight, 1);
    assert.equal(h.calls[0].target, 'source');
    assert.equal(h.connectionsRef.current.length, 3);
    assert.equal(new Set(h.nodesRef.current.map((n) => n.position.x)).size, 4);
    assert.ok(h.calls.every((call) => call.config.count === '1'));
    assert.equal(h.requests.size, 0);
    assert.equal(h.running, null);
});

test('existing video remains intact while a batch creates separate result nodes', async () => {
    const h = batchHarness({ count: 3, content: 'original-video' });
    await h.run();
    assert.equal(h.nodesRef.current.length, 4);
    assert.equal(h.nodesRef.current[0].metadata.content, 'original-video');
    assert.equal(h.connectionsRef.current.length, 3);
    assert.ok(h.calls.every((call) => call.target !== 'source'));
});

test('video generation retains appearance, H3 settings and all reference kinds', async () => {
    const h = batchHarness({ count: 2 });
    await h.run();
    assert.equal(h.nodesRef.current[0].metadata.labelColor, '#a855f7');
    assert.equal(h.nodesRef.current[0].metadata.videoCount, 2);
    for (const call of h.calls) {
        assert.equal(call.extra.videoH3Mode, 'turbo');
        assert.equal(call.extra.h3TeSpeed, 'false');
        assert.deepEqual(call.images, ['image-ref']);
        assert.deepEqual(call.videos, ['video-ref']);
        assert.deepEqual(call.audios, ['audio-ref']);
    }
});

test('one failed video does not overwrite successful siblings', async () => {
    const h = batchHarness({ count: 3, failAt: 2 });
    await h.run();
    assert.deepEqual(h.nodesRef.current.map((n) => n.metadata.status), ['success', 'error', 'success']);
    assert.equal(h.errors.length, 1);
    assert.equal(h.requests.size, 0);
});

test('a failed first result remains failed after subsequent results succeed', async () => {
    const h = batchHarness({ count: 3, failAt: 1 });
    await h.run();
    assert.deepEqual(h.nodesRef.current.map((n) => n.metadata.status), ['error', 'success', 'success']);
});

test('cancel stops before another model request or placeholder is created', async () => {
    const h = batchHarness({ count: 4, cancelAt: 2 });
    await h.run();
    assert.equal(h.calls.length, 2);
    assert.equal(h.nodesRef.current.length, 2);
    assert.equal(h.nodesRef.current[0].metadata.status, 'success');
    assert.equal(h.requests.size, 0);
    assert.equal(h.errors.length, 0);
});

test('video count is bounded and is independent of the image/global count', async () => {
    for (const [count, expected] of [[undefined, 1], [-1, 1], [0, 1], [100, 4], [2.8, 2]]) {
        const h = batchHarness({ count });
        await h.run();
        assert.equal(h.calls.length, expected);
    }
});

test('failed backend cancellation remains visible and stops the rest of a video batch', async () => {
    const h = batchHarness({ count: 4, cancelAt: 2, cancelFailure: true });
    await h.run();
    assert.equal(h.calls.length, 2);
    assert.equal(h.nodesRef.current.length, 2);
    assert.equal(h.nodesRef.current[0].metadata.status, 'success');
    assert.equal(h.nodesRef.current[1].metadata.status, 'error');
    assert.deepEqual(h.errors, ['无法确认后台任务已取消']);
    assert.equal(h.requests.size, 0);
});

function moduleWith(relative, dependencies) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports = {};
    new Function('exports', 'require', code)(exports, (name) => {
        if (name in dependencies) return dependencies[name];
        if (name === 'react/jsx-runtime') return require('../node_modules/react/jsx-runtime');
        throw new Error('Unexpected import: ' + name);
    });
    return exports;
}

test('appearance, rich text and video quantity survive actual store persistence and rehydration', async () => {
    const disk = new Map();
    const loadStore = () => moduleWith('stores/canvas/use-canvas-store.ts', {
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': require('../node_modules/zustand/middleware'),
        nanoid: { nanoid: () => 'test-project' },
        '@/i18n': { default: { t: (key) => key } },
        '@/lib/canvas-theme': moduleWith('lib/canvas-theme.ts', {}),
        '@/lib/localforage-storage': { localForageStorage: { getItem: async (key) => disk.get(key) || null, setItem: (key, value) => disk.set(key, value), removeItem: (key) => disk.delete(key) }, reportStateReadError: (_, error) => { throw error; } },
    }).useCanvasStore;
    const first = loadStore();
    await new Promise(setImmediate);
    assert.equal(first.getState().hydrated, true);
    const id = first.getState().createProject('UI test');
    assert.equal(first.getState().projects[0].backgroundMode, 'dots');
    const richText = { version: 1, html: '<p><strong>脚本内容</strong></p>', text: '脚本内容' };
    const metadata = { content: '脚本内容', richText, texts: [{ id: 'active', content: '脚本内容', richText }], primaryTextId: 'active', textBackground: '#e7eafd', labelColor: '#a855f7', videoCount: 3 };
    first.getState().updateProject(id, { nodes: [{ id: 'text', type: 'text', metadata }] });
    const reopened = loadStore();
    await new Promise(setImmediate);
    assert.deepEqual(reopened.getState().projects[0].nodes[0].metadata, metadata);
    reopened.getState().updateProject(id, { nodes: [{ id: 'text', type: 'text', metadata: { ...metadata, richText: undefined, texts: [{ id: 'active', content: '脚本内容', richText: undefined }], textBackground: undefined, labelColor: undefined } }] });
    const cleared = loadStore();
    await new Promise(setImmediate);
    assert.equal(cleared.getState().projects[0].nodes[0].metadata.textBackground, undefined);
    assert.equal(cleared.getState().projects[0].nodes[0].metadata.labelColor, undefined);
    assert.equal(cleared.getState().projects[0].nodes[0].metadata.content, '脚本内容');
    assert.equal(cleared.getState().projects[0].nodes[0].metadata.richText, undefined);
    assert.equal(cleared.getState().projects[0].nodes[0].metadata.texts[0].richText, undefined);
});

test('legacy text nodes gain formatting and plain edits clear it without changing other nodes', () => {
    const untouched = { id: 'other', type: 'text', metadata: { content: '保留正文' } };
    let nodes = [{ id: 'text', type: 'text', metadata: { content: '旧正文', textBackground: '#242424' } }, untouched];
    const change = pageCallback('handleNodeContentChange', { setNodes: (update) => { nodes = update(nodes); } });
    const richText = { version: 1, html: '<h2>新正文</h2>', text: '新正文' };
    change('text', '新正文', richText);
    assert.equal(nodes[0].metadata.content, '新正文');
    assert.deepEqual(nodes[0].metadata.richText, richText);
    assert.equal(nodes[0].metadata.textBackground, '#242424');
    assert.equal(nodes[0].metadata.texts, undefined);
    assert.equal(nodes[1], untouched);
    change('text', '普通正文');
    assert.equal(nodes[0].metadata.content, '普通正文');
    assert.equal(nodes[0].metadata.richText, undefined);
    change('text', '');
    const { readTextNodeContent } = moduleWith('lib/canvas/text-rich-content.ts', {});
    assert.deepEqual(readTextNodeContent(nodes[0]), { content: '', richText: undefined });
    assert.equal(nodes[1], untouched);
});

test('batch text formatting follows the active item and empty edits leave no old content or format', () => {
    const second = { id: 'two', content: '第二段' };
    let nodes = [{ id: 'text', type: 'text', metadata: { content: '第一段', texts: [{ id: 'one', content: '第一段' }, second] } }];
    const bindings = { setNodes: (update) => { nodes = update(nodes); }, CanvasNodeType: { Text: 'text' } };
    const change = pageCallback('handleNodeContentChange', bindings);
    const select = pageCallback('setBatchPrimary', bindings);
    const { readTextNodeContent } = moduleWith('lib/canvas/text-rich-content.ts', {});
    const firstRichText = { version: 1, html: '<p><strong>第一段</strong></p>', text: '第一段' };
    change('text', '第一段', firstRichText);
    assert.deepEqual(nodes[0].metadata.richText, firstRichText);
    assert.deepEqual(nodes[0].metadata.texts[0].richText, firstRichText, 'a missing primary id must update the displayed first item');
    assert.equal(nodes[0].metadata.texts[1], second);
    select('text', 'two');
    assert.equal(nodes[0].metadata.primaryTextId, 'two');
    assert.equal(nodes[0].metadata.content, '第二段');
    assert.equal(nodes[0].metadata.richText, undefined, 'a plain batch item must not inherit the previous format');
    const secondRichText = { version: 1, html: '<p><em>第二段</em></p>', text: '第二段' };
    change('text', '第二段', secondRichText);
    assert.deepEqual(nodes[0].metadata.texts[0].richText, firstRichText);
    assert.deepEqual(nodes[0].metadata.texts[1].richText, secondRichText);
    select('text', 'one');
    assert.deepEqual(readTextNodeContent(nodes[0]), { content: '第一段', richText: firstRichText });
    assert.deepEqual(nodes[0].metadata.richText, firstRichText);
    change('text', '');
    assert.equal(nodes[0].metadata.content, '');
    assert.equal(nodes[0].metadata.richText, undefined);
    assert.equal(nodes[0].metadata.texts[0].content, '');
    assert.equal(nodes[0].metadata.texts[0].richText, undefined);
    assert.deepEqual(readTextNodeContent(nodes[0]), { content: '', richText: undefined });
    select('text', 'two');
    assert.deepEqual(readTextNodeContent(nodes[0]), { content: '第二段', richText: secondRichText });
    assert.deepEqual(nodes[0].metadata.richText, secondRichText);
});

test('an invalid nonempty primary text id updates the same first item used for display', () => {
    const second = { id: 'two', content: '第二段' };
    let nodes = [{ id: 'text', type: 'text', metadata: { content: '旧正文', primaryTextId: 'removed', texts: [{ id: 'one', content: '第一段' }, second] } }];
    const change = pageCallback('handleNodeContentChange', { setNodes: (update) => { nodes = update(nodes); } });
    const { readTextNodeContent } = moduleWith('lib/canvas/text-rich-content.ts', {});
    assert.equal(readTextNodeContent(nodes[0]).content, '第一段');
    const richText = { version: 1, html: '<h2>修改第一段</h2>', text: '修改第一段' };
    change('text', '修改第一段', richText);
    assert.equal(nodes[0].metadata.content, '修改第一段');
    assert.deepEqual(nodes[0].metadata.richText, richText);
    assert.deepEqual(readTextNodeContent(nodes[0]), { content: '修改第一段', richText });
    assert.equal(nodes[0].metadata.texts[1], second);
});

test('rich text modifier clicks bypass canvas selection while ordinary node clicks still select', () => {
    const file = ts.createSourceFile('canvas-node.tsx', fs.readFileSync(path.join(root, 'components/canvas/canvas-node.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler;
    function visit(node) {
        if (ts.isJsxAttribute(node) && node.name.getText(file) === 'onMouseDownCapture') handler = node.initializer.expression.getText(file);
        ts.forEachChild(node, visit);
    }
    visit(file);
    assert.ok(handler, 'the actual canvas node capture handler must be exercised');
    const code = ts.transpileModule('return (' + handler + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    class Element {
        constructor(richTextOwner) { this.richTextOwner = richTextOwner; }
        closest(selector) { return selector === '[data-rich-text-owner]' && this.richTextOwner ? this.richTextOwner : null; }
    }
    const calls = [];
    const capture = new Function('Element', 'referenceSelectionState', 'onSelectCapture', 'data', code)(Element, undefined, (...args) => calls.push(args), { id: 'text-node' });
    for (const modifier of [{ shiftKey: true }, { ctrlKey: true }]) {
        const editorEvent = { target: new Element({ id: 'editor-owner' }), button: 0, ...modifier };
        capture(editorEvent);
        assert.equal(calls.length, 0, 'selecting text or clicking its portal toolbar must not toggle canvas selection');
    }
    for (const modifier of [{}, { shiftKey: true }, { ctrlKey: true }]) {
        const nodeEvent = { target: new Element(null), button: 0, ...modifier };
        const before = calls.length;
        capture(nodeEvent);
        assert.equal(calls.length, before + 1);
        assert.deepEqual(calls[before], [nodeEvent, 'text-node']);
    }
});

test('video control events stay separate from node dragging and native media dragging is disabled', () => {
    const { CanvasVideoPlayer } = moduleWith('components/canvas/canvas-video-player.tsx', {
        react: { useRef: () => ({ current: null }), useState: (value) => [value, () => {}] },
        antd: { App: { useApp: () => ({ message: { error: () => {} } }) } },
        'lucide-react': Object.fromEntries(['Maximize2', 'Pause', 'Play', 'Volume2', 'VolumeX'].map((name) => [name, name])),
    });
    const tree = CanvasVideoPlayer({ src: 'test.mp4', nodeId: 'video' });
    const [video, controls] = tree.props.children;
    assert.equal(video.props.draggable, false);
    assert.equal(video.props.controls, undefined);
    assert.ok(video.props.className.includes('pointer-events-none'));
    assert.equal(tree.props.onMouseDown, undefined, 'picture must bubble to the canvas drag handler');
    let prevented = false;
    tree.props.onDragStart({ preventDefault: () => { prevented = true; } });
    assert.ok(prevented);
    for (const event of ['onMouseDown', 'onPointerDown', 'onDoubleClick']) {
        let stopped = false;
        controls.props[event]({ stopPropagation: () => { stopped = true; } });
        assert.ok(stopped, event);
    }
});

test('text download exports the active batch text with a safe filename', async () => {
    let saved;
    const theme = { node: { fill: '#242424', text: '#fff' } };
    const { TextNodeActions, textNodeColors } = moduleWith('components/canvas/canvas-node-appearance.tsx', {
        react: { useMemo: (compute) => compute(), useState: (value) => [value, () => {}] },
        antd: { Modal: 'modal', Popover: 'popover' },
        'lucide-react': { Download: 'download', Maximize2: 'maximize', Tag: 'tag', X: 'x' },
        'file-saver': { saveAs: (blob, filename) => { saved = { blob, filename }; } },
        '@/lib/canvas-theme': { canvasThemes: { dark: theme } },
        '@/stores/use-theme-store': { useThemeStore: (select) => select({ theme: 'dark' }) },
        '@/lib/canvas/text-rich-content': moduleWith('lib/canvas/text-rich-content.ts', {}),
        './canvas-text-editor.css': {},
    });
    const node = { title: '脚本/镜头:01', metadata: { content: 'old text', primaryTextId: 'b', texts: [{ id: 'a', content: 'first' }, { id: 'b', content: '所选镜头\n完整正文' }], textBackground: '#e7eafd' } };
    const tree = TextNodeActions({ node, onChange: () => {} });
    tree.props.children.find((child) => child?.props?.['aria-label'] === '下载文本').props.onClick();
    assert.equal(await saved.blob.text(), '所选镜头\n完整正文');
    assert.equal(saved.filename, '脚本_镜头_01.txt');
    assert.equal(saved.blob.type, 'text/plain;charset=utf-8');
    assert.equal(textNodeColors(node, theme.node).color, '#202329');
    assert.equal(textNodeColors({ metadata: { textBackground: '#242424' } }, theme.node).color, '#f3f4f6');
});

test('connected text is live in both image and video requests, including an empty local prompt', () => {
    const types = moduleWith('types/canvas.ts', {});
    const dependencies = {
        '@/types/canvas': types,
        '@/i18n': { default: { t: (key) => key } },
        '@/lib/canvas/node-registry': { getNodeDefinition: () => undefined },
        '@/lib/image-utils': {}, '@/services/image-storage': {},
        '@/lib/image-reference-prompt': { imageReferenceLabel: () => 'image' },
    };
    dependencies['@/lib/canvas/canvas-resource-references'] = moduleWith('lib/canvas/canvas-resource-references.ts', dependencies);
    const { buildNodeGenerationContext } = moduleWith('components/canvas/canvas-node-generation.ts', dependencies);
    for (const type of ['image', 'video']) {
        const source = { id: 'text', type: 'text', metadata: { content: '第一版剧本', richText: { version: 1, html: '<h2><strong>第一版剧本</strong></h2>', text: '第一版剧本' } } };
        const target = { id: 'target', type };
        const nodes = [source, target];
        const connections = [{ fromNodeId: 'text', toNodeId: 'target' }];
        const initial = buildNodeGenerationContext('target', nodes, connections, '').prompt;
        assert.ok(initial.includes('第一版剧本'));
        assert.ok(!initial.includes('<h2>') && !initial.includes('<strong>'), 'generation references must contain plain text only');
        source.metadata.content = '修改后的剧本';
        const updated = buildNodeGenerationContext('target', nodes, connections, '').prompt;
        assert.ok(updated.includes('修改后的剧本'));
        assert.ok(!updated.includes('第一版剧本'));
        assert.ok(!updated.includes(source.metadata.richText.html), 'stale rich text must not override updated plain content');
        assert.equal(buildNodeGenerationContext('target', nodes, [], '').prompt, '');
    }
});
