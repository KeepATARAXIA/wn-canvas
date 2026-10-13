import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { REQUIRED_PATHS, LEGACY_REQUIRED_PATHS, SOURCE_CHECK_PATHS, configBytes, verifyPackage, checkBootstrap, applyBootstrap, rollbackBootstrap } from '../wn-bootstrap/core.mjs';
import { prepareFirstDownload } from '../wn-bootstrap/first-download.mjs';
import { prepareStartup, markStartupReady, confirmStartup, rollback as rollbackOnline } from '../wn-updater/core.mjs';
import { publishRelease } from '../wn-updater/publish.mjs';

const stopped = async () => {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const program = 'web/src/example.ts';
const h3 = 'extras/video-suite/ComfyUI/comfy_extras/nodes_minimax_h3.py';
const put = async (root, relative, bytes) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); };
const read = (root, name) => fs.readFile(path.join(root, name), 'utf8');
const exists = async (root, name) => fs.access(path.join(root, name)).then(() => true, () => false);

async function fixture(t, { legacy = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wn-bootstrap-test-中文路径 '));
  const project = path.join(directory, 'project'), packageDir = path.join(directory, 'package');
  await fs.mkdir(project); await fs.mkdir(packageDir);
  t.after(async () => {
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'wn-bootstrap-test-')));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = {
    format: 1, kind: 'wn-canvas-bootstrap', sourceVersion: 'WN-20260924-01',
    feedUrl: 'https://updates.example.test/stable/release.json',
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }), sourceChecks: [], files: [],
  };
  for (const name of [...(legacy ? LEGACY_REQUIRED_PATHS : REQUIRED_PATHS), h3]) {
    let bytes;
    if (legacy && name === 'scripts/wn-updater/core.mjs') bytes = Buffer.from('export const legacyUpdaterWithoutRoleImports = true;');
    else if (name.startsWith('scripts/wn-updater/')) bytes = await fs.readFile(new URL('../' + name.slice('scripts/'.length), import.meta.url));
    else if (name === '.wn-updates/config.json') bytes = configBytes(manifest);
    else bytes = Buffer.from('new known ' + name);
    const before = ['一键启动.cjs', 'scripts/show-comfy-console.ps1', h3].includes(name) ? Buffer.from('old ' + name) : null;
    if (before) await put(project, name, before);
    manifest.files.push({ path: name, before: before === null ? null : hash(before), after: { sha256: hash(bytes), size: bytes.length } });
    await put(packageDir, 'payload/' + name, bytes);
  }
  await put(project, 'VERSION', 'v0.19.0'); await put(project, 'web/package.json', '{"type":"module"}');
  for (const name of SOURCE_CHECK_PATHS) {
    const bytes = Buffer.from(name === 'web/package.json' ? '{"type":"module"}' : 'baseline dependency ' + name);
    await put(project, name, bytes); manifest.sourceChecks.push({ path: name, sha256: hash(bytes) });
  }
  await put(packageDir, 'manifest.json', JSON.stringify(manifest, null, 2));
  await put(project, 'WN-DISTRIBUTION-VERSION.json', '{"version":"WN-20260924-01","myRecord":true}');
  await put(project, 'user-data/config.json', 'my private configuration');
  await put(project, 'user-data/work.png', 'my artwork'); await put(project, 'extras/models/model.bin', 'my local model');
  await put(project, program, 'baseline source');
  return { directory, project, packageDir, manifest, privateKey };
}
async function original(f) {
  assert.equal(await read(f.project, '一键启动.cjs'), 'old 一键启动.cjs');
  assert.equal(await exists(f.project, 'scripts/wn-updater/core.mjs'), false);
  assert.equal(await exists(f.project, '.wn-updates/config.json'), false);
}
async function preserved(f) {
  assert.equal(await read(f.project, 'user-data/config.json'), 'my private configuration');
  assert.equal(await read(f.project, 'user-data/work.png'), 'my artwork');
  assert.equal(await read(f.project, 'extras/models/model.bin'), 'my local model');
  assert.equal(await read(f.project, program), 'baseline source');
  assert.equal(await read(f.project, 'WN-DISTRIBUTION-VERSION.json'), '{"version":"WN-20260924-01","myRecord":true}');
}

test('verify/check are read-only; bootstrap installs, repeats and restores only tracked recovery files', async t => {
  const f = await fixture(t);
  assert.equal((await verifyPackage(f.packageDir)).manifest.files.length, REQUIRED_PATHS.length + 1);
  assert.equal((await checkBootstrap(f.packageDir, f.project)).changes.length, REQUIRED_PATHS.length + 1);
  assert.equal(await exists(f.project, '.wn-bootstrap'), false);
  await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  assert.equal((await checkBootstrap(f.packageDir, f.project)).changes.length, 0);
  assert.equal((await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped })).applied, false);
  assert.equal(await exists(f.project, '.wn-updates/installed.json'), false);
  await preserved(f);
  await rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped }); await original(f); await preserved(f);
  assert.equal((await rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped })).rolledBack, false);
});

test('legacy bootstrap manifests remain valid without newer local role or publisher modules', async t => {
  const f = await fixture(t, { legacy: true });
  assert.equal((await verifyPackage(f.packageDir)).manifest.files.length, LEGACY_REQUIRED_PATHS.length + 1);
  await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  assert.equal(await exists(f.project, 'scripts/wn-updater/role.mjs'), false);
  assert.equal(await exists(f.project, 'scripts/wn-updater/publisher.mjs'), false);
  await rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  await original(f); await preserved(f);
});

for (const name of ['scripts/wn-updater/role.mjs', 'scripts/wn-updater/publisher.mjs']) test(`a newer core bootstrap refuses missing ${name} before modifying the installation`, async t => {
  const f = await fixture(t);
  f.manifest.files = f.manifest.files.filter(file => file.path !== name);
  await fs.unlink(path.join(f.packageDir, 'payload', name));
  await put(f.packageDir, 'manifest.json', JSON.stringify(f.manifest));
  await assert.rejects(applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /新版引导包缺少开发者\/用户端模块/);
  await original(f); await preserved(f);
  assert.equal(await exists(f.project, '.wn-bootstrap'), false);
});

test('external CLI verify/check run with Chinese and space paths without installing tools or creating state', async t => {
  const f = await fixture(t);
  for (const name of ['core.mjs', 'cli.mjs', 'first-download.mjs']) {
    await put(f.packageDir, name, await fs.readFile(new URL('../wn-bootstrap/' + name, import.meta.url)));
  }
  for (const args of [['verify'], ['check', '--project', f.project]]) {
    const result = spawnSync(process.execPath, [path.join(f.packageDir, 'cli.mjs'), ...args], { windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, String(result.stderr));
    assert.ok(JSON.parse(String(result.stdout)).id);
  }
  assert.equal(await exists(f.project, '.wn-bootstrap'), false);
  assert.equal(await exists(f.project, 'scripts/wn-bootstrap'), false);
  await original(f);
});

test('pre-existing identical trusted configuration survives bootstrap rollback', async t => {
  const f = await fixture(t), configuration = configBytes(f.manifest);
  await put(f.project, '.wn-updates/config.json', configuration);
  await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  await rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  assert.equal(await read(f.project, '.wn-updates/config.json'), configuration.toString());
  assert.equal(await exists(f.project, 'scripts/wn-updater/core.mjs'), false);
});

test('repeat apply cannot discard the original rollback paths when a committed file returns to source bytes', async t => {
  const f = await fixture(t); await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  const journal = await read(f.project, '.wn-bootstrap/transaction.json');
  await put(f.project, '一键启动.cjs', 'old 一键启动.cjs');
  await assert.rejects(applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /已安装的引导文件发生变化/);
  assert.equal(await read(f.project, '.wn-bootstrap/transaction.json'), journal);
  await put(f.project, '一键启动.cjs', 'new known 一键启动.cjs');
  await rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  await original(f);
});

for (const [name, mutate, message] of [
  ['customized launcher', f => put(f.project, '一键启动.cjs', 'customized launcher'), /来源文件冲突/],
  ['missing source launcher', f => fs.unlink(path.join(f.project, '一键启动.cjs')), /来源文件冲突/],
  ['occupied new updater file', f => put(f.project, 'scripts/wn-updater/core.mjs', 'my existing tool'), /来源文件冲突/],
  ['directory occupying a file', f => fs.mkdir(path.join(f.project, 'scripts/wn-updater/core.mjs'), { recursive: true }), /非文件占用/],
  ['different trusted public key', async f => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    await put(f.project, '.wn-updates/config.json', JSON.stringify({ feedUrl: f.manifest.feedUrl, publicKey: other }));
  }, /已有更新配置/],
  ['different distribution version', f => put(f.project, 'WN-DISTRIBUTION-VERSION.json', '{"version":"WN-20260921-01"}'), /仅支持/],
]) test(`whole preflight protects ${name} before any bootstrap writes`, async t => {
  const f = await fixture(t); await mutate(f);
  await assert.rejects(applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), message);
  assert.equal(await exists(f.project, 'scripts/wn-updater/files.mjs'), false);
  assert.equal(await read(f.project, 'scripts/show-comfy-console.ps1'), 'old scripts/show-comfy-console.ps1');
});

test('missing distribution marker relies on actual source hashes and remains missing', async t => {
  const f = await fixture(t); await fs.unlink(path.join(f.project, 'WN-DISTRIBUTION-VERSION.json'));
  await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  assert.equal(await exists(f.project, 'WN-DISTRIBUTION-VERSION.json'), false);
});

for (const dependency of SOURCE_CHECK_PATHS) test(`read-only dependency baseline refuses incompatible ${dependency} without installing dependencies`, async t => {
  const f = await fixture(t); await put(f.project, dependency, 'locally customized dependency');
  await assert.rejects(applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /来源依赖校验失败/);
  assert.equal(await read(f.project, dependency), 'locally customized dependency');
  assert.equal(await exists(f.project, '.wn-bootstrap'), false); await original(f);
});

test('dependency baseline requires all four exact paths; missing source lockfile is refused', async t => {
  const f = await fixture(t); f.manifest.sourceChecks.pop();
  await put(f.packageDir, 'manifest.json', JSON.stringify(f.manifest));
  await assert.rejects(verifyPackage(f.packageDir), /四项只读来源依赖校验/);
  const f2 = await fixture(t); await fs.unlink(path.join(f2.project, 'web/package-lock.json'));
  await assert.rejects(checkBootstrap(f2.packageDir, f2.project), /来源依赖校验失败/);
  assert.equal(await exists(f2.project, '.wn-bootstrap'), false);
});

test('payload corruption and unexpected payload files are refused before target mutation', async t => {
  const f = await fixture(t);
  await put(f.packageDir, 'payload/scripts/wn-updater/core.mjs', 'damaged payload');
  await assert.rejects(applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /载荷校验失败/);
  await original(f); assert.equal(await exists(f.project, '.wn-bootstrap'), false);
  const f2 = await fixture(t); await put(f2.packageDir, 'payload/private.pem', 'must not ship');
  await assert.rejects(verifyPackage(f2.packageDir), /载荷文件范围/);
});

test('manifest cannot expand allowlist, delete recovery files, duplicate paths or fake launcher baseline', async t => {
  for (const edit of [
    m => { m.files[0].path = '../secrets'; },
    m => { m.files[0].after = null; },
    m => { m.files[0] = m.files[1]; },
    m => { m.files.find(f => f.path === '一键启动.cjs').before = null; },
    m => { m.files.find(f => f.path === '.wn-updates/config.json').before = 'a'.repeat(64); },
    m => { m.feedUrl = 'http://example.test/release.json'; },
  ]) {
    const f = await fixture(t); edit(f.manifest); await put(f.packageDir, 'manifest.json', JSON.stringify(f.manifest));
    await assert.rejects(verifyPackage(f.packageDir)); await original(f);
  }
});

test('target and payload junctions cannot escape the trusted directories', async t => {
  const f = await fixture(t), outside = path.join(f.directory, 'outside'); await fs.mkdir(outside);
  await fs.mkdir(path.join(f.project, 'scripts/wn-updater'), { recursive: true });
  await fs.rename(path.join(f.project, 'scripts/wn-updater'), path.join(f.project, 'scripts/saved-updater'));
  await fs.symlink(outside, path.join(f.project, 'scripts/wn-updater'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /链接/);
  assert.deepEqual(await fs.readdir(outside), []);
  const f2 = await fixture(t);
  await fs.rename(path.join(f2.packageDir, 'payload/scripts'), path.join(f2.directory, 'external-payload'));
  await fs.symlink(path.join(f2.directory, 'external-payload'), path.join(f2.packageDir, 'payload/scripts'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyPackage(f2.packageDir), /链接/);
});

test('known busy-service result blocks apply without ending a process', async t => {
  const f = await fixture(t);
  await assert.rejects(applyBootstrap(f.packageDir, f.project, { ensureStopped: async () => { throw new Error('test service busy'); } }), /service busy/);
  await original(f);
});

test('bootstrap and online locks serialize concurrent mutations', async t => {
  const f = await fixture(t);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const first = applyBootstrap(f.packageDir, f.project, { ensureStopped: async () => { entered(); await gate; } });
  await ready;
  await assert.rejects(applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /操作正在进行/);
  release(); await first;
  await put(f.project, '.wn-updates/lock.json', JSON.stringify({ pid: process.pid }));
  await assert.rejects(rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /操作正在进行/);
  await fs.unlink(path.join(f.project, '.wn-updates/lock.json'));
});

test('mid-apply failure restores source files and leaves no invented online version', async t => {
  const f = await fixture(t);
  await assert.rejects(applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped, afterWrite: () => { throw new Error('simulated failure'); } }), /simulated failure/);
  await original(f); await preserved(f);
  assert.equal(JSON.parse(await read(f.project, '.wn-bootstrap/transaction.json')).status, 'rolled-back');
  assert.equal(await exists(f.project, '.wn-updates/installed.json'), false);
});

test('actual terminated apply is recovered before another installation using retained journal and stale locks', async t => {
  const f = await fixture(t), moduleUrl = new URL('../wn-bootstrap/core.mjs', import.meta.url).href;
  const script = `import {applyBootstrap} from ${JSON.stringify(moduleUrl)}; await applyBootstrap(process.env.WN_BOOTSTRAP_PACKAGE,process.env.WN_BOOTSTRAP_PROJECT,{ensureStopped:async()=>{},afterWrite:()=>process.exit(23)});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, WN_BOOTSTRAP_PACKAGE: f.packageDir, WN_BOOTSTRAP_PROJECT: f.project }, windowsHide: true, timeout: 15000 });
  assert.equal(child.status, 23, String(child.stderr));
  await assert.rejects(checkBootstrap(f.packageDir, f.project), /未结束引导事务/);
  assert.equal((await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped })).rolledBack, true);
  await original(f); await preserved(f);
  assert.equal((await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped })).applied, true);
});

test('rollback validates all backups and protects edits made after installation', async t => {
  const f = await fixture(t); await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  await put(f.project, 'scripts/show-comfy-console.ps1', 'user edit');
  await assert.rejects(rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /又被修改/);
  assert.equal(await exists(f.project, 'scripts/wn-updater/core.mjs'), true);
  await put(f.project, 'scripts/show-comfy-console.ps1', 'new known scripts/show-comfy-console.ps1');
  const { id } = await verifyPackage(f.packageDir);
  await put(f.project, `.wn-bootstrap/backups/${id}/一键启动.cjs`, 'bad backup');
  await assert.rejects(rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /备份校验/);
  assert.equal(await exists(f.project, '.wn-updates/config.json'), true);
});

for (const [name, file, value] of [
  ['pending online update', 'pending.json', '{"id":"pending"}'],
  ['unfinished online transaction', 'transaction.json', '{"status":"awaiting-start"}'],
  ['confirmed online version', 'installed.json', '{"version":"WN-20261007-01"}'],
]) test(`bootstrap rollback refuses ${name} while retaining updater recovery`, async t => {
  const f = await fixture(t); await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  await put(f.project, '.wn-updates/' + file, value);
  await assert.rejects(rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /在线更新|在线版本/);
  assert.equal(await exists(f.project, 'scripts/wn-updater/core.mjs'), true);
});

test('first download uses real signed release and existing service; programs install only at later controlled startup', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareFirstDownload(f.packageDir, f.project), /先完成引导/);
  await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  const target = path.join(f.directory, 'target'), out = path.join(f.directory, 'published'); await fs.mkdir(target);
  await put(target, program, 'genuine updated source');
  await publishRelease({ baseRoot: f.project, targetRoot: target, outDir: out, files: [program], fromVersion: 'WN-20260924-01', version: 'WN-20261007-01', notes: 'test actual changed program', privateKey: f.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const fetchImpl = async url => {
    const name = new URL(url).pathname.replace('/stable/', '');
    const bytes = await fs.readFile(path.join(out, name)); return new Response(bytes);
  };
  const previousFetch = globalThis.fetch;
  let result;
  try {
    globalThis.fetch = fetchImpl;
    result = await prepareFirstDownload(f.packageDir, f.project);
  } finally { globalThis.fetch = previousFetch; }
  assert.equal(result.ready, true); assert.equal(await read(f.project, program), 'baseline source');
  assert.equal(await exists(f.project, '.wn-updates/installed.json'), false);
  const startup = await prepareStartup(f.project, { ensureStopped: stopped });
  await markStartupReady(f.project, startup.id); await confirmStartup(f.project, startup.id);
  assert.equal(await read(f.project, program), 'genuine updated source');
  await assert.rejects(rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped }), /先回滚在线/);
  await rollbackOnline(f.project, { ensureStopped: stopped });
  await rollbackBootstrap(f.packageDir, f.project, { ensureStopped: stopped }); await original(f); await preserved(f);
});

test('first download cannot execute locally replaced updater code or treat a failed download as ready', async t => {
  const f = await fixture(t); await applyBootstrap(f.packageDir, f.project, { ensureStopped: stopped });
  let called = false;
  await put(f.project, 'scripts/wn-updater/core.mjs', 'unknown replaced code');
  await assert.rejects(prepareFirstDownload(f.packageDir, f.project, { createService: () => { called = true; } }), /来源文件冲突/);
  assert.equal(called, false);
  const f2 = await fixture(t); await applyBootstrap(f2.packageDir, f2.project, { ensureStopped: stopped });
  await assert.rejects(prepareFirstDownload(f2.packageDir, f2.project, { createService: () => ({
    status: async () => ({}), check: async () => ({ release: { id: 'a'.repeat(64) } }),
    stage: () => ({}), wait: async () => ({ phase: 'error', pending: null, error: 'network unavailable' }),
  }) }), /network unavailable/);
});
