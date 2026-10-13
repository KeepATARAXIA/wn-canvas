import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { digest, readBytes, readJson, writeBytes, writeJson } from '../wn-updater/files.mjs';
import { publishRelease } from '../wn-updater/publish.mjs';
import { publisherProfilePath } from '../wn-updater/role.mjs';
import { createPublisherService } from '../wn-updater/publisher.mjs';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { unzipSync } = require('fflate');
const BASE_VERSION = 'WN-20261007-01', NEXT_VERSION = 'WN-20261011-01';
const DEPS = ['web/package.json', 'web/package-lock.json', 'canvas-agent/package.json', 'canvas-agent/package-lock.json'];

async function fixture(t, buildOverride) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wn-publisher-test-'));
  const root = path.join(directory, 'developer'), base = path.join(directory, 'formal'), previous = path.join(directory, 'previous'), profileDirectory = path.join(directory, 'profiles'), site = path.join(directory, 'site');
  for (const folder of [root, base, previous, profileDirectory, site]) await fs.mkdir(folder);
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'wn-publisher-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const sources = { 'web/src/demo.ts': 'formal demo', 'web/src/deleted.ts': 'obsolete source', 'canvas-agent/dist/agent.js': 'formal agent', 'web/index.html': '<html>source</html>', 'scripts/wn-updater/core.mjs': 'formal updater', 'VERSION': 'v0.19.0', 'CHANGELOG.md': '# Changelog' };
  for (const name of DEPS) sources[name] = 'formal dependency ' + name;
  const rows = [];
  for (const [name, content] of Object.entries(sources)) {
    await writeBytes(base, name, content); await writeBytes(root, name, content);
    rows.push({ path: name, sha256: digest(Buffer.from(content)), bytes: Buffer.byteLength(content) });
  }
  await writeBytes(base, 'web/dist/index.html', '<html>formal build</html>');
  const dist = [{ path: 'web/dist/index.html', sha256: digest(Buffer.from('<html>formal build</html>')), size: Buffer.byteLength('<html>formal build</html>') }];
  await writeBytes(previous, 'web/src/demo.ts', 'previous demo');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }), privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const signed = path.join(directory, 'old-release');
  const release = await publishRelease({ baseRoot: previous, targetRoot: base, outDir: signed, files: ['web/src/demo.ts'], fromVersion: 'WN-20260924-01', version: BASE_VERSION, notes: 'formal version', privateKey: privatePem });
  await writeBytes(site, 'stable/release.json', await readBytes(signed, 'release.json'));
  await writeBytes(site, `stable/files/${digest(Buffer.from('formal demo'))}`, 'formal demo');
  await writeBytes(site, 'bootstrap/old.zip', 'old bootstrap archive');
  await writeBytes(site, 'bootstrap/old.zip.sha256', digest(Buffer.from('old bootstrap archive')) + '  old.zip\n');
  await writeBytes(site, '404.html', 'missing'); await writeBytes(site, 'index.html', 'old public page');
  await writeBytes(site, 'probe/transport.json', '{}');
  await writeJson(root, '.wn-updates/config.json', { feedUrl: 'https://updates.example.test/stable/release.json', publicKey: publicPem });
  await writeBytes(root, 'RELEASES.md', '# Releases\n\n## Unreleased / 待打包\n\n本次新功能\n\n## Formal\n旧版');
  await writeBytes(root, 'user-data/private.json', 'must remain private');
  await writeBytes(root, 'extras/models/model.bin', 'must not be scanned');
  await writeBytes(root, 'web/src/.env.local', 'must not be scanned');
  const manifest = path.join(directory, 'source-manifest.json'), buildManifest = path.join(directory, 'build-manifest.json'), key = path.join(directory, 'private.pem');
  await fs.writeFile(key, privatePem); await fs.writeFile(manifest, JSON.stringify({ status: 'passed', rows })); await fs.writeFile(buildManifest, JSON.stringify({ status: 'passed', rows: dist }));
  const profile = { format: 1, mode: 'developer', root, baselineRoot: base, baselineVersion: BASE_VERSION, baselineId: release.id, baselineManifestPath: manifest, buildManifestPath: buildManifest, pagesSiteRoot: site, privateKeyPath: key, uploadUrl: 'https://dash.cloudflare.com/example/pages/view/wn-canvas-updates' };
  const profilePath = publisherProfilePath(root, { profileDirectory }); await fs.writeFile(profilePath, JSON.stringify(profile));
  await writeBytes(root, 'web/src/demo.ts', 'new demo'); await writeBytes(root, 'web/src/added.ts', 'new source'); await fs.unlink(path.join(root, 'web/src/deleted.ts'));
  let network = 'old', requests = [], built = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options }); assert.equal(options.method, 'GET'); assert.ok(url.startsWith('https://updates.example.test/'));
    if (network === 'error') return new Response('failed', { status: 503 });
    if (network === 'old') return new Response(await readBytes(site, 'stable/release.json'));
    const nextSite = path.join(path.dirname(profilePath), path.basename(profilePath, '.json') + '.data', 'drafts', network, 'pages-site');
    const relative = new URL(url).pathname.slice(1);
    const bytes = await readBytes(nextSite, relative);
    return new Response(network === 'corrupt' ? 'corrupt' : bytes, { status: bytes ? 200 : 404 });
  };
  const buildTarget = buildOverride || (async ({ targetRoot }) => { built.push(targetRoot); await writeBytes(targetRoot, 'web/dist/index.html', '<html>new build</html>'); await writeBytes(targetRoot, 'web/dist/assets/app.js', 'built code'); });
  const service = createPublisherService(root, { profileDirectory, fetchImpl, buildTarget });
  const prepare = async () => service.prepare({ version: NEXT_VERSION, notes: '本轮新功能与修复', reviewId: (await service.status()).reviewId });
  const draftRoot = id => path.join(path.dirname(profilePath), path.basename(profilePath, '.json') + '.data', 'drafts', id);
  return { directory, root, base, site, profileDirectory, profile, profilePath, manifest, key, service, prepare, draftRoot, built, requests, network: value => { network = value; } };
}

test('developer status reports exact source changes and no credentials or installation paths', async t => {
  const f = await fixture(t), state = await f.service.status();
  assert.equal(state.mode, 'developer'); assert.equal(state.baselineVersion, BASE_VERSION);
  assert.deepEqual(state.changes.map(row => [row.path, row.change]), [['web/src/added.ts', 'new'], ['web/src/deleted.ts', 'deleted'], ['web/src/demo.ts', 'modified']]);
  assert.equal(state.maintenanceChanges.length, 0); assert.equal(state.dependencyChanges.length, 0);
  assert.equal(state.unreleasedNotes, '本次新功能'); assert.equal(state.draft, null); assert.equal(state.buildRequired, true);
  const serialized = JSON.stringify(state); assert.ok(!serialized.includes(f.directory)); assert.ok(!serialized.includes('private.pem')); assert.ok(!serialized.includes('.env.local'));
  assert.equal(f.requests.length, 0);
});

test('user installation has no publishing permission and creates no draft', async t => {
  const f = await fixture(t); await fs.unlink(f.profilePath);
  await assert.rejects(f.service.status(), /用户模式/); await assert.rejects(f.prepare(), /用户模式/);
  assert.deepEqual(await fs.readdir(f.profileDirectory), []);
});

test('preparation freezes inputs and makes a validated complete site ZIP; approval permits manual download only', async t => {
  const f = await fixture(t), draft = await f.prepare();
  assert.equal(draft.status, 'prepared'); assert.equal(draft.downloadAvailable, false); assert.equal(draft.uploadUrl, null);
  assert.ok(draft.changes.some(row => row.path === 'web/src/deleted.ts' && row.change === 'deleted'));
  assert.ok(draft.changes.some(row => row.path === 'web/dist/assets/app.js' && row.change === 'new'));
  await assert.rejects(f.service.download(draft.id), /明确确认/);
  await assert.rejects(f.service.approve('0'.repeat(64)), /不存在/);
  const approved = await f.service.approve(draft.id); assert.equal(approved.status, 'approved'); assert.ok(approved.uploadUrl.startsWith('https://dash.cloudflare.com/'));
  const download = await f.service.download(draft.id), contents = unzipSync(download.bytes);
  assert.equal(digest(download.bytes), draft.zipSha256);
  assert.equal(Buffer.from(contents['bootstrap/old.zip']).toString(), 'old bootstrap archive');
  assert.ok(contents[`stable/files/${digest(Buffer.from('formal demo'))}`]);
  assert.ok(!Object.keys(contents).some(name => /private|\.wn-|node_modules|user-data|extras\//.test(name)));
  assert.equal(f.requests.length, 0); assert.equal(f.built.length, 1);
  assert.ok(f.built[0].startsWith(f.profileDirectory + path.sep));
  assert.equal((await readBytes(f.root, 'web/src/demo.ts')).toString(), 'new demo');
  assert.equal(await readBytes(f.root, 'web/dist/index.html'), null);
  assert.equal(JSON.parse(await fs.readFile(f.profilePath)).baselineVersion, BASE_VERSION);
});

test('only trusted matching public envelope and every payload mark the draft published', async t => {
  const f = await fixture(t), draft = await f.prepare();
  await assert.rejects(f.service.verify(draft.id), /确认上传/);
  await f.service.approve(draft.id);
  await assert.rejects(f.service.verify(draft.id), /旧版本/);
  assert.equal(JSON.parse(await fs.readFile(f.profilePath)).baselineVersion, BASE_VERSION);
  f.network('error'); await assert.rejects(f.service.verify(draft.id), /503/);
  f.network(draft.id);
  const published = await f.service.verify(draft.id); assert.equal(published.status, 'published'); assert.ok(published.verifiedAt);
  const state = await f.service.status(); assert.equal(state.baselineVersion, NEXT_VERSION); assert.equal(state.changes.length, 0);
  assert.ok(f.requests.length >= draft.files + 2);
  assert.equal(state.draft.status, 'published');
  // A crash after advancing the profile but before writing draft status is recoverable.
  const record = await readJson(f.draftRoot(draft.id), 'draft.json');
  await writeJson(f.draftRoot(draft.id), 'draft.json', { ...record, status: 'approved' });
  assert.equal((await f.service.verify(draft.id)).status, 'published');
});

test('a corrupt remote payload leaves the official baseline and approved state unchanged', async t => {
  const f = await fixture(t), draft = await f.prepare(); await f.service.approve(draft.id);
  const site = path.join(f.draftRoot(draft.id), 'pages-site');
  const bytes = await readBytes(site, 'stable/release.json'), envelope = JSON.parse(bytes.toString());
  const release = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
  const file = release.files.find(file => file.after);
  await writeBytes(site, `stable/files/${file.after.sha256}`, 'damaged payload'); f.network(draft.id);
  await assert.rejects(f.service.verify(draft.id), /超过预期|文件校验/);
  assert.equal((await f.service.status()).draft.status, 'approved'); assert.equal(JSON.parse(await fs.readFile(f.profilePath)).baselineVersion, BASE_VERSION);
});

test('stale review and source edits after preparation block approval', async t => {
  const f = await fixture(t), old = await f.service.status();
  await writeBytes(f.root, 'web/src/demo.ts', 'later edit');
  await assert.rejects(f.service.prepare({ version: NEXT_VERSION, notes: 'review', reviewId: old.reviewId }), /内容已变化/);
  const draft = await f.prepare(); await writeBytes(f.root, 'web/src/demo.ts', 'even later edit');
  await assert.rejects(f.service.approve(draft.id), /本地内容变化/); await assert.rejects(f.service.download(draft.id), /明确确认/);
});

test('source mutation during build never yields a downloadable draft', async t => {
  let installed;
  const f = await fixture(t, async ({ targetRoot }) => { await writeBytes(targetRoot, 'web/dist/index.html', 'build'); await writeBytes(installed, 'web/src/demo.ts', 'changed while building'); });
  installed = f.root;
  await assert.rejects(f.prepare(), /构建期间/);
  assert.equal((await f.service.status()).draft, null); assert.equal(f.requests.length, 0);
});

test('frozen source mutation during build is rejected', async t => {
  const f = await fixture(t, async ({ targetRoot }) => { await writeBytes(targetRoot, 'web/src/demo.ts', 'bad builder'); await writeBytes(targetRoot, 'web/dist/index.html', 'build'); });
  await assert.rejects(f.prepare(), /构建改变了冻结源码/);
  assert.equal((await f.service.status()).draft, null);
});

test('dependency and maintenance changes cannot be silently excluded from an online release', async t => {
  const f = await fixture(t); await writeBytes(f.root, DEPS[0], 'new dependency');
  assert.equal((await f.service.status()).dependencyChanges.length, 1); await assert.rejects(f.prepare(), /依赖迁移/);
  await writeBytes(f.root, DEPS[0], 'formal dependency ' + DEPS[0]);
  await writeBytes(f.root, 'scripts/wn-updater/publisher.mjs', 'new maintenance module');
  assert.equal((await f.service.status()).maintenanceChanges.length, 1); await assert.rejects(f.prepare(), /引导维护交付/);
  assert.equal(f.built.length, 0);
});

test('baseline corruption, missing scope and traversal cannot become an accepted formal baseline', async t => {
  const f = await fixture(t), report = JSON.parse(await fs.readFile(f.manifest));
  await writeBytes(f.base, 'web/src/demo.ts', 'corrupt baseline'); await assert.rejects(f.service.status(), /正式基线文件已变化/);
  await writeBytes(f.base, 'web/src/demo.ts', 'formal demo');
  await fs.writeFile(f.manifest, JSON.stringify({ ...report, rows: report.rows.filter(row => row.path !== 'web/src/deleted.ts') }));
  await assert.rejects(f.service.status(), /范围不完整/);
  await fs.writeFile(f.manifest, JSON.stringify({ ...report, rows: [...report.rows, { path: 'web/public/../../secret.json', sha256: '0'.repeat(64), bytes: 0 }] }));
  await assert.rejects(f.service.status(), /越界路径/);
});

test('unexpected public-site files and a signing-key mismatch refuse preparation', async t => {
  const f = await fixture(t); const { privateKey } = generateKeyPairSync('ed25519');
  const original = await fs.readFile(f.key); await fs.writeFile(f.key, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await assert.rejects(f.prepare(), /可信公钥不匹配/); await fs.writeFile(f.key, original);
  await writeBytes(f.site, '.env', 'secret');
  await assert.rejects(f.prepare(), /未审核文件/);
  assert.equal((await f.service.status()).draft, null);
});

test('malformed draft IDs and a tampered upload archive never grant download or publication', async t => {
  const f = await fixture(t), draft = await f.prepare();
  await assert.rejects(f.service.approve('../escape'), /编号无效/);
  await assert.rejects(f.service.download('../escape'), /编号无效/);
  await writeBytes(f.draftRoot(draft.id), 'pages-site.zip', 'corrupt zip');
  await assert.rejects(f.service.approve(draft.id), /ZIP 已变化/);
  await assert.rejects(f.service.download(draft.id), /明确确认/);
});

test('an old published draft cannot move a newer official baseline backwards', async t => {
  const f = await fixture(t), draft = await f.prepare(); await f.service.approve(draft.id); f.network(draft.id); await f.service.verify(draft.id);
  const profile = JSON.parse(await fs.readFile(f.profilePath));
  await fs.writeFile(f.profilePath, JSON.stringify({ ...profile, baselineVersion: 'WN-20261012-01', baselineId: 'a'.repeat(64) }));
  await assert.rejects(f.service.verify(draft.id), /正式基线已变化/);
  assert.equal(JSON.parse(await fs.readFile(f.profilePath)).baselineVersion, 'WN-20261012-01');
});

test('filesystem failures never expose a configured private-key path in the API error', async t => {
  const f = await fixture(t); await fs.unlink(f.key);
  await assert.rejects(f.prepare(), error => /本机发布资料失败/.test(error.message) && !error.message.includes(f.key) && !error.message.includes(f.directory));
});

test('new public static files appear in review and block an incomplete online release; custom plugins stay private', async t => {
  const f = await fixture(t);
  await writeBytes(f.root, 'web/public/icons/new.svg', '<svg/>');
  await writeBytes(f.root, 'web/public/plugins/user-custom.js', 'private custom plugin');
  const state = await f.service.status();
  assert.deepEqual(state.buildContextChanges.map(row => [row.path, row.change]), [['web/public/icons/new.svg', 'new']]);
  assert.ok(!JSON.stringify(state).includes('user-custom'));
  await assert.rejects(f.prepare(), /引导维护交付/);
  assert.equal(f.built.length, 0);
});

test('preserved old payload and bootstrap checksum corruption cannot enter a newly prepared Pages ZIP', async t => {
  const f = await fixture(t), payload = `stable/files/${digest(Buffer.from('formal demo'))}`;
  await writeBytes(f.site, payload, 'corrupt previous payload');
  await assert.rejects(f.prepare(), /原更新站哈希文件已损坏/);
  await writeBytes(f.site, payload, 'formal demo'); await writeBytes(f.site, 'bootstrap/old.zip', 'corrupt archive');
  await assert.rejects(f.prepare(), /原引导包与校验文件不匹配/);
  assert.equal((await f.service.status()).draft, null);
});
