import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdateService } from '../scripts/wn-updater/core.mjs';
import { createPublisherService } from '../scripts/wn-updater/publisher.mjs';

async function readBody(req) {
  const limit = 80 * 1024;
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw new Error('发布请求过大。'); }
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('发布请求须使用 JSON。');
  const chunks = []; let received = 0, oversized = false;
  for await (const bytes of req) {
    received += bytes.length;
    if (received > limit) oversized = true;
    if (!oversized) chunks.push(bytes);
  }
  if (oversized) throw new Error('发布请求过大。');
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('发布请求内容无效。');
  return body;
}

export function updaterMiddleware(service, publisher) {
  return async (req, res, next) => {
    const pathname = (req.url || '').split('?')[0];
    if (!pathname.startsWith('/api/wn-update/')) return next();
    const reply = (status, data) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(data));
    };
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return reply(403, { message: '仅支持本机更新。' });
    try {
      const host = new URL(`http://${req.headers.host}`);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || host.username || host.password) throw new Error();
      if (req.headers.origin && new URL(req.headers.origin).origin !== host.origin) throw new Error();
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new Error();
    } catch { return reply(403, { message: '更新请求来源不被允许。' }); }
    const action = pathname.slice('/api/wn-update/'.length);
    if (!['status', 'check', 'stage', 'cancel', 'confirm', 'developer-status', 'developer-prepare', 'developer-approve', 'developer-verify', 'developer-download'].includes(action)) return reply(404, { message: '更新操作不存在。' });
    const method = ['status', 'developer-status', 'developer-download'].includes(action) ? 'GET' : 'POST';
    if (req.method !== method) { res.setHeader('Allow', method); return reply(405, { message: '请求方法不支持。' }); }
    if (method === 'POST' && req.headers['x-wn-update-action'] !== action) return reply(403, { message: '更新请求缺少操作标识。' });
    try {
      if (action.startsWith('developer-')) {
        if (!publisher || (await service.status()).mode !== 'developer') return reply(403, { message: '发布管理仅对本机开发者开放。' });
        if (action === 'developer-status') return reply(200, await publisher.status());
        if (action === 'developer-prepare') return reply(200, await publisher.prepare(await readBody(req)));
        const id = action === 'developer-download' ? new URL(req.url, 'http://localhost').searchParams.get('draft') : req.headers['x-wn-update-id'];
        if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return reply(400, { message: '发布草案编号无效，请重新准备。' });
        if (action === 'developer-approve') return reply(200, await publisher.approve(id));
        if (action === 'developer-verify') return reply(200, await publisher.verify(id));
        const archive = await publisher.download(id);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Disposition', `attachment; filename="${archive.filename}"`);
        res.setHeader('Content-Length', archive.bytes.length);
        return res.end(archive.bytes);
      }
      if (action === 'stage' || action === 'confirm') {
        const id = req.headers['x-wn-update-id'];
        if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return reply(400, { message: '请先重新检查更新。' });
        return action === 'stage' ? reply(202, service.stage(id)) : reply(200, await service.confirm(id));
      }
      return reply(200, await service[action]());
    } catch (error) { return reply(409, { message: error.message || '更新未完成，请稍后重试。' }); }
  };
}

export function localUpdaterPlugin() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const middleware = updaterMiddleware(createUpdateService(root), createPublisherService(root));
  return { name: 'wn-local-updater', configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
