import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { updaterMiddleware } from '../../web/local-updater.mjs';

const id = 'a'.repeat(64);
const archiveBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3]);
async function fixture(t, { mode = 'developer', publisherAvailable = true } = {}) {
  const calls = [];
  let approved = false, published = false, failVerify = false;
  const publisher = {
    async status() { calls.push(['status']); return { mode: 'developer', draft: { id, status: published ? 'published' : approved ? 'approved' : 'prepared' } }; },
    async prepare(body) { calls.push(['prepare', body]); return { id, status: 'prepared' }; },
    async approve(value) { calls.push(['approve', value]); approved = true; return { id, status: 'approved' }; },
    async verify(value) {
      calls.push(['verify', value]);
      if (!approved) throw new Error('请先确认上传并完成手动部署，再核验公网。');
      if (failVerify) throw new Error('公网仍是旧版本或发布内容与本草案不同。');
      published = true; return { id, status: 'published' };
    },
    async download(value) {
      calls.push(['download', value]);
      if (!approved) throw new Error('上传前须由开发者明确确认，草案 ZIP 尚未开放下载。');
      return { filename: 'WN-Canvas-Pages-WN-20261011-01.zip', bytes: archiveBytes };
    },
  };
  const service = { async status() { return { mode, configured: true }; } };
  const middleware = updaterMiddleware(service, publisherAvailable ? publisher : undefined);
  const server = createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/wn-update/`;
  const request = (action, options) => fetch(base + action, options);
  const post = (action, { body, headers = {} } = {}) => request(action, {
    method: 'POST', headers: { 'x-wn-update-action': action, 'x-wn-update-id': id, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = (action, headers, chunks = [], method = 'POST') => new Promise((resolve, reject) => {
    const request = httpRequest(base + action, { method, headers }, response => {
      const bytes = []; response.on('data', chunk => bytes.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(bytes) }));
    });
    request.on('error', reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
  return { request, post, raw, calls, approved: () => approved, published: () => published, failVerify: () => { failVerify = true; } };
}

test('all developer routes are forbidden to user installations before publisher operations run', async t => {
  const f = await fixture(t, { mode: 'user' });
  assert.equal((await f.request('developer-status')).status, 403);
  for (const action of ['developer-prepare', 'developer-approve', 'developer-verify']) assert.equal((await f.post(action, { body: { version: 'WN-20261011-01', notes: '说明', reviewId: id } })).status, 403);
  assert.equal((await f.request(`developer-download?draft=${id}`)).status, 403);
  assert.deepEqual(f.calls, []);
});

test('developer mode without a publisher service does not expose a fallback publication route', async t => {
  const f = await fixture(t, { publisherAvailable: false });
  assert.equal((await f.request('developer-status')).status, 403);
  assert.equal((await f.post('developer-prepare', { body: {} })).status, 403);
  assert.deepEqual(f.calls, []);
});

test('developer status is JSON, cannot be cached and supports only GET', async t => {
  const f = await fixture(t);
  const response = await f.request('developer-status');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).draft.status, 'prepared');
  const unsupported = await f.post('developer-status');
  assert.equal(unsupported.status, 405); assert.equal(unsupported.headers.get('allow'), 'GET');
});

test('preparation requires the exact operation header and JSON content', async t => {
  const f = await fixture(t);
  const body = { version: 'WN-20261011-01', notes: '说明', reviewId: id };
  assert.equal((await f.request('developer-prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
  assert.equal((await f.post('developer-prepare', { body, headers: { 'x-wn-update-action': 'developer-approve' } })).status, 403);
  const wrongType = await f.post('developer-prepare', { body, headers: { 'content-type': 'text/plain' } });
  assert.equal(wrongType.status, 409); assert.match((await wrongType.json()).message, /JSON/);
  const valid = await f.post('developer-prepare', { body });
  assert.equal(valid.status, 200);
  assert.deepEqual(f.calls, [['prepare', body]]);
});

test('preparation rejects invalid JSON and non-object bodies without calling the publisher', async t => {
  const f = await fixture(t);
  for (const body of ['{', 'null', '[]', '"text"', '42']) {
    const response = await f.request('developer-prepare', { method: 'POST', headers: { 'x-wn-update-action': 'developer-prepare', 'content-type': 'application/json' }, body });
    assert.equal(response.status, 409, body);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(f.calls, []);
});

test('preparation enforces the byte limit for declared and streaming bodies', async t => {
  const f = await fixture(t);
  const oversized = await f.post('developer-prepare', { body: { notes: 'x'.repeat(100000) } });
  assert.equal(oversized.status, 409); assert.match((await oversized.json()).message, /请求过大/);
  const chunks = await f.raw('developer-prepare', { 'x-wn-update-action': 'developer-prepare', 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, [Buffer.from('{"notes":"'), Buffer.alloc(50000, 'x'), Buffer.alloc(50000, 'x'), Buffer.from('"}')]);
  assert.equal(chunks.status, 409); assert.match(JSON.parse(chunks.body).message, /请求过大/);
  assert.deepEqual(f.calls, []);
});

test('the documented 12000-character Chinese notes fit the HTTP limit and reach the publisher intact', async t => {
  const f = await fixture(t);
  const body = { version: 'WN-20261011-01', notes: '中'.repeat(12000), reviewId: id };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 16000);
  const response = await f.post('developer-prepare', { body });
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, [['prepare', body]]);
});

test('approve, verify and download validate their identifiers before invoking the publisher', async t => {
  const f = await fixture(t);
  for (const action of ['developer-approve', 'developer-verify']) {
    for (const value of ['', 'not-an-id', '../escape', 'A'.repeat(64)]) {
      const response = await f.post(action, { headers: { 'x-wn-update-id': value } });
      assert.equal(response.status, 400, `${action}:${value}`);
    }
  }
  for (const query of ['', '?draft=../escape', '?draft=not-an-id', `?draft=${'a'.repeat(65)}`]) assert.equal((await f.request('developer-download' + query)).status, 400, query);
  assert.deepEqual(f.calls, []);
});

test('an unapproved ZIP is refused; explicit approval unlocks the exact attachment bytes', async t => {
  const f = await fixture(t);
  const unavailable = await f.request(`developer-download?draft=${id}`);
  assert.equal(unavailable.status, 409); assert.match((await unavailable.json()).message, /明确确认/);
  assert.equal(f.approved(), false);
  const approved = await f.post('developer-approve');
  assert.equal(approved.status, 200); assert.equal((await approved.json()).status, 'approved');
  const response = await f.request(`developer-download?draft=${id}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-length'), String(archiveBytes.length));
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="WN-Canvas-Pages-WN-20261011-01.zip"');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), archiveBytes);
  assert.equal(f.published(), false);
});

test('verification errors do not report a published draft through the HTTP API', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('developer-verify')).status, 409);
  assert.equal(f.published(), false);
  await f.post('developer-approve'); f.failVerify();
  const response = await f.post('developer-verify');
  assert.equal(response.status, 409); assert.match((await response.json()).message, /公网仍是旧版本/);
  assert.equal(f.published(), false);
  assert.equal((await (await f.request('developer-status')).json()).draft.status, 'approved');
});

test('developer routes retain host, origin and cross-site protections before any publisher action', async t => {
  const f = await fixture(t);
  const wrongOrigin = await f.request('developer-status', { headers: { origin: 'https://attacker.example' } });
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await f.raw('developer-status', { host: 'attacker.example' }, [], 'GET')).status, 403);
  assert.equal((await f.raw('developer-approve', { 'x-wn-update-action': 'developer-approve', 'x-wn-update-id': id, 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await f.post('developer-verify', { headers: { origin: 'http://localhost:1' } })).status, 403);
  assert.deepEqual(f.calls, []);
});

test('developer action methods and unknown routes fail before calling the publisher', async t => {
  const f = await fixture(t);
  for (const action of ['developer-prepare', 'developer-approve', 'developer-verify']) {
    const response = await f.request(action);
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'POST');
  }
  assert.equal((await f.post('developer-download')).status, 405);
  assert.equal((await f.request('developer-upload')).status, 404);
  assert.deepEqual(f.calls, []);
});
