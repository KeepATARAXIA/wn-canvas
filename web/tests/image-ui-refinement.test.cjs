const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');
const React = require('../node_modules/react');
const src = path.join(__dirname, '../src');

const generation = 'qwen::Qwen-Image 2.1 · 生图';
const edit = 'qwen::Qwen-Image 2.1 · 编辑';
const turboGeneration = 'qwen::Qwen-Image 2.1 Turbo · 生图';
const turboEdit = 'qwen::Qwen-Image 2.1 Turbo · 编辑';
const decode = value => value.includes('::') ? { channelId: value.slice(0, value.indexOf('::')), model: value.slice(value.indexOf('::') + 2) } : null;
const name = value => decode(value)?.model || value;
function config() {
    return { channelMode: 'local', models: [], imageModel: generation, model: generation, quality: 'high', count: '1', size: '2048x1152', background: '', channels: [
        { id: 'default', name: '默认渠道', models: [{ name: 'gpt-image-2', capability: 'image' }] },
        { id: 'qwen', name: '本地 ComfyUI · Qwen-Image 2.1', models: [
            { name: 'Qwen-Image 2.1 · 生图', capability: 'image', workflowId: 'builtin:qwen-image21-t2i' },
            { name: 'Qwen-Image 2.1 · 编辑', capability: 'image', workflowId: 'builtin:qwen-image21-edit' },
            { name: 'Qwen-Image 2.1 Turbo · 生图', capability: 'image', workflowId: 'builtin:qwen-image21-turbo-t2i' },
            { name: 'Qwen-Image 2.1 Turbo · 编辑', capability: 'image', workflowId: 'builtin:qwen-image21-turbo-edit' },
        ] },
    ] };
}
const selectable = config => config.channels.flatMap(channel => channel.models.map(model => `${channel.id}::${model.name}`));
const label = (config, value) => `${name(value)}（${config.channels.find(channel => channel.id === decode(value)?.channelId)?.name || ''}）`;
function harness() {
    const cache = new Map();
    const overrides = {
        react: { ...React, useState: value => [value, () => {}], useMemo: fn => fn(), useEffect: () => {}, useId: () => 'qa-picker', useRef: () => ({ current: null }) },
        'react/jsx-runtime': require('../node_modules/react/jsx-runtime'),
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        antd: { ConfigProvider: ({ children }) => children, Switch: props => React.createElement('switch', props) },
        'lucide-react': { Cpu: () => null, ChevronDown: () => null },
        '@/i18n': { t: key => key },
        '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
        '@/stores/use-config-store': {
            decodeChannelModel: decode, encodeChannelModel: (channel, name) => `${channel}::${name}`, modelOptionName: name, modelOptionLabel: label,
            selectableModelsByCapability: selectable,
            normalizeModelOptionValue: (value, channels) => decode(value) ? value : `${channels.find(channel => channel.models.some(model => model.name === value))?.id}::${value}`,
            resolveModelWorkflowId: (config, value) => config.channels.find(channel => channel.id === decode(value)?.channelId)?.models.find(model => model.name === name(value))?.workflowId || '',
        },
        '@/components/ui/select': Object.fromEntries(['Select', 'SelectContent', 'SelectItem', 'SelectTrigger'].map(type => [type, type])),
    };
    function load(relative) {
        const file = path.resolve(src, relative);
        if (cache.has(file)) return cache.get(file);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
        const output = {};
        cache.set(file, output);
        new Function('exports', 'require', code)(output, module => {
            if (module in overrides) return overrides[module];
            const target = module.startsWith('@/') ? path.join(src, module.slice(2)) : path.resolve(path.dirname(file), module);
            return load(path.relative(src, fs.existsSync(target) ? target : target + '.ts'));
        });
        return output;
    }
    return { load };
}
function flatten(element) {
    if (element === null || element === undefined || typeof element === 'boolean') return [];
    if (Array.isArray(element)) return element.flatMap(flatten);
    if (!React.isValidElement(element)) return [element];
    if (typeof element.type === 'function') return flatten(element.type(element.props));
    return [element, ...flatten(element.props.children)];
}
const text = element => flatten(element).filter(item => typeof item === 'string' || typeof item === 'number').join('');

test('model menu combines both built-in pairs without changing selectable values or config', () => {
    const state = config(), before = structuredClone(state);
    const { modelPickerOptions } = harness().load('lib/model-picker-options.ts');
    const options = modelPickerOptions(state, selectable(state), 'image');
    assert.deepEqual(options.map(option => option.label), ['gpt-image-2', '千问 2.1', '千问 2.1 Turbo']);
    assert.deepEqual(options[1].values, [generation, edit]);
    assert.deepEqual(options[2].values, [turboGeneration, turboEdit]);
    assert.ok(options.every(option => option.channel === undefined));
    assert.match(options[2].detail, /本地 ComfyUI/);
    assert.deepEqual(state, before);
});

test('renamed, scripted, ambiguous or incomplete model pairs remain separate and usable', () => {
    const { modelPickerOptions } = harness().load('lib/model-picker-options.ts');
    for (const change of [
        channel => { channel.models[0].name = '我的生图模型'; },
        channel => { channel.models[1].script = 'return custom();'; },
        channel => { channel.models.splice(1, 1); },
        channel => { channel.models.push({ ...channel.models[1], name: '另一个编辑模型' }); },
    ]) {
        const state = config(); change(state.channels[1]);
        const values = selectable(state), options = modelPickerOptions(state, values, 'image');
        assert.equal(options.some(option => option.label === '千问 2.1'), false);
        assert.deepEqual(new Set(options.flatMap(option => option.values)), new Set(values));
        assert.ok(options.some(option => option.label === '千问 2.1 Turbo'));
    }
});

test('same model in multiple channels displays only the information needed to distinguish it', () => {
    const state = config(), other = structuredClone(state.channels[1]);
    other.id = 'second'; other.name = '另一台千问'; state.channels.push(other);
    const { modelPickerOptions } = harness().load('lib/model-picker-options.ts');
    const options = modelPickerOptions(state, selectable(state), 'image');
    assert.deepEqual(options.filter(option => option.label === '千问 2.1').map(option => option.channel), [state.channels[1].name, other.name]);
    state.channels[2].name = state.channels[1].name;
    const duplicates = modelPickerOptions(state, selectable(state), 'image').filter(option => option.label === '千问 2.1');
    assert.ok(duplicates[0].channel.endsWith(' · qwen')); assert.ok(duplicates[1].channel.endsWith(' · second'));
});

test('an editor stays visibly selected and choosing Turbo passes the existing real model value', () => {
    const state = config(), changes = [], { ModelPicker } = harness().load('components/model-picker.tsx');
    for (const current of [edit, 'Qwen-Image 2.1 · 编辑']) {
        const tree = ModelPicker({ config: state, value: current, capability: 'image', onChange: value => changes.push(value) });
        assert.equal(tree.props.value, generation);
        const elements = flatten(tree);
        const trigger = elements.find(element => element?.type === 'SelectTrigger');
        assert.match(text(trigger), /千问 2.1/); assert.doesNotMatch(text(trigger), /ComfyUI|生图|编辑/);
        assert.equal(elements.filter(element => element?.type === 'SelectItem').length, 3);
        tree.props.onValueChange(turboGeneration);
    }
    assert.deepEqual(changes, [turboGeneration, turboGeneration]);
    assert.equal(state.model, generation);
});

test('non-image pickers retain full menu labels, detailed channels and the previous width', () => {
    const state = config(), { load } = harness(), { ModelPicker } = load('components/model-picker.tsx');
    const { modelPickerOptions } = load('lib/model-picker-options.ts');
    const options = modelPickerOptions(state, selectable(state), 'video');
    assert.equal(options.length, 5);
    assert.equal(options[1].label, label(state, generation));
    const full = flatten(ModelPicker({ config: state, value: generation, capability: 'video', fullWidth: true, onChange: () => {} }));
    assert.equal(text(full.find(element => element?.type === 'SelectTrigger')), label(state, generation));
    assert.match(full.find(element => element?.type === 'SelectContent').props.className, /w-96/);
    const detailed = flatten(ModelPicker({ config: state, value: generation, capability: 'video', detailed: true, onChange: () => {} }));
    assert.equal(text(detailed.find(element => element?.type === 'SelectTrigger')), name(generation) + state.channels[1].name);
});

const theme = { node: { text: '#fff', muted: '#999', stroke: '#aaa', activeStroke: '#00f', fill: '#222' }, toolbar: { activeBg: '#00f', activeText: '#fff', panel: '#111' } };
test('one output panel exposes ratio, resolution, aligned dimensions, count and transparency', () => {
    const state = { ...config(), size: '1024x1024' }, changes = [], { ImageSettingsPanel } = harness().load('components/image-settings-panel.tsx');
    const render = () => flatten(ImageSettingsPanel({ config: state, theme, section: 'output', onConfigChange: (key, value) => { changes.push([key, value]); state[key] = value; }, showTitle: false, quickCount: 4 }));
    let elements = render();
    assert.doesNotMatch(elements.filter(item => typeof item === 'string').join(''), /不支持透明|质量档位/);
    elements.find(element => element?.type === 'button' && text(element) === '16:9').props.onClick();
    assert.equal(state.size, '1536x864');
    elements = render();
    elements.find(element => element?.type === 'button' && text(element) === '2k').props.onClick();
    assert.equal(state.size, '2048x1152');
    elements = render();
    const width = elements.find(element => element?.props?.['aria-label'] === '图片宽度');
    width.props.onBlur({ currentTarget: { value: '2050' } });
    assert.equal(state.size, '2064x1152');
    const transparent = elements.find(element => element?.type === 'switch' && element.props['aria-label'] === 'settingsPanels.image.transparent');
    transparent.props.onChange(true); assert.equal(state.background, 'transparent');
    transparent.props.onChange(false); assert.equal(state.background, '');
    assert.ok(changes.some(([key]) => key === 'size'));
    const count = elements.find(element => element?.props?.['aria-label'] === '自定义图片生成数量');
    count.props.onChange({ target: { value: '6' } }); assert.equal(state.count, '6');
});

test('Qwen edit keeps reference size restrictions while exposing transparent output and quantity', () => {
    const state = { ...config(), model: edit }, { ImageSettingsPanel } = harness().load('components/image-settings-panel.tsx');
    const elements = flatten(ImageSettingsPanel({ config: state, theme, section: 'output', onConfigChange: () => {}, showTitle: false }));
    assert.equal(elements.some(element => element?.props?.['aria-label'] === '图片宽度'), false);
    assert.equal(elements.some(element => element?.type === 'button' && text(element) === '16:9'), false);
    assert.ok(elements.some(element => element?.type === 'switch' && element.props['aria-label'] === 'settingsPanels.image.transparent'));
    assert.ok(elements.some(element => element?.props?.['aria-label'] === '自定义图片生成数量'));
});

test('Qwen has no quality content while other models retain real quality choices', () => {
    const { ImageSettingsPanel } = harness().load('components/image-settings-panel.tsx');
    const render = state => flatten(ImageSettingsPanel({ config: state, theme, section: 'quality', onConfigChange: () => {}, showTitle: false }));
    assert.equal(render(config()).filter(element => element?.type === 'button').length, 0);
    assert.equal(render({ ...config(), model: 'default::gpt-image-2' }).filter(element => element?.type === 'button').length, 4);
});

test('separate ratio and resolution panels share size changes without showing unrelated controls', () => {
    const state = { ...config(), size: '1024x1024' }, changes = [], { ImageSettingsPanel } = harness().load('components/image-settings-panel.tsx');
    const render = section => flatten(ImageSettingsPanel({ config: state, theme, section, showTitle: false, onConfigChange: (key, value) => { changes.push([key, value]); state[key] = value; } }));
    let elements = render('ratio');
    assert.equal(elements.filter(element => element?.type === 'button').length, 10);
    assert.equal(elements.some(element => element?.type === 'input' || element?.type === 'switch'), false);
    elements.find(element => element?.type === 'button' && text(element) === '16:9').props.onClick();
    assert.equal(state.size, '1536x864');
    elements = render('resolution');
    assert.deepEqual(elements.filter(element => element?.type === 'button').map(text), ['1k', '2k', '4k', 'settingsPanels.common.auto']);
    assert.equal(elements.some(element => element?.props?.['aria-label'] === '自定义图片生成数量'), false);
    assert.equal(elements.some(element => element?.props?.['aria-label'] === 'settingsPanels.image.transparent'), false);
    elements.find(element => element?.type === 'button' && text(element) === '2k').props.onClick();
    assert.equal(state.size, '2048x1152');
    elements = render('resolution');
    elements.find(element => element?.props?.['aria-label'] === '图片宽度').props.onBlur({ currentTarget: { value: '2050' } });
    assert.equal(state.size, '2064x1152');
    assert.ok(elements.some(element => element?.type === 'switch' && element.props['aria-label'] === 'settingsPanels.image.align16'));
    assert.ok(changes.every(([key]) => key === 'size'));
});

test('separate count and background panels expose only their own controls while complete panels retain the previous defaults', () => {
    const state = config(), changes = [], { ImageSettingsPanel } = harness().load('components/image-settings-panel.tsx');
    const render = section => flatten(ImageSettingsPanel({ config: state, theme, section, showTitle: false, onConfigChange: (key, value) => { changes.push([key, value]); state[key] = value; } }));
    let elements = render('count');
    const buttons = elements.filter(element => element?.type === 'button');
    assert.equal(buttons.length, 4);
    assert.equal(elements.some(element => element?.type === 'switch'), false);
    buttons[2].props.onClick();
    assert.equal(state.count, '3');
    const custom = elements.find(element => element?.props?.['aria-label'] === '自定义图片生成数量');
    assert.equal(custom.props.min, 1);
    assert.equal(custom.props.max, 15);
    custom.props.onChange({ target: { value: '15' } });
    assert.equal(state.count, '15');
    elements = render('background');
    assert.equal(elements.some(element => element?.type === 'button' || element?.type === 'input'), false);
    const transparent = elements.find(element => element?.type === 'switch');
    assert.equal(transparent.props['aria-label'], 'settingsPanels.image.transparent');
    transparent.props.onChange(true); assert.equal(state.background, 'transparent');
    transparent.props.onChange(false); assert.equal(state.background, '');
    assert.deepEqual(changes.map(([key]) => key), ['count', 'count', 'background', 'background']);
    for (const section of ['all', 'output']) {
        assert.equal(render(section).filter(element => element?.type === 'button' && text(element) === 'settingsPanels.image.images').length, 10);
    }
});

test('split Qwen editing size panels explain restrictions and offer quantity or transparency only in their own sections', () => {
    const { ImageSettingsPanel } = harness().load('components/image-settings-panel.tsx');
    for (const model of [edit, turboEdit]) {
        const state = { ...config(), model };
        const render = section => flatten(ImageSettingsPanel({ config: state, theme, section, showTitle: false, onConfigChange: () => assert.fail('Read-only restriction panel changed config') }));
        for (const section of ['ratio', 'resolution']) {
            const elements = render(section);
            assert.equal(elements.some(element => element?.type === 'button' || element?.type === 'input' || element?.type === 'switch'), false);
            assert.match(elements.filter(element => typeof element === 'string').join(''), /参考图|1K/);
        }
        assert.ok(render('count').some(element => element?.props?.['aria-label'] === '自定义图片生成数量'));
        assert.ok(render('background').some(element => element?.type === 'switch' && element.props['aria-label'] === 'settingsPanels.image.transparent'));
    }
});
