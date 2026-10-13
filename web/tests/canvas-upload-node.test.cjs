const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.join(__dirname, '../src');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

// Execute production modules/callbacks while isolating media storage and all page state.
// These tests do not touch browser data, network, model services, or user files.
function moduleWith(relative, dependencies = {}) {
    const exports = {};
    new Function('exports', 'require', compile(fs.readFileSync(path.join(root, relative), 'utf8')))(exports, (id) => {
        assert.ok(id in dependencies, 'Unmocked dependency: ' + id);
        return dependencies[id];
    });
    return exports;
}

const types = moduleWith('types/canvas.ts');
const sizes = moduleWith('lib/canvas/canvas-node-size.ts');
const specs = moduleWith('constant/canvas.ts', {
    '@/i18n': { default: { t: (key) => key } },
    '@/types/canvas': types,
    '@/lib/canvas/node-registry': {},
}).NODE_DEFAULT_SIZE;
const factory = moduleWith('lib/canvas/canvas-node-factory.ts', {
    '@/constant/canvas': { NODE_DEFAULT_SIZE: specs },
    '@/lib/canvas/canvas-node-size': sizes,
    '@/stores/use-config-store': {},
    '@/lib/canvas/generation-preferences': {},
    '@/types/canvas': types,
});
const page = ts.createSourceFile('project.tsx', fs.readFileSync(path.join(root, 'pages/canvas/project.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function pageCallback(name, bindings) {
    let callback;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(page) === name) callback = node.initializer.arguments[0].getText(page);
        ts.forEachChild(node, visit);
    }
    visit(page);
    assert.ok(callback, name);
    return new Function(...Object.keys(bindings), compile('return (' + callback + ');'))(...Object.values(bindings));
}

function readerHarness() {
    const calls = [];
    const { readCanvasUploadFile } = moduleWith('lib/canvas/canvas-file-upload.ts', {
        '@/constant/canvas': { NODE_DEFAULT_SIZE: specs },
        '@/lib/canvas/canvas-node-size': sizes,
        '@/lib/canvas/canvas-node-factory': factory,
        '@/types/canvas': types,
        '@/services/image-storage': { uploadImage: async (input) => {
            calls.push({ kind: 'image', input });
            return { url: 'blob:image-result', storageKey: 'image:result', width: 1280, height: 720, bytes: input.size, mimeType: input.type };
        } },
        '@/services/file-storage': { uploadMediaFile: async (input, kind = 'file') => {
            calls.push({ kind, input });
            return { url: 'blob:' + kind + '-result', storageKey: kind + ':result', width: 1920, height: 1080, durationMs: 3000, bytes: input.size, mimeType: input.type || 'application/octet-stream' };
        } },
    });
    return { read: readCanvasUploadFile, calls };
}

const fixtures = [
    { name: 'sample.png', mime: 'image/png', type: 'image', key: 'image:result', size: { width: 640, height: 360 } },
    { name: 'sample.mp4', mime: 'video/mp4', type: 'video', key: 'video:result', size: { width: 420, height: 236.25 } },
    { name: 'sample.wav', mime: 'audio/wav', type: 'audio', key: 'audio:result', size: { width: specs.audio.width, height: specs.audio.height } },
    { name: 'document.pdf', mime: 'application/pdf', type: 'upload', key: 'file:result', size: { width: specs.upload.width, height: specs.upload.height } },
];
const makeFile = (name, type = '') => new File(['test upload contents'], name, { type });
const originalNode = (metadata = {}) => ({ id: 'upload-1', type: 'upload', title: '上传节点', position: { x: 100, y: 160 }, width: 340, height: 200, metadata: { status: 'idle', groupId: 'group-1', labelColor: '#2458ff', ...metadata } });
const center = (node) => [node.position.x + node.width / 2, node.position.y + node.height / 2];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function pageHarness(read, node = originalNode()) {
    const other = { ...originalNode(), id: 'other', title: '保留节点' };
    const nodesRef = { current: [node, other] };
    const connections = [{ id: 'incoming', fromNodeId: 'other', toNodeId: node.id }, { id: 'outgoing', fromNodeId: node.id, toNodeId: 'config' }];
    const nodeFileTargetRef = { current: null };
    const restoredProjectIdRef = { current: 'project-1' };
    const nodeFileSessionRef = { current: 1 };
    const errors = [], calls = [];
    let clicks = 0, writes = 0;
    const bindings = {
        nodesRef, nodeFileTargetRef, restoredProjectIdRef, nodeFileSessionRef,
        nodeFileInputRef: { current: { click: () => { clicks++; } } },
        projectId: 'project-1', CanvasNodeType: types.CanvasNodeType,
        NODE_STATUS_LOADING: 'loading', NODE_STATUS_ERROR: 'error',
        setNodes: (update) => { writes++; nodesRef.current = update(nodesRef.current); },
        readCanvasUploadFile: async (file) => { calls.push(file); return read(file); },
        message: { error: (error) => errors.push(error) },
    };
    const request = pageCallback('handleNodeFileUpload', bindings);
    const change = pageCallback('handleNodeFileInputChange', bindings);
    function select(file) {
        const input = { files: file ? [file] : [], value: 'C:\\fakepath\\sample' };
        return { input, done: change({ target: input }) };
    }
    return { request, select, nodesRef, nodeFileTargetRef, restoredProjectIdRef, nodeFileSessionRef, connections, errors, calls, other, get clicks() { return clicks; }, get writes() { return writes; } };
}

test('all four upload kinds use existing media storage, metadata and fitting rules', async () => {
    for (const fixture of fixtures) {
        const h = readerHarness();
        const file = makeFile(fixture.name, fixture.mime);
        const result = await h.read(file);
        assert.equal(result.type, fixture.type);
        assert.equal(result.title, fixture.name);
        assert.deepEqual({ width: result.width, height: result.height }, fixture.size);
        assert.equal(result.metadata.storageKey, fixture.key);
        assert.equal(result.metadata.mimeType, fixture.mime);
        assert.equal(result.metadata.bytes, file.size);
        assert.equal(result.metadata.status, 'success');
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0].input, file);
        if (fixture.type === 'video' || fixture.type === 'audio') assert.equal(result.metadata.durationMs, 3000);
    }
});

test('missing and octet-stream MIME types infer common image, video and audio extensions', async () => {
    for (const mime of ['', 'application/octet-stream']) {
        for (const [name, expected, inferred] of [['picture.PNG', 'image', 'image/png'], ['clip.MOV', 'video', 'video/quicktime'], ['sound.FLAC', 'audio', 'audio/flac']]) {
            const h = readerHarness();
            const file = makeFile(name, mime);
            const result = await h.read(file);
            assert.equal(result.type, expected);
            assert.equal(h.calls[0].input.type, inferred);
            assert.equal(result.metadata.mimeType, inferred);
            assert.equal(await h.calls[0].input.text(), await file.text(), 'MIME inference must preserve file bytes');
        }
    }
});

test('explicit MIME wins over the extension and unknown untyped files stay downloadable files', async () => {
    for (const [name, mime] of [['notes.mp4', 'text/plain'], ['archive.unknown', '']]) {
        const h = readerHarness();
        const file = makeFile(name, mime);
        const result = await h.read(file);
        assert.equal(result.type, 'upload');
        assert.equal(h.calls[0].kind, 'file');
        assert.equal(h.calls[0].input, file);
        assert.equal(result.metadata.mimeType, mime || 'application/octet-stream');
        assert.equal(result.metadata.storageKey, 'file:result');
    }
});

test('empty files are rejected before any media storage call', async () => {
    for (const [name, mimeType] of [['empty.png', 'image/png'], ['empty.pdf', 'application/pdf']]) {
        const h = readerHarness();
        await assert.rejects(h.read(new File([], name, { type: mimeType })), /文件为空/);
        assert.deepEqual(h.calls, []);
    }
});

test('image formats without browser preview support preserve their bytes as downloadable files', async () => {
    for (const [name, mimeType] of [['scan.tiff', 'image/tiff'], ['photo.heic', 'image/heic']]) {
        const h = readerHarness();
        const file = makeFile(name, mimeType);
        const result = await h.read(file);
        assert.equal(result.type, 'upload');
        assert.equal(result.title, name);
        assert.equal(result.metadata.storageKey, 'file:result');
        assert.equal(result.metadata.mimeType, mimeType);
        assert.equal(result.metadata.status, 'success');
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0].kind, 'file');
        assert.equal(h.calls[0].input, file);
        assert.equal(await h.calls[0].input.text(), await file.text());
    }
});

test('upload completion preserves the node ID, center, group, label and both graph connections', async () => {
    for (const fixture of fixtures) {
        const reader = readerHarness();
        const original = originalNode({ content: 'blob:old-file', storageKey: 'file:old', prompt: 'stale generation prompt', model: 'stale-model' });
        const h = pageHarness(reader.read, original);
        const graphBefore = structuredClone(h.connections);
        h.request(original.id);
        assert.equal(h.clicks, 1);
        assert.equal(h.nodesRef.current[0], original, 'opening the picker must not change the node');
        const { done, input } = h.select(makeFile(fixture.name, fixture.mime));
        assert.equal(h.nodesRef.current[0].metadata.status, 'loading');
        assert.equal(h.nodesRef.current[0].metadata.content, 'blob:old-file');
        await done;
        const uploaded = h.nodesRef.current[0];
        assert.equal(uploaded.id, original.id);
        assert.deepEqual(center(uploaded), center(original));
        assert.equal(uploaded.type, fixture.type);
        assert.equal(uploaded.metadata.groupId, 'group-1');
        assert.equal(uploaded.metadata.labelColor, '#2458ff');
        assert.equal(uploaded.metadata.model, undefined, 'uploaded media must not inherit a generated-result identity');
        assert.equal(uploaded.metadata.prompt, undefined);
        assert.equal(uploaded.metadata.storageKey, fixture.key);
        assert.equal(h.nodesRef.current[1], h.other);
        assert.deepEqual(h.connections, graphBefore);
        assert.equal(input.value, '');
        assert.equal(h.nodeFileTargetRef.current, null);
        assert.deepEqual(h.errors, []);
    }
});

test('failed replacement keeps original file data and enables another file selection', async () => {
    let attempts = 0;
    const reader = readerHarness();
    const original = originalNode({ content: 'blob:old-file', storageKey: 'file:old', bytes: 42, mimeType: 'application/pdf', status: 'success' });
    const h = pageHarness(async (file) => { if (++attempts === 1) throw new Error('storage is full'); return reader.read(file); }, original);
    h.request(original.id);
    const first = h.select(makeFile('new.pdf', 'application/pdf'));
    await first.done;
    const failed = h.nodesRef.current[0];
    assert.equal(failed.metadata.status, 'error');
    for (const field of ['content', 'storageKey', 'bytes', 'mimeType', 'groupId', 'labelColor']) assert.equal(failed.metadata[field], original.metadata[field]);
    assert.deepEqual(center(failed), center(original));
    assert.equal(first.input.value, '');
    assert.deepEqual(h.errors, ['storage is full']);
    h.request(original.id);
    assert.equal(h.clicks, 2);
    await h.select(makeFile('replacement.png', 'image/png')).done;
    assert.equal(h.nodesRef.current[0].metadata.status, 'success');
    assert.equal(h.nodesRef.current[0].metadata.errorDetails, undefined);
    assert.equal(h.nodesRef.current[0].type, 'image');
});

test('canceling the file picker preserves the node and clears the pending selection', async () => {
    const original = originalNode();
    const h = pageHarness(() => assert.fail('cancel must not read a file'), original);
    h.request(original.id);
    const { done, input } = h.select();
    await done;
    assert.equal(h.nodesRef.current[0], original);
    assert.equal(h.writes, 0);
    assert.equal(h.nodeFileTargetRef.current, null);
    assert.equal(input.value, '');
});

test('deleted targets, non-upload targets and loading targets do not open another picker', () => {
    for (const [type, status] of [['image', 'success'], ['upload', 'loading']]) {
        const h = pageHarness(() => {}, { ...originalNode(), type, metadata: { status } });
        h.request('missing-node');
        h.request('upload-1');
        assert.equal(h.clicks, 0);
        assert.equal(h.nodeFileTargetRef.current, null);
    }
});

test('a node deleted before file selection cannot upload or recreate itself', async () => {
    const h = pageHarness(() => assert.fail('missing target must not read a file'));
    h.request('upload-1');
    h.nodesRef.current = [h.other];
    await h.select(makeFile('sample.png', 'image/png')).done;
    assert.deepEqual(h.nodesRef.current, [h.other]);
    assert.equal(h.writes, 0);
});

test('a node deleted while upload is pending is never recreated on completion', async () => {
    const gate = deferred();
    const h = pageHarness(() => gate.promise);
    h.request('upload-1');
    const pending = h.select(makeFile('sample.png', 'image/png')).done;
    h.nodesRef.current = [h.other];
    gate.resolve({ type: 'image', title: 'sample.png', width: 640, height: 360, metadata: { content: 'blob:new', status: 'success' } });
    await pending;
    assert.deepEqual(h.nodesRef.current, [h.other]);
});

test('switching canvases while upload is pending prevents success and failure from writing into the new canvas', async () => {
    for (const outcome of ['success', 'failure']) {
        const gate = deferred();
        const h = pageHarness(() => gate.promise);
        h.request('upload-1');
        const pending = h.select(makeFile('sample.png', 'image/png')).done;
        const newCanvasNodes = [originalNode({ status: 'idle', labelColor: '#f90' })];
        h.restoredProjectIdRef.current = 'project-2';
        h.nodesRef.current = newCanvasNodes;
        const writesBefore = h.writes;
        if (outcome === 'success') gate.resolve({ type: 'image', title: 'sample.png', width: 640, height: 360, metadata: { content: 'blob:new', status: 'success' } });
        else gate.reject(new Error('read failed after navigation'));
        await pending;
        assert.equal(h.nodesRef.current, newCanvasNodes);
        assert.equal(h.writes, writesBefore);
        assert.deepEqual(h.errors, []);
    }
});

test('leaving and returning to the same canvas permanently invalidates the original upload session', async () => {
    for (const outcome of ['success', 'failure']) {
        const gate = deferred();
        const h = pageHarness(() => gate.promise);
        h.request('upload-1');
        const pending = h.select(makeFile('sample.png', 'image/png')).done;
        h.nodeFileSessionRef.current++;
        h.restoredProjectIdRef.current = 'project-2';
        h.nodeFileSessionRef.current++;
        h.restoredProjectIdRef.current = 'project-1';
        const returnedNodes = [originalNode({ status: 'error', errorDetails: 'upload interrupted' })];
        h.nodesRef.current = returnedNodes;
        const writesBefore = h.writes;
        if (outcome === 'success') gate.resolve({ type: 'image', title: 'sample.png', width: 640, height: 360, metadata: { content: 'blob:new', status: 'success' } });
        else gate.reject(new Error('original upload failed'));
        await pending;
        assert.equal(h.nodesRef.current, returnedNodes);
        assert.equal(h.writes, writesBefore);
        assert.deepEqual(h.errors, []);
    }
});

test('ordinary files, including text MIME, never become generation outputs, history or text assets', () => {
    const history = moduleWith('lib/canvas/generation-history.ts');
    const assets = moduleWith('lib/canvas/canvas-assets.ts', { './generation-history': history });
    for (const mimeType of ['text/plain', 'application/pdf', 'application/json']) {
        const fileNode = originalNode({ status: 'success', content: 'blob:document', storageKey: 'file:document', mimeType, model: 'legacy-value' });
        assert.deepEqual(history.canvasOutputs([fileNode]), []);
        assert.deepEqual(history.backfillGenerationHistory([fileNode], [], 10), []);
        assert.deepEqual(history.recordGenerationChanges([], [fileNode], [], 10, 'upload'), []);
        assert.deepEqual(assets.collectCanvasAssets('project', [fileNode], []), []);
    }
});

test('uploaded media remains eligible for media assets without creating generation history', async () => {
    const history = moduleWith('lib/canvas/generation-history.ts');
    const assets = moduleWith('lib/canvas/canvas-assets.ts', { './generation-history': history });
    for (const fixture of fixtures.slice(0, 3)) {
        const node = { ...originalNode(), ...await readerHarness().read(makeFile(fixture.name, fixture.mime)) };
        assert.deepEqual(history.recordGenerationChanges([], [node], [], 10, 'upload'), []);
        const collected = assets.collectCanvasAssets('project', [node], []);
        assert.equal(collected.length, 1);
        assert.equal(collected[0].kind, fixture.type);
        assert.equal(collected[0].data.storageKey, fixture.key);
    }
});

test('actual project persistence retains upload files and hydration replaces stale object URLs from storage keys', async () => {
    const disk = new Map();
    const loadStore = () => moduleWith('stores/canvas/use-canvas-store.ts', {
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': require('../node_modules/zustand/middleware'),
        nanoid: { nanoid: () => 'persisted-project' },
        '@/i18n': { default: { t: (key) => key } },
        '@/lib/canvas-theme': moduleWith('lib/canvas-theme.ts'),
        '@/lib/localforage-storage': { localForageStorage: { getItem: async (key) => disk.get(key) || null, setItem: (key, value) => disk.set(key, value), removeItem: (key) => disk.delete(key) }, reportStateReadError: (_, error) => { throw error; } },
    }).useCanvasStore;
    const first = loadStore();
    await new Promise(setImmediate);
    const projectId = first.getState().createProject('Upload persistence');
    const stored = fixtures.map((fixture, index) => ({ ...originalNode(), id: 'stored-' + index, type: fixture.type, title: fixture.name, metadata: { content: 'blob:expired-' + index, storageKey: fixture.key, mimeType: fixture.mime, status: 'success' } }));
    stored.push(originalNode());
    const connections = [{ id: 'kept-connection', fromNodeId: stored[0].id, toNodeId: stored[1].id }];
    first.getState().updateProject(projectId, { nodes: stored, connections });
    const reopened = loadStore();
    await new Promise(setImmediate);
    const savedProject = reopened.getState().projects[0];
    assert.deepEqual(savedProject.nodes, stored);
    assert.deepEqual(savedProject.connections, connections);
    const resolved = [];
    const { hydrateCanvasImages } = moduleWith('lib/canvas/canvas-generation-helpers.ts', {
        '@/stores/use-config-store': {}, '@/i18n': {}, '@/types/canvas': types,
        '@/services/image-storage': { ensureImagePreview: () => {}, resolveImageUrl: async (key) => { resolved.push(key); return 'blob:restored-' + key; }, uploadImage: () => assert.fail('restore must not re-upload') },
        '@/services/file-storage': { resolveMediaUrl: async (key) => { resolved.push(key); return 'blob:restored-' + key; } },
        '@/lib/canvas/canvas-node-factory': factory,
    });
    const hydrated = await hydrateCanvasImages(savedProject.nodes);
    for (let index = 0; index < fixtures.length; index++) assert.equal(hydrated[index].metadata.content, 'blob:restored-' + fixtures[index].key);
    assert.equal(hydrated.at(-1), savedProject.nodes.at(-1), 'an empty upload placeholder needs no media lookup');
    assert.deepEqual(resolved.sort(), fixtures.map((fixture) => fixture.key).sort());
    assert.deepEqual(savedProject.nodes, stored, 'hydration must not mutate the persisted snapshot');
});

function findAll(tree, predicate) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap((item) => findAll(item, predicate));
    return [...(predicate(tree) ? [tree] : []), ...findAll(tree.props?.children, predicate)];
}

function nodeRenderer(name, bindings) {
    const file = ts.createSourceFile('canvas-node.tsx', fs.readFileSync(path.join(root, 'components/canvas/canvas-node.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, name);
    const jsx = (type, props) => ({ type, props });
    return new Function('exports', 'require', ...Object.keys(bindings), compile('return (' + declaration.getText(file) + ');'))({}, (id) => {
        assert.equal(id, 'react/jsx-runtime');
        return { jsx, jsxs: jsx };
    }, ...Object.values(bindings));
}

test('upload loading and failure keep the upload renderer instead of exposing generation retry', () => {
    const render = nodeRenderer('NodeContent', { CanvasNodeType: types.CanvasNodeType, UploadNodeContent: 'UploadNodeContent' });
    for (const status of ['idle', 'loading', 'error', 'success']) {
        const node = originalNode({ status });
        const output = render({ node, onRetry: () => assert.fail('upload must not invoke generation retry') });
        assert.equal(output.type, 'UploadNodeContent');
        assert.equal(output.props.node, node);
    }
});

test('upload node buttons reselect the target, expose the original file download, and isolate canvas gestures', () => {
    const theme = { node: { text: '#111', muted: '#666' }, toolbar: { activeBg: '#2458ff', activeText: '#fff', panel: '#fff', border: '#ddd' } };
    const render = nodeRenderer('UploadNodeContent', { LoadingContent: 'LoadingContent', Upload: 'Upload', Download: 'Download', formatBytes: (bytes) => bytes + ' bytes' });
    const node = originalNode({ status: 'error', content: 'blob:kept-file', bytes: 42, errorDetails: 'save failed' });
    node.title = 'original.pdf';
    const requested = [];
    const tree = render({ node, theme, onUploadFile: (id) => requested.push(id) });
    assert.equal(findAll(tree, (part) => part.props?.role === 'alert')[0].props.children, 'save failed');
    const button = findAll(tree, (part) => part.type === 'button')[0];
    let stopped = 0;
    button.props.onClick({ stopPropagation: () => stopped++ });
    assert.deepEqual(requested, ['upload-1']);
    const download = findAll(tree, (part) => part.type === 'a')[0];
    assert.equal(download.props.href, 'blob:kept-file');
    assert.equal(download.props.download, 'original.pdf');
    for (const action of [button, download]) for (const event of ['onMouseDown', 'onPointerDown', 'onDoubleClick']) action.props[event]({ stopPropagation: () => stopped++ });
    const controls = findAll(tree, (part) => part.props?.onKeyDown && part.props?.onKeyUp)[0];
    for (const event of ['onKeyDown', 'onKeyUp']) controls.props[event]({ stopPropagation: () => stopped++ });
    assert.equal(stopped, 9);
    const loading = render({ node: originalNode({ status: 'loading' }), theme });
    assert.equal(loading.type, 'LoadingContent');
    assert.equal(loading.props.node.metadata.progressStage, '上传中');
    assert.equal(findAll(loading, (part) => part.type === 'button').length, 0);
});

test('left menu creates an empty upload node while the original three entries retain immediate file upload callbacks', () => {
    const jsx = (type, props) => ({ type, props });
    const theme = { node: { panel: '#fff', stroke: '#ddd', text: '#111', muted: '#666', fill: '#eee' } };
    const definitions = [{ type: 'image', title: '图片' }, { type: 'upload', title: '上传节点', showInCreateMenu: false }, { type: 'plugin:example', title: '扩展' }];
    const menus = moduleWith('components/canvas/canvas-create-menus.tsx', {
        react: { useEffect: () => {}, useLayoutEffect: () => {}, useRef: () => ({ current: null }), useState: (initial) => [initial, () => {}] },
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'lucide-react': new Proxy({}, { get: (_, key) => key }),
        'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
        '@/lib/canvas-theme': { canvasThemes: { light: theme } },
        '@/stores/use-theme-store': { useThemeStore: (select) => select({ theme: 'light' }) },
        '@/lib/canvas/node-registry': { listNodeDefinitions: () => definitions, useNodeRegistryVersion: () => {} },
        '@/types/canvas': types,
    });
    const created = [], uploaded = [];
    let closed = 0;
    const mouse = { x: 700, y: 200 };
    const tree = menus.NodeCreateMenu({ position: mouse, bounds: { width: 1440, height: 900 }, onCreate: (type) => created.push(type), onUpload: (kind) => uploaded.push(kind), onClose: () => closed++ });
    const left = findAll(tree, (node) => node.props?.['data-create-menu-uploads'] !== undefined)[0];
    const right = findAll(tree, (node) => node.props?.['data-create-menu-nodes'] !== undefined)[0];
    assert.equal(tree.props.style.left + (tree.props.style.width - 12) / 2 + 12, mouse.x, 'the creation module begins at the mouse position when there is enough space');
    assert.equal(tree.props.style.top, mouse.y);
    assert.equal(tree.props.style.background, undefined, 'modules retain the transparent gap between them');
    assert.equal(left.props.style.background, theme.node.panel);
    assert.equal(right.props.style.background, theme.node.panel);
    const options = findAll(left, (node) => node.type === menus.ConnectionCreateOption);
    assert.equal(options.length, 4);
    options[0].props.onClick();
    assert.deepEqual(created, ['upload']);
    assert.deepEqual(uploaded, [], 'placing a placeholder must not immediately open a file picker');
    options.slice(1).forEach((option) => option.props.onClick());
    assert.deepEqual(uploaded, ['image', 'video', 'audio']);
    assert.deepEqual(created, ['upload']);
    const rightOptions = findAll(right, (node) => node.type === menus.ConnectionCreateOption);
    assert.equal(rightOptions.length, 2);
    rightOptions[1].props.onClick();
    assert.deepEqual(created, ['upload', 'plugin:example']);
    let stopped = 0;
    tree.props.onKeyDown({ key: 'Escape', stopPropagation: () => stopped++ });
    tree.props.onKeyUp({ key: 'Escape', stopPropagation: () => stopped++ });
    assert.equal(closed, 1);
    assert.equal(stopped, 2);
});
