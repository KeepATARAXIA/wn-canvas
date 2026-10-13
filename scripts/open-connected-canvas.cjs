const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function parseArguments(args) {
  const options = { port: 3000, agentPort: 17371, agent: false, noOpen: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--no-open') options.noOpen = true;
    else if (arg === '--agent') options.agent = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--port' || arg === '--agent-port') {
      const value = args[++index];
      if (!/^\d+$/.test(value || '') || Number(value) < 1 || Number(value) > 65535) throw new Error(arg + ' 需要 1–65535 的端口号。');
      options[arg === '--port' ? 'port' : 'agentPort'] = Number(value);
    } else throw new Error('未知参数：' + arg + '。运行 node 一键启动.cjs --help 查看用法。');
  }
  return options;
}

function canvasUrl({ port = 3000, agent = false, agentPort = 17371 } = {}, configFile = path.join(os.homedir(), '.infinite-canvas', 'canvas-agent.json')) {
  const url = new URL('http://localhost:' + port);
  if (agent) {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      const endpoint = new URL(config.url);
      if (endpoint.protocol === 'http:' && !endpoint.username && !endpoint.password && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
          && Number(endpoint.port) === agentPort && typeof config.token === 'string' && config.token) {
        url.hash = new URLSearchParams({ agentUrl: endpoint.href, agentToken: config.token }).toString();
      }
    } catch { /* Missing or invalid Agent config must not prevent opening the canvas. */ }
  }
  return url.href;
}

function openCanvas(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('浏览器打开失败。')));
  });
}

module.exports = { parseArguments, canvasUrl, openCanvas };
if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log('用法：node scripts/open-connected-canvas.cjs [--port 3000] [--agent] [--agent-port 17371] [--no-open]');
    else if (!options.noOpen) openCanvas(canvasUrl(options)).catch(error => { console.error(error.message); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
