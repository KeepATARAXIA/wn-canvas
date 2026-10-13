import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest, fail } from './files.mjs';

const normalizedRoot = root => {
  const resolved = path.resolve(root).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

export function publisherProfilePath(root, { profileDirectory = path.join(os.homedir(), 'WN-Canvas-Publisher', 'projects') } = {}) {
  return path.join(path.resolve(profileDirectory), `${digest(normalizedRoot(root))}.json`);
}

// The role belongs to this machine and absolute installation path, outside the distributable project.
// Synchronous reads preserve stage()'s immediate rejection before it accepts a download operation.
export function readPublisherProfile(root, options) {
  const filename = publisherProfilePath(root, options);
  let current = path.parse(filename).root;
  const segments = path.relative(current, filename).split(path.sep);
  let stat;
  for (let index = 0; index <= segments.length; index++) {
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) fail('发布配置路径包含链接，已停止。');
    if (index < segments.length && !stat.isDirectory()) fail('发布配置父级不是目录。');
    if (index < segments.length) current = path.join(current, segments[index]);
  }
  if (!stat.isFile() || stat.size > 256 * 1024) fail('开发模式标记无效，请检查本机发布配置。');
  let profile;
  try { profile = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (error) { if (error instanceof SyntaxError) fail('开发模式标记损坏，请检查本机发布配置。'); throw error; }
  if (profile?.format !== 1 || profile.mode !== 'developer' || typeof profile.root !== 'string' || !path.isAbsolute(profile.root) || normalizedRoot(profile.root) !== normalizedRoot(root)) fail('开发模式标记与当前目录不匹配，请检查本机发布配置。');
  return profile;
}

export const readInstallationMode = (root, options) => readPublisherProfile(root, options) ? 'developer' : 'user';
export function requireUserInstallation(root, options) {
  if (readInstallationMode(root, options) === 'developer') fail('开发模式不接收正式版本更新，请使用发布管理。');
}
