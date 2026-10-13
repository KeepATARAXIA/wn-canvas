const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/layout/app-config-modal.tsx'), 'utf8');

function harness(initialChannels) {
    let channels = structuredClone(initialChannels);
    let newChannel = null;
    let editingId = '';
    let writes = 0;
    let sequence = 0;
    const extract = name => source.match(new RegExp(`    const ${name} = [\\s\\S]*?\\n    \\};`))?.[0] || assert.fail(`missing callback ${name}`);
    const methods = ['addChannel', 'addLocalChannel', 'saveChannel'].map(extract).join('\n');
    const createChannel = patch => ({ id: `new-${++sequence}`, name: '', baseUrl: '', apiKey: '', apiFormat: 'openai', models: [], ...patch });
    const render = () => {
        const code = ts.transpileModule(methods, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        return new Function('config', 'createModelChannel', 't', 'updateChannels', 'setEditingChannelId', 'setNewChannel', 'newChannel', code + '\nreturn { addChannel, addLocalChannel, saveChannel };')(
            { channels }, createChannel, key => key,
            next => { channels = next; writes++; }, value => { editingId = value; }, value => { newChannel = value; }, newChannel,
        );
    };
    return { render, snapshot: () => ({ channels, newChannel, editingId, writes }), close: () => { newChannel = null; editingId = ''; } };
}

const defaults = [{ id: 'existing', name: 'Existing', baseUrl: 'http://127.0.0.1:1234', apiKey: 'test-only', apiFormat: 'openai', models: [{ name: 'text-model', capability: 'text' }] }];
const localPreset = { nameKey: 'config.local.service', baseUrl: 'http://127.0.0.1:8189', apiKey: '', apiFormat: 'openai', serviceType: 'comfyui', models: [{ name: 'image-model', capability: 'image' }] };

test('repeated new-channel cancel leaves channel data untouched and performs zero writes', () => {
    const h = harness(defaults);
    for (let i = 0; i < 3; i++) {
        h.render().addChannel();
        assert.equal(h.snapshot().channels.length, 1);
        assert.ok(h.snapshot().newChannel);
        h.close();
        assert.deepEqual(h.snapshot().channels, defaults);
    }
    assert.equal(h.snapshot().writes, 0);
});

test('saving new API channel adds the edited draft exactly once', () => {
    const h = harness(defaults);
    h.render().addChannel();
    const draft = { ...h.snapshot().newChannel, name: 'Saved new', models: [{ name: 'new-model', capability: 'text' }] };
    h.render().saveChannel(draft);
    h.close();
    assert.equal(h.snapshot().channels.length, 2);
    assert.deepEqual(h.snapshot().channels[1], draft);
    assert.equal(h.snapshot().writes, 1);
});

test('local preset cancel never inserts or replaces a stored channel', () => {
    for (const initial of [defaults, [{ ...defaults[0], apiKey: '', models: [] }]]) {
        const h = harness(initial);
        h.render().addLocalChannel(localPreset);
        assert.deepEqual(h.snapshot().channels, initial);
        assert.ok(h.snapshot().newChannel);
        h.close();
        assert.deepEqual(h.snapshot().channels, initial);
        assert.equal(h.snapshot().writes, 0);
    }
});

test('saving local preset preserves the prior replace-unused-default behavior', () => {
    const h = harness([{ ...defaults[0], apiKey: '', models: [] }]);
    h.render().addLocalChannel(localPreset);
    h.render().saveChannel(h.snapshot().newChannel);
    h.close();
    assert.equal(h.snapshot().channels.length, 1);
    assert.equal(h.snapshot().channels[0].id, 'existing');
    assert.equal(h.snapshot().channels[0].baseUrl, localPreset.baseUrl);
    assert.equal(h.snapshot().writes, 1);
});

test('editing an existing service reuses its identity and never creates another draft', () => {
    const initial = [{ ...defaults[0], serviceType: 'comfyui' }];
    const h = harness(initial);
    h.render().addLocalChannel(localPreset);
    assert.equal(h.snapshot().editingId, 'existing');
    assert.equal(h.snapshot().newChannel, null);
    assert.equal(h.snapshot().writes, 0);
    h.render().saveChannel({ ...initial[0], name: 'Updated' });
    assert.equal(h.snapshot().channels.length, 1);
    assert.equal(h.snapshot().channels[0].name, 'Updated');
});
