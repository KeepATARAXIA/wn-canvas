const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

const output = {};
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/canvas/video-tool-preview.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function('exports', 'require', code)(output, () => ({
    getNodeDefinition: type => ({ resource: node => node.metadata?.content ? { kind: type === 'image' ? 'image' : 'video', url: node.metadata.content } : null }),
}));
const { getVideoToolInput } = output;
const video = (id, content = id + '.mp4') => ({ id, type: 'video', metadata: { content } });
const tool = source => ({ id: 'tool', type: 'video-tool:upscale', metadata: { videoToolSettings: { source } } });

test('one ready video previews automatically without mutating the tool output', () => {
    const node = tool();
    const saved = JSON.stringify(node);
    assert.deepEqual(getVideoToolInput(node, [video('a'), video('pending', '')]), { source: 'a', preview: 'a.mp4' });
    assert.equal(JSON.stringify(node), saved);
    assert.equal(node.metadata.content, undefined);
});

test('multiple inputs require a choice and changing that choice changes the preview', () => {
    const upstream = [video('a'), video('b')];
    assert.deepEqual(getVideoToolInput(tool(), upstream), { source: undefined, preview: undefined });
    for (const source of ['a', 'b']) assert.deepEqual(getVideoToolInput(tool(source), upstream), { source, preview: source + '.mp4' });
});

test('disconnected and non-video selections do not silently use another video', () => {
    const upstream = [video('a'), { ...video('image'), type: 'image' }];
    assert.equal(getVideoToolInput(tool('missing'), upstream).preview, undefined);
    assert.equal(getVideoToolInput(tool('image'), upstream).preview, undefined);
    assert.deepEqual(getVideoToolInput(tool(), []), { source: undefined, preview: undefined });
});

test('completed upstream tools and replaced inputs use their current result URL', () => {
    const upstream = { ...video('prior', 'new-result.mp4'), type: 'video-tool:trim' };
    assert.deepEqual(getVideoToolInput(tool(), [upstream]), { source: 'prior', preview: 'new-result.mp4' });
});
