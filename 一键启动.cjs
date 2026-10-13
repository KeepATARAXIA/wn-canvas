const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { parseArguments, canvasUrl, openCanvas } = require('./scripts/open-connected-canvas.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function checkNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw new Error('当前 Node.js ' + version + ' 不受支持，请安装 Node.js 22.12 或更高版本（建议 24 LTS）。');
  }
}

function requireFreePort(port, host) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => reject(new Error('本机端口 ' + port + ' 无法使用：' + error.code + '。请关闭占用它的程序或指定其他端口。')));
    probe.listen(port, host, () => probe.close(resolve));
  });
}

async function waitForReady(url, record, signal, isReady) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('启动已取消。');
    if (!record.running) throw new Error(record.name + ' 已退出，请查看上方错误。');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok && isReady(await response.text()) && record.running) {
        if (signal?.aborted) throw new Error('启动已取消。');
        return;
      }
    } catch (error) {
      if (signal?.aborted) throw new Error('启动已取消。');
      // Service may still be starting.
    }
    await sleep(150);
  }
  throw new Error(record.name + ' 在 60 秒内未就绪，请查看上方错误。');
}

// Keep every service owned by this foreground launcher; never reuse or stop another installation.
async function startCanvas(options, { root = __dirname, log = console.log, signal } = {}) {
  checkNodeVersion();
  const vite = path.join(root, 'web', 'node_modules', 'vite', 'bin', 'vite.js');
  const agent = path.join(root, 'canvas-agent', 'dist', 'index.js');
  if (!fs.existsSync(vite)) throw new Error('缺少前端依赖。请先进入 web 目录执行 npm ci，再重新启动。');
  if (options.agent && !fs.existsSync(agent)) {
    throw new Error('缺少 Canvas Agent 构建。请先进入 canvas-agent 目录执行 npm ci 和 npm run build；基础画布可不带 --agent 启动。');
  }
  await requireFreePort(options.port, 'localhost');
  if (options.agent) await requireFreePort(options.agentPort, '127.0.0.1');

  const records = [];
  let stopping;
  const assertActive = () => {
    if (signal?.aborted || stopping) throw new Error('启动已取消。');
  };
  const stop = () => stopping ||= (async () => {
    signal?.removeEventListener('abort', onAbort);
    await Promise.all(records.map(async record => {
      if (!record.running) return;
      if (process.platform === 'win32') {
        // Vite/Agent may own child processes. Only target a PID created by this launcher.
        await new Promise(resolve => execFile(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
          ['/PID', String(record.child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
      } else {
        record.child.kill('SIGTERM');
      }
      await record.done;
    }));
  })();
  const onAbort = () => { void stop(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  const launch = (name, args, cwd, env = process.env) => {
    assertActive();
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: 'inherit' });
    const record = { name, child, running: true };
    record.done = new Promise(resolve => {
      child.once('error', error => { record.running = false; resolve({ name, code: 1, error }); });
      child.once('exit', (code, signal) => { record.running = false; resolve({ name, code, signal }); });
    });
    records.push(record);
    return record;
  };

  try {
    assertActive();
    const canvas = launch('画布', [vite, '--host', 'localhost', '--port', String(options.port), '--strictPort', '--configLoader', 'runner'], path.join(root, 'web'));
    const url = 'http://localhost:' + options.port;
    await waitForReady(url, canvas, signal, body => body.includes('/src/main.tsx'));
    await waitForReady(url + '/src/main.tsx', canvas, signal, body => body.length > 0);
    if (options.agent) {
      const localAgent = launch('Canvas Agent', [agent], root, { ...process.env, PORT: String(options.agentPort) });
      await waitForReady('http://127.0.0.1:' + options.agentPort + '/health', localAgent, signal, body => {
        try { const data = JSON.parse(body); return data.ok === true && Boolean(data.protocolVersion); }
        catch { return false; }
      });
    }
    assertActive();
    log('画布已就绪：' + url);
    log('此窗口需保持打开；按 Ctrl+C 停止本次启动的画布和可选 Agent。');
    if (!options.noOpen) {
      try { await openCanvas(canvasUrl(options)); }
      catch { log('浏览器未能自动打开，请手动打开上方画布地址。'); }
    }
    assertActive();
    return { stop, done: Promise.race(records.map(record => record.done)) };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node 一键启动.cjs [--no-open] [--port 3000] [--agent] [--agent-port 17371]');
    console.log('默认仅启动本机画布；--agent 需要预先安装并编译 canvas-agent。不会安装依赖或启动模型服务。');
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let service;
  try {
    service = await startCanvas(options, { signal: controller.signal });
    const result = await service.done;
    if (!controller.signal.aborted && result.code !== 0) throw new Error(result.name + ' 异常退出，请查看上方错误。');
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    await service?.stop();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

module.exports = { checkNodeVersion, startCanvas };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
