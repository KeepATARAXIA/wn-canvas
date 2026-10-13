const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.join(__dirname, '../src');
const CanvasNodeType = { Group: 'group', Image: 'image', Video: 'video', Text: 'text', Audio: 'audio', Config: 'config' };

function load(file, dependencies = {}) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('exports', 'require', code)(exports, name => name in dependencies ? dependencies[name] : name === '@/types/canvas' ? { CanvasNodeType } : {});
    return exports;
}
const { collectGroupMemberNodes } = load('lib/canvas/canvas-node-geometry.ts');
const { copiedNodeMetadata } = load('lib/canvas/canvas-generation-helpers.ts');

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

function fixture() {
    const node = (id, type, x, y, metadata = {}) => ({ id, type, title: id, position: { x, y }, width: 200, height: 160, metadata });
    return {
        nodes: [
            node('group', 'group', 20, 40, { groupColor: '#2f5bff' }),
            node('image', 'image', 80, 120, { groupId: 'group', content: 'blob:image', storageKey: 'image:saved' }),
            node('video', 'video', 400, 140, { groupId: 'group', status: 'loading', model: 'MiniMax-H3', seconds: '4', videoH3Mode: 'turbo', videoTaskId: 'running-task', videoTaskProvider: 'comfy', videoTaskCheckpoint: { id: 'running-task', baseUrl: 'http://local', outputNodeId: '92' }, generationStartedAt: 123, progress: 25, progressStage: 'sampling' }),
            node('outside', 'text', 700, 120, { content: 'outside text' }),
        ],
        connections: [
            { id: 'internal', fromNodeId: 'image', toNodeId: 'video' },
            { id: 'incoming', fromNodeId: 'outside', toNodeId: 'image' },
            { id: 'outgoing', fromNodeId: 'video', toNodeId: 'outside' },
        ],
    };
}

function harness(selected = ['group'], data = fixture()) {
    const nodesRef = { current: structuredClone(data.nodes) }, connectionsRef = { current: structuredClone(data.connections) };
    const clipboardRef = { current: null }, selectedNodeIdsRef = { current: new Set(selected) };
    let selectedIds, dialog;
    const bindings = {
        CanvasNodeType, nodesRef, connectionsRef, clipboardRef, selectedNodeIdsRef, collectGroupMemberNodes, copiedNodeMetadata,
        getCanvasCenter: () => ({ x: 1000, y: 600 }),
        setNodes: update => { nodesRef.current = update(nodesRef.current); },
        setConnections: update => { connectionsRef.current = update(connectionsRef.current); },
        setSelectedNodeIds: value => { selectedIds = value; }, setSelectedConnectionId: () => {},
        setDialogNodeId: value => { dialog = value; }, setContextMenu: () => {},
    };
    return { nodesRef, connectionsRef, clipboardRef, copy: pageCallback('copySelectedNodes', bindings), paste: pageCallback('pasteCopiedNodes', bindings), duplicate: pageCallback('duplicateNode', bindings), get selectedIds() { return selectedIds; }, get dialog() { return dialog; } };
}

test('copying a selected group includes its members and only internal connections', () => {
    const h = harness();
    const before = structuredClone(h.nodesRef.current);
    h.copy();
    assert.deepEqual(h.clipboardRef.current.nodes.map(n => n.id), ['group', 'image', 'video']);
    assert.deepEqual(h.clipboardRef.current.connections.map(c => c.id), ['internal']);
    assert.deepEqual(h.nodesRef.current, before);
    assert.notEqual(h.clipboardRef.current.nodes[1].position, h.nodesRef.current[1].position);
});

test('group paste remaps member IDs and internal edges and detaches running video identity', () => {
    const h = harness();
    const before = structuredClone(h.nodesRef.current);
    h.copy(); assert.equal(h.paste(), true);
    const [group, image, video] = h.nodesRef.current.slice(4);
    assert.equal(h.nodesRef.current.length, 7);
    assert.equal(h.connectionsRef.current.length, 4);
    for (const n of [group, image, video]) assert(!before.some(original => original.id === n.id));
    assert.equal(image.metadata.groupId, group.id); assert.equal(video.metadata.groupId, group.id);
    assert.equal(image.metadata.storageKey, 'image:saved');
    assert.equal(video.metadata.status, 'idle');
    for (const key of ['videoTaskId', 'videoTaskProvider', 'videoTaskCheckpoint', 'generationStartedAt', 'progress', 'progressStage']) assert.equal(video.metadata[key], undefined);
    assert.equal(video.metadata.model, 'MiniMax-H3'); assert.equal(video.metadata.seconds, '4');
    assert.deepEqual(h.connectionsRef.current.at(-1), { ...h.connectionsRef.current.at(-1), fromNodeId: image.id, toNodeId: video.id });
    assert.equal(image.position.x - group.position.x, before[1].position.x - before[0].position.x);
    assert.equal(video.position.y - group.position.y, before[2].position.y - before[0].position.y);
    assert.deepEqual(h.nodesRef.current.slice(0, 4), before);
});

test('selecting a group and one of its members does not duplicate that member twice', () => {
    const h = harness(['group', 'image']); h.copy();
    assert.equal(h.clipboardRef.current.nodes.length, 3);
    assert.equal(new Set(h.clipboardRef.current.nodes.map(n => n.id)).size, 3);
});

test('mixed group and external selection keeps connections between all copied nodes', () => {
    const h = harness(['group', 'outside']); h.copy(); h.paste();
    assert.equal(h.clipboardRef.current.nodes.length, 4);
    assert.equal(h.clipboardRef.current.connections.length, 3);
    const ids = new Set(h.nodesRef.current.slice(4).map(n => n.id));
    assert(h.connectionsRef.current.slice(3).every(c => ids.has(c.fromNodeId) && ids.has(c.toNodeId)));
});

test('right-click group duplicate includes members, keeps placement offset and internal edges', () => {
    const h = harness(); const before = structuredClone(h.nodesRef.current);
    h.duplicate('group');
    assert.equal(h.nodesRef.current.length, 7);
    const [group, image, video] = h.nodesRef.current.slice(4);
    assert.equal(group.type, 'group'); assert.equal(image.metadata.groupId, group.id); assert.equal(video.metadata.groupId, group.id);
    for (let i = 0; i < 3; i++) assert.deepEqual(h.nodesRef.current[4 + i].position, { x: before[i].position.x + 36, y: before[i].position.y + 36 });
    assert.equal(h.connectionsRef.current.length, 4);
    assert.equal(h.connectionsRef.current.at(-1).fromNodeId, image.id); assert.equal(h.connectionsRef.current.at(-1).toNodeId, video.id);
    assert.deepEqual([...h.selectedIds], [group.id]);
    assert.equal(video.metadata.videoTaskId, undefined); assert.equal(video.metadata.status, 'idle');
    assert.deepEqual(h.nodesRef.current.slice(0, 4), before);
});

test('single member paste stays independent of its source group and does not pull siblings', () => {
    const h = harness(['image']); h.copy(); h.paste();
    assert.equal(h.clipboardRef.current.nodes.length, 1); assert.equal(h.nodesRef.current.length, 5);
    assert.equal(h.nodesRef.current.at(-1).metadata.groupId, undefined); assert.equal(h.connectionsRef.current.length, 3);
});

test('ordinary right-click duplicate retains existing single-node behavior', () => {
    const h = harness(); h.duplicate('image');
    assert.equal(h.nodesRef.current.length, 5); assert.equal(h.nodesRef.current.at(-1).title, 'image Copy');
    assert.equal(h.nodesRef.current.at(-1).metadata.groupId, 'group'); assert.equal(h.connectionsRef.current.length, 3);
});

test('empty group and stale selections are copied safely without unrelated nodes', () => {
    const data = fixture(); data.nodes = data.nodes.filter(n => !n.metadata.groupId);
    const h = harness(['group', 'missing'], data); h.copy(); assert.equal(h.clipboardRef.current.nodes.length, 1); h.paste();
    assert.equal(h.nodesRef.current.length, 3); assert.equal(h.nodesRef.current.at(-1).type, 'group');
});

test('copying multiple groups remaps each distinct membership and cross-group edges', () => {
    const data = fixture(); data.nodes[3].metadata.groupId = 'second-group';
    data.nodes.push({ ...data.nodes[0], id: 'second-group', title: 'second-group', position: { x: 660, y: 40 } });
    const h = harness(['group', 'second-group'], data); h.copy(); h.paste();
    const copies = h.nodesRef.current.slice(5), groups = copies.filter(n => n.type === 'group');
    assert.equal(copies.length, 5); assert.equal(groups.length, 2);
    assert.equal(copies.find(n => n.title === 'outside Copy').metadata.groupId, groups.find(n => n.title === 'second-group Copy').id);
    assert.equal(copies.find(n => n.title === 'image Copy').metadata.groupId, groups.find(n => n.title === 'group Copy').id);
    assert.equal(h.connectionsRef.current.slice(3).length, 3);
});

function toolFixture() {
    const data = fixture();
    data.nodes[1].type = 'video';
    data.nodes[2].type = 'video-tool:trim';
    data.nodes[2].metadata = { groupId: 'group', status: 'loading', progress: 25, progressStage: 'encoding', generationStartedAt: 123,
        videoToolJobId: 'original-owned-job', videoToolImportedJobId: 'previous-job',
        videoToolSettings: { source: 'image', firstImage: 'image', audio: 'image', voice: 'image', references: ['image', 'external-image'], prompt: 'image', start: 0, end: 3, resolution: 1080, review: false } };
    // Settings must be remapped even when the tool precedes its source in the node list.
    [data.nodes[1], data.nodes[2]] = [data.nodes[2], data.nodes[1]];
    return data;
}

for (const operation of ['continuum', 'handtie', 'interpolate', 'upscale', 'restore', 'trim', 'audio']) {
    test(`copied ${operation} tool keeps successful media/settings and detaches source task identity`, () => {
        const source = toolFixture().nodes[1];
        source.type = 'video-tool:' + operation;
        source.metadata.content = 'blob:previous-success'; source.metadata.storageKey = 'video:previous-success';
        const before = structuredClone(source);
        const copied = copiedNodeMetadata(source);
        assert.equal(copied.status, 'success'); assert.equal(copied.content, source.metadata.content); assert.equal(copied.storageKey, source.metadata.storageKey);
        for (const key of ['videoToolJobId', 'videoToolImportedJobId', 'generationStartedAt', 'progress', 'progressStage']) assert.equal(copied[key], undefined);
        assert.deepEqual(copied.videoToolSettings, source.metadata.videoToolSettings);
        assert.notEqual(copied.videoToolSettings, source.metadata.videoToolSettings);
        assert.notEqual(copied.videoToolSettings.references, source.metadata.videoToolSettings.references);
        assert.deepEqual(source, before);
    });
}

for (const action of ['paste', 'duplicate']) {
    test(`${action} group remaps all tool input IDs after the complete ID map exists`, () => {
        const h = harness(['group'], toolFixture()); const before = structuredClone(h.nodesRef.current);
        if (action === 'paste') { h.copy(); h.paste(); } else h.duplicate('group');
        const tool = h.nodesRef.current.slice(4).find(n => n.type.startsWith('video-tool:'));
        const media = h.nodesRef.current.slice(4).find(n => n.type === 'video');
        assert.equal(tool.metadata.videoToolJobId, undefined); assert.equal(tool.metadata.videoToolImportedJobId, undefined); assert.equal(tool.metadata.status, 'idle');
        for (const key of ['source', 'firstImage', 'audio', 'voice']) assert.equal(tool.metadata.videoToolSettings[key], media.id);
        assert.deepEqual(tool.metadata.videoToolSettings.references, [media.id, 'external-image']);
        assert.equal(tool.metadata.videoToolSettings.prompt, 'image', 'text parameters must not be mistaken for references');
        assert.equal(tool.metadata.videoToolSettings.end, 3); assert.equal(tool.metadata.videoToolSettings.review, false);
        assert.deepEqual(h.nodesRef.current.slice(0, 4), before);
        const edge = h.connectionsRef.current.at(-1); assert.equal(edge.fromNodeId, media.id); assert.equal(edge.toNodeId, tool.id);
    });
}

test('mixed tool/source selection remaps input while single-tool copy preserves uncopied references', () => {
    const data = toolFixture();
    const mixed = harness(['image', 'video'], data); mixed.copy(); mixed.paste();
    const mixedTool = mixed.nodesRef.current.slice(4).find(n => n.type.startsWith('video-tool:'));
    const mixedSource = mixed.nodesRef.current.slice(4).find(n => n.type === 'video');
    assert.equal(mixedTool.metadata.videoToolSettings.source, mixedSource.id);
    assert.equal(mixedTool.metadata.groupId, undefined);
    const single = harness(['video'], data); single.copy(); single.paste();
    assert.equal(single.nodesRef.current.at(-1).metadata.videoToolSettings.source, 'image');
    assert.equal(single.nodesRef.current.at(-1).metadata.videoToolJobId, undefined);
    assert.equal(single.connectionsRef.current.length, 3);
    const duplicate = harness([], data); duplicate.duplicate('video');
    assert.equal(duplicate.nodesRef.current.at(-1).metadata.videoToolSettings.source, 'image');
    assert.equal(duplicate.nodesRef.current.at(-1).metadata.videoToolJobId, undefined);
});

test('runtime watches the original tool task only, never a copied group member', async () => {
    const h = harness(['group'], toolFixture()); h.copy(); h.paste();
    const polled = [];
    const { VideoToolRuntime } = load('lib/canvas/video-tool-runtime.ts', {
        '@/services/api/canvas-video-tools': { getVideoToolJob: async id => { polled.push(id); return { id, status: 'running' }; } },
    });
    const runtime = new VideoToolRuntime('test', () => ({ getNodes: () => h.nodesRef.current, getNode: id => h.nodesRef.current.find(n => n.id === id), updateMetadata: () => {}, getConnections: () => h.connectionsRef.current }));
    try { runtime.sync(h.nodesRef.current); await new Promise(resolve => setTimeout(resolve, 5)); assert.deepEqual(polled, ['original-owned-job']); }
    finally { runtime.dispose(); }
});
