# Canvas Agent / 本地画布助手

Canvas Agent 将 WN 画布连接到本机 Codex，并提供画布 MCP 工具。本目录保留上游 Agent 的源码和包元数据，使用时运行这里构建的版本。WN 源码候选版尚未发布独立 npm 包。

## Setup / 安装与构建

与前端统一使用 Node.js 22.12+，推荐 24 LTS。从项目根目录执行：

```powershell
cd canvas-agent
npm ci
npm run build
cd ..
```

调用 Codex 前，使用自己的账号完成 Codex 登录或配置；画布和 Agent 不提供账号、额度或 API Key。

## Start / 启动与连接

同时启动前端与 Agent：

```powershell
node 一键启动.cjs --agent
```

仅启动 Agent：

```powershell
node canvas-agent/dist/index.js
```

终端输出本机地址和连接 token。默认地址为 `http://127.0.0.1:17371`；在画布 Agent 面板输入实际地址和 token。按 `Ctrl+C` 结束对应前台进程。

根启动器可通过 `--agent-port 17381` 指定另一个 Agent 端口。前端默认地址为 `http://localhost:3000`；修改前端主机名或端口会改变浏览器 Origin，已有连接配置可能需要相应调整。

Agent 默认只监听 `127.0.0.1`。正确 token 首次连接后会记录网页 Origin；遇到问题先检查地址、token 和终端提示，不直接删除登录或用户配置。

## MCP / 终端集成

已安装并配置 Codex 的使用者可以自行注册本地构建的 MCP。将下面路径替换为本机绝对路径：

```text
codex mcp add wn-canvas -- node <项目绝对路径>/canvas-agent/dist/index.js mcp
```

这是可选的本机配置修改，基础画布不需要它。仅启动 Agent HTTP 服务不会自动注册全局 MCP。本候选目录不提供旧版 Codex 插件 marketplace 安装流程。

## Data and Limits / 数据与限制

- Agent token、日志与用户配置属于本机数据，不进入 Git、截图或公开附件。
- 侧边栏请求和附件由 Agent 交给已配置的 Codex；模型服务可能处理这些内容，提交私人素材前确认自己使用的服务。
- 画布操作以当前网页确认流程为准，不建议为排错关闭全部审批。
- Claude Code 适配器源码仍保留，当前网页主要开放 Codex；未完成入口不作为首发能力承诺。
- 独立构建与页面验证不等于新电脑登录、真实模型调用或全部 MCP 操作已验收。

## Development / 开发

在 `canvas-agent` 目录运行 `npm test` 执行已有测试，运行 `npm run build` 编译 TypeScript。调试可运行 `node dist/index.js --debug`；公开日志前检查路径、素材信息和请求内容。

本模块源自 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)，许可见 [根 LICENSE](../LICENSE)。原 `@basketikun/canvas-agent` 包名保留为上游元数据；不要向该命名空间发布 WN 改版。
