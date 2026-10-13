const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

function retryCallback(bindings) {
    const file = ts.createSourceFile('project.tsx', fs.readFileSync(path.join(__dirname, '../src/pages/canvas/project.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    const visit = (part) => {
        if (ts.isVariableDeclaration(part) && part.name.getText(file) === 'executeRetryNode') callback = part.initializer.arguments[0].getText(file);
        ts.forEachChild(part, visit);
    };
    visit(file);
    assert.ok(callback);
    const code = ts.transpileModule('return (' + callback + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

function harness(images, primaryImageId, options = {}) {
    const node = {
        id: 'retry-image', type: 'image', title: '图片1', position: { x: 100, y: 100 }, width: 340, height: 240,
        metadata: { status: 'error', content: images.find((image) => image.id === primaryImageId)?.content, prompt: 'white background', generationType: 'generation', model: 'Qwen-Image 2.1', size: '1K', images, primaryImageId, ...options.metadata },
    };
    const nodesRef = { current: [node] };
    const setNodes = (update) => { nodesRef.current = update(nodesRef.current); };
    const config = { model: 'Qwen-Image 2.1', size: '1K' };
    const uploaded = { url: 'blob:result', storageKey: 'image:result', width: 1024, height: 1024, bytes: 1024, mimeType: 'image/png' };
    const run = retryCallback({
        hasResumableSeedVr2Task: () => false, hasResumableVideoTask: () => false,
        findRetrySourceNode: () => null, nodesRef, connectionsRef: { current: [] }, effectiveConfig: config,
        isAiConfigReady: () => true, openConfigDialog: () => assert.fail('unexpected config dialog'),
        resolveMetadataReferences: async () => options.references || [],
        resolveQwenImageConfig: options.resolveQwenImageConfig || (config => config),
        CanvasNodeType: { Text: 'text', Video: 'video', Audio: 'audio', Image: 'image' },
        generationRequestsRef: { current: new Map() }, setRunningNodeId: () => {}, setNodes,
        startGenerationRequest: () => new AbortController(), finishGenerationRequest: () => {},
        requestGeneration: options.requestGeneration || (async () => [{ dataUrl: 'data:image/png;base64,AA==' }]),
        requestEdit: options.requestEdit || (() => assert.fail('unexpected edit')),
        uploadImage: async () => uploaded,
        NODE_DEFAULT_SIZE: { image: { width: 340, height: 240 } },
        fitNodeSize: () => ({ width: 340, height: 340 }),
        imageMetadata: (image) => ({ content: image.url, storageKey: image.storageKey, status: 'success', naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType }),
        nanoid: () => 'new-slot',
        NODE_STATUS_LOADING: 'loading', NODE_STATUS_SUCCESS: 'success', NODE_STATUS_ERROR: 'error',
        isGenerationCanceled: () => false, isVideoTaskFailed: () => false,
        t: (key) => key, message: { warning: assert.fail, error: assert.fail },
    });
    return { run: (imageId) => run(node, imageId), nodesRef };
}

test('retry after every image failed replaces the original image slot', async () => {
    const h = harness([{ id: 'failed-slot', status: 'error', content: '' }]);
    await h.run();
    const result = h.nodesRef.current[0];
    assert.equal(result.metadata.status, 'success');
    assert.equal(result.metadata.primaryImageId, 'failed-slot');
    assert.deepEqual(result.metadata.images.map((image) => image.id), ['failed-slot']);
    assert.equal(result.metadata.images[0].content, result.metadata.content);
});

test('retry of an old image node with no slots inserts a visible result', async () => {
    const h = harness([]);
    await h.run();
    const result = h.nodesRef.current[0];
    assert.equal(result.metadata.primaryImageId, 'new-slot');
    assert.deepEqual(result.metadata.images.map((image) => image.id), ['new-slot']);
    assert.equal(result.metadata.images[0].content, result.metadata.content);
});

test('retrying a failed candidate preserves successful siblings', async () => {
    const h = harness([
        { id: 'main', status: 'success', content: 'blob:main' },
        { id: 'candidate', status: 'error', content: '' },
    ], 'main');
    await h.run('candidate');
    const result = h.nodesRef.current[0];
    assert.equal(result.metadata.primaryImageId, 'main');
    assert.equal(result.metadata.images[0].content, 'blob:main');
    assert.equal(result.metadata.images[1].content, 'blob:result');
});

test('generation retry switches Qwen back to text-to-image without using its successful output as a reference', async () => {
    const h = harness([{ id: 'main', status: 'success', content: 'blob:main' }], 'main', {
        metadata: { model: 'qwen::edit' },
        resolveQwenImageConfig: (config, referenceCount) => {
            assert.equal(config.model, 'qwen::edit');
            assert.equal(referenceCount, 0);
            return { ...config, model: 'qwen::t2i' };
        },
        requestGeneration: async config => {
            assert.equal(config.model, 'qwen::t2i');
            return [{ dataUrl: 'data:image/png;base64,AA==' }];
        },
    });
    await h.run();
    assert.equal(h.nodesRef.current[0].metadata.model, 'qwen::t2i');
    assert.equal(h.nodesRef.current[0].metadata.generationType, 'generation');
});

test('edit retry switches Qwen using the saved references and records the executed model', async () => {
    const references = [{ id: 'saved-reference', dataUrl: 'blob:source' }];
    const h = harness([{ id: 'main', status: 'success', content: 'blob:main' }], 'main', {
        metadata: { model: 'qwen::t2i', generationType: 'edit', references: ['image:source'] },
        references,
        resolveQwenImageConfig: (config, referenceCount) => {
            assert.equal(config.model, 'qwen::t2i');
            assert.equal(referenceCount, 1);
            return { ...config, model: 'qwen::edit' };
        },
        requestGeneration: () => assert.fail('unexpected text-to-image request'),
        requestEdit: async (config, prompt, images) => {
            assert.equal(config.model, 'qwen::edit');
            assert.deepEqual(images, references);
            return [{ dataUrl: 'data:image/png;base64,AA==' }];
        },
    });
    await h.run();
    assert.equal(h.nodesRef.current[0].metadata.model, 'qwen::edit');
    assert.deepEqual(h.nodesRef.current[0].metadata.references, ['image:source']);
});
