# Third-Party Notices / 第三方说明

本文件记录公开源码候选版的来源和分发边界。根 [LICENSE](LICENSE) 保留原画布的 MIT 授权；它不替代第三方资料、可选工具、模型和素材各自的许可。

## Included Sources / 保留的来源

| 内容 | 来源 | 许可与保留要求 |
|---|---|---|
| 画布、Canvas Agent、Canvas Proxy、插件 SDK 与示例的上游代码 | [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) | 保留根 MIT LICENSE 与 `Copyright (c) 2026 basketikun`；WN 修改不冒称上游发布 |
| npm 依赖声明 | 各模块 `package.json` 与 lockfile | 不附 node_modules；依赖安装后仍适用各自许可 |
| WN 桥接脚本、画布修改和即梦扩展源码 | 从本地维护项目筛选 | 与上游边界结合审阅；不附第三方程序、模型、登录态或作品 |

上游源码的精确起始 commit 还需在正式发布前补齐。目前保留来源名称和链接，不将本地维护状态伪装为上游 tag。

### Prompt Packs / 提示资料包

以下四份 JSON 位于 `web/public/local-prompt-skills/`。每份均含来源 URL、文件正文、逐文件 SHA256 和上游 LICENSE 正文。分发时完整保留版权和许可字段。

| 文件 | 上游 | 包内许可与版权 |
|---|---|---|
| `cinematic-director.json` | [DirectorSKILL](https://github.com/wuwangzhang1216/DirectorSKILL) | MIT；2026 wangzhang-wu |
| `director-craft-framework.json` | [director-craft-framework](https://github.com/Krenlis/director-craft-framework) | 上游简版 MIT；版权原文为 `Copyright (c) 2026`，未补写作者 |
| `tvc-director.json` | [tvc-director](https://github.com/Ethanxwang/tvc-director) | MIT；2026 Ethan Wang |
| `minimax-h3.json` | [minimax-h3-skill](https://github.com/teskor-hub/minimax-h3-skill) | MIT；2026 teskor；第三方 Skill 许可与模型许可分开 |

这些包尚未记录精确上游 commit/tag，正式发布前应补齐。SHA256 只能证明内容一致，不能替代来源或授权证明。

## Optional Components / 未捆绑组件

以下来自原整合包的可选能力，本候选目录没有复制它们。版本为原包检查记录，不构成新安装的兼容承诺。

| 组件与原包版本 | 官方来源 | 许可与待办 |
|---|---|---|
| ComfyUI 0.35.0 / 0.37.0 | [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI) | 原包 GPLv3；维护改动需整理成补丁并保留原许可、修改说明 |
| SeedVR2 VideoUpscaler 2.5.24 | [numz/ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler) | Apache-2.0；代码改动、模型和工具分别交付 |
| H3-Continuum 3.8.0 | [ukr8b3g-cmyk/ComfyUI-H3-Continuum](https://github.com/ukr8b3g-cmyk/ComfyUI-H3-Continuum) | MIT；重新分发时保留原 THIRD_PARTY_NOTICES.md |
| Hand-Tie-Clips 2.0.0 | [dntpi/ComfyUI-Hand-Tie-Clips](https://github.com/dntpi/ComfyUI-Hand-Tie-Clips) | MIT |
| H3-Motion-Context 0.6.2 | [NikoDemon80/ComfyUI-H3-Motion-Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context) | GPLv3 |
| Spectrum-MiniMax-H3 0.2.26 | [xmarre/ComfyUI-Spectrum-MiniMax-H3](https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3) | GPLv3-or-later；保留 LICENSE 与 COPYRIGHT |
| TE-Speed-MiniMaxH3 二进制 | 原包仅有加载入口与 nodes.pyd | 本机确切来源、版本和再分发授权未闭环；不捆绑，不能借用其他 OSS 重实现的许可 |
| LosslessCut 3.69.0 | [mifi/lossless-cut](https://github.com/mifi/lossless-cut) | [该版 LICENSE](https://github.com/mifi/lossless-cut/blob/v3.69.0/LICENSE) 为 GPLv2；运行包需另核源码提供方式 |
| Video2X，版本待确认 | [k4yt3x/video2x](https://github.com/k4yt3x/video2x) | 当前上游 AGPLv3；不能据最新版推定原包二进制许可版本 |
| Ollama，版本待确认 | [ollama/ollama](https://github.com/ollama/ollama) | 上游主项目 MIT；模型和捆绑库分别核对 |
| FFmpeg，各工具所带构建 | [官方许可说明](https://www.ffmpeg.org/legal.html) | 受启用组件影响，不能统一写 LGPL；须核具体构建与源码来源 |

这里记录各自许可，不据目录相邻或服务调用关系断言画布整体改用某一第三方许可。

## Model and Guide Terms / 模型与指南条款

### Qwen-Image 2.1

适用 [Qwen Research License](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)。已核条款限定非商业研究或评估，商业使用需另行许可；分发材料还涉及协议副本、NOTICE 与修改声明。本目录不含权重或整套推理环境。

### MiniMax H3

模型与官方材料适用 [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)，需按实际材料和服务核对：

- I.4、I.14 定义官方文档和材料；I.5、II 规定地域，排除 EU、UK、韩国、美国。
- III.1、III.2、III.4 规定协议副本、修改声明和分发 NOTICE。
- V.2、V.5 涉及接收者使用限制告知，以及提供生成能力产品的合理保障要求。

原 `h3-prompt-writing.json` 内嵌官方 Skill 与两份指南正文，未带独立 LICENSE/NOTICE，本目录已排除。仅保留 [官方入口](https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing)；确认适用许可和分发条件前，不恢复内嵌正文。

不分发模型并不自动消除所复制指南、代码或其他官方材料的义务；这些说明也不将独立画布代码整体归入模型许可。

## Before Distribution / 正式分发前

补齐版本与修改记录，核对最终包中的素材和第三方内容。新增运行包、模型下载器、二进制或示例媒体时，重新检查对应交付物；本文件不代表这些尚未制作的包已完成全部许可审查。
