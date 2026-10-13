const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(name) {
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/canvas', name + '.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    new Function('exports', code)(exports);
    return exports;
}
const { generationRecordNumbers, reusableGenerationMetadata, generationHistoryGroups, generationHistoryTint, generationRecordTiming } = load('generation-history-presentation');
const { generationQueueDisplay } = load('generation-queue');

test('history sorts groups and children newest first and searches without changing group totals', () => {
    const records = [
        { id: 'a1', nodeId: 'a', title: '海报', kind: 'image', startedAt: 1, recordedAt: 1, metadata: { prompt: '红色' } },
        { id: 'b', nodeId: 'b', title: '视频', kind: 'video', startedAt: 2, recordedAt: 2, metadata: {} },
        { id: 'a3', nodeId: 'a', title: '海报', kind: 'image', startedAt: 3, recordedAt: 3, metadata: { model: 'Qwen' } },
    ];
    const before = JSON.stringify(records);
    const groups = generationHistoryGroups(records);
    assert.deepEqual(groups.map(g => g.nodeId), ['a', 'b']);
    assert.deepEqual(groups[0].records.map(r => r.id), ['a3', 'a1']);
    const match = generationHistoryGroups(records, ' 红色 ', 'image');
    assert.equal(match.length, 1); assert.equal(match[0].cover.id, 'a1'); assert.equal(match[0].records.length, 2);
    assert.equal(generationHistoryGroups(records, 'qwen')[0].cover.id, 'a3');
    assert.equal(generationHistoryGroups(records, '红色', 'video').length, 0);
    assert.equal(generationHistoryGroups([], 'none').length, 0);
    assert.equal(JSON.stringify(records), before);
});

test('history tint fades with age, respects 24h and 7d boundaries, and never invents legacy age', () => {
    const now = 10 * 86400000;
    const ages = [0, .5, 1, 2, 6, 7, 10];
    const tints = ages.map(days => generationHistoryTint(now - days * 86400000, now, true));
    for (let i = 1; i < tints.length; i++) assert.ok(tints[i] <= tints[i - 1]);
    assert.ok(tints[0] > generationHistoryTint(now, now, false));
    assert.equal(tints[5], 0); assert.equal(generationHistoryTint(undefined, now, true), 0);
    assert.equal(generationHistoryTint(now + 1000, now, true), tints[0]);
    assert.equal(generationHistoryTint(now - 86400000, now, true), generationHistoryTint(now - 86400000, now, false));
});
test('result numbers distinguish retries and batch outputs without mutating history or requiring legacy timestamps', () => {
    const records = [{ id: 'old', nodeId: 'n', recordedAt: 10 }, { id: 'batch', nodeId: 'n', startedAt: 20, recordedAt: 20 }, { id: 'retry', nodeId: 'n', startedAt: 30, recordedAt: 30 }, { id: 'other', nodeId: 'm', recordedAt: 10 }];
    const copy = JSON.stringify(records);
    const numbers = generationRecordNumbers(records);
    assert.deepEqual([...numbers], [['old', 1], ['other', 1], ['batch', 2], ['retry', 3]]);
    assert.equal(JSON.stringify(records), copy);
    assert.equal(generationRecordNumbers([...records, { id: 'next', nodeId: 'n', recordedAt: 40 }]).get('retry'), 3);
});
test('reuse copies only request parameters and cannot replay an old task or overwrite output media', () => {
    const m = { model: 'h3', prompt: 'ocean', seconds: '6', vquality: '1080p', count: 3, videoH3Mode: 'turbo', background: 'transparent', content: 'blob:old', storageKey: 'image:old', status: 'loading', progress: 90, videoTaskId: 'paid-task', seedVr2TaskId: 'seed-task', generationType: 'edit', references: ['image:reference'], images: [{ id: 'old' }] };
    const result = reusableGenerationMetadata({ metadata: m });
    assert.deepEqual(result, { model: 'h3', background: 'transparent', count: 3, seconds: '6', vquality: '1080p', videoH3Mode: 'turbo', prompt: 'ocean', composerContent: 'ocean', status: 'idle' });
    assert.equal(m.videoTaskId, 'paid-task');
});
const source = { id: 'source', type: 'image', title: 'reference', metadata: { content: 'image.png', prompt: 'old', status: 'success', progress: 100 } };
const target = { id: 'result', type: 'image', title: 'result', metadata: { status: 'loading', generationStartedAt: 101, prompt: 'full prompt', progressStage: '采样', progress: 42, progressIndeterminate: false } };
test('queue follows the active output, uses actual progress, and never borrows an old or queued result', () => {
    const item = { nodeId: 'source', mode: 'image', status: 'running', startedAt: 100, targetNodeIds: ['source', 'result'], prompt: 'typed' };
    const result = generationQueueDisplay(item, [source, target]);
    assert.equal(result.prompt, 'full prompt'); assert.equal(result.percent, 42); assert.equal(result.stage, '采样'); assert.equal(result.preview.id, 'source');
    assert.equal(generationQueueDisplay({ ...item, status: 'queued' }, [source, target]).percent, undefined);
    assert.equal(generationQueueDisplay(item, [source, { ...target, metadata: { ...target.metadata, progressIndeterminate: undefined } }]).percent, 42);
    assert.equal(generationQueueDisplay(item, [source, { ...target, metadata: { ...target.metadata, generationStartedAt: 90 } }]).percent, undefined);
    for (const m of [{ progressIndeterminate: true }, { progress: NaN }, { progress: undefined }]) assert.equal(generationQueueDisplay(item, [source, { ...target, metadata: { ...target.metadata, ...m } }]).percent, undefined);
});
test('batch queue progress follows completed images and keeps failures visible', () => {
    const item = { nodeId: 'source', mode: 'image', status: 'running', startedAt: 100, targetNodeIds: ['result'] };
    const result = generationQueueDisplay(item, [{ ...target, metadata: { ...target.metadata, images: [{ status: 'success' }, { status: 'error' }, { status: 'loading', progressStage: '保存中' }] } }]);
    assert.equal(result.percent, 200 / 3); assert.equal(result.stage, '1/3 张完成 · 1 张失败 · 保存中');
    for (const completed of [0, 1, 2, 4]) {
        const images = Array.from({ length: 4 }, (_, index) => ({ status: index < completed ? 'success' : index === completed ? 'loading' : 'idle' }));
        assert.equal(generationQueueDisplay(item, [{ ...target, metadata: { ...target.metadata, progress: 90, progressIndeterminate: true, images } }]).percent, completed * 25);
    }
    assert.equal(generationQueueDisplay({ ...item, status: 'queued' }, [target]).percent, undefined);
});
test('single video progress follows its output and clamps invalid ranges', () => {
    const item = { nodeId: 'source', mode: 'video', status: 'running', startedAt: 100, targetNodeIds: ['result'] };
    for (const [progress, expected] of [[42, 42], [0, 0], [100, 100], [-10, 0], [120, 100], [Infinity, undefined]]) {
        assert.equal(generationQueueDisplay(item, [{ ...target, type: 'video', metadata: { ...target.metadata, progress } }]).percent, expected);
    }
    assert.equal(generationQueueDisplay(item, [target]).percent, undefined);
});

test('queued time never grows generation total or contributes to its stage distribution', () => {
    const record = { status: 'loading', startedAt: 1000, stages: [
        { name: '正在准备视频任务', startedAt: 1000, endedAt: 2000 },
        { name: '已提交，正在排队等待执行', startedAt: 2000 },
    ] };
    const copy = JSON.stringify(record);
    for (const now of [3000, 600000]) {
        const result = generationRecordTiming(record, now);
        assert.equal(result.total, 1000);
        assert.equal(result.waiting, now - 2000);
        assert.equal(result.queued, true);
        assert.deepEqual(result.stages.map(s => [s.name, s.elapsed]), [['正在准备视频任务', 1000]]);
    }
    assert.equal(JSON.stringify(record), copy);
});

test('starting and finishing the second task counts only its own execution after waiting', () => {
    const record = { status: 'loading', startedAt: 1000, stages: [
        { name: '已提交，正在排队等待执行', startedAt: 1000, endedAt: 601000 },
        { name: '后台已开始，正在生成视频', startedAt: 601000 },
    ] };
    const running = generationRecordTiming(record, 606000);
    assert.equal(running.total, 5000); assert.equal(running.waiting, 600000); assert.equal(running.queued, false);
    const done = { ...record, status: 'success', endedAt: 611000, stages: record.stages.map(s => ({ ...s, endedAt: s.endedAt ?? 611000 })) };
    for (const now of [611000, 999000]) {
        const result = generationRecordTiming(done, now);
        assert.equal(result.total, 10000); assert.equal(result.waiting, 600000);
        assert.equal(result.stages.reduce((sum, s) => sum + s.elapsed, 0), result.total);
    }
});

test('canceled queue and interrupted or legacy records retain truthful timing', () => {
    const canceled = generationRecordTiming({ status: 'canceled', startedAt: 1000, endedAt: 5000, stages: [{ name: '排队', startedAt: 1000, endedAt: 5000 }] }, 9000);
    assert.equal(canceled.total, 0); assert.equal(canceled.waiting, 4000); assert.equal(canceled.queued, false);
    const interrupted = generationRecordTiming({ status: 'interrupted', startedAt: 1000, stages: [{ name: '已提交，正在排队等待执行', startedAt: 1000 }] }, 9000);
    assert.equal(interrupted.total, undefined); assert.equal(interrupted.waiting, 0);
    const legacy = generationRecordTiming({ status: 'success', stages: [] }, 9000);
    assert.equal(legacy.total, undefined);
    // Missing historical events cannot establish that an old model-loading stage was waiting.
    const old = generationRecordTiming({ status: 'success', startedAt: 1000, endedAt: 5000, stages: [{ name: '正在准备采样（加载模型）', startedAt: 1000, endedAt: 5000 }] }, 9000);
    assert.equal(old.total, 4000); assert.equal(old.waiting, 0);
});

test('known upscale queue stages use the same waiting accounting', () => {
    for (const name of ['已提交，正在等待后台执行', '任务已提交，正在排队']) {
        const result = generationRecordTiming({ status: 'loading', startedAt: 1000, stages: [{ name, startedAt: 1000 }] }, 5000);
        assert.equal(result.total, 0); assert.equal(result.waiting, 4000); assert.equal(result.queued, true);
    }
});
