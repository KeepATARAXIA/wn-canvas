const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const root = path.join(__dirname, '../src');

function load(relative) {
    const output = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function('exports', 'require', code)(output, (name) => {
        assert.ok(name.startsWith('@/'), name);
        return load(name.slice(2) + '.ts');
    });
    return output;
}

const { ensureGroupColors, getGroupAccent, groupNodeColors } = load('lib/canvas/canvas-group-colors.ts');
const { canvasThemes } = load('lib/canvas-theme.ts');
const group = (id, metadata) => ({ id, type: 'group', title: id, position: { x: 0, y: 0 }, width: 760, height: 480, ...(metadata ? { metadata } : {}) });
const colors = (nodes) => nodes.filter((node) => node.type === 'group').map((node) => node.metadata.groupColor);

test('legacy groups gain distinct colors without changing inputs, members or existing metadata', () => {
    const member = Object.freeze({ ...group('member'), type: 'text', metadata: Object.freeze({ groupId: 'a', content: '保留内容' }) });
    const first = Object.freeze(group('a', Object.freeze({ status: 'idle' })));
    const old = Object.freeze([first, member, Object.freeze(group('b')), Object.freeze(group('c'))]);
    const next = ensureGroupColors(old);
    assert.equal(new Set(colors(next)).size, 3);
    assert.equal(next[0].metadata.status, 'idle');
    assert.equal(next[1], member);
    assert.equal(first.metadata.groupColor, undefined);
    assert.equal(old[2].metadata, undefined);
});

test('multiple new groups reserve existing colors before assignment and leave existing groups untouched', () => {
    const existing = ensureGroupColors([group('existing')])[0];
    const next = ensureGroupColors([group('new-a'), existing, group('new-b')], [existing]);
    assert.equal(next[1], existing);
    assert.equal(new Set(colors(next)).size, 3);
});

test('copied and pasted groups get new colors while each source keeps its color', () => {
    const previous = ensureGroupColors([group('source-a'), group('source-b')]);
    const copies = previous.map((node, index) => ({ ...node, id: 'copy-' + index, metadata: { ...node.metadata } }));
    const pasted = ensureGroupColors([...copies, ...previous], previous);
    assert.equal(new Set(colors(pasted)).size, 4);
    assert.equal(pasted[2], previous[0]);
    assert.equal(pasted[3], previous[1]);
    assert.deepEqual(copies.map((node) => node.metadata.groupColor), colors(previous), 'clipboard metadata stays unchanged');
    const repeated = ensureGroupColors([...pasted, ...copies.map((node) => ({ ...node, id: node.id + '-again' }))], pasted);
    assert.equal(new Set(colors(repeated)).size, 6);
});

test('manual colors remain the accent and clearing one restores the stable automatic color', () => {
    const node = ensureGroupColors([group('manual', { labelColor: '#2F5BFF', status: 'idle' })])[0];
    assert.equal(node.metadata.labelColor, '#2F5BFF');
    assert.notEqual(node.metadata.groupColor, '#2f5bff', 'automatic allocation also reserves manual colors');
    assert.equal(getGroupAccent(node), '#2F5BFF');
    const cleared = { ...node, metadata: { ...node.metadata, labelColor: undefined } };
    assert.equal(ensureGroupColors([cleared], [node])[0], cleared);
    assert.equal(getGroupAccent(cleared), node.metadata.groupColor);
    const copy = { ...node, id: 'manual-copy', metadata: { ...node.metadata } };
    const next = ensureGroupColors([node, copy], [node]);
    assert.equal(next[1].metadata.labelColor, '#2F5BFF');
    assert.notEqual(next[1].metadata.groupColor, node.metadata.groupColor);
});

test('reload, reordering and removal preserve stored colors, including saved duplicates', () => {
    const previous = ensureGroupColors([group('a'), group('b'), group('c')]);
    const reopened = JSON.parse(JSON.stringify(previous));
    assert.equal(ensureGroupColors(reopened), reopened);
    const reordered = [previous[2], previous[0]];
    assert.equal(ensureGroupColors(reordered, previous), reordered);
    assert.deepEqual(colors(reordered), [colors(previous)[2], colors(previous)[0]]);
    const savedDuplicates = [previous[0], { ...previous[0], id: 'restored-copy' }];
    assert.equal(ensureGroupColors(savedDuplicates), savedDuplicates, 'restore and undo keep the saved colors');
});

test('a large group collection gets unique colors beyond the palette and retains them after reload', () => {
    const next = ensureGroupColors(Array.from({ length: 120 }, (_, index) => group('group-' + index)));
    assert.equal(new Set(colors(next)).size, 120);
    assert.ok(colors(next).slice(0, 8).every((color) => /^#[\da-f]{6}$/.test(color)));
    assert.ok(colors(next).slice(8).every((color) => color.startsWith('hsl(')));
    assert.equal(ensureGroupColors(next), next);
    assert.equal(ensureGroupColors(next, next), next);
});

test('unchanged and non-group node collections retain the original array and node references', () => {
    const empty = [];
    assert.equal(ensureGroupColors(empty), empty);
    const text = { ...group('text', { content: '说明' }), type: 'text' };
    const other = [text];
    assert.equal(ensureGroupColors(other, []), other);
    const assigned = ensureGroupColors([group('a'), text]);
    assert.equal(ensureGroupColors(assigned), assigned);
    assert.equal(ensureGroupColors(assigned, assigned), assigned);
    const changedExisting = [group('a', { groupColor: '#abcdef' }), text];
    assert.equal(ensureGroupColors(changedExisting, assigned), changedExisting);
    assert.equal(assigned[1], text);
});

test('group fill and border blend with each theme while manual accents remain visible', () => {
    const node = group('a', { groupColor: '#059669', labelColor: '#db2777' });
    assert.deepEqual(groupNodeColors(node, canvasThemes.light), {
        background: 'color-mix(in srgb, #db2777 13%, transparent)',
        border: 'color-mix(in srgb, #db2777 45%, #f4f6f8)',
        accent: '#db2777',
    });
    assert.deepEqual(groupNodeColors(node, canvasThemes.dark), {
        background: 'color-mix(in srgb, #db2777 18%, transparent)',
        border: 'color-mix(in srgb, #db2777 60%, #11151d)',
        accent: 'color-mix(in srgb, #db2777 70%, white)',
    });
    assert.equal(getGroupAccent(group('legacy')), '#2f5bff');
});
