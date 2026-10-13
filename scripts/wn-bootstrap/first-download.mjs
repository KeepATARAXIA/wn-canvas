import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkBootstrap, safePath } from './core.mjs';

// Only the updater whose installed bytes match this reviewed bootstrap is executed.
export async function prepareFirstDownload(packageDir, project, { createService } = {}) {
  const checked = await checkBootstrap(packageDir, project);
  if (checked.changes.length) throw new Error('请先完成引导安装，再首次下载在线更新。');
  const makeService = createService || (async root => {
    const module = await import(pathToFileURL(await safePath(root, 'scripts/wn-updater/core.mjs')).href);
    return module.createUpdateService(root);
  });
  const service = await makeService(project), status = await service.status();
  if (status.awaitingConfirmation) throw new Error('上次在线更新等待启动确认，请先完成或恢复。');
  const checkedRelease = await service.check();
  if (checkedRelease.phase === 'current') return { current: true, status: checkedRelease };
  if (!checkedRelease.release) throw new Error('更新源尚无可用正式清单。');
  service.stage(checkedRelease.release.id);
  const ready = await service.wait();
  if (ready.phase !== 'ready' || !ready.pending) throw new Error(ready.error || '首次下载未准备完成，现有程序保留。');
  return { ready: true, status: ready };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--project') throw new Error('用法：first-download.mjs --project 项目绝对路径');
    const result = await prepareFirstDownload(path.dirname(fileURLToPath(import.meta.url)), process.argv[3]);
    console.log(JSON.stringify(result, null, 2));
    if (result.ready) console.log('已下载并校验。请保存工作、停止所有画布及模型后台，再一键启动；本工具不会停止进程或安装文件。');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
