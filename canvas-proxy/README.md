# Canvas Proxy / 本地接口代理

浏览器直连第三方 AI 接口遇到跨域限制时，可将请求先发到本机代理，再转发到目标服务。本代理是可选组件，基础画布不依赖它。

## Start / 启动

与前端统一使用 Node.js 22.12+，推荐 24 LTS。本模块仅使用 Node 标准库，无需安装第三方依赖。从项目根目录执行：

```powershell
node canvas-proxy/index.js
```

默认监听 `http://127.0.0.1:23210`。将该地址填入画布的本地代理设置并启用；保持终端打开，按 `Ctrl+C` 结束进程。

更换端口：

```powershell
node canvas-proxy/index.js --port 23211 --host 127.0.0.1
```

代码也读取 `PORT`、`HOST` 环境变量；使用已有终端环境时确认没有把监听地址改为公网地址。

## Behavior / 转发行为

目标地址接在代理地址后：

```text
http://127.0.0.1:23210/https://api.example.com/v1/models
```

代理转发方法、请求体与请求头，移除必要的逐跳头；返回上游响应并补充 CORS 头，支持 SSE 流式转发。根路径返回代理版本信息。

代理不校验 API Key，不提供账号或额度。Key 由浏览器持有并随请求转发；目标服务仍按自己的权限和计费规则处理请求。

## Access and Logs / 访问与日志

默认仅监听本机回环地址。代理可向任意目标转发请求，只用于可信的本机环境，不要通过 `--host 0.0.0.0` 对公网开放。

每次转发会在终端打印方法、完整目标 URL、状态与耗时，不主动落盘请求体或请求头。URL 查询参数本身可能含敏感信息，分享终端日志前仍需检查。

本源码来自 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)，许可见 [根 LICENSE](../LICENSE)。保留的 `@basketikun/canvas-proxy` 包名属于上游元数据；WN 候选版没有向该命名空间发布程序。
