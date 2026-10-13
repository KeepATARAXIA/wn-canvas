const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { checkNodeVersion, startCanvas } = require('../../一键启动.cjs');
const { parseArguments, canvasUrl } = require('../open-connected-canvas.cjs');

async function freePort(host = 'localhost') {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function fixture(t, { agent = false, failModule = false } = {}) {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'wn-opensource-launcher-'));
  t.after(async () => {
    const relative = path.relative(parent, path.resolve(root));
    assert.ok(relative.startsWith('wn-opensource-launcher-') && !relative.includes(path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const vite = path.join(root, 'web/node_modules/vite/bin/vite.js');
  await fs.mkdir(path.dirname(vite), { recursive: true });
  const lines = [
    "const http = require('node:http');",
    "const args = process.argv.slice(2), port = Number(args[args.indexOf('--port') + 1]), host = args[args.indexOf('--host') + 1];",
    "const requests = [];",
    "const server = http.createServer((req, res) => {",
    "  requests.push(req.url);",
    failModule ? "  if (req.url === '/src/main.tsx') { res.statusCode = 500; res.end('compile failed'); setTimeout(() => process.exit(1), 20); return; }" : "",
    "  res.setHeader('Content-Type', req.url === '/probe' ? 'application/json' : 'text/javascript');",
    "  if (req.url === '/probe') return res.end(JSON.stringify({ args, requests, address: server.address().address }));",
    "  if (req.url === '/src/main.tsx') return res.end('export const compiled = true;');",
    "  res.end('<script type=\"module\" src=\"/src/main.tsx\"></script>');",
    "});",
    "server.listen(port, host);",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ];
  await fs.writeFile(vite, lines.join('\n'));
  if (agent) {
    const entry = path.join(root, 'canvas-agent/dist/index.js');
    await fs.mkdir(path.dirname(entry), { recursive: true });
    await fs.writeFile(entry, [
      "const http = require('node:http');",
      "require('node:fs').writeFileSync('agent-started.txt', 'started');",
      "const server = http.createServer((_req, res) => res.end(JSON.stringify({ ok: true, protocolVersion: 1 })));",
      "server.listen(Number(process.env.PORT), '127.0.0.1');",
      "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
    ].join('\n'));
  }
  return root;
}

const quiet = () => {};

test('default launch does not enable Agent or change the normal origin', () => {
  assert.deepEqual(parseArguments([]), { port: 3000, agentPort: 17371, agent: false, noOpen: false, help: false });
  assert.equal(canvasUrl({}, path.join(os.tmpdir(), 'absent-wn-agent-config.json')), 'http://localhost:3000/');
});

test('explicit options accept isolated ports and reject invalid input', () => {
  assert.deepEqual(parseArguments(['--no-open', '--port', '13103', '--agent', '--agent-port', '17381']),
    { port: 13103, agentPort: 17381, agent: true, noOpen: true, help: false });
  for (const args of [['--port'], ['--port', '0'], ['--port', '65536'], ['--port', '3000bad'], ['--host', '0.0.0.0']]) {
    assert.throws(() => parseArguments(args));
  }
});

test('Node requirement matches the public project engines', () => {
  for (const version of ['18.20.0', '20.19.0', '22.11.0']) assert.throws(() => checkNodeVersion(version), /Node.js/);
  for (const version of ['22.12.0', '24.0.0']) assert.doesNotThrow(() => checkNodeVersion(version));
});

test('Agent URL uses a fragment only with explicit opt-in and matching local config', async t => {
  const root = await fixture(t);
  const filename = path.join(root, 'agent.json');
  await fs.writeFile(filename, JSON.stringify({ url: 'http://127.0.0.1:17381', token: 'fixture-token-only' }));
  assert.equal(canvasUrl({ port: 13103 }, filename), 'http://localhost:13103/');
  const connected = new URL(canvasUrl({ port: 13103, agent: true, agentPort: 17381 }, filename));
  assert.equal(connected.search, '');
  assert.equal(new URLSearchParams(connected.hash.slice(1)).get('agentToken'), 'fixture-token-only');
  assert.equal(canvasUrl({ agent: true }, filename), 'http://localhost:3000/');
  await fs.writeFile(filename, JSON.stringify({ url: 'https://example.com:17381', token: 'fixture-token-only' }));
  assert.equal(canvasUrl({ agent: true, agentPort: 17381 }, filename), 'http://localhost:3000/');
  await fs.writeFile(filename, '{invalid');
  assert.equal(canvasUrl({ agent: true }, filename), 'http://localhost:3000/');
  assert.equal(canvasUrl({ agent: true }, path.join(root, 'missing.json')), 'http://localhost:3000/');
});

test('base startup works without extras or Agent and confirms module compilation', async t => {
  const root = await fixture(t, { agent: true });
  const port = await freePort();
  const options = parseArguments(['--no-open', '--port', String(port)]);
  const running = await startCanvas(options, { root, log: quiet });
  t.after(() => running.stop());
  const result = await (await fetch('http://localhost:' + port + '/probe')).json();
  assert.ok(result.requests.includes('/src/main.tsx'));
  assert.ok(['127.0.0.1', '::1'].includes(result.address));
  assert.ok(result.args.includes('--strictPort'));
  assert.equal(result.args[result.args.indexOf('--configLoader') + 1], 'runner');
  await assert.rejects(fs.access(path.join(root, 'agent-started.txt')));
  await assert.rejects(fs.access(path.join(root, 'extras')));
  await running.stop();
  await assert.rejects(fetch('http://localhost:' + port, { signal: AbortSignal.timeout(1500) }));
});

test('missing dependencies and explicit missing Agent fail with install instructions', async t => {
  const root = await fixture(t);
  const options = parseArguments(['--no-open', '--agent', '--port', String(await freePort())]);
  await assert.rejects(startCanvas(options, { root, log: quiet }), /canvas-agent.*npm ci.*npm run build/);
  await assert.rejects(startCanvas(options, { root: path.join(root, 'missing'), log: quiet }), /web.*npm ci/);
});

test('an occupied port is rejected without reusing or stopping the existing service', async t => {
  const root = await fixture(t);
  const existing = http.createServer((_req, res) => res.end('existing service'));
  await new Promise(resolve => existing.listen(0, 'localhost', resolve));
  t.after(() => new Promise(resolve => existing.close(resolve)));
  const port = existing.address().port;
  await assert.rejects(startCanvas(parseArguments(['--no-open', '--port', String(port)]), { root, log: quiet }), /端口.*EADDRINUSE/);
  assert.equal(await (await fetch('http://localhost:' + port)).text(), 'existing service');
});

test('entry-module compilation failure never reports the canvas ready', async t => {
  const root = await fixture(t, { failModule: true });
  const port = await freePort();
  const messages = [];
  await assert.rejects(startCanvas(parseArguments(['--no-open', '--port', String(port)]), { root, log: message => messages.push(message) }), /已退出/);
  assert.deepEqual(messages, []);
});

test('explicit Agent uses its own port and stops with the foreground launcher', async t => {
  const root = await fixture(t, { agent: true });
  const port = await freePort();
  const agentPort = await freePort('127.0.0.1');
  const controller = new AbortController();
  const options = parseArguments(['--no-open', '--agent', '--port', String(port), '--agent-port', String(agentPort)]);
  const running = await startCanvas(options, { root, log: quiet, signal: controller.signal });
  t.after(() => running.stop());
  assert.equal(await fs.readFile(path.join(root, 'agent-started.txt'), 'utf8'), 'started');
  assert.equal((await (await fetch('http://127.0.0.1:' + agentPort + '/health')).json()).ok, true);
  controller.abort();
  await running.stop();
  await assert.rejects(fetch('http://localhost:' + port, { signal: AbortSignal.timeout(1500) }));
  await assert.rejects(fetch('http://127.0.0.1:' + agentPort, { signal: AbortSignal.timeout(1500) }));
});

test('cancelling as a delayed readiness body resolves never launches the optional Agent', async t => {
  const root = await fixture(t, { agent: true });
  const port = await freePort();
  const agentPort = await freePort('127.0.0.1');
  const controller = new AbortController();
  const realFetch = globalThis.fetch;
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const response = await realFetch(url, options);
    if (String(url) !== 'http://localhost:' + port + '/src/main.tsx') return response;
    return {
      ok: response.ok,
      async text() {
        const body = await response.text();
        await new Promise(resolve => setTimeout(resolve, 30));
        // Abort in the readiness response, before the asynchronous process stop completes.
        controller.abort();
        return body;
      },
    };
  });
  const options = parseArguments(['--no-open', '--agent', '--port', String(port), '--agent-port', String(agentPort)]);
  await assert.rejects(startCanvas(options, { root, signal: controller.signal, log: message => messages.push(message) }), /启动已取消/);
  await new Promise(resolve => setTimeout(resolve, 200));
  await assert.rejects(fs.access(path.join(root, 'agent-started.txt')));
  assert.deepEqual(messages, []);
  await assert.rejects(realFetch('http://localhost:' + port, { signal: AbortSignal.timeout(1500) }));
  await assert.rejects(realFetch('http://127.0.0.1:' + agentPort, { signal: AbortSignal.timeout(1500) }));
});
