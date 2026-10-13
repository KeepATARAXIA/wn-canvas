const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

const output = {};
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/layout/wn-publish-content.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
new Function('exports', code)(output);
const { releaseNotesFromRecords } = output;
const header = '| 时间 | 本轮变化 | 用户可感知行为与兼容 | 验证与限制 |\n| --- | --- | --- | --- |';

test('release notes keep the real table columns and row order without engineering records', () => {
    const records = `工程前言：累计基线与冻结验收。\n\n${header}\n| 2026-10-11 11:31 | 简化资产界面与完整预览窗口 | 默认纯缩略图，hover/focus显示操作；完整筛选跨页切换与页码同步。 | 46项回归、SHA256、audits/report.md |\n| 2026-10-11 10:56 | 区分开发发布与用户正式更新 | 确认后开放完整Pages ZIP，控制台手动部署后公网逐项核验才本机登记。 | 101项回归、真实构建通过 |\n\n其他工程正文。`;
    assert.equal(releaseNotesFromRecords(records), '简化资产界面与完整预览窗口\n默认纯缩略图，hover/focus显示操作；完整筛选跨页切换与页码同步。\n\n区分开发发布与用户正式更新\n确认后开放完整Pages ZIP，控制台手动部署后公网逐项核验才本机登记。');
});

test('dated list records preserve user changes while excluding their verification and historical releases', () => {
    const records = '# Releases / 分发版本记录\n\n## Unreleased / 待打包\n旧版本已冻结，后续差异如下。\n\n- 2026-10-12 23:16：修复视频复制任务身份，副本使用自己的计时。保留旧作品与参数，无配置迁移。67/67相关回归、TypeScript通过。未真实GPU/打包。见audits/queue/REPORT.md。\n- 2026-10-12 22:10：增加 `A|B` 预览。\n  用户可以继续编辑。验证与限制：单测通过。\n\n## WN-20261012-01 / 已冻结\n- 2026-10-11 11:31：历史资产优化。12/12相关回归通过。';
    assert.equal(releaseNotesFromRecords(records), '修复视频复制任务身份，副本使用自己的计时。保留旧作品与参数，无配置迁移。\n\n增加 A|B 预览。用户可以继续编辑。');
});

test('frozen empty records and the first new dated change have stable outcomes', () => {
    const frozen = '已冻结历史条目，本区待新增差异。\n\n';
    assert.equal(releaseNotesFromRecords(frozen), '');
    assert.equal(releaseNotesFromRecords(frozen + '- 2026-10-13 10:01：首次新增用户变化。1项回归通过。'), '首次新增用户变化。');
    assert.equal(releaseNotesFromRecords('- 2026-10-13 10:01：'), '');
});

test('legacy table rows and new dated list records can share the same pending section', () => {
    const records = header + '\n| 今天 | 旧格式 | 保留用户行为。 | 验证 |\n\n- 2026-10-13 10:01：新增列表变化。验证与限制：通过。\n\n## WN-20261012-01\n' + header + '\n| 过去 | 已发布 | 历史行为。 | 验证 |';
    assert.equal(releaseNotesFromRecords(records), '旧格式\n保留用户行为。\n\n新增列表变化。');
});

test('a malformed dated record does not return a partial pending summary', () => {
    const good = '- 2026-10-13 10:02：保留完整用户变化。';
    for (const bad of ['- 2026-10-13 10:01：', '- 2026-10-13 10:01：`未闭合内容。']) assert.equal(releaseNotesFromRecords(good + '\n' + bad), '');
});

test('an Unreleased section yields recorded user changes without old releases or private records', () => {
    const records = `# Releases\n\n## Unreleased / 待打包\n下一次默认累计更新包说明。\n\n${header}\n| 2026-10-11 11:31 | 简化资产界面与完整预览窗口 | 默认纯缩略图，保留完整预览。 | audits/2026-10-11/report.md |\n| 2026-10-11 10:56 | 区分开发发布与用户正式更新 | 本机外部路径绑定身份，保留人工确认。 | 验证记录 |\n| 2026-10-08 11:00 | 扩宽项目/资产工作台与素材卡片分层 | 内容上限1280px。 | 验证记录 |\n\n## Previous / 上一版\n${header}\n| 2026-10-07 10:00 | 图片按钮按需显示与空白收回 | 旧版行为。 | 验证记录 |`;
    const section = records.match(/## Unreleased[^\n]*\n([\s\S]*?)(?=\n## |$)/)[1];
    const notes = releaseNotesFromRecords(section);
    assert.ok(notes.includes('简化资产界面与完整预览窗口\n默认纯缩略图'));
    assert.ok(notes.includes('区分开发发布与用户正式更新\n本机外部路径绑定身份'));
    assert.ok(notes.includes('扩宽项目/资产工作台与素材卡片分层\n内容上限1280px'));
    assert.equal(notes.includes('audits/2026-10-11/'), false);
    assert.equal(notes.includes('下一次默认累计更新包'), false);
    assert.equal(notes.includes('2026-10-11 11:31'), false);
    assert.equal(notes.includes('图片按钮按需显示与空白收回'), false);
    assert.equal(releaseNotesFromRecords(records), notes, 'a full document must not include frozen historical entries');
});

test('escaped pipes and inline code stay in their original column with code delimiters removed', () => {
    const row = '| 今天 | 调整 `A\\|B` | 保留 `left\\|right` 与路径 `C:\\canvas\\file`。 | 无需带入的校验 |';
    assert.equal(releaseNotesFromRecords(header + '\n' + row), '调整 A|B\n保留 left|right 与路径 C:\\canvas\\file。');
    assert.equal(releaseNotesFromRecords(header + '\n| 今天 | 左\\|右 | 可选\\|切换 | 校验 |'), '左|右\n可选|切换');
    assert.equal(releaseNotesFromRecords(header + '\n| 今天 | `A|B` | `left|right` | 校验 |'), 'A|B\nleft|right');
});

test('literal escaped backticks and nested inline-code ticks retain their text', () => {
    const row = '| 今天 | 保留\\`符号 | ``内容`原样`` 与 `\\\\server\\file` | 校验 |';
    assert.equal(releaseNotesFromRecords(header + '\n' + row), '保留`符号\n内容`原样 与 \\\\server\\file');
});

test('aligned headers, optional edge pipes and CRLF preserve the same user text', () => {
    const records = '时间 | 迭代 | 用户可感知变化与兼容影响 | 验证与限制\r\n:--- | :---: | ---: | ---\r\n今天 | 增加预览 | 原文件可完整浏览。 | 类型通过';
    assert.equal(releaseNotesFromRecords(records), '增加预览\n原文件可完整浏览。');
});

test('empty, ordinary prose and unrelated tables do not invent release notes', () => {
    for (const records of ['', '   \n\n', '# 待发布\n请填写说明。', '| 名称 | 内容 |\n| --- | --- |\n| 变化 | 描述 |', header]) assert.equal(releaseNotesFromRecords(records), '');
});

test('malformed and missing user columns return empty rather than a partial summary', () => {
    const good = '| 今天 | 新增功能 | 保留用户行为。 | 验证 |';
    for (const row of ['| 今天 | 缺少行为 | 验证 |', '| 今天 | | 行为 | 验证 |', '| 今天 | 标题 | | 验证 |', '| 今天 | `未闭合 | 行为 | 验证 |']) assert.equal(releaseNotesFromRecords(header + '\n' + good + '\n' + row), '');
});

test('long release notes remain complete for the UI to review and report its limit', () => {
    const behavior = '保留全部真实改动。'.repeat(1600);
    const notes = releaseNotesFromRecords(header + '\n| 今天 | 大批更新 | ' + behavior + ' | 验证 |');
    assert.ok(notes.length > 12000);
    assert.equal(notes, '大批更新\n' + behavior);
});
