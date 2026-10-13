const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const src = path.join(__dirname, '../src');

const generation = 'local-qwen-image21::Qwen-Image 2.1 · 生图';
const edit = 'local-qwen-image21::Qwen-Image 2.1 · 编辑';
const turboGeneration = 'local-qwen-image21::Qwen-Image 2.1 Turbo · 生图';
const turboEdit = 'local-qwen-image21::Qwen-Image 2.1 Turbo · 编辑';
const sizes = { image: { width: 260, height: 180 }, text: { width: 300, height: 200 }, config: { width: 300, height: 200 } };
const translate = (key, args = {}) => {
    if (key === 'canvas.composer.resources.text') return `文本 ${args.index}`;
    if (key === 'imageReferences.label') return `参考图 ${args.index}`;
    if (key === 'imageReferences.separator') return '、';
    if (key === 'imageReferences.promptPrefix') return `${args.labels}\n${args.prompt}`;
    return key;
};

function harness() {
    const cache = new Map();
    let sequence = 0;
    const overrides = {
        react: require('../node_modules/react'),
        zustand: require('../node_modules/zustand'),
        'zustand/middleware': { persist: initializer => initializer },
        nanoid: { nanoid: () => `id-${++sequence}` },
        '@/i18n': { t: translate },
        '@/lib/canvas/node-registry': { getNodeDefinition: () => undefined },
        '@/lib/image-utils': {},
        '@/constant/canvas': { NODE_DEFAULT_SIZE: sizes },
        '@/lib/canvas/canvas-node-size': {},
        '@/lib/canvas/generation-preferences': {},
        '@/services/image-storage': { imageToDataUrl: async image => image.dataUrl },
        '@/services/file-storage': {},
        '@/lib/seedance-video': { seedanceReferenceLabel: (kind, index) => `${kind} ${index + 1}` },
        '@/services/comfy-workflow-storage': { getComfyWorkflowPreset: async id => ({ name: id, mapping: { outputNodeId: 'output', imageSlots: id.endsWith('-edit') ? Array(10).fill('image') : [], videoSlots: [], audioSlots: [] } }) },
    };
    function load(relative) {
        const file = path.resolve(src, relative);
        if (cache.has(file)) return cache.get(file);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
        const output = {};
        cache.set(file, output);
        new Function('exports', 'require', code)(output, name => {
            if (name in overrides) return overrides[name];
            const target = name.startsWith('@/') ? path.join(src, name.slice(2)) : path.resolve(path.dirname(file), name);
            if (target.endsWith('?raw')) return fs.readFileSync(target.slice(0, -4), 'utf8');
            return load(path.relative(src, fs.existsSync(target) ? target : target + '.ts'));
        });
        return output;
    }
    const store = load('stores/use-config-store.ts');
    return {
        load,
        config: { ...store.defaultConfig, model: generation, imageModel: generation, count: '1', canvasImageCount: '1', size: '2048x1152' },
        context: load('components/canvas/canvas-node-generation.ts'),
        preview: () => load('lib/canvas/canvas-generation-preview.ts'),
        helpers: load('lib/canvas/canvas-generation-helpers.ts'),
        factory: load('lib/canvas/canvas-node-factory.ts'),
        qwen: load('lib/qwen-image-mode.ts'),
    };
}

function node(id, type, metadata = {}) {
    return { id, type, title: id, position: { x: 100, y: 100 }, width: 260, height: 180, metadata };
}
const edge = (fromNodeId, toNodeId) => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });

function pageCallback(name, bindings) {
    const file = ts.createSourceFile('project.tsx', fs.readFileSync(path.join(src, 'pages/canvas/project.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    const visit = part => {
        if (ts.isVariableDeclaration(part) && part.name.getText(file) === name) callback = part.initializer.arguments[0].getText(file);
        ts.forEachChild(part, visit);
    };
    visit(file);
    assert.ok(callback, name);
    const code = ts.transpileModule('return (' + callback + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

function execution(h, nodes, connections, overrides = {}) {
    const nodesRef = { current: nodes }, connectionsRef = { current: connections }, calls = [];
    let sequence = 0;
    const bindings = {
        ...h.helpers,
        ...h.factory,
        ...h.context,
        ...h.qwen,
        nodesRef, connectionsRef, effectiveConfig: h.config,
        CanvasNodeType: h.load('types/canvas.ts').CanvasNodeType,
        isAiConfigReady: () => true, openConfigDialog: () => assert.fail('Unexpected config dialog'),
        getNodeDefinition: () => undefined, setRunningNodeId: () => {},
        startGenerationRequest: (_, __, ___, controller = new AbortController()) => controller,
        finishGenerationRequest: () => {},
        validateQwenImageInputs: () => null,
        NODE_DEFAULT_SIZE: sizes,
        NODE_STATUS_LOADING: 'loading', NODE_STATUS_IDLE: 'idle', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error',
        nanoid: () => `generated-${++sequence}`, createGeneratedTitle: () => '图片1',
        setNodes: update => { nodesRef.current = update(nodesRef.current); },
        setConnections: update => { connectionsRef.current = update(connectionsRef.current); },
        setSelectedNodeIds: () => {}, setSelectedConnectionId: () => {}, setDialogNodeId: () => {},
        fitNodeSize: () => sizes.image,
        uploadImage: async dataUrl => ({ url: dataUrl, storageKey: `image:${dataUrl}`, width: 2048, height: 1152, bytes: 123, mimeType: 'image/png' }),
        requestGeneration: async (config, prompt) => { calls.push({ kind: 'generation', config, prompt, references: [] }); return [{ dataUrl: `blob:result-${calls.length}` }]; },
        requestEdit: async (config, prompt, references) => { calls.push({ kind: 'edit', config, prompt, references }); return [{ dataUrl: `blob:result-${calls.length}` }]; },
        t: translate, message: { error: value => assert.fail(value) },
        ...overrides,
    };
    bindings.setNodesWithoutHistory = bindings.setNodes;
    return { nodesRef, connectionsRef, calls, run: pageCallback('executeGenerateNode', bindings) };
}

test('connected text is assembled once and a completed image never becomes its own reference', () => {
    const h = harness();
    const nodes = [node('text', 'text', { content: '生成一个玩具 LOGO' }), node('image', 'image', { content: 'blob:previous', composerContent: '' })];
    const connections = [edge('text', 'image')];
    for (let send = 0; send < 2; send++) {
        const context = h.context.buildNodeGenerationContext('image', nodes, connections, nodes[1].metadata.composerContent);
        assert.equal(context.prompt.trim(), '【文本 1】\n生成一个玩具 LOGO');
        assert.equal(context.textCount, 1);
        assert.deepEqual(context.referenceImages, []);
    }
});

test('a group connected to its completed member uses the other text member without reintroducing its own image', async () => {
    const h = harness();
    const resources = h.load('lib/canvas/canvas-resource-references.ts');
    const group = node('group', 'group');
    const text = node('text', 'text', { groupId: group.id, content: '玩具 LOGO' });
    const source = node('image', 'image', { groupId: group.id, content: 'blob:previous', model: turboEdit });
    const nodes = [group, text, source], connections = [edge(group.id, source.id)];
    const context = h.context.buildNodeGenerationContext(source.id, nodes, connections, '');
    assert.equal(context.prompt.trim(), '【文本 1】\n玩具 LOGO');
    assert.deepEqual(context.referenceImages, []);
    assert.equal(context.textCount, 1);
    assert.deepEqual(resources.buildNodeMentionReferences(source, nodes, connections).map(reference => reference.nodeId), [text.id]);
    const preview = await h.preview().buildCanvasGenerationPreview({ nodeId: source.id, mode: 'image', prompt: '', nodes, connections, config: h.config });
    assert.equal(preview.references.filter(reference => reference.type === 'image').length, 0);
    assert.equal(preview.model, h.load('stores/use-config-store.ts').modelOptionLabel(h.config, turboGeneration));
    const e = execution(h, nodes, connections);
    await e.run(source.id, 'image', '');
    await e.run(source.id, 'image', '');
    assert.ok(e.calls.every(call => call.kind === 'generation' && call.config.model === turboGeneration));
    assert.deepEqual(e.nodesRef.current.find(current => current.id === source.id).metadata.references, []);

    const configNode = node('config', 'config', { composerContent: '@[node:text]' });
    const composerNodes = [...nodes, configNode], composerConnections = [edge(group.id, configNode.id), edge(text.id, configNode.id)];
    const selected = h.context.buildNodeGenerationContext(configNode.id, composerNodes, composerConnections, configNode.metadata.composerContent);
    assert.equal(selected.textCount, 1);
    assert.deepEqual(selected.referenceImages, []);
    const selectedPreview = await h.preview().buildCanvasGenerationPreview({ nodeId: configNode.id, mode: 'image', prompt: configNode.metadata.composerContent, nodes: composerNodes, connections: composerConnections, config: h.config });
    assert.deepEqual(selectedPreview.references.map(reference => reference.nodeId), [text.id]);
});

test('a group containing its completed target and another image uses only the other image as the edit reference', async () => {
    const h = harness();
    const group = node('group', 'group');
    const source = node('image', 'image', { groupId: group.id, content: 'blob:previous', model: turboGeneration });
    const reference = node('reference', 'image', { groupId: group.id, content: 'blob:reference', storageKey: 'image:reference' });
    const nodes = [group, source, reference], connections = [edge(group.id, source.id)];
    const context = h.context.buildNodeGenerationContext(source.id, nodes, connections, '换成蓝色');
    assert.deepEqual(context.referenceImages.map(image => image.id), [reference.id]);
    const resources = h.load('lib/canvas/canvas-resource-references.ts');
    assert.deepEqual(resources.buildNodeMentionReferences(source, nodes, connections).map(image => image.nodeId), [reference.id]);
    const preview = await h.preview().buildCanvasGenerationPreview({ nodeId: source.id, mode: 'image', prompt: '换成蓝色', nodes, connections, config: h.config });
    assert.deepEqual(preview.references.map(image => image.nodeId), [reference.id]);
    assert.equal(preview.model, h.load('stores/use-config-store.ts').modelOptionLabel(h.config, turboEdit));
    const e = execution(h, nodes, connections);
    await e.run(source.id, 'image', '换成蓝色');
    await e.run(source.id, 'image', '换成绿色');
    assert.ok(e.calls.every(call => call.kind === 'edit' && call.config.model === turboEdit));
    assert.ok(e.calls.every(call => call.references.length === 1 && call.references[0].id === reference.id));
    assert.deepEqual(e.nodesRef.current.find(current => current.id === source.id).metadata.references, ['image:reference']);
});

test('a config input group containing only the target does not hide its own connected text input', async () => {
    const h = harness();
    const group = node('group', 'group');
    const source = node('image', 'image', { groupId: group.id, content: 'blob:previous', model: generation });
    const text = node('text', 'text', { content: '玩具 LOGO' });
    const configNode = node('config', 'config');
    const nodes = [group, source, text, configNode];
    const connections = [edge(text.id, source.id), edge(source.id, configNode.id), edge(group.id, configNode.id)];
    const resources = h.load('lib/canvas/canvas-resource-references.ts');
    assert.deepEqual(resources.getGenerationResourceNodes(source.id, nodes, connections).map(input => input.id), [text.id]);
    assert.deepEqual(resources.buildNodeMentionReferences(source, nodes, connections).map(reference => reference.nodeId), [text.id]);
    const context = h.context.buildNodeGenerationContext(source.id, nodes, connections, '');
    assert.equal(context.prompt.trim(), '【文本 1】\n玩具 LOGO');
    assert.deepEqual(context.referenceImages, []);
    const preview = await h.preview().buildCanvasGenerationPreview({ nodeId: source.id, mode: 'image', prompt: '', nodes, connections, config: h.config });
    assert.deepEqual(preview.references.map(reference => reference.nodeId), [text.id]);
    assert.equal(preview.model, h.load('stores/use-config-store.ts').modelOptionLabel(h.config, generation));
});

test('legacy merged image prompts restore only the composer text and explicitly saved drafts take precedence', () => {
    const h = harness();
    const { buildNodeMentionReferences, getNodeComposerPrompt } = h.load('lib/canvas/canvas-resource-references.ts');
    const texts = [node('first', 'text', { content: '玩具 LOGO' }), node('second', 'text', { content: '扁平风格' })];
    const merged = '【文本 1】\n玩具 LOGO\n\n【文本 2】\n扁平风格';
    const image = node('image', 'image', { content: 'blob:previous', prompt: merged });
    const references = buildNodeMentionReferences(image, [...texts, image], texts.map(text => edge(text.id, image.id)));
    assert.equal(getNodeComposerPrompt(image, references), '');
    assert.equal(getNodeComposerPrompt({ ...image, metadata: { ...image.metadata, prompt: `使用橙色\n\n${merged}` } }, references), '使用橙色');
    assert.equal(getNodeComposerPrompt({ ...image, metadata: { ...image.metadata, composerContent: '' } }, references), '');
    assert.equal(getNodeComposerPrompt({ ...image, metadata: { ...image.metadata, composerContent: merged } }, references), merged);
    assert.equal(getNodeComposerPrompt({ ...image, metadata: { ...image.metadata, prompt: '手动输入不含连接内容' } }, references), '手动输入不含连接内容');
    assert.equal(getNodeComposerPrompt({ ...image, type: 'text' }, references), merged);
    assert.equal(getNodeComposerPrompt(image, references.map(reference => ({ ...reference, text: reference.text + '已修改' }))), merged);
});

test('restored legacy image drafts can be sent twice without adding repeated connected text', async () => {
    const h = harness();
    const resources = h.load('lib/canvas/canvas-resource-references.ts');
    const upstream = node('text', 'text', { content: '玩具 LOGO' });
    const source = node('image', 'image', { content: 'blob:previous', model: generation, prompt: '使用橙色\n\n【文本 1】\n玩具 LOGO' });
    const e = execution(h, [upstream, source], [edge(upstream.id, source.id)]);
    for (let send = 0; send < 2; send++) {
        const current = e.nodesRef.current.find(item => item.id === source.id);
        const references = resources.buildNodeMentionReferences(current, e.nodesRef.current, e.connectionsRef.current);
        await e.run(source.id, 'image', resources.getNodeComposerPrompt(current, references));
    }
    assert.deepEqual(e.calls.map(call => call.prompt), ['使用橙色\n\n【文本 1】\n玩具 LOGO', '使用橙色\n\n【文本 1】\n玩具 LOGO']);
    assert.equal(e.nodesRef.current.find(item => item.id === source.id).metadata.composerContent, '使用橙色');
    assert.equal(e.nodesRef.current.length, 2);
});

test('generation preview keeps completed nodes in text-to-image with their requested dimensions and count', async () => {
    const h = harness();
    for (const [model, expectedModel] of [[generation, generation], [edit, generation], [turboEdit, turboGeneration]]) {
        const source = node('image', 'image', { content: 'blob:previous', model, size: '2048x1152', count: 4 });
        const preview = await h.preview().buildCanvasGenerationPreview({ nodeId: source.id, mode: 'image', prompt: '画一只猫', nodes: [source], connections: [], config: h.config });
        assert.equal(preview.model, h.load('stores/use-config-store.ts').modelOptionLabel(h.config, expectedModel));
        assert.deepEqual(preview.references, []);
        assert.equal(preview.parameters.find(item => item.label === 'canvas.generationPreview.parameter.size').value, '2048x1152');
        assert.equal(preview.parameters.find(item => item.label === 'canvas.generationPreview.parameter.count').value, '4');
    }
});

test('editing preview lists the connected source image and excludes the current output', async () => {
    const h = harness();
    const reference = node('reference', 'image', { content: 'blob:reference', storageKey: 'image:reference' });
    const source = node('image', 'image', { content: 'blob:previous', model: turboGeneration, count: 2 });
    const preview = await h.preview().buildCanvasGenerationPreview({ nodeId: source.id, mode: 'image', prompt: '换成蓝色', nodes: [reference, source], connections: [edge(reference.id, source.id)], config: h.config });
    assert.equal(preview.model, h.load('stores/use-config-store.ts').modelOptionLabel(h.config, turboEdit));
    assert.deepEqual(preview.references.map(item => item.nodeId), ['reference']);
    assert.equal(preview.references[0].previewUrl, 'blob:reference');
    assert.match(preview.parameters.find(item => item.label === 'canvas.generationPreview.parameter.size').value, /1K/);
});

test('sending again reuses the same text-to-image node and preserves size, count and the unexpanded composer', async () => {
    const h = harness();
    const source = node('image', 'image', { model: generation, size: '2048x1152', count: 1 });
    const e = execution(h, [node('text', 'text', { content: '生成一个玩具 LOGO' }), source], [edge('text', source.id)]);
    await e.run(source.id, 'image', '');
    let result = e.nodesRef.current.find(item => item.id === source.id);
    assert.equal(result.metadata.composerContent, '');
    assert.equal(result.metadata.prompt, '【文本 1】\n生成一个玩具 LOGO');
    assert.equal(result.metadata.generationType, 'generation');
    assert.equal(result.metadata.model, generation);
    result.metadata.count = 2;
    result.metadata.size = '3072x1728';
    await e.run(source.id, 'image', result.metadata.composerContent);
    result = e.nodesRef.current.find(item => item.id === source.id);
    assert.equal(e.nodesRef.current.length, 2);
    assert.deepEqual(e.connectionsRef.current, [edge('text', source.id)]);
    assert.equal(e.calls.length, 3);
    assert.ok(e.calls.every(call => call.kind === 'generation' && call.config.model === generation && call.prompt === '【文本 1】\n生成一个玩具 LOGO'));
    assert.ok(e.calls.slice(1).every(call => call.config.size === '3072x1728'));
    assert.equal(result.metadata.count, 2);
    assert.equal(result.metadata.size, '3072x1728');
    assert.equal(result.metadata.images.length, 2);
    assert.equal(result.metadata.content, 'blob:result-2');
    assert.equal(result.metadata.prompt, e.calls[2].prompt);
    assert.equal(result.metadata.composerContent, '');
    assert.deepEqual(result.metadata.references, []);
});

test('typed composer additions remain separate from connected text across repeated sends', async () => {
    const h = harness();
    const source = node('image', 'image', { model: turboEdit, content: 'blob:previous' });
    const e = execution(h, [node('text', 'text', { content: '玩具 LOGO' }), source], [edge('text', source.id)]);
    const input = '使用橙色';
    await e.run(source.id, 'image', input);
    let result = e.nodesRef.current.find(item => item.id === source.id);
    assert.equal(result.metadata.composerContent, input);
    await e.run(source.id, 'image', result.metadata.composerContent);
    result = e.nodesRef.current.find(item => item.id === source.id);
    assert.deepEqual(e.calls.map(call => call.prompt), ['使用橙色\n\n【文本 1】\n玩具 LOGO', '使用橙色\n\n【文本 1】\n玩具 LOGO']);
    assert.ok(e.calls.every(call => call.kind === 'generation' && call.config.model === turboGeneration));
    assert.equal(result.metadata.generationType, 'generation');
    assert.equal(result.metadata.composerContent, input);
    assert.equal(e.nodesRef.current.length, 2);
});

test('a connected upstream image selects editing on every send and never adds the current result as a reference', async () => {
    const h = harness();
    const reference = node('reference', 'image', { content: 'blob:reference', storageKey: 'image:reference' });
    const source = node('image', 'image', { model: turboGeneration, count: 2, size: '4096x2304' });
    const e = execution(h, [reference, source], [edge(reference.id, source.id)]);
    await e.run(source.id, 'image', '换成蓝色');
    await e.run(source.id, 'image', '换成绿色');
    const result = e.nodesRef.current.find(item => item.id === source.id);
    assert.equal(e.calls.length, 4);
    assert.ok(e.calls.every(call => call.kind === 'edit' && call.config.model === turboEdit));
    assert.ok(e.calls.every(call => call.references.length === 1 && call.references[0].id === reference.id));
    assert.deepEqual(result.metadata.references, ['image:reference']);
    assert.equal(result.metadata.model, turboEdit);
    assert.equal(result.metadata.generationType, 'edit');
    assert.equal(result.metadata.composerContent, '换成绿色');
    assert.equal(result.metadata.prompt, '换成绿色');
    assert.equal(e.nodesRef.current.length, 2);
});

test('a failed same-node regeneration retains the previous successful image and the new composer draft', async () => {
    const h = harness(), errors = [];
    const metadata = {
        content: 'blob:previous', storageKey: 'image:previous', status: 'success', generationType: 'generation',
        model: generation, prompt: '上一次提示词', composerContent: '上一次提示词', primaryImageId: 'previous-image',
        images: [{ id: 'previous-image', content: 'blob:previous', storageKey: 'image:previous', status: 'success' }],
    };
    const source = node('image', 'image', metadata);
    const e = execution(h, [source], [], {
        requestGeneration: async () => { throw new Error('模拟生成失败'); },
        message: { error: value => errors.push(value) },
    });
    await e.run(source.id, 'image', '新的提示词');
    const result = e.nodesRef.current[0];
    assert.equal(e.nodesRef.current.length, 1);
    assert.equal(result.metadata.content, metadata.content);
    assert.equal(result.metadata.storageKey, metadata.storageKey);
    assert.deepEqual(result.metadata.images, metadata.images);
    assert.equal(result.metadata.primaryImageId, metadata.primaryImageId);
    assert.equal(result.metadata.prompt, metadata.prompt);
    assert.equal(result.metadata.composerContent, '新的提示词');
    assert.ok(errors.includes('模拟生成失败'));
});

test('failed regeneration restores the previous output without overwriting edits made while the request is pending', async () => {
    const h = harness(), errors = [];
    const metadata = {
        content: 'blob:previous', storageKey: 'image:previous', status: 'success', generationType: 'generation',
        naturalWidth: 2048, naturalHeight: 1152, bytes: 456, mimeType: 'image/png',
        model: generation, size: '2048x1152', count: 1, background: '', labelColor: '#111111', groupId: 'old-group',
        prompt: '上一次提示词', composerContent: '上一次提示词', primaryImageId: 'previous-image', references: [],
        images: [{ id: 'previous-image', content: 'blob:previous', storageKey: 'image:previous', status: 'success' }],
    };
    const source = node('image', 'image', metadata);
    let rejectRequest, markRequested;
    const requested = new Promise(resolve => { markRequested = resolve; });
    const e = execution(h, [source], [], {
        requestGeneration: () => new Promise((_, reject) => { rejectRequest = reject; markRequested(); }),
        message: { error: value => errors.push(value) },
    });
    const pending = e.run(source.id, 'image', '本次发送的提示词');
    await requested;
    const edits = { composerContent: '生成期间继续修改的草稿', size: '3072x1728', count: 4, model: turboGeneration, background: 'transparent', labelColor: '#ff9900', groupId: 'new-group' };
    e.nodesRef.current = e.nodesRef.current.map(current => ({ ...current, metadata: { ...current.metadata, ...edits } }));
    rejectRequest(new Error('模拟生成失败'));
    await pending;
    const result = e.nodesRef.current[0].metadata;
    assert.equal(e.nodesRef.current.length, 1);
    for (const key of ['content', 'storageKey', 'naturalWidth', 'naturalHeight', 'bytes', 'mimeType', 'images', 'primaryImageId', 'prompt', 'generationType', 'references', 'status']) {
        assert.deepEqual(result[key], metadata[key], key);
    }
    for (const [key, value] of Object.entries(edits)) assert.deepEqual(result[key], value, key);
    assert.ok(errors.includes('模拟生成失败'));
});

test('canceling a same-node batch preserves the previous successful image and stops unsent candidates', async () => {
    const h = harness();
    const metadata = {
        content: 'blob:previous', storageKey: 'image:previous', status: 'success', count: 3,
        model: generation, prompt: '上一次提示词', primaryImageId: 'previous-image',
        images: [{ id: 'previous-image', content: 'blob:previous', status: 'success' }],
    };
    const source = node('image', 'image', metadata);
    let controller, requests = 0;
    const e = execution(h, [source], [], {
        startGenerationRequest: () => (controller = new AbortController()),
        requestGeneration: async (_, __, { signal }) => {
            requests++;
            controller.abort();
            assert.equal(signal.aborted, true);
            throw Object.assign(new Error('模拟取消'), { name: 'AbortError' });
        },
    });
    await e.run(source.id, 'image', '新的提示词');
    assert.equal(requests, 1);
    assert.equal(e.nodesRef.current.length, 1);
    const result = e.nodesRef.current[0].metadata;
    for (const key of ['content', 'storageKey', 'images', 'primaryImageId', 'prompt', 'status', 'count', 'model']) {
        assert.deepEqual(result[key], metadata[key], key);
    }
    assert.equal(result.composerContent, '新的提示词');
});
