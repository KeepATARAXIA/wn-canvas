import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID, createPublicKey, verify } from 'node:crypto';

export const STATE = '.wn-updates';
export const MAX_TOTAL = 512 * 1024 * 1024;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const fail = message => { throw new Error(message); };

// Version 1 updates program files only. Dependencies, models and user data require a separate migration.
export function programPath(relative) {
  if (typeof relative !== 'string' || relative.length > 220 || relative.includes('\\') || relative.includes(':')) fail('更新路径无效。');
  const parts = relative.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail('更新路径无效。');
  const allowed = /^(web\/(src|dist)\/|canvas-agent\/dist\/)/.test(relative)
    || ['web/index.html', 'web/vite.config.ts', 'web/local-resources.mjs', 'web/local-updater.mjs', 'scripts/canvas-video-service.py', 'scripts/seedvr2-service.py', 'scripts/local-prompt-guard.py'].includes(relative);
  if (!allowed || parts.some(p => /^(node_modules|\.env.*|AGENTS\.md|WORKLOG\.md|HISTORY\.md)$/i.test(p))) fail(`不允许自动更新此路径：${relative}`);
  return relative;
}

// Check every existing ancestor: a junction or symbolic link must never redirect writes.
export async function safePath(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) fail('路径超出安装目录。');
  let current = base;
  const segments = path.relative(base, target).split(path.sep);
  for (let i = 0; i <= segments.length; i++) {
    const stat = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat?.isSymbolicLink()) fail(`路径包含链接，已停止：${path.relative(base, current) || '.'}`);
    if (stat && i < segments.length && !stat.isDirectory()) fail('路径父级不是目录。');
    if (i < segments.length) current = path.join(current, segments[i]);
  }
  return target;
}

export async function readBytes(root, relative) {
  const target = await safePath(root, relative);
  const stat = await fs.lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return null;
  if (!stat.isFile()) fail(`路径不是普通文件：${relative}`);
  return fs.readFile(target);
}

export async function readJson(root, relative) {
  const bytes = await readBytes(root, relative);
  return bytes === null ? null : JSON.parse(bytes.toString('utf8'));
}

export async function writeBytes(root, relative, bytes) {
  const target = await safePath(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await safePath(root, relative);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(temporary, target); } catch (error) { await fs.unlink(temporary); throw error; }
}

export const writeJson = (root, relative, data) => writeBytes(root, relative, JSON.stringify(data, null, 2) + '\n');
export async function removeFile(root, relative) {
  const target = await safePath(root, relative);
  await fs.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
export async function hashFile(root, relative) {
  const bytes = await readBytes(root, relative);
  return bytes === null ? null : digest(bytes);
}

export async function withLock(root, operation) {
  const lockPath = await safePath(root, `${STATE}/lock.json`);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try { handle = await fs.open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const lock = await readJson(root, `${STATE}/lock.json`);
    if (!Number.isSafeInteger(lock?.pid) || lock.pid <= 0) fail('更新锁损坏，请保留现场并检查。');
    try { process.kill(lock.pid, 0); fail('另一个更新操作正在进行。'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    // Stale-lock recovery is serialized with its own exclusive lock.
    const recovery = await fs.open(lockPath + '.recovery', 'wx').catch(() => fail('正在恢复更新锁，请稍后重试。'));
    try {
      const again = await readJson(root, `${STATE}/lock.json`);
      if (JSON.stringify(again) !== JSON.stringify(lock)) fail('更新锁已变化，请重试。');
      await fs.unlink(lockPath);
      handle = await fs.open(lockPath, 'wx');
    } finally { await recovery.close(); await fs.unlink(lockPath + '.recovery'); }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    await handle.sync();
    return await operation();
  } finally { await handle.close(); await fs.unlink(lockPath); }
}

export const validVersion = value => typeof value === 'string' && /^WN-\d{8}-\d{2}$/.test(value);
export function validateRelease(release) {
  if (release?.format !== 1 || release.app !== 'wn-canvas' || !validVersion(release.version) || !validVersion(release.fromVersion) || release.version <= release.fromVersion) fail('更新清单版本无效。');
  if (typeof release.notes !== 'string' || release.notes.length > 12000 || !Array.isArray(release.files) || !release.files.length || release.files.length > 5000) fail('更新清单内容无效。');
  const seen = new Set();
  let total = 0;
  for (const file of release.files) {
    const name = programPath(file.path).toLowerCase();
    if (seen.has(name)) fail('更新清单包含重复路径。');
    seen.add(name);
    if (file.before !== null && !/^[a-f0-9]{64}$/.test(file.before)) fail('来源文件校验值无效。');
    if (file.after !== null && (!/^[a-f0-9]{64}$/.test(file.after?.sha256) || !Number.isSafeInteger(file.after?.size) || file.after.size < 0 || file.after.size > MAX_TOTAL)) fail('目标文件信息无效。');
    if (file.before === null && file.after === null) fail('空文件操作无效。');
    total += file.after?.size || 0;
  }
  if (total > MAX_TOTAL) fail('程序更新超过 512 MiB，请拆分发布；模型和依赖不走此通道。');
  const names = [...seen].sort();
  if (names.some((name, i) => i > 0 && name.startsWith(names[i - 1] + '/'))) fail('更新清单中文件与目录路径冲突。');
  return release;
}

export function decodeRelease(bytes, publicKey) {
  if (bytes.length > 2 * 1024 * 1024) fail('更新清单过大。');
  const envelope = JSON.parse(bytes.toString('utf8'));
  if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') fail('更新签名缺失。');
  const payload = Buffer.from(envelope.payload, 'base64');
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, payload, key, Buffer.from(envelope.signature, 'base64'))) fail('更新签名验证失败，未信任此更新。');
  return { id: digest(bytes), release: validateRelease(JSON.parse(payload.toString('utf8'))), envelope: bytes };
}

export async function loadConfig(root) {
  const config = await readJson(root, `${STATE}/config.json`);
  if (!config) return null;
  const url = new URL(config.feedUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(config.allowLocalFeed === true && local && url.protocol === 'http:'))) fail('更新源须为 HTTPS；本机演练须单独允许。');
  if (createPublicKey(config.publicKey).asymmetricKeyType !== 'ed25519') fail('更新公钥类型无效。');
  return { ...config, feedUrl: url.href };
}
