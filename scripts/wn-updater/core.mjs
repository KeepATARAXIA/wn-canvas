import net from 'node:net';
import { STATE, digest, fail, decodeRelease, loadConfig, readBytes, readJson, writeBytes, writeJson, removeFile, hashFile, withLock, validVersion } from './files.mjs';
import { readInstallationMode, requireUserInstallation } from './role.mjs';

const installedFile = `${STATE}/installed.json`;
const pendingFile = `${STATE}/pending.json`;
const journalFile = `${STATE}/transaction.json`;
const resultFile = `${STATE}/last-result.json`;
const cache = id => `${STATE}/packages/${id}`;

async function downloaded(root, id) {
  if (!/^[a-f0-9]{64}$/.test(id)) fail('本地更新编号无效。');
  const config = await loadConfig(root);
  if (!config) fail('尚未配置更新源。');
  const bytes = await readBytes(root, `${cache(id)}/release.json`);
  if (!bytes) fail('更新清单丢失，请重新下载。');
  const bundle = decodeRelease(bytes, config.publicKey);
  if (bundle.id !== id) fail('本地更新清单被改动。');
  return bundle;
}

async function installed(root) {
  const value = await readJson(root, installedFile);
  if (value && (!validVersion(value.version) || !/^[a-f0-9]{64}$/.test(value.id))) fail('本地版本记录损坏，请先检查。');
  return value;
}

export async function preflight(root, release, id) {
  const current = await installed(root);
  if (current && (current.version !== release.fromVersion && !(current.version === release.version && current.id === id))) fail(`此更新仅支持 ${release.fromVersion}，当前为 ${current.version}。`);
  const conflicts = [], changes = [];
  for (const file of release.files) {
    const actual = await hashFile(root, file.path);
    const target = file.after?.sha256 ?? null;
    if (actual !== file.before && actual !== target) conflicts.push(file.path);
    if (actual !== target) changes.push(file);
  }
  if (conflicts.length) fail(`发现 ${conflicts.length} 个文件冲突，未覆盖：${conflicts.slice(0, 12).join('、')}`);
  return { current, changes };
}

async function fetchBytes(url, limit, fetchImpl, onBytes = () => {}) {
  const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) fail(`下载失败（HTTP ${response.status}），已保留当前版本。`);
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); fail('下载文件超过清单大小。'); }
  const chunks = [], reader = response.body.getReader();
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) fail('下载文件超过清单大小。');
      chunks.push(value); onBytes(value.length);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

const summary = bundle => ({ id: bundle.id, version: bundle.release.version, fromVersion: bundle.release.fromVersion, notes: bundle.release.notes, bytes: bundle.release.files.reduce((n, f) => n + (f.after?.size || 0), 0), files: bundle.release.files.length });

export function createUpdateService(root, { fetchImpl = fetch, profileDirectory } = {}) {
  const roleOptions = { profileDirectory };
  let latest = null, compatibility = null, phase = 'idle', error = '', received = 0, total = 0;
  let operation = null;
  return {
    async status() {
      const mode = readInstallationMode(root, roleOptions);
      const config = await loadConfig(root);
      const current = await installed(root);
      const pending = await readJson(root, pendingFile);
      const prepared = pending ? summary(await downloaded(root, pending.id)) : null;
      const transaction = await readJson(root, journalFile);
      return { mode, compatibility, configured: Boolean(config), currentVersion: current?.version || null, release: latest ? summary(latest) : null, pending: prepared, awaitingConfirmation: transaction?.status === 'awaiting-browser' ? transaction.id : null, phase, received, total, error, lastResult: await readJson(root, resultFile) };
    },
    async check() {
      requireUserInstallation(root, roleOptions);
      if (operation) fail('正在准备更新，请稍后再检查。');
      const config = await loadConfig(root);
      if (!config) return this.status();
      if (phase === 'checking') fail('正在检查更新。');
      phase = 'checking'; error = ''; latest = null; compatibility = null;
      try {
        const candidate = decodeRelease(await fetchBytes(config.feedUrl, 2 * 1024 * 1024, fetchImpl), config.publicKey);
        const current = await installed(root);
        if (current && candidate.release.version <= current.version) {
          if (candidate.release.version === current.version && candidate.id !== current.id) fail('同一版本的发布内容发生变化，已拒绝。');
          phase = 'current';
        } else {
          latest = candidate;
          try { await preflight(root, candidate.release, candidate.id); compatibility = { compatible: true, message: '' }; }
          catch (failure) { compatibility = { compatible: false, message: failure.message }; }
          phase = 'available';
        }
      } catch (failure) { error = failure.message; phase = 'error'; throw failure; }
      return this.status();
    },
    stage(id) {
      requireUserInstallation(root, roleOptions);
      if (operation || phase === 'checking') fail('另一个更新操作正在进行。');
      if (!latest || latest.id !== id) fail('请先重新检查更新。');
      const selected = latest;
      phase = 'downloading'; error = ''; received = 0; total = summary(selected).bytes;
      operation = withLock(root, async () => {
        requireUserInstallation(root, roleOptions);
        const config = await loadConfig(root);
        if (!config) fail('更新源已移除。');
        decodeRelease(selected.envelope, config.publicKey);
        if (await readJson(root, journalFile)) {
          const transaction = await readJson(root, journalFile);
          if (!['committed', 'rolled-back'].includes(transaction.status)) fail('上一次安装尚未结束，请先恢复。');
        }
        const existing = await readJson(root, pendingFile);
        if (existing && existing.id !== selected.id) fail('已有待安装更新，请先取消。');
        const initial = await preflight(root, selected.release, selected.id);
        if (initial.current?.id === selected.id) { phase = 'current'; return; }
        for (const file of selected.release.files) {
          if (!file.after) continue;
          const relative = `${cache(selected.id)}/files/${file.after.sha256}`;
          const saved = await readBytes(root, relative);
          if (saved && saved.length === file.after.size && digest(saved) === file.after.sha256) { received += file.after.size; continue; }
          const url = new URL(`files/${file.after.sha256}`, config.feedUrl);
          const bytes = await fetchBytes(url, file.after.size, fetchImpl, amount => { received += amount; });
          if (bytes.length !== file.after.size || digest(bytes) !== file.after.sha256) fail(`文件校验失败：${file.path}`);
          requireUserInstallation(root, roleOptions);
          await writeBytes(root, relative, bytes);
        }
        // Check again after the download; the local source may have changed meanwhile.
        await preflight(root, selected.release, selected.id);
        requireUserInstallation(root, roleOptions);
        await writeBytes(root, `${cache(selected.id)}/release.json`, selected.envelope);
        await writeJson(root, pendingFile, { id: selected.id });
        phase = 'ready';
      }).catch(failure => { error = failure.message; phase = 'error'; }).finally(() => { operation = null; });
      return { accepted: true };
    },
    async wait() { await operation; return this.status(); },
    async cancel() {
      requireUserInstallation(root, roleOptions);
      if (operation) fail('正在下载，请结束后再取消安装。');
      await withLock(root, async () => {
        requireUserInstallation(root, roleOptions);
        const transaction = await readJson(root, journalFile);
        if (transaction && !['committed', 'rolled-back'].includes(transaction.status)) fail('安装已经开始，不能取消；请等待启动确认或恢复。');
        await removeFile(root, pendingFile);
      });
      phase = 'idle'; error = '';
      return this.status();
    },
    async confirm(id) { await confirmStartup(root, id, roleOptions); phase = 'current'; latest = null; compatibility = null; return this.status(); },
  };
}

const MANAGED_PORTS = [3000, 8188, 8189, 17371, 17372, 17373, 17374];
async function portOpen(port, host) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host);
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1500, () => { socket.destroy(); reject(new Error(`无法确认端口 ${port} 是否已关闭。`)); });
    socket.once('connect', () => done(true));
    socket.once('error', err => { if (['ECONNREFUSED', 'EAFNOSUPPORT', 'ENETUNREACH', 'EADDRNOTAVAIL'].includes(err.code)) done(false); else reject(err); });
  });
}
export async function requireStopped() {
  const busy = [];
  for (const port of MANAGED_PORTS) {
    if (await portOpen(port, '127.0.0.1') || await portOpen(port, '::1')) busy.push(port);
  }
  if (busy.length) fail(`更新尚未安装：请先关闭画布和所有模型后台，或重启电脑后再一键启动。仍在监听的端口：${busy.join('、')}。关闭浏览器不会停止后台。`);
}

async function restore(root, transaction) {
  const bundle = await downloaded(root, transaction.id);
  const files = transaction.paths.map(name => bundle.release.files.find(file => file.path === name));
  if (files.some(file => !file) || new Set(transaction.paths).size !== files.length) fail('更新恢复记录无效。');
  // Validate every target and backup before restoring any file.
  for (const file of files) {
    const actual = await hashFile(root, file.path);
    if (actual !== file.before && actual !== (file.after?.sha256 ?? null)) fail(`回滚保护：更新后文件又被修改：${file.path}`);
    if (file.before !== null && await hashFile(root, `${STATE}/backups/${transaction.id}/${file.path}`) !== file.before) fail(`回滚备份校验失败：${file.path}`);
  }
  const current = await installed(root);
  if (JSON.stringify(current) !== JSON.stringify(transaction.previous) && !(current?.id === transaction.id && current?.version === bundle.release.version)) fail('版本记录已变化，停止回滚。');
  for (const file of [...files].reverse()) {
    if (file.before === null) await removeFile(root, file.path);
    else await writeBytes(root, file.path, await readBytes(root, `${STATE}/backups/${transaction.id}/${file.path}`));
  }
  if (transaction.previous) await writeJson(root, installedFile, transaction.previous);
  else await removeFile(root, installedFile);
  await removeFile(root, pendingFile);
  await writeJson(root, journalFile, { ...transaction, status: 'rolled-back' });
  await writeJson(root, resultFile, { status: 'rolled-back', version: bundle.release.version, at: new Date().toISOString() });
}

export async function rollback(root, { ensureStopped = requireStopped } = {}) {
  return withLock(root, async () => {
    await ensureStopped();
    const transaction = await readJson(root, journalFile);
    if (!transaction || transaction.status === 'rolled-back') fail('没有可回滚的更新。');
    await restore(root, transaction);
    return { rolledBack: true };
  });
}

export async function prepareStartup(root, { ensureStopped = requireStopped, afterWrite, profileDirectory } = {}) {
  const roleOptions = { profileDirectory };
  const mode = readInstallationMode(root, roleOptions);
  const pending = await readJson(root, pendingFile);
  const previous = await readJson(root, journalFile);
  if (mode === 'developer' && (pending || (previous && !['committed', 'rolled-back'].includes(previous.status)))) fail('开发模式存在待安装更新或未确认事务，已停止启动；请先恢复用户模式，再取消尚未安装的更新；已开始的事务请恢复或回滚。');
  if (!pending && (!previous || ['committed', 'rolled-back'].includes(previous.status))) return { restart: false };
  return withLock(root, async () => {
    requireUserInstallation(root, roleOptions);
    await ensureStopped();
    requireUserInstallation(root, roleOptions);
    const transaction = await readJson(root, journalFile);
    if (transaction && !['committed', 'rolled-back'].includes(transaction.status)) {
      await restore(root, transaction);
      return { restart: false, rolledBack: true };
    }
    const waiting = await readJson(root, pendingFile);
    if (!waiting) return { restart: false };
    const bundle = await downloaded(root, waiting.id);
    const { current, changes } = await preflight(root, bundle.release, bundle.id);
    if (current?.id === bundle.id && transaction?.status === 'committed' && transaction.id === bundle.id) {
      if (changes.length) fail('已安装版本的文件被修改，请先检查。');
      await removeFile(root, pendingFile);
      return { restart: false };
    }
    // Complete validation and backup before changing any program file.
    for (const file of bundle.release.files) {
      if (file.after) {
        const bytes = await readBytes(root, `${cache(bundle.id)}/files/${file.after.sha256}`);
        if (!bytes || bytes.length !== file.after.size || digest(bytes) !== file.after.sha256) fail(`更新缓存损坏：${file.path}`);
      }
    }
    for (const file of changes) {
      if (file.before !== null) {
        const bytes = await readBytes(root, file.path);
        if (!bytes || digest(bytes) !== file.before) fail(`备份前文件发生变化：${file.path}`);
        await writeBytes(root, `${STATE}/backups/${bundle.id}/${file.path}`, bytes);
      }
    }
    const journal = { id: bundle.id, status: 'applying', previous: current, paths: changes.map(file => file.path) };
    requireUserInstallation(root, roleOptions);
    await writeJson(root, journalFile, journal);
    try {
      for (const file of changes) {
        requireUserInstallation(root, roleOptions);
        if (await hashFile(root, file.path) !== file.before) fail(`安装前文件发生变化：${file.path}`);
        if (file.after) await writeBytes(root, file.path, await readBytes(root, `${cache(bundle.id)}/files/${file.after.sha256}`));
        else await removeFile(root, file.path);
        await afterWrite?.(file);
      }
      for (const file of bundle.release.files) if (await hashFile(root, file.path) !== (file.after?.sha256 ?? null)) fail(`安装校验失败：${file.path}`);
      requireUserInstallation(root, roleOptions);
      await writeJson(root, journalFile, { ...journal, status: 'awaiting-start' });
      return { restart: true, id: bundle.id, version: bundle.release.version };
    } catch (failure) {
      try { await restore(root, journal); }
      catch (restoreError) { fail(`${failure.message}；自动恢复未完成：${restoreError.message}。请保留备份并检查。`); }
      throw failure;
    }
  });
}

export async function markStartupReady(root, id, roleOptions) {
  if (!id) return;
  requireUserInstallation(root, roleOptions);
  await withLock(root, async () => {
    requireUserInstallation(root, roleOptions);
    const transaction = await readJson(root, journalFile);
    if (transaction?.id !== id || transaction.status !== 'awaiting-start') fail('更新启动确认状态不一致。');
    await writeJson(root, journalFile, { ...transaction, status: 'awaiting-browser' });
  });
}

export async function confirmStartup(root, id, roleOptions) {
  requireUserInstallation(root, roleOptions);
  if (!id) fail('缺少更新确认编号。');
  await withLock(root, async () => {
    requireUserInstallation(root, roleOptions);
    const transaction = await readJson(root, journalFile);
    if (transaction?.id !== id || transaction.status !== 'awaiting-browser') fail('后台尚未就绪，不能确认更新。');
    const bundle = await downloaded(root, id);
    for (const file of bundle.release.files) if (await hashFile(root, file.path) !== (file.after?.sha256 ?? null)) fail(`启动后文件校验失败：${file.path}`);
    await writeJson(root, installedFile, { version: bundle.release.version, id });
    await writeJson(root, journalFile, { ...transaction, status: 'committed' });
    await removeFile(root, pendingFile);
    await writeJson(root, resultFile, { status: 'installed', version: bundle.release.version, at: new Date().toISOString() });
  });
}
