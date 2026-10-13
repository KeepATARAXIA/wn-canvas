import * as fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { publishRelease } from './publish.mjs';
import { rollback, createUpdateService } from './core.mjs';

const [command, ...args] = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!args[index].startsWith('--') || !args[index + 1]) throw new Error('参数须使用 --名称 值。');
  options[args[index].slice(2)] = args[index + 1];
}
const required = key => { if (!options[key]) throw new Error(`缺少 --${key}`); return options[key]; };
try {
  if (command === 'keygen') {
    const directory = path.resolve(required('out'));
    await fs.mkdir(directory, { recursive: false });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await fs.writeFile(path.join(directory, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(directory, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
    console.log('已生成发布密钥。private.pem 必须离线保管，不得放入更新源或分发包。');
  } else if (command === 'publish') {
    const outDir = path.resolve(required('out')), keyPath = path.resolve(required('key'));
    if (keyPath.startsWith(outDir + path.sep)) throw new Error('私钥不能放在发布目录中。');
    const result = await publishRelease({ baseRoot: required('base'), targetRoot: required('target'), outDir, files: JSON.parse(await fs.readFile(required('files'), 'utf8')), fromVersion: required('from'), version: required('version'), notes: await fs.readFile(required('notes'), 'utf8'), privateKey: await fs.readFile(keyPath) });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'rollback') {
    console.log(JSON.stringify(await rollback(path.resolve(required('root')))));
  } else if (command === 'cancel') {
    await createUpdateService(path.resolve(required('root'))).cancel();
    console.log('已取消待安装更新，保留下载缓存和现有程序。');
  } else {
    console.log('命令：keygen --out 新密钥目录；publish --base 基线目录 --target 新版目录 --files 文件清单.json --from 来源版本 --version 新版本 --notes 说明.txt --key 私钥.pem --out 新发布目录；rollback --root 安装目录；cancel --root 安装目录。');
    if (command) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
