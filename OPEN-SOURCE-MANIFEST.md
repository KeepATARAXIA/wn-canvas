# Open-Source Manifest / 公开文件说明

本目录从本地整合包筛选而来，原开发目录独立保留。本目录尚未建立正式 GitHub 发布版本。此文件描述分发边界，不替代正式发布的逐文件 SHA256 清单。

## Included / 保留内容

| 路径 | 用途与边界 |
|---|---|
| `web/src/`、`web/tests/` | 画布源码与测试；保留接入界面不表示附带对应后端 |
| `web/package.json`、lockfile、构建配置 | 安装与构建所需，不附已安装依赖 |
| `web/public/config.js`、`web/public/workflows/` | 空白运行配置与筛选后的轻量工作流 |
| `web/public/local-prompt-skills/` | 四份带来源与内嵌 MIT 许可的资料包 |
| `canvas-agent/`、`canvas-proxy/` | 本地 Agent 与接口转发源码、测试、依赖清单 |
| `plugins/canvas/` | SDK、模板、示例和注册表源码；不承诺已有 WN 插件发布服务 |
| `browser-extension/jimeng-canvas-bridge/` | 即梦桥接源码，不含浏览器资料或账号配置 |
| `scripts/` | 筛选的服务、启动/更新源码与测试；部分仍依赖整合包路径，不由基础启动自动执行 |
| `一键启动.cjs`、`启动无限画布.bat` | 本目录的基础启动入口，可显式选择已构建的 Agent |
| `LICENSE`、`VERSION`、`CHANGELOG.md` | 原许可和构建输入；不代表候选版已发布 |
| 根说明及验证记录 | 公开边界、开发规则、整理状态和实际检查结果 |

`web/src/services/api/templates/comfyui-minimax-h3-before-submission-retry.txt` 是此前内置调用脚本的精确快照，用于识别并迁移旧脚本；它不包含被排除的官方 H3 提示指南正文。

## Excluded / 不进入公开源码

- **运行环境**：整个 extras、runtime、node_modules，模型权重、Python 环境、第三方 EXE/DLL/PYD 和工具用户目录。
- **个人与运行数据**：作品、输入输出媒体、任务、日志、缓存、浏览器资料、token、API Key、登录配置和开发者发布身份。
- **维护现场**：原 `.codex-backups/`、`.codex-upgrades/`、`.wn-updates/`、`audits/`、AGENTS/WORKLOG/HISTORY、打包清单和旧维护说明。
- **旧站点与插件交付**：原 `docs/` 文档站、`plugins/infinite-canvas/` Codex 插件，以及未经本候选版验收的 `web/vercel.json` 部署配置，避免误指上游服务。
- **未闭环材料**：MiniMax 官方 `h3-prompt-writing.json` 正文包、TE-Speed 二进制，使用权未确认的首页图、图标和演示素材。
- **生成产物**：已有 dist、插件编译结果、本机依赖链接和临时验证目录。
- **本机维护记录**：WORKLOG.md、HISTORY.md、SYNC-REPORT.md、CLEAN-INSTALL-REPORT.md、GITHUB-PUBLISH-PLAN.md 留在维护目录，首发上传镜像不携带；公开验证范围保留在 VALIDATION.md。

排除表示不随本目录分发，不删除原开发目录文件。四份已带 MIT 许可的资料包保留，详见 [第三方说明](THIRD-PARTY-NOTICES.md)。

## Integration Gaps / 待补齐的接入

1. **ComfyUI 与 Qwen/H3**：固定版本、节点、模型和本地维护改动尚需独立交付。记录版本、提取必要补丁、给出官方下载与安装步骤后再验证，不能只装上游最新版便认定等效。
2. **视频工具与超分**：`scripts/canvas-video-service.py`、`scripts/seedvr2-service.py` 等仍有 extras 路径约定。当前保留供后续适配，基础启动不会建立这些环境。
3. **本地提示词服务**：Python/Ollama 等后端需另备；被排除的官方 H3 正文不得由同步流程自动回填公开目录。
4. **更新与发布管理**：原包签名来源、基线、开发者身份和更新状态不属于本候选版。正式版本链需另建，基础启动不执行旧更新器。
5. **新用户安装**：Windows系统Node24.15/npm11.12已完成独立目录标准npm ci与基础画布验收；另一台电脑、Node22和其他系统仍未验。完整用户运行包应另做跨机器和约定生成流程验收。

已确认的配置丢失风险已修复：完整校验后再应用，错误文件保持现有设置；两个配置入口共享当前会话的最后一次导入撤销。视频未知提交和取消结果会保留恢复身份，编组复制会带入成员及内部线。具体已验与未验范围见 [验证记录](VALIDATION.md)。

## Release Gate / 公开前通过条件

- 审阅实际清单，确认没有模型、依赖、私人媒体、凭据、本机链接或运行数据进入交付。
- 保留上游署名与第三方许可；新增第三方内容完成许可和版本核对。
- 基础启动、类型检查、生产构建和浏览器实际模块加载通过；失败与跳过项目如实记录。
- README 与交付内容一致，可选能力明确说明未附组件和验证范围。
- 配置导入保护与回归已通过；其余已知问题按首发范围明确限制与优先级。
- 明确首发版本、下载入口、已知限制与备份方式。实际上传发布另行确认。

## Packaging / 打包

源码、用户运行包、可选模型分别交付。`.gitignore` 只影响 Git，不保护直接压缩目录的操作。本机验证可能存在依赖链接或临时产物；正式归档需按明确清单重新导出并检查压缩包，避免携带链接目标、依赖与缓存。
