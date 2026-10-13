import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPackage, checkBootstrap, applyBootstrap, rollbackBootstrap } from './core.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const [command, flag, project, ...extra] = process.argv.slice(2);
try {
  if (command === 'verify' && !flag) {
    const { id, manifest } = await verifyPackage(packageDir);
    console.log(JSON.stringify({ verified: true, id, sourceVersion: manifest.sourceVersion, files: manifest.files.length }, null, 2));
  } else if (['check', 'apply', 'rollback'].includes(command) && flag === '--project' && project && !extra.length) {
    const execute = { check: checkBootstrap, apply: applyBootstrap, rollback: rollbackBootstrap }[command];
    console.log(JSON.stringify(await execute(packageDir, project), null, 2));
  } else throw new Error('用法：cli.mjs verify；cli.mjs check|apply|rollback --project 项目绝对路径。');
} catch (e) { console.error(e.message); process.exitCode = 1; }
