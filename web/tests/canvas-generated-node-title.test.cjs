const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas/generated-node-title.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function('exports', code)(moduleExports);
const { nextGeneratedNodeTitle } = moduleExports;

test('generated media titles continue the highest number and stay separate by type', () => {
    assert.deepEqual(nextGeneratedNodeTitle('image', ['图片1', '图片7', '图片说明', '视频9']), { title: '图片8', sequence: 8 });
    assert.deepEqual(nextGeneratedNodeTitle('video', ['图片7', '视频1', '视频3']), { title: '视频4', sequence: 4 });
    assert.deepEqual(nextGeneratedNodeTitle('image', ['a long prompt', '图片0', '图片1 副本'], 8), { title: '图片9', sequence: 9 });
});
