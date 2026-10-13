import * as fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';

export const SOURCE_VERSION = 'WN-20260924-01';
export const SOURCE_CHECK_PATHS = [
  'web/package.json', 'web/package-lock.json',
  'canvas-agent/package.json', 'canvas-agent/package-lock.json',
];
export const LEGACY_REQUIRED_PATHS = [
  'scripts/wn-updater/files.mjs', 'scripts/wn-updater/core.mjs',
  'scripts/wn-updater/publish.mjs', 'scripts/wn-updater/cli.mjs',
  '一键启动.cjs', 'scripts/show-comfy-console.ps1', '.wn-updates/config.json',
];
export const REQUIRED_PATHS = [...LEGACY_REQUIRED_PATHS, 'scripts/wn-updater/role.mjs', 'scripts/wn-updater/publisher.mjs'];
export const ALLOWED_PATHS = [...REQUIRED_PATHS,
  'extras/video-suite/ComfyUI/comfy_extras/nodes_minimax_h3.py',
  'extras/video-suite/ComfyUI/comfy_extras/canvas_h3_reference.py',
  'extras/video-suite/workflows/03-H3-Continuum-续生成.api.json',
  'extras/video-suite/workflows/04-H3-HandTie-角色音轨串联.api.json',
];
const JOURNAL = '.wn-bootstrap/transaction.json';
const closed = status => ['committed', 'rolled-back'].includes(status);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// This bootstrap runs before the updater exists, so its recovery cannot import it.
export async function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':')) fail('路径无效。');
  const parts = relative.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail('路径无效。');
  const base = path.resolve(root), target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) fail('路径超出指定目录。');
  let current = path.parse(target).root;
  const segments = path.relative(current, target).split(path.sep);
  for (let i = 0; i <= segments.length; i++) {
    const stat = await fs.lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (stat?.isSymbolicLink()) fail(`路径包含链接，已停止：${current}`);
    if (stat && i < segments.length && !stat.isDirectory()) fail(`路径父级不是目录：${current}`);
    if (i < segments.length) current = path.join(current, segments[i]);
  }
  return target;
}
async function read(root, relative) {
  const file = await safePath(root, relative);
  const stat = await fs.lstat(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (!stat) return null;
  if (!stat.isFile()) fail(`路径被非文件占用：${relative}`);
  return fs.readFile(file);
}
const json = async (root, relative) => { const bytes = await read(root, relative); return bytes === null ? null : JSON.parse(bytes.toString('utf8')); };
async function write(root, relative, bytes) {
  const file = await safePath(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await safePath(root, relative);
  const temp = `${file}.${randomUUID()}.tmp`, handle = await fs.open(temp, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(temp, file); } catch (e) { await fs.unlink(temp); throw e; }
}
const writeJson = (root, relative, value) => write(root, relative, JSON.stringify(value, null, 2) + '\n');
const currentHash = async (root, relative) => { const bytes = await read(root, relative); return bytes === null ? null : hash(bytes); };

export function configBytes(manifest) {
  return Buffer.from(JSON.stringify({ feedUrl: manifest.feedUrl, publicKey: manifest.publicKey }, null, 2) + '\n');
}
function validateManifest(manifest) {
  if (manifest?.format !== 1 || manifest.kind !== 'wn-canvas-bootstrap' || manifest.sourceVersion !== SOURCE_VERSION) fail('引导包格式或来源版本无效。');
  const url = new URL(manifest.feedUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('引导更新源必须为无鉴权的 HTTPS。');
  if (createPublicKey(manifest.publicKey).asymmetricKeyType !== 'ed25519') fail('引导公钥必须为 Ed25519。');
  if (!Array.isArray(manifest.sourceChecks) || manifest.sourceChecks.length !== SOURCE_CHECK_PATHS.length) fail('引导包缺少四项只读来源依赖校验。');
  const checkedSources = new Set();
  for (const source of manifest.sourceChecks) {
    if (!SOURCE_CHECK_PATHS.includes(source?.path) || checkedSources.has(source.path) || !hex(source.sha256)) fail('只读来源依赖清单无效。');
    checkedSources.add(source.path);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length > ALLOWED_PATHS.length) fail('引导文件清单无效。');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!ALLOWED_PATHS.includes(file?.path) || seen.has(file.path)) fail('引导清单存在未允许或重复路径。');
    seen.add(file.path);
    if ((file.before !== null && !hex(file.before)) || !hex(file.after?.sha256) || !Number.isSafeInteger(file.after.size) || file.after.size < 0 || file.after.size > 25 * 1024 * 1024) fail('引导清单文件哈希或大小无效。');
  }
  if (LEGACY_REQUIRED_PATHS.some(name => !seen.has(name))) fail('引导包缺少必需的恢复入口或配置。');
  if (manifest.files.find(f => f.path === '一键启动.cjs').before === null) fail('启动器必须声明真实来源 SHA256。');
  const config = manifest.files.find(f => f.path === '.wn-updates/config.json'), bytes = configBytes(manifest);
  if (config.before !== null || config.after.sha256 !== hash(bytes) || config.after.size !== bytes.length) fail('可信配置必须是首次新增且匹配包内公钥和更新地址。');
  return manifest;
}

export async function verifyPackage(packageDir) {
  if (!path.isAbsolute(packageDir)) fail('请使用解压包的绝对路径。');
  const bytes = await read(packageDir, 'manifest.json');
  if (!bytes || bytes.length > 65536) fail('引导清单缺失或过大。');
  const manifest = validateManifest(JSON.parse(bytes.toString('utf8')));
  const payload = new Map(), actual = [];
  async function walk(relative) {
    const folder = await safePath(packageDir, relative);
    if (!(await fs.lstat(folder)).isDirectory()) fail('载荷根目录无效。');
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      const name = `${relative}/${item.name}`;
      await safePath(packageDir, name);
      if (item.isDirectory()) await walk(name);
      else if (item.isFile()) actual.push(name.slice('payload/'.length));
      else fail('载荷包含链接或非普通文件。');
    }
  }
  await walk('payload');
  const expected = manifest.files.map(f => f.path).sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected)) fail('载荷文件范围与清单不一致。');
  for (const file of manifest.files) {
    const content = await read(packageDir, `payload/${file.path}`);
    if (!content || content.length !== file.after.size || hash(content) !== file.after.sha256) fail(`载荷校验失败：${file.path}`);
    payload.set(file.path, content);
  }
  // Older reviewed packages have no role import and remain valid. New updater cores must
  // ship both local-role and publisher modules before an online middleware can use them.
  if (payload.get('scripts/wn-updater/core.mjs').toString('utf8').includes('./role.mjs')
    && REQUIRED_PATHS.some(name => !payload.has(name))) fail('新版引导包缺少开发者/用户端模块，请包含 role.mjs 和 publisher.mjs 后重新生成。');
  return { manifest, id: hash(bytes), payload };
}

async function validateProject(project, manifest) {
  if (!path.isAbsolute(project)) fail('请使用项目的绝对路径。');
  if (!await read(project, 'VERSION') || !await read(project, 'web/package.json')) fail('目标不符合 WN-Canvas 项目结构。');
  const marker = await json(project, 'WN-DISTRIBUTION-VERSION.json');
  if (marker && marker.version !== SOURCE_VERSION) fail(`引导包仅支持 ${SOURCE_VERSION}；现有分发标识不同。`);
  for (const source of manifest.sourceChecks) {
    if (await currentHash(project, source.path) !== source.sha256) fail(`来源依赖校验失败，未修改依赖：${source.path}`);
  }
}
async function onlineIdle(project) {
  if (await read(project, '.wn-updates/pending.json')) fail('存在待安装在线更新，请先取消或完成在线更新。');
  const transaction = await json(project, '.wn-updates/transaction.json');
  if (transaction && !closed(transaction.status)) fail('在线更新事务尚未结束，请先恢复在线更新。');
  if (await read(project, '.wn-updates/installed.json')) fail('已登记在线版本，请先回滚在线更新，再回滚或修改引导入口。');
}
async function preflight(bundle, project) {
  await validateProject(project, bundle.manifest);
  const changes = [], already = [];
  for (const file of bundle.manifest.files) {
    const actual = await currentHash(project, file.path);
    if (actual === file.after.sha256) already.push(file.path);
    else if (actual === file.before) changes.push(file);
    else fail(file.path === '.wn-updates/config.json' ? '已有更新配置与引导包不同，未更换公钥或更新源。' : `来源文件冲突，未覆盖：${file.path}`);
  }
  return { changes, already };
}
export async function checkBootstrap(packageDir, project) {
  const bundle = await verifyPackage(packageDir), result = await preflight(bundle, project);
  const journal = await json(project, JOURNAL);
  if (journal && !closed(journal.status)) fail('存在未结束引导事务，请用同一包执行 apply 恢复或 rollback。');
  return { id: bundle.id, sourceVersion: SOURCE_VERSION, changes: result.changes.map(f => f.path), already: result.already };
}

async function withLock(project, relative, operation) {
  const file = await safePath(project, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await safePath(project, relative);
  let handle;
  try { handle = await fs.open(file, 'wx'); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const lock = await json(project, relative);
    if (!Number.isSafeInteger(lock?.pid) || lock.pid <= 0) fail('更新锁损坏，请保留现场检查。');
    try { process.kill(lock.pid, 0); fail('另一个引导或在线更新操作正在进行。'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    const recoveryFile = await safePath(project, relative + '.recovery');
    const recovery = await fs.open(recoveryFile, 'wx').catch(() => fail('正在恢复更新锁，请稍后重试。'));
    try {
      if (JSON.stringify(await json(project, relative)) !== JSON.stringify(lock)) fail('更新锁已变化，请重试。');
      await fs.unlink(file); handle = await fs.open(file, 'wx');
    } finally { await recovery.close(); await fs.unlink(recoveryFile); }
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); await handle.sync(); return await operation(); }
  finally { await handle.close(); await fs.unlink(file); }
}
const withUpdateLocks = (project, operation) => withLock(project, '.wn-bootstrap/lock.json', () => withLock(project, '.wn-updates/lock.json', operation));

const PORTS = [3000, 8188, 8189, 17371, 17372, 17373, 17374];
export async function requireStopped() {
  const busy = [];
  for (const port of PORTS) for (const host of ['127.0.0.1', '::1']) {
    const open = await new Promise((resolve, reject) => {
      const socket = net.connect(port, host), done = value => { socket.destroy(); resolve(value); };
      socket.setTimeout(1500, () => { socket.destroy(); reject(new Error(`无法确认端口 ${port} 已停止。`)); });
      socket.once('connect', () => done(true));
      socket.once('error', e => { if (['ECONNREFUSED', 'EAFNOSUPPORT', 'ENETUNREACH', 'EADDRNOTAVAIL'].includes(e.code)) done(false); else reject(e); });
    });
    if (open) { busy.push(port); break; }
  }
  if (busy.length) fail(`请保存工作并停止全部画布和模型后台；不会自动结束进程。仍监听端口：${busy.join('、')}。`);
}

function validateJournal(journal, bundle, project) {
  if (journal?.id !== bundle.id || journal.project !== path.resolve(project) || !['preparing', 'applying', 'rolling-back', 'committed', 'rolled-back'].includes(journal.status) || !Array.isArray(journal.paths) || new Set(journal.paths).size !== journal.paths.length || journal.paths.some(name => !bundle.manifest.files.some(f => f.path === name))) fail('引导恢复记录与此包或项目不符，请保留现场。');
  return journal.paths.map(name => bundle.manifest.files.find(f => f.path === name));
}
const backupPath = (id, name) => `.wn-bootstrap/backups/${id}/${name}`;
async function restore(bundle, project, journal) {
  const files = validateJournal(journal, bundle, project);
  for (const file of files) {
    const actual = await currentHash(project, file.path);
    if (journal.status === 'preparing' ? actual !== file.before : actual !== file.before && actual !== file.after.sha256) fail(`回滚保护：引导后文件又被修改：${file.path}`);
    if (journal.status !== 'preparing' && file.before !== null && await currentHash(project, backupPath(bundle.id, file.path)) !== file.before) fail(`引导备份校验失败：${file.path}`);
  }
  if (journal.status !== 'preparing') {
    await writeJson(project, JOURNAL, { ...journal, status: 'rolling-back' });
    for (const file of [...files].reverse()) {
      const actual = await currentHash(project, file.path);
      if (actual === file.before) continue;
      if (actual !== file.after.sha256) fail(`回滚时文件变化：${file.path}`);
      if (file.before === null) await fs.unlink(await safePath(project, file.path));
      else {
        const backup = await read(project, backupPath(bundle.id, file.path));
        if (!backup || hash(backup) !== file.before) fail(`回滚时备份变化：${file.path}`);
        await write(project, file.path, backup);
      }
    }
  }
  await writeJson(project, JOURNAL, { ...journal, status: 'rolled-back' });
  return { rolledBack: true, id: bundle.id, files: files.length };
}

export async function applyBootstrap(packageDir, project, { ensureStopped = requireStopped, afterWrite } = {}) {
  const bundle = await verifyPackage(packageDir);
  await validateProject(project, bundle.manifest);
  return withUpdateLocks(project, async () => {
    await ensureStopped(); await onlineIdle(project);
    const previous = await json(project, JOURNAL);
    if (previous && !closed(previous.status)) return restore(bundle, project, previous);
    const { changes, already } = await preflight(bundle, project);
    if (previous?.status === 'committed') {
      validateJournal(previous, bundle, project);
      if (changes.length) fail('已安装的引导文件发生变化，已保留原恢复记录；请先核对或回滚。');
      return { applied: false, id: bundle.id, files: 0, already };
    }
    const journal = { id: bundle.id, project: path.resolve(project), status: 'preparing', paths: changes.map(f => f.path) };
    await writeJson(project, JOURNAL, journal);
    try {
      for (const file of changes) if (file.before !== null) {
        const bytes = await read(project, file.path);
        if (!bytes || hash(bytes) !== file.before) fail(`备份前文件变化：${file.path}`);
        await write(project, backupPath(bundle.id, file.path), bytes);
        if (await currentHash(project, backupPath(bundle.id, file.path)) !== file.before) fail(`备份校验失败：${file.path}`);
      }
      journal.status = 'applying'; await writeJson(project, JOURNAL, journal);
      for (const file of changes) {
        if (await currentHash(project, file.path) !== file.before) fail(`安装前文件变化：${file.path}`);
        await write(project, file.path, bundle.payload.get(file.path));
        await afterWrite?.(file);
      }
      for (const file of bundle.manifest.files) if (await currentHash(project, file.path) !== file.after.sha256) fail(`引导落地校验失败：${file.path}`);
      await writeJson(project, JOURNAL, { ...journal, status: 'committed' });
      return { applied: Boolean(changes.length), id: bundle.id, files: changes.length, already };
    } catch (e) {
      try { await restore(bundle, project, journal); }
      catch (recovery) { fail(`${e.message}；引导恢复未完成：${recovery.message}。请保留现场。`); }
      throw e;
    }
  });
}
export async function rollbackBootstrap(packageDir, project, { ensureStopped = requireStopped } = {}) {
  const bundle = await verifyPackage(packageDir);
  await validateProject(project, bundle.manifest);
  return withUpdateLocks(project, async () => {
    await ensureStopped(); await onlineIdle(project);
    const journal = await json(project, JOURNAL);
    if (!journal) fail('没有引导安装恢复记录。');
    validateJournal(journal, bundle, project);
    if (journal.status === 'rolled-back') return { rolledBack: false, id: bundle.id, files: 0 };
    return restore(bundle, project, journal);
  });
}
