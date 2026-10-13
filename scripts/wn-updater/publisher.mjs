import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createPublicKey, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { digest, fail, programPath, validVersion, decodeRelease, loadConfig, readBytes, readJson, writeBytes, writeJson } from './files.mjs';
import { publishRelease } from './publish.mjs';
import { publisherProfilePath, readPublisherProfile } from './role.mjs';

const SOURCE_DIRS = ['web/src', 'canvas-agent/dist'];
const PROGRAM_FILES = ['web/index.html', 'web/vite.config.ts', 'web/local-resources.mjs', 'web/local-updater.mjs', 'scripts/canvas-video-service.py', 'scripts/seedvr2-service.py', 'scripts/local-prompt-guard.py'];
const DEPENDENCIES = ['web/package.json', 'web/package-lock.json', 'canvas-agent/package.json', 'canvas-agent/package-lock.json'];
const BUILD_FILES = ['VERSION', 'CHANGELOG.md', ...DEPENDENCIES, 'web/tsconfig.json', 'web/postcss.config.mjs', 'web/components.json', 'canvas-agent/tsconfig.json', 'canvas-agent/agent-instructions.md'];
const MAINTENANCE_DIRS = ['scripts/wn-updater', 'scripts/wn-bootstrap'];
const MAINTENANCE_FILES = ['一键启动.cjs', '启动无限画布.bat', 'scripts/open-connected-canvas.cjs', 'scripts/show-comfy-console.ps1', 'extras/video-suite/ComfyUI/comfy_extras/nodes_minimax_h3.py', 'extras/video-suite/ComfyUI/comfy_extras/canvas_h3_reference.py', 'extras/video-suite/workflows/03-H3-Continuum-续生成.api.json', 'extras/video-suite/workflows/04-H3-HandTie-角色音轨串联.api.json'];
const LIMITATIONS = ['仅更新程序；模型、运行时、依赖、作品、个人配置和自定义插件不进入在线包。', 'Qwen Turbo 约 7.26 GB 新权重须另行提供；在线程序包不会为其他电脑安装此模型。', '更新器、启动恢复入口与 H3 外部文件须独立引导交付，不能通过现有在线白名单更新。', '此草案仅支持已安装来源正式版本的电脑；更旧版本与首次引导需要单独过渡方案。', '准备、确认上传均不写公网；手动部署后须核验公网签名与全部文件，才登记已发布。'];
const HEX = /^[a-f0-9]{64}$/;
const normalizedPath = filename => { const resolved = path.resolve(filename); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; };
const inside = (filename, directory) => normalizedPath(filename) === normalizedPath(directory) || normalizedPath(filename).startsWith(normalizedPath(directory) + path.sep);
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const excluded = relative => relative.split('/').some(part => /^(tests?|__tests__|node_modules|audits|\.git|__pycache__|\.env.*|private\.pem|auth\.json|credentials\.json|\.npmrc|id_rsa|id_ed25519)$/i.test(part)) || /\.(test|spec)\.[cm]?[jt]sx?$|\.(log|pyc|tsbuildinfo|bak|db)$/i.test(relative);
const kind = relative => SOURCE_DIRS.some(prefix => relative.startsWith(prefix + '/')) || PROGRAM_FILES.includes(relative) ? 'online-program' : MAINTENANCE_DIRS.some(prefix => relative.startsWith(prefix + '/')) || MAINTENANCE_FILES.includes(relative) ? 'maintenance' : BUILD_FILES.includes(relative) || relative.startsWith('web/public/') && !relative.startsWith('web/public/plugins/') ? 'build-context' : null;
const sorted = rows => rows.sort((a, b) => a.path.localeCompare(b.path));
const jsonFile = async filename => JSON.parse(await fs.readFile(await externalPath(filename), 'utf8'));

// Profiles and drafts live outside the install. Do not follow junctions to credentials or data.
async function externalPath(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) fail('本机发布配置缺少绝对路径。');
  const resolved = path.resolve(filename);
  let current = path.parse(resolved).root;
  const parts = path.relative(current, resolved).split(path.sep);
  for (let index = 0; index <= parts.length; index++) {
    const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat?.isSymbolicLink()) fail('发布资料路径包含链接，已停止。');
    if (stat && index < parts.length && !stat.isDirectory()) fail('发布资料父级不是目录。');
    if (index < parts.length) current = path.join(current, parts[index]);
  }
  return resolved;
}

async function inventory(root, prefix, excludeSource = true) {
  const result = [];
  const folder = await externalPath(path.join(root, prefix));
  const stat = await fs.lstat(folder).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return result;
  if (!stat.isDirectory()) fail(`发布目录被文件占用：${prefix}`);
  async function walk(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (excludeSource && (excluded(name) || name === 'web/public/plugins' || name.startsWith('web/public/plugins/'))) continue;
      if (entry.isSymbolicLink()) fail(`发布范围包含链接：${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        const bytes = await readBytes(root, name);
        result.push({ path: name, sha256: digest(bytes), bytes: bytes.length });
      } else fail(`发布范围包含特殊文件：${name}`);
    }
  }
  await walk(prefix);
  return sorted(result);
}

async function currentRows(root, baselineRows) {
  const map = new Map();
  for (const prefix of [...SOURCE_DIRS, ...MAINTENANCE_DIRS, 'web/public']) for (const row of await inventory(root, prefix)) map.set(row.path, { ...row, kind: kind(row.path) });
  const exact = new Set([...PROGRAM_FILES, ...BUILD_FILES, ...MAINTENANCE_FILES, ...baselineRows.filter(row => row.path.startsWith('web/public/')).map(row => row.path)]);
  for (const relative of exact) {
    if (excluded(relative) || !kind(relative)) continue;
    const bytes = await readBytes(root, relative);
    if (bytes !== null) map.set(relative, { path: relative, sha256: digest(bytes), bytes: bytes.length, kind: kind(relative) });
  }
  return sorted([...map.values()]);
}

function manifestRows(manifest, build = false) {
  if (manifest?.status !== 'passed' || !Array.isArray(manifest.rows) || manifest.rows.length > 5000) fail('正式基线快照未通过验收或清单无效。');
  const seen = new Set();
  return sorted(manifest.rows.map(row => {
    if (!row || typeof row.path !== 'string' || seen.has(row.path.toLowerCase()) || !HEX.test(row.sha256) || !Number.isSafeInteger(row.bytes ?? row.size) || (row.bytes ?? row.size) < 0) fail('正式基线文件记录无效。');
    seen.add(row.path.toLowerCase());
    if (row.path.includes('\\') || row.path.includes(':') || row.path.split('/').some(part => !part || part === '.' || part === '..')) fail('正式基线含越界路径。');
    if (build) { programPath(row.path); if (!row.path.startsWith('web/dist/')) fail('构建基线包含非构建文件。'); }
    else if (!kind(row.path) || excluded(row.path)) fail('源码基线包含发布范围外文件。');
    return { path: row.path, sha256: row.sha256, bytes: row.bytes ?? row.size, kind: build ? 'build-output' : kind(row.path) };
  }));
}

async function checkRows(root, rows, message) {
  for (const row of rows) {
    const bytes = await readBytes(root, row.path);
    if (bytes === null || bytes.length !== row.bytes || digest(bytes) !== row.sha256) fail(`${message}：${row.path}`);
  }
}

async function baseline(profile, config) {
  if (!validVersion(profile.baselineVersion) || !HEX.test(profile.baselineId)) fail('本机发布配置缺少可信正式版本。');
  for (const name of ['baselineRoot', 'baselineManifestPath', 'buildManifestPath', 'pagesSiteRoot']) await externalPath(profile[name]);
  const rows = manifestRows(await jsonFile(profile.baselineManifestPath));
  const dist = manifestRows(await jsonFile(profile.buildManifestPath), true);
  for (const dependency of DEPENDENCIES) if (!rows.some(row => row.path === dependency)) fail('正式基线缺少四项依赖校验。');
  await checkRows(profile.baselineRoot, [...rows, ...dist], '正式基线文件已变化');
  for (const prefix of [...SOURCE_DIRS, 'web/public']) {
    const actual = (await inventory(profile.baselineRoot, prefix)).map(row => row.path);
    const expected = rows.filter(row => row.path.startsWith(prefix + '/')).map(row => row.path);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('正式源码基线文件范围不完整。');
  }
  const actualDist = (await inventory(profile.baselineRoot, 'web/dist')).map(row => row.path);
  if (JSON.stringify(actualDist) !== JSON.stringify(dist.map(row => row.path))) fail('正式构建基线文件范围不完整。');
  const bytes = await readBytes(profile.pagesSiteRoot, 'stable/release.json');
  if (!bytes) fail('正式站点基线缺少签名清单。');
  const bundle = decodeRelease(bytes, config.publicKey);
  if (bundle.id !== profile.baselineId || bundle.release.version !== profile.baselineVersion) fail('正式站点与本机发布基线不匹配。');
  const known = new Map([...rows, ...dist].map(row => [row.path, row]));
  for (const file of bundle.release.files) {
    if (file.after ? known.get(file.path)?.sha256 !== file.after.sha256 : known.has(file.path)) fail(`正式签名与快照不匹配：${file.path}`);
  }
  return { rows, dist };
}

function difference(before, after) {
  const old = new Map(before.map(row => [row.path, row])), next = new Map(after.map(row => [row.path, row]));
  return sorted([...new Set([...old.keys(), ...next.keys()])].flatMap(relative => {
    const a = old.get(relative), b = next.get(relative);
    if (a?.sha256 === b?.sha256) return [];
    const change = !a ? 'new' : !b ? 'deleted' : 'modified';
    return [{ path: relative, change, before: a?.sha256 ?? null, after: b?.sha256 ?? null, bytes: b?.bytes ?? 0 }];
  }));
}

const publicDraft = draft => draft ? { id: draft.id, status: draft.status, version: draft.version, fromVersion: draft.fromVersion, releaseId: draft.releaseId, notes: draft.notes, changes: draft.changes, files: draft.files, bytes: draft.bytes, zipBytes: draft.zipBytes, zipSha256: draft.zipSha256, createdAt: draft.createdAt, approvedAt: draft.approvedAt ?? null, verifiedAt: draft.verifiedAt ?? null, uploadUrl: draft.status === 'approved' || draft.status === 'published' ? draft.uploadUrl : null, downloadAvailable: draft.status === 'approved' || draft.status === 'published', limitations: LIMITATIONS } : null;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export async function buildPublisherTarget({ root, targetRoot, logRoot }) {
  const web = path.join(targetRoot, 'web');
  const dependencies = await externalPath(path.join(root, 'web/node_modules'));
  if (!(await fs.stat(dependencies)).isDirectory()) fail('缺少现有网页依赖，未安装任何依赖。');
  await fs.symlink(dependencies, path.join(web, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const node = path.join(root, 'runtime/node-v24.21.0-win-x64/node.exe');
  const executable = await fs.stat(node).then(() => node).catch(error => { if (error.code === 'ENOENT') return process.execPath; throw error; });
  for (const [name, args] of [['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']], ['build', ['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner']]]) {
    const output = [];
    const code = await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: web, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', chunk => output.push(chunk)); child.stderr.on('data', chunk => output.push(chunk));
      child.once('error', reject); child.once('close', resolve);
    });
    await writeBytes(logRoot, `${name}.log`, Buffer.concat(output));
    if (code !== 0) fail(`隔离${name === 'build' ? '构建' : '类型检查'}失败，未准备可上传草案。`);
  }
}

async function prepareSite(profile, draftRoot, release, bundle) {
  const site = path.join(draftRoot, 'pages-site');
  await fs.mkdir(site);
  // Preserve the entire reviewed static site, including old hash payloads and bootstrap ZIPs.
  const preserved = await inventory(profile.pagesSiteRoot, '', false);
  for (const row of preserved) {
    const name = row.path.replace(/^\//, '');
    if (!/^(index\.html|404\.html|_headers|release-info\.json|stable\/release\.json|stable\/files\/[a-f0-9]{64}|bootstrap\/[^/]+\.zip(?:\.sha256)?|probe\/transport\.json|probe\/files\/[a-f0-9]{64})$/.test(name)) fail(`更新站包含未审核文件：${name}`);
    const bytes = await readBytes(profile.pagesSiteRoot, name);
    const contentHash = name.match(/^(?:stable|probe)\/files\/([a-f0-9]{64})$/)?.[1];
    if (contentHash && digest(bytes) !== contentHash) fail(`原更新站哈希文件已损坏：${name}`);
    if (/^bootstrap\/[^/]+\.zip$/.test(name)) {
      const checksum = await readBytes(profile.pagesSiteRoot, name + '.sha256');
      if (checksum?.toString('utf8').trim().split(/\s+/)[0] !== digest(bytes)) fail(`原引导包与校验文件不匹配：${name}`);
    }
    await writeBytes(site, name, bytes);
  }
  await writeBytes(site, 'stable/release.json', bundle.envelope);
  for (const file of bundle.release.files) if (file.after) await writeBytes(site, `stable/files/${file.after.sha256}`, await readBytes(path.join(draftRoot, 'signed-release'), `files/${file.after.sha256}`));
  await writeBytes(site, '_headers', '/\n  Cache-Control: no-store\n\n/release-info.json\n  Cache-Control: no-store\n  Content-Type: application/json; charset=utf-8\n\n/stable/release.json\n  Cache-Control: no-store\n  Content-Type: application/json; charset=utf-8\n\n/stable/files/*\n  Cache-Control: public, max-age=31536000, immutable\n  Content-Type: application/octet-stream\n\n/bootstrap/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/probe/transport.json\n  Cache-Control: no-store\n\n/probe/files/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/*\n  X-Content-Type-Options: nosniff\n');
  await writeJson(site, 'release-info.json', { version: release.version, sourceVersion: release.fromVersion, releaseId: bundle.id, operations: release.files, programBytes: release.bytes, notes: bundle.release.notes, limitations: LIMITATIONS });
  await writeBytes(site, 'index.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WN 画布正式更新</title><style>body{font:16px system-ui;color:#15233b;background:#f6f7fa;margin:0}main{max-width:760px;margin:60px auto;background:white;padding:32px;border-radius:16px}pre{white-space:pre-wrap;line-height:1.8}li{line-height:1.8}a{color:#315df1}</style><main><h1>WN 画布正式更新</h1><p>${escapeHtml(release.version)} · 仅支持 ${escapeHtml(release.fromVersion)}</p><pre>${escapeHtml(bundle.release.notes)}</pre><ul>${LIMITATIONS.slice(0, 3).map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul><p>已安装来源版本的电脑在本地画布检查并下载更新，保存工作并停止全部后台，再完整启动安装。保留的旧首次引导文件对应旧发布版本，不直接适用当前新版。</p><a href="/release-info.json">版本详情</a></main></html>`);
  const rows = (await inventory(site, '', false)).map(row => ({ ...row, path: row.path.replace(/^\//, '') }));
  if (rows.length > 1000 || rows.some(row => row.bytes > 25 * 1024 * 1024) || rows.reduce((n, row) => n + row.bytes, 0) > 128 * 1024 * 1024) fail('完整更新站超过本发布入口容量，请拆分交付方案。');
  const entries = Object.create(null);
  for (const row of rows) {
    const bytes = await readBytes(site, row.path);
    if (bytes.includes(Buffer.from('-----BEGIN PRIVATE KEY-----')) || bytes.includes(Buffer.from('-----BEGIN RSA PRIVATE KEY-----'))) fail('公开载荷含私钥标记，已停止。');
    entries[row.path] = bytes;
  }
  const { zipSync, unzipSync } = require('fflate');
  const zip = Buffer.from(zipSync(entries, { level: 6 }));
  const extracted = unzipSync(zip);
  if (Object.keys(extracted).length !== rows.length || rows.some(row => !extracted[row.path] || digest(extracted[row.path]) !== row.sha256)) fail('更新站 ZIP 解压校验失败。');
  await writeBytes(draftRoot, 'pages-site.zip', zip);
  await writeJson(draftRoot, 'public-upload-files.json', { files: rows, zipSha256: digest(zip), zipBytes: zip.length });
  return { zipBytes: zip.length, zipSha256: digest(zip) };
}

async function fetchChecked(url, maximum, fetchImpl) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) fail('发布核验只接受可信 HTTPS 更新站。');
  const response = await fetchImpl(parsed.href, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) fail(`公网核验下载失败（HTTP ${response.status}）。`);
  const chunks = [], reader = response.body.getReader(); let size = 0;
  try {
    while (true) {
      const value = await reader.read(); if (value.done) break;
      size += value.value.length;
      if (size > maximum) fail('公网核验文件超过预期大小。');
      chunks.push(value.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export function createPublisherService(root, { profileDirectory, fetchImpl = fetch, buildTarget = buildPublisherTarget } = {}) {
  const options = { profileDirectory };
  const filename = publisherProfilePath(root, options);
  const stateRoot = path.join(path.dirname(filename), path.basename(filename, '.json') + '.data');
  if (inside(stateRoot, root)) fail('发布状态与草案必须保存在项目外。');
  let busy = false;
  const profile = () => { const value = readPublisherProfile(root, options); if (!value) fail('此电脑处于用户模式，没有发布权限。'); return value; };
  const draftRoot = id => { if (!HEX.test(id)) fail('发布草案编号无效。'); return path.join(stateRoot, 'drafts', id); };
  async function readDraft(id) {
    const value = await readJson(draftRoot(id), 'draft.json');
    if (!value || value.id !== id || !['prepared', 'approved', 'published'].includes(value.status)) fail('发布草案不存在或损坏。');
    return value;
  }
  async function inspect() {
    const local = profile(), config = await loadConfig(root);
    if (!config) fail('尚未配置可信正式更新源。');
    const old = await baseline(local, config);
    const current = await currentRows(root, old.rows);
    const changes = difference(old.rows.filter(row => row.kind === 'online-program'), current.filter(row => row.kind === 'online-program'));
    const maintenanceChanges = difference(old.rows.filter(row => row.kind === 'maintenance'), current.filter(row => row.kind === 'maintenance'));
    const dependencyChanges = difference(old.rows.filter(row => DEPENDENCIES.includes(row.path)), current.filter(row => DEPENDENCIES.includes(row.path)));
    const buildContextChanges = difference(old.rows.filter(row => row.kind === 'build-context' && !DEPENDENCIES.includes(row.path)), current.filter(row => row.kind === 'build-context' && !DEPENDENCIES.includes(row.path)));
    const reviewId = digest(JSON.stringify({ baselineId: local.baselineId, rows: current }));
    const records = await readBytes(root, 'RELEASES.md');
    const unreleasedNotes = records?.toString('utf8').match(/## Unreleased[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() || '';
    return { local, config, old, current, view: { mode: 'developer', baselineVersion: local.baselineVersion, baselineId: local.baselineId, reviewId, changes, maintenanceChanges, dependencyChanges, buildContextChanges, unreleasedNotes, buildRequired: true, preparing: busy, limitations: LIMITATIONS } };
  }
  async function exclusive(operation) {
    if (busy) fail('另一个发布操作正在进行。');
    busy = true;
    try { return await operation(); } finally { busy = false; }
  }
  const service = {
    async status() {
      const { view } = await inspect();
      const latest = await readJson(stateRoot, 'latest.json');
      return { ...view, draft: latest ? publicDraft(await readDraft(latest.id)) : null };
    },
    prepare({ version, notes, reviewId }) {
      return exclusive(async () => {
        const inspected = await inspect(), { local, config, old, current, view } = inspected;
        if (!validVersion(version) || version <= local.baselineVersion) fail('草案版本须高于当前正式版本，格式为 WN-YYYYMMDD-NN。');
        if (typeof notes !== 'string' || !notes.trim() || notes.length > 12000) fail('请填写本版发布说明（最多 12000 字）。');
        if (reviewId !== view.reviewId) fail('本地内容已变化，请刷新未发布改动后重新确认。');
        if (view.dependencyChanges.length) fail('四项依赖清单发生变化，须先制定独立依赖迁移方案。');
        if (view.maintenanceChanges.length || view.buildContextChanges.length) fail('更新器、启动入口或构建配置存在独立维护改动；先完成引导维护交付，在线草案不能遗漏这些文件。');
        if (!view.changes.length) fail('没有未发布程序改动，无需准备新版本。');
        const keyPath = await externalPath(local.privateKeyPath);
        if (inside(keyPath, root)) fail('发布私钥必须保存在项目外。');
        const upload = new URL(local.uploadUrl);
        if (upload.protocol !== 'https:' || upload.username || upload.password || upload.hash) fail('手动上传控制台地址无效。');
        const id = digest(randomUUID()), directory = draftRoot(id), target = path.join(directory, 'target');
        await externalPath(directory); await fs.mkdir(target, { recursive: true });
        for (const row of current) await writeBytes(target, row.path, await readBytes(root, row.path));
        await checkRows(target, current, '冻结源码与已审查内容不符');
        await buildTarget({ root, targetRoot: target, logRoot: directory });
        await checkRows(target, current, '构建改变了冻结源码');
        if ((await inspect()).view.reviewId !== reviewId) fail('构建期间本地内容发生变化，请重新准备；旧草案未开放上传。');
        const dist = (await inventory(target, 'web/dist')).map(row => ({ ...row, kind: 'build-output' }));
        if (!dist.length || !dist.some(row => row.path === 'web/dist/index.html')) fail('隔离构建未生成可用网页。');
        const candidates = [...new Set([...old.rows.filter(row => row.kind === 'online-program').map(row => row.path), ...current.filter(row => row.kind === 'online-program').map(row => row.path), ...old.dist.map(row => row.path), ...dist.map(row => row.path)])].sort();
        candidates.forEach(programPath);
        const key = await fs.readFile(keyPath);
        let release;
        try {
          if (createPublicKey(key).export({ type: 'spki', format: 'pem' }) !== createPublicKey(config.publicKey).export({ type: 'spki', format: 'pem' })) fail('签名私钥与用户端可信公钥不匹配。');
          release = await publishRelease({ baseRoot: local.baselineRoot, targetRoot: target, outDir: path.join(directory, 'signed-release'), files: candidates, fromVersion: local.baselineVersion, version, notes: notes.trim(), privateKey: key });
        } finally { key.fill(0); }
        const bundle = decodeRelease(await readBytes(path.join(directory, 'signed-release'), 'release.json'), config.publicKey);
        const zip = await prepareSite(local, directory, release, bundle);
        await writeJson(directory, 'baseline-manifest.json', { status: 'passed', rows: current });
        await writeJson(directory, 'build-manifest.json', { status: 'passed', rows: dist });
        await checkRows(target, current, '准备后冻结源码已变化');
        await checkRows(local.baselineRoot, [...old.rows, ...old.dist], '准备期间正式基线已变化');
        const changes = bundle.release.files.map(file => ({ path: file.path, change: file.before === null ? 'new' : file.after === null ? 'deleted' : 'modified', before: file.before, after: file.after?.sha256 ?? null, bytes: file.after?.size ?? 0 }));
        const draft = { id, status: 'prepared', version, fromVersion: local.baselineVersion, baselineId: local.baselineId, reviewId, notes: notes.trim(), changes, releaseId: bundle.id, files: release.files, bytes: release.bytes, ...zip, uploadUrl: upload.href, createdAt: new Date().toISOString() };
        await writeJson(directory, 'draft.json', draft); await writeJson(stateRoot, 'latest.json', { id });
        return publicDraft(draft);
      });
    },
    approve(id) {
      return exclusive(async () => {
        const inspected = await inspect(), draft = await readDraft(id);
        if (draft.status === 'published') return publicDraft(draft);
        if (draft.baselineId !== inspected.local.baselineId || draft.reviewId !== inspected.view.reviewId) fail('草案已过期或本地内容变化，请重新准备后确认上传。');
        const bytes = await readBytes(draftRoot(id), 'pages-site.zip');
        if (!bytes || digest(bytes) !== draft.zipSha256 || bytes.length !== draft.zipBytes) fail('待上传 ZIP 已变化，请重新准备。');
        draft.status = 'approved'; draft.approvedAt ||= new Date().toISOString();
        await writeJson(draftRoot(id), 'draft.json', draft);
        return publicDraft(draft);
      });
    },
    async download(id) {
      profile(); const draft = await readDraft(id);
      if (!['approved', 'published'].includes(draft.status)) fail('上传前须由开发者明确确认，草案 ZIP 尚未开放下载。');
      const bytes = await readBytes(draftRoot(id), 'pages-site.zip');
      if (!bytes || bytes.length !== draft.zipBytes || digest(bytes) !== draft.zipSha256) fail('上传 ZIP 校验失败。');
      return { bytes, name: `WN-Canvas-Pages-${draft.version}.zip`, filename: `WN-Canvas-Pages-${draft.version}.zip`, sha256: draft.zipSha256 };
    },
    verify(id) {
      return exclusive(async () => {
        const local = profile(), config = await loadConfig(root), draft = await readDraft(id);
        if (!config) fail('尚未配置可信正式更新源。');
        if (draft.status !== 'approved' && draft.status !== 'published') fail('请先确认上传并完成手动部署，再核验公网。');
        if (local.baselineId !== draft.baselineId && !(local.baselineId === draft.releaseId && local.baselineVersion === draft.version)) fail('正式基线已变化，不能登记旧草案。');
        const directory = draftRoot(id), envelope = await fetchChecked(config.feedUrl, 2 * 1024 * 1024, fetchImpl);
        const bundle = decodeRelease(envelope, config.publicKey);
        if (bundle.id !== draft.releaseId || bundle.release.version !== draft.version || !envelope.equals(await readBytes(path.join(directory, 'signed-release'), 'release.json'))) fail('公网仍是旧版本或发布内容与本草案不同。');
        for (const file of bundle.release.files) if (file.after) {
          const bytes = await fetchChecked(new URL(`files/${file.after.sha256}`, config.feedUrl).href, file.after.size, fetchImpl);
          if (bytes.length !== file.after.size || digest(bytes) !== file.after.sha256) fail(`公网文件校验失败：${file.path}`);
        }
        await checkRows(path.join(directory, 'target'), manifestRows(await readJson(directory, 'baseline-manifest.json')), '草案冻结源码已变化');
        await checkRows(path.join(directory, 'target'), manifestRows(await readJson(directory, 'build-manifest.json'), true), '草案构建文件已变化');
        const next = { ...local, baselineRoot: path.join(directory, 'target'), baselineManifestPath: path.join(directory, 'baseline-manifest.json'), buildManifestPath: path.join(directory, 'build-manifest.json'), pagesSiteRoot: path.join(directory, 'pages-site'), baselineVersion: draft.version, baselineId: draft.releaseId };
        if (JSON.stringify(profile()) !== JSON.stringify(local)) fail('公网核验期间本机发布配置变化，未覆盖配置，请重新核验。');
        await writeJson(path.dirname(filename), path.basename(filename), next);
        draft.status = 'published'; draft.verifiedAt = new Date().toISOString();
        await writeJson(directory, 'draft.json', draft);
        return publicDraft(draft);
      });
    },
  };
  return Object.fromEntries(Object.entries(service).map(([name, operation]) => [name, async (...args) => {
    try { return await operation(...args); }
    catch (error) {
      // Filesystem errors can contain a private-key path. The local HTTP response never exposes it.
      if (error.code) fail('读取或写入本机发布资料失败，请检查路径、权限和磁盘空间。');
      throw error;
    }
  }]));
}
