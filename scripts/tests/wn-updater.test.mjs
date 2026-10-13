import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { STATE, digest, programPath, decodeRelease, loadConfig, readJson, writeJson, writeBytes, readBytes, validateRelease } from '../wn-updater/files.mjs';
import { publishRelease } from '../wn-updater/publish.mjs';
import { createUpdateService, prepareStartup, markStartupReady, confirmStartup, rollback } from '../wn-updater/core.mjs';
import { updaterMiddleware } from '../../web/local-updater.mjs';

const stopped = async () => {};
const oldVersion = 'WN-20260921-01', newVersion = 'WN-20261004-01';
const files = ['web/src/demo.ts', 'web/src/added.ts', 'web/src/deleted.ts'];
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wn-updater-test-'));
  const base = path.join(directory, 'base'), target = path.join(directory, 'target'), root = path.join(directory, 'installed'), out = path.join(directory, 'published');
  for (const location of [base, target, root]) await fs.mkdir(location);
  for (const location of [base, root]) {
    await writeBytes(location, files[0], 'old code'); await writeBytes(location, files[2], 'obsolete code');
    await writeBytes(location, 'user-data/config.json', 'private user data');
    await writeBytes(location, 'extras/models/model.bin', 'large model placeholder');
  }
  await writeBytes(target, files[0], 'new code'); await writeBytes(target, files[1], 'added code');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ format: 'pem', type: 'spki' }), privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const published = await publishRelease({ baseRoot: base, targetRoot: target, outDir: out, files, fromVersion: oldVersion, version: newVersion, notes: '本地演练：新增、修改和删除程序文件。', privateKey: privatePem });
  let corrupt = false, unavailable = false;
  const server = createServer(async (req, res) => {
    if (unavailable) { res.writeHead(503).end(); return; }
    const relative = req.url === '/release.json' ? 'release.json' : /^\/files\/[a-f0-9]{64}$/.test(req.url) ? req.url.slice(1) : null;
    if (!relative) { res.writeHead(404).end(); return; }
    const content = await readBytes(out, relative);
    if (!content) res.writeHead(404).end();
    else res.end(corrupt && relative !== 'release.json' ? Buffer.from('damaged payload') : content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/release.json`;
  await writeJson(root, `${STATE}/config.json`, { feedUrl: url, publicKey: publicPem, allowLocalFeed: true });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    // The test owns this freshly created absolute temp directory only.
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'wn-updater-test-')));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const service = createUpdateService(root);
  const stage = async () => { const state = await service.check(); service.stage(state.release.id); const ready = await service.wait(); assert.equal(ready.phase, 'ready', ready.error); return ready; };
  const apply = async () => {
    const result = await prepareStartup(root, { ensureStopped: stopped });
    if (result.restart) {
      await assert.rejects(confirmStartup(root, result.id), /后台尚未就绪/);
      await markStartupReady(root, result.id);
      await confirmStartup(root, result.id);
    }
    return result;
  };
  return { directory, root, base, target, out, publicPem, privatePem, published, service, stage, apply, corrupt: value => { corrupt = value; }, unavailable: value => { unavailable = value; } };
}

test('signed release downloads, installs on clean startup, confirms, repeats safely and rolls back', async t => {
  const f = await fixture(t);
  await f.stage();
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
  await f.apply();
  assert.equal((await readBytes(f.root, files[0])).toString(), 'new code');
  assert.equal((await readBytes(f.root, files[1])).toString(), 'added code');
  assert.equal(await readBytes(f.root, files[2]), null);
  assert.equal((await f.service.check()).phase, 'current');
  assert.equal((await readJson(f.root, `${STATE}/installed.json`)).version, newVersion);
  assert.deepEqual(await prepareStartup(f.root, { ensureStopped: stopped }), { restart: false });
  // Simulate a crash between confirming the transaction and removing pending.json.
  await writeJson(f.root, `${STATE}/pending.json`, { id: f.published.id });
  assert.deepEqual(await prepareStartup(f.root, { ensureStopped: stopped }), { restart: false });
  await rollback(f.root, { ensureStopped: stopped });
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
  assert.equal(await readBytes(f.root, files[1]), null);
  assert.equal((await readBytes(f.root, files[2])).toString(), 'obsolete code');
  assert.equal((await readBytes(f.root, 'user-data/config.json')).toString(), 'private user data');
  assert.equal((await readBytes(f.root, 'extras/models/model.bin')).toString(), 'large model placeholder');
});

test('no configured feed is reported honestly and creates no updater state', async t => {
  const f = await fixture(t);
  const service = createUpdateService(f.target);
  assert.equal((await service.check()).configured, false);
  assert.equal(await readBytes(f.target, `${STATE}/config.json`), null);
  assert.throws(() => service.stage('a'.repeat(64)), /检查更新/);
});

test('unreachable feed never reports current or modifies program files', async t => {
  const f = await fixture(t); f.unavailable(true);
  await assert.rejects(f.service.check(), /503/);
  assert.equal((await f.service.status()).phase, 'error');
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
});

test('signature mismatch is rejected before any payload is downloaded', async t => {
  const f = await fixture(t);
  const envelope = JSON.parse((await readBytes(f.out, 'release.json')).toString());
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString()); payload.notes = 'tampered';
  envelope.payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  await writeJson(f.out, 'release.json', envelope);
  await assert.rejects(f.service.check(), /签名/);
  assert.equal(await readJson(f.root, `${STATE}/pending.json`), null);
});

test('corrupt payload cannot become pending and a retry succeeds', async t => {
  const f = await fixture(t); f.corrupt(true);
  const checked = await f.service.check(); f.service.stage(checked.release.id);
  const failed = await f.service.wait(); assert.equal(failed.phase, 'error'); assert.equal(failed.pending, null);
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
  f.corrupt(false); await f.stage();
});

for (const [name, mutate] of [
  ['local edit', async f => writeBytes(f.root, files[0], 'my customization')],
  ['occupied new path', async f => writeBytes(f.root, files[1], 'my existing script')],
  ['missing old path', async f => fs.unlink(path.join(f.root, files[0]))],
]) test(`preflight rejects ${name} before writing any program file`, async t => {
  const f = await fixture(t); await mutate(f);
  const checked = await f.service.check(); f.service.stage(checked.release.id);
  const state = await f.service.wait(); assert.equal(state.phase, 'error'); assert.match(state.error, /冲突/);
  assert.equal((await readBytes(f.root, files[2])).toString(), 'obsolete code');
  assert.equal(state.pending, null);
});

test('edit after download is checked again at install time', async t => {
  const f = await fixture(t); await f.stage(); await writeBytes(f.root, files[0], 'later edit');
  await assert.rejects(f.apply(), /冲突/);
  assert.equal((await readBytes(f.root, files[0])).toString(), 'later edit');
  assert.equal(await readBytes(f.root, files[1]), null);
});

test('cached payload is revalidated before backups or installation', async t => {
  const f = await fixture(t); await f.stage();
  await writeBytes(f.root, `${STATE}/packages/${f.published.id}/files/${digest(Buffer.from('new code'))}`, 'corrupted cache');
  await assert.rejects(f.apply(), /缓存损坏/);
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
});

test('running services prevent installation without stopping them', async t => {
  const f = await fixture(t); await f.stage();
  await assert.rejects(prepareStartup(f.root, { ensureStopped: async () => { throw new Error('service busy'); } }), /service busy/);
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
  assert.ok((await f.service.status()).pending);
});

test('failure in the middle of apply restores all original files', async t => {
  const f = await fixture(t); await f.stage();
  await assert.rejects(prepareStartup(f.root, { ensureStopped: stopped, afterWrite: () => { throw new Error('simulated disk failure'); } }), /simulated/);
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
  assert.equal(await readBytes(f.root, files[1]), null);
  assert.equal((await readJson(f.root, `${STATE}/transaction.json`)).status, 'rolled-back');
});

test('unconfirmed startup automatically rolls back on the next clean launch', async t => {
  const f = await fixture(t); await f.stage();
  const first = await prepareStartup(f.root, { ensureStopped: stopped }); assert.equal(first.restart, true);
  assert.equal(await readJson(f.root, `${STATE}/installed.json`), null);
  assert.equal((await prepareStartup(f.root, { ensureStopped: stopped })).rolledBack, true);
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
});

test('actual process termination during apply is recovered using the journal and stale lock', async t => {
  const f = await fixture(t); await f.stage();
  const coreUrl = new URL('../wn-updater/core.mjs', import.meta.url).href;
  const script = `import {prepareStartup} from ${JSON.stringify(coreUrl)}; await prepareStartup(process.env.WN_TEST_ROOT,{ensureStopped:async()=>{},afterWrite:()=>process.exit(23)});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, WN_TEST_ROOT: f.root }, windowsHide: true, timeout: 15000 });
  assert.equal(child.status, 23, String(child.stderr));
  const restored = await prepareStartup(f.root, { ensureStopped: stopped });
  assert.equal(restored.rolledBack, true);
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
});

test('rollback refuses to overwrite post-update edits and validates all backups first', async t => {
  const f = await fixture(t); await f.stage(); await f.apply();
  await writeBytes(f.root, files[1], 'user edit after update');
  await assert.rejects(rollback(f.root, { ensureStopped: stopped }), /又被修改/);
  assert.equal((await readBytes(f.root, files[0])).toString(), 'new code');
  await writeBytes(f.root, files[1], 'added code');
  await writeBytes(f.root, `${STATE}/backups/${f.published.id}/${files[0]}`, 'damaged backup');
  await assert.rejects(rollback(f.root, { ensureStopped: stopped }), /备份校验/);
  assert.equal((await readBytes(f.root, files[0])).toString(), 'new code');
});

test('unsupported installed versions are refused; publisher cannot overwrite a release', async t => {
  const f = await fixture(t);
  await writeJson(f.root, `${STATE}/installed.json`, { version: 'WN-20260924-01', id: 'a'.repeat(64) });
  const checked = await f.service.check(); f.service.stage(checked.release.id);
  assert.match((await f.service.wait()).error, /仅支持/);
  await assert.rejects(publishRelease({ baseRoot: f.base, targetRoot: f.target, outDir: f.out, files, fromVersion: oldVersion, version: newVersion, notes: '', privateKey: f.privatePem }), /EEXIST/);
});

test('a remote HTTP feed is never accepted as a local rehearsal', async t => {
  const f = await fixture(t);
  await writeJson(f.root, `${STATE}/config.json`, { feedUrl: 'http://example.com/release.json', allowLocalFeed: true, publicKey: f.publicPem });
  await assert.rejects(loadConfig(f.root), /HTTPS/);
});

test('cancel removes only the pending request, preserving reusable download files', async t => {
  const f = await fixture(t); await f.stage(); await f.service.cancel();
  assert.equal((await f.service.status()).pending, null);
  assert.ok(await readBytes(f.root, `${STATE}/packages/${f.published.id}/release.json`));
  assert.equal((await readBytes(f.root, files[0])).toString(), 'old code');
});

test('concurrent downloads are serialized and cannot replace an in-flight selection', async t => {
  const f = await fixture(t); const state = await f.service.check(); f.service.stage(state.release.id);
  assert.throws(() => f.service.stage(state.release.id), /正在/);
  await assert.rejects(f.service.cancel(), /正在/);
  assert.equal((await f.service.wait()).phase, 'ready');
});

test('paths reject traversal, absolute paths, user data, alternate streams and Windows aliases', () => {
  for (const name of ['../secret', '/web/src/a', 'C:/web/src/a', 'web/src/../x', 'web/src/a:stream', 'web/src/AUX.txt', 'web/src/a.', 'web\\src\\a', 'extras/models/a', 'AGENTS.md', 'web/node_modules/a', '.wn-updates/config.json', 'web/src/.env.local', '一键启动.cjs', 'scripts/wn-updater/core.mjs']) assert.throws(() => programPath(name), undefined, name);
  assert.equal(programPath('web/src/components/画布.tsx'), 'web/src/components/画布.tsx');
});

test('signed manifests reject case collisions and file/parent path collisions', async t => {
  const f = await fixture(t);
  const base = decodeRelease(await readBytes(f.out, 'release.json'), f.publicPem).release;
  assert.throws(() => validateRelease({ ...base, files: [base.files[0], { ...base.files[0], path: 'web/src/DEMO.ts' }] }), /重复/);
  assert.throws(() => validateRelease({ ...base, files: [base.files[0], { ...base.files[0], path: 'web/src/demo.ts/child' }] }), /目录路径冲突/);
});

test('junctions cannot redirect program writes outside the installation', async t => {
  const f = await fixture(t); await f.stage();
  const external = path.join(f.directory, 'outside'); await fs.mkdir(external);
  await fs.rename(path.join(f.root, 'web/src'), path.join(f.root, 'web/saved-src'));
  await fs.symlink(external, path.join(f.root, 'web/src'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.apply(), /链接/);
  assert.deepEqual(await fs.readdir(external), []);
});

test('HTTP API enforces local host, origin, operation headers and methods', async t => {
  const f = await fixture(t), middleware = updaterMiddleware(f.service);
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404).end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/wn-update/`;
  const request = (endpoint, options) => fetch(base + endpoint, options);
  assert.equal((await request('status')).status, 200);
  assert.equal((await request('check')).status, 405);
  assert.equal((await request('check', { method: 'POST' })).status, 403);
  assert.equal((await request('check', { method: 'POST', headers: { 'x-wn-update-action': 'check', origin: 'https://attacker.example' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(base + 'status', { headers: { host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHostStatus, 403);
  const checked = await request('check', { method: 'POST', headers: { 'x-wn-update-action': 'check' } });
  assert.equal(checked.status, 200); assert.equal(checked.headers.get('cache-control'), 'no-store');
  const state = await checked.json();
  assert.equal((await request('stage', { method: 'POST', headers: { 'x-wn-update-action': 'stage', 'x-wn-update-id': state.release.id } })).status, 202);
  assert.equal((await f.service.wait()).phase, 'ready');
  assert.equal((await request('cancel', { method: 'POST', headers: { 'x-wn-update-action': 'cancel' } })).status, 200);
});
