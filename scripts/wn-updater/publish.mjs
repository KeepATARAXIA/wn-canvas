import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import { digest, fail, programPath, readBytes, writeBytes, validateRelease } from './files.mjs';

// Input is an explicit reviewed file list. Never scan or package a developer's entire installation.
export async function publishRelease({ baseRoot, targetRoot, outDir, files, fromVersion, version, notes, privateKey }) {
  if (!Array.isArray(files) || !files.length) fail('请提供明确的程序文件清单。');
  const entries = [], payload = new Map();
  for (const relative of files) {
    programPath(relative);
    const before = await readBytes(baseRoot, relative);
    const after = await readBytes(targetRoot, relative);
    const oldHash = before === null ? null : digest(before), newHash = after === null ? null : digest(after);
    if (oldHash === newHash) continue;
    entries.push({ path: relative, before: oldHash, after: after === null ? null : { sha256: newHash, size: after.length } });
    if (after !== null) payload.set(newHash, after);
  }
  const release = validateRelease({ format: 1, app: 'wn-canvas', fromVersion, version, notes, files: entries });
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') fail('发布私钥须为 Ed25519。');
  const bytes = Buffer.from(JSON.stringify(release));
  const envelope = Buffer.from(JSON.stringify({ payload: bytes.toString('base64'), signature: sign(null, bytes, key).toString('base64') }));
  const resolvedOut = path.resolve(outDir);
  for (const source of [baseRoot, targetRoot]) {
    const resolved = path.resolve(source);
    if (resolved === resolvedOut || resolved.startsWith(resolvedOut + path.sep)) fail('发布目录不能包含来源目录。');
  }
  // Refuse to overwrite an existing release, including a partially created one.
  await fs.mkdir(resolvedOut, { recursive: false });
  for (const [hash, content] of payload) await writeBytes(resolvedOut, `files/${hash}`, content);
  await writeBytes(resolvedOut, 'release.json', envelope);
  return { version, fromVersion, id: digest(envelope), files: entries.length, bytes: [...payload.values()].reduce((n, bytes) => n + bytes.length, 0) };
}
