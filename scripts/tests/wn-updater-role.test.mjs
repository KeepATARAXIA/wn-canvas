import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { STATE, readBytes, readJson, writeBytes, writeJson, programPath } from '../wn-updater/files.mjs';
import { createUpdateService, prepareStartup, markStartupReady, confirmStartup } from '../wn-updater/core.mjs';
import { publishRelease } from '../wn-updater/publish.mjs';
import { publisherProfilePath } from '../wn-updater/role.mjs';

const filename = 'web/src/demo.ts';
const developer = (root, profileDirectory) => writeJson(profileDirectory, path.basename(publisherProfilePath(root, { profileDirectory })), { format: 1, mode: 'developer', root });
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wn-updater-role-test-'));
  const base = path.join(directory, 'base'), target = path.join(directory, 'target'), root = path.join(directory, 'user'), out = path.join(directory, 'published'), profileDirectory = path.join(directory, 'publisher-profiles');
  for (const location of [base, target, root, profileDirectory]) await fs.mkdir(location);
  await writeBytes(base, filename, 'old code');
  await writeBytes(root, filename, 'old code');
  await writeBytes(target, filename, 'new code');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const published = await publishRelease({ baseRoot: base, targetRoot: target, outDir: out, files: [filename], fromVersion: 'WN-20260924-01', version: 'WN-20261007-01', notes: '正式版本', privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) });
  await writeJson(root, `${STATE}/config.json`, { feedUrl: 'https://updates.example/stable/release.json', publicKey: publicKey.export({ format: 'pem', type: 'spki' }) });
  const requests = [];
  let onDownload = async () => {};
  const service = createUpdateService(root, { profileDirectory, fetchImpl: async url => {
    requests.push(String(url));
    const relative = String(url).endsWith('release.json') ? 'release.json' : `files/${String(url).split('/').pop()}`;
    if (relative !== 'release.json') await onDownload();
    return new Response(await readBytes(out, relative));
  } });
  const stage = async () => { const checked = await service.check(); service.stage(checked.release.id); return service.wait(); };
  t.after(async () => {
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'wn-updater-role-test-')));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, root, out, target, profileDirectory, published, service, requests, stage, developer: () => developer(root, profileDirectory), onDownload: fn => { onDownload = fn; } };
}

test('user mode is the default, including locally edited copies', async t => {
  const f = await fixture(t);
  await writeBytes(f.root, filename, 'local customization');
  await writeJson(f.root, `${STATE}/developer.json`, { format: 1, mode: 'developer' });
  const state = await f.service.status();
  assert.equal(state.mode, 'user');
  assert.equal(state.compatibility, null);
  assert.deepEqual(await fs.readdir(f.profileDirectory), []);
});

test('an explicit developer marker blocks check before accessing the feed', async t => {
  const f = await fixture(t); await f.developer();
  assert.equal((await f.service.status()).mode, 'developer');
  await assert.rejects(f.service.check(), /开发模式/);
  assert.deepEqual(f.requests, []);
});

test('copying the project does not copy developer permissions to another installation path', async t => {
  const f = await fixture(t); await f.developer();
  const copied = path.join(f.directory, 'copied-user'); await fs.cp(f.root, copied, { recursive: true });
  assert.equal((await f.service.status()).mode, 'developer');
  assert.equal((await createUpdateService(copied, { profileDirectory: f.profileDirectory }).status()).mode, 'user');
  assert.equal(await readJson(copied, `${STATE}/developer.json`), null);
});

test('switching to developer mode immediately blocks direct download, cancel and confirmation calls', async t => {
  const f = await fixture(t); const checked = await f.service.check(); await f.developer();
  assert.throws(() => f.service.stage(checked.release.id), /开发模式/);
  await assert.rejects(f.service.cancel(), /开发模式/);
  await assert.rejects(f.service.confirm(f.published.id), /开发模式/);
  await assert.rejects(confirmStartup(f.root, f.published.id, { profileDirectory: f.profileDirectory }), /开发模式/);
  await assert.rejects(markStartupReady(f.root, f.published.id, { profileDirectory: f.profileDirectory }), /开发模式/);
  assert.equal(f.requests.length, 1);
  assert.equal(await readJson(f.root, `${STATE}/pending.json`), null);
});

test('developer mode starts normally with no installation pending', async t => {
  const f = await fixture(t); await f.developer();
  let stoppedChecks = 0;
  assert.deepEqual(await prepareStartup(f.root, { profileDirectory: f.profileDirectory, ensureStopped: async () => { stoppedChecks++; } }), { restart: false });
  assert.equal(stoppedChecks, 0);
  assert.equal((await readBytes(f.root, filename)).toString(), 'old code');
});

test('a staged official package blocks developer startup without discarding or applying it', async t => {
  const f = await fixture(t); assert.equal((await f.stage()).phase, 'ready'); await f.developer();
  let stoppedChecks = 0;
  await assert.rejects(prepareStartup(f.root, { profileDirectory: f.profileDirectory, ensureStopped: async () => { stoppedChecks++; } }), /开发模式.*待安装.*先恢复用户模式.*取消尚未安装.*事务.*恢复或回滚/);
  assert.equal(stoppedChecks, 0);
  assert.equal((await readJson(f.root, `${STATE}/pending.json`)).id, f.published.id);
  assert.equal(await readJson(f.root, `${STATE}/transaction.json`), null);
  assert.equal((await readBytes(f.root, filename)).toString(), 'old code');
});

for (const status of ['applying', 'awaiting-start', 'awaiting-browser']) test(`developer startup reports an unfinished ${status} transaction without silently restoring it`, async t => {
  const f = await fixture(t); await f.developer();
  const journal = { id: f.published.id, status, paths: [filename], previous: null };
  await writeJson(f.root, `${STATE}/transaction.json`, journal);
  await assert.rejects(prepareStartup(f.root, { profileDirectory: f.profileDirectory, ensureStopped: async () => {} }), /开发模式.*未确认.*先恢复用户模式.*事务.*恢复或回滚/);
  assert.deepEqual(await readJson(f.root, `${STATE}/transaction.json`), journal);
  assert.equal((await readBytes(f.root, filename)).toString(), 'old code');
});

test('role changes during download cannot leave a package ready for developer installation', async t => {
  const f = await fixture(t);
  f.onDownload(() => f.developer());
  const state = await f.stage();
  assert.equal(state.mode, 'developer');
  assert.equal(state.phase, 'error');
  assert.match(state.error, /开发模式/);
  assert.equal(state.pending, null);
  assert.equal((await readBytes(f.root, filename)).toString(), 'old code');
});

test('role changes while stopping services are rechecked before applying files', async t => {
  const f = await fixture(t); assert.equal((await f.stage()).phase, 'ready');
  await assert.rejects(prepareStartup(f.root, { profileDirectory: f.profileDirectory, ensureStopped: () => f.developer() }), /开发模式/);
  assert.equal(await readJson(f.root, `${STATE}/transaction.json`), null);
  assert.equal((await readBytes(f.root, filename)).toString(), 'old code');
});

test('checking a conflicting user copy returns read-only compatibility details without downloading payload', async t => {
  const f = await fixture(t); await writeBytes(f.root, filename, 'local customization');
  const state = await f.service.check();
  assert.equal(state.phase, 'available');
  assert.equal(state.compatibility.compatible, false);
  assert.match(state.compatibility.message, /冲突/);
  assert.equal(f.requests.length, 1);
  assert.equal(await readJson(f.root, `${STATE}/pending.json`), null);
  assert.equal((await readBytes(f.root, filename)).toString(), 'local customization');
  f.service.stage(state.release.id);
  assert.match((await f.service.wait()).error, /冲突/);
  assert.equal(f.requests.length, 1);
});

test('user download and startup still recheck edits made after successful compatibility checking', async t => {
  const f = await fixture(t); const checked = await f.service.check();
  assert.equal(checked.compatibility.compatible, true);
  await writeBytes(f.root, filename, 'later local edit');
  f.service.stage(checked.release.id);
  assert.match((await f.service.wait()).error, /冲突/);
  assert.equal(await readJson(f.root, `${STATE}/pending.json`), null);
  assert.equal((await readBytes(f.root, filename)).toString(), 'later local edit');
});

test('unsupported user versions are explained at check time without claiming install compatibility', async t => {
  const f = await fixture(t);
  await writeJson(f.root, `${STATE}/installed.json`, { version: 'WN-20260925-01', id: 'a'.repeat(64) });
  const state = await f.service.check();
  assert.equal(state.compatibility.compatible, false);
  assert.match(state.compatibility.message, /仅支持 WN-20260924-01/);
  assert.equal(f.requests.length, 1);
});

test('a damaged developer marker fails closed rather than silently becoming a user copy', async t => {
  const f = await fixture(t);
  await writeJson(f.profileDirectory, path.basename(publisherProfilePath(f.root, { profileDirectory: f.profileDirectory })), { format: 1, mode: 'user', root: f.root });
  await assert.rejects(f.service.status(), /开发模式标记/);
  await assert.rejects(f.service.check(), /开发模式标记/);
  await assert.rejects(prepareStartup(f.root, { profileDirectory: f.profileDirectory, ensureStopped: async () => {} }), /开发模式标记/);
  assert.deepEqual(f.requests, []);
});

test('a profile bound to a different absolute root cannot enable or silently fall back from developer mode', async t => {
  const f = await fixture(t);
  await writeJson(f.profileDirectory, path.basename(publisherProfilePath(f.root, { profileDirectory: f.profileDirectory })), { format: 1, mode: 'developer', root: f.target });
  await assert.rejects(f.service.status(), /开发模式标记.*不匹配/);
  await assert.rejects(f.service.check(), /开发模式标记.*不匹配/);
  assert.deepEqual(f.requests, []);
});

test('external publisher profile directories cannot redirect reads through a junction', async t => {
  const f = await fixture(t); await f.developer();
  const external = path.join(f.directory, 'external-profiles'); await fs.mkdir(external);
  await fs.rename(f.profileDirectory, path.join(f.directory, 'saved-profiles'));
  await fs.symlink(external, f.profileDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.service.status(), /链接/);
  await assert.rejects(f.service.check(), /链接/);
  assert.deepEqual(await fs.readdir(external), []);
});

test('developer markers cannot be linked to or included in a signed update payload', async t => {
  const f = await fixture(t);
  const external = path.join(f.directory, 'external'); await fs.mkdir(external);
  await fs.rename(path.join(f.root, STATE), path.join(f.root, 'saved-state'));
  await fs.symlink(external, path.join(f.root, STATE), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.service.status(), /链接/);
  assert.throws(() => programPath(`${STATE}/developer.json`), /不允许/);
  assert.deepEqual(await fs.readdir(external), []);
});
