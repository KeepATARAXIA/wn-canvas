const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/canvas/generation-detail-parameters.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function('exports', code)(moduleExports);
const { generationDetailParameters } = moduleExports;
const fields = (metadata, modelName) => Object.fromEntries(generationDetailParameters(metadata, modelName).map(({ key, value }) => [key, value]));

test('built-in Qwen history hides ineffective quality without changing saved request values', () => {
    const metadata = { quality: 'high', size: '3840x2160', background: 'transparent', generationType: 'edit', count: 4 };
    const before = JSON.stringify(metadata);
    for (const name of ['Qwen-Image 2.1 · 生图', 'Qwen-Image 2.1 · 编辑', 'Qwen-Image 2.1 Turbo · 生图', 'Qwen-Image 2.1 Turbo · 编辑']) {
        const result = fields(metadata, name);
        assert.equal(result.quality, undefined);
        assert.equal(result.size, '3840 × 2160 px');
        assert.equal(result.background, '透明');
        assert.equal(result.generationType, '编辑');
        assert.equal(result.count, '4');
    }
    assert.equal(JSON.stringify(metadata), before);
    assert.equal(fields(metadata, 'gpt-image-2').quality, '高');
    assert.equal(fields(metadata, 'Custom Qwen quality workflow').quality, '高');
});

test('readable parameters preserve unknown values and include explicit false and zero', () => {
    const result = fields({ size: 'auto', quality: 'auto', seconds: '-1', vquality: '1080', videoMode: 'reference', generateAudio: false, watermark: '0', audioSpeed: '1.25', count: 0, audioVoice: 'my-custom-voice', videoH3Mode: 'custom-mode', audioInstructions: '' }, 'custom');
    assert.deepEqual(result, { size: '自动', quality: '自动', vquality: '1080p', seconds: '智能时长', videoMode: '参考素材', videoH3Mode: 'custom-mode', generateAudio: '关闭', watermark: '关闭', audioVoice: 'my-custom-voice', audioSpeed: '1.25×', count: '0' });
    assert.deepEqual(generationDetailParameters({}, ''), []);
    assert.equal(fields({ seconds: '5', generationType: 'generation', h3TeSpeed: 'on', background: 'opaque' }, '').seconds, '5 秒');
    assert.equal(fields({ generationType: 'generation' }, '').generationType, '生图');
});
