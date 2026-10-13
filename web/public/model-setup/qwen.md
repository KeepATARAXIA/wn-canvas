# Qwen-Image 2.1 / 千问本地安装与连接

核对日期：2026-10-13。适用于 Windows、NVIDIA RTX 显卡，以及 WN Canvas 内置的「千问 2.1 / 千问 2.1 Turbo」生图和编辑工作流。

建议先安装 Turbo：下载独立 ComfyUI 运行包和 3 个模型文件，启动到 `127.0.0.1:8189`，再连接画布。画布已内置工作流，不需要额外安装节点插件。下面的命令供你确认后手动运行；画布不会自动下载模型、安装 Python 或启动模型服务。

## Before download / 下载前确认

- **用途限制**：Qwen 官方当前使用 Qwen Research License。「非商业」在许可中限定为研究或评估；用于商业目的需要另外取得许可。个人使用、免费提供服务或模型能免费下载，都不自动构成商业授权。原版与 Turbo 的许可分别见 [原版 LICENSE](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE)、[Turbo LICENSE](https://huggingface.co/Qwen/Qwen-Image-2.1-Turbo/blob/main/LICENSE)。
- 如需再分发权重或修改版，应随附许可原文、保留许可要求的 Notice，修改文件须注明。以官方全文为准。商业许可申请地址列于上述 LICENSE；本指引不代办申请。托管 API 的合同和输出权利需要另行核对。
- 本项目已有 RTX 5070 Ti 16GB、ComfyUI 0.37.0 的 1K 生图/单图编辑实测记录，**16GB 是已验证配置，不是测得的最低显存**。更小显存、AMD/Intel、CPU、不同驱动与其他电脑尚未验收。
- Turbo 的 3 个模型合计 **17,283,095,877 字节，约 17.28 GB / 16.10 GiB**；加装原版后模型合计约 **24.54 GB / 22.85 GiB**。ComfyUI 压缩包约 1.93 GB，解压还需空间。建议先预留至少 40 GB 可用磁盘，这是安装余量建议，不是精确最低需求。
- 准备好 NVIDIA 驱动和可解压 `.7z` 的工具；缺少工具时，先按 [ComfyUI 官方 Portable 指引](https://docs.comfy.org/installation/comfyui_portable_windows) 完成准备。此路线使用包内 Python，无需再安装系统 Python、CUDA Toolkit 或运行 `pip install`。

## Runtime / 安装独立 ComfyUI

本指引固定使用 **ComfyUI v0.37.0 Windows NVIDIA portable**，对应项目已有运行记录。将它解压到一个新文件夹，不覆盖你已有的 ComfyUI。推荐使用 `D:\AI\ComfyUI-Qwen` 这类短路径；多层长目录可能让 PyTorch 加载 DLL 时出现 `WinError 206`，应先缩短安装路径。

- [下载固定版本 NVIDIA 运行包](https://github.com/Comfy-Org/ComfyUI/releases/download/v0.37.0/ComfyUI_windows_portable_nvidia.7z)
- [官方 v0.37.0 发布页面](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.37.0)
- 文件名：`ComfyUI_windows_portable_nvidia.7z`
- 大小：`1925204508` 字节
- SHA256：`7805f634fab51f63a238aaf0cfe2a9833bb7c86ddfc8400a60919f44460d7d65`

下载后在文件所在目录打开 PowerShell，先检查完整文件，再解压：

```powershell
$runtimeArchive = Get-Item -LiteralPath '.\ComfyUI_windows_portable_nvidia.7z'
if ($runtimeArchive.Length -ne 1925204508) { throw '运行包大小不匹配，请重新下载。' }
$runtimeSha = (Get-FileHash -LiteralPath $runtimeArchive.FullName -Algorithm SHA256).Hash
if ($runtimeSha -ne '7805f634fab51f63a238aaf0cfe2a9833bb7c86ddfc8400a60919f44460d7d65') {
    throw '运行包 SHA256 不匹配，请停止解压。'
}
'运行包校验通过，可以解压。'
```

解压后找到同时含 `ComfyUI` 和 `python_embeded` 的目录。后续命令都在**这个目录**运行：

```text
ComfyUI_windows_portable/
├── python_embeded/python.exe
└── ComfyUI/
    ├── main.py
    └── models/
```

不要先运行默认 `run_nvidia_gpu.bat`；默认端口与下面为画布准备的 `8189` 不同，后文提供带正确端口和 CORS 的启动命令。

## Models / 放入准确模型文件

使用 Comfy-Org 的 ComfyUI 格式权重。默认只需要 Turbo、文本编码器、VAE 三项；希望同时使用原版时再下载第四项。完整 Turbo 权重独立使用，不需要原版权重或 Turbo LoRA。

以下均为 ModelScope 上 Comfy-Org 仓库的固定修订 `8c798285d642b81a1af415b70f2e444e809820d7`，来源可与 [Comfy-Org Hugging Face 模型卡](https://huggingface.co/Comfy-Org/Qwen-Image-2.1) 对照。

| 用途 | 文件和固定下载链接 | 字节 | 相对 `ComfyUI/` 的目标目录 |
|---|---|---:|---|
| Turbo，必需 | [qwen_image_2.1_turbo_int8_convrot.safetensors](https://modelscope.cn/models/Comfy-Org/Qwen-Image-2.1/resolve/8c798285d642b81a1af415b70f2e444e809820d7/diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors) | 7,256,787,829 | `models/diffusion_models/` |
| 文本编码器，必需 | [qwen3vl_8b_int8_convrot.safetensors](https://modelscope.cn/models/Comfy-Org/Qwen-Image-2.1/resolve/8c798285d642b81a1af415b70f2e444e809820d7/text_encoders/qwen3vl_8b_int8_convrot.safetensors) | 9,350,798,360 | `models/text_encoders/` |
| VAE，必需 | [qwen_image_2.1_vae_bf16.safetensors](https://modelscope.cn/models/Comfy-Org/Qwen-Image-2.1/resolve/8c798285d642b81a1af415b70f2e444e809820d7/vae/qwen_image_2.1_vae_bf16.safetensors) | 675,509,688 | `models/vae/` |
| 原版，可选 | [qwen_image_2.1_int8_convrot.safetensors](https://modelscope.cn/models/Comfy-Org/Qwen-Image-2.1/resolve/8c798285d642b81a1af415b70f2e444e809820d7/diffusion_models/qwen_image_2.1_int8_convrot.safetensors) | 7,256,783,064 | `models/diffusion_models/` |

你可以手动下载并放到对应目录，或在 Portable 根目录运行以下 PowerShell。它默认下载 Turbo 三项；把 `$includeBase` 改为 `$true` 才追加原版。已有正确文件会复用，已有错误文件会停止，不自动覆盖；中断文件保留为 `.part`，再次运行会尝试续传。

```powershell
$ErrorActionPreference = 'Stop'
$includeBase = $false
$comfyRoot = (Resolve-Path -LiteralPath '.\ComfyUI').Path
$modelSource = 'https://modelscope.cn/models/Comfy-Org/Qwen-Image-2.1/resolve/8c798285d642b81a1af415b70f2e444e809820d7'
$modelFiles = @(
    @{ Path='diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors'; Bytes=7256787829; Sha='8144a0182964aa8403ad6dbc011db837304167d235161b9aabaa8532e967314c' },
    @{ Path='text_encoders/qwen3vl_8b_int8_convrot.safetensors'; Bytes=9350798360; Sha='8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f' },
    @{ Path='vae/qwen_image_2.1_vae_bf16.safetensors'; Bytes=675509688; Sha='bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9' }
)
if ($includeBase) {
    $modelFiles += @{ Path='diffusion_models/qwen_image_2.1_int8_convrot.safetensors'; Bytes=7256783064; Sha='cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d' }
}
foreach ($modelFile in $modelFiles) {
    $target = Join-Path (Join-Path $comfyRoot 'models') $modelFile.Path
    if (Test-Path -LiteralPath $target) {
        if ((Get-Item -LiteralPath $target).Length -ne $modelFile.Bytes -or
            (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $modelFile.Sha) {
            throw "已有文件校验不通过，请手动检查，未覆盖：$target"
        }
        Write-Host "复用已校验文件：$($modelFile.Path)"
        continue
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    $partialFile = $target + '.part'
    & curl.exe --fail --location --retry 3 --continue-at - --output $partialFile "$modelSource/$($modelFile.Path)"
    if ($LASTEXITCODE -ne 0) { throw "下载未完成，保留临时文件：$partialFile" }
    if ((Get-Item -LiteralPath $partialFile).Length -ne $modelFile.Bytes -or
        (Get-FileHash -LiteralPath $partialFile -Algorithm SHA256).Hash -ne $modelFile.Sha) {
        throw "下载文件大小或 SHA256 不匹配，未启用：$partialFile"
    }
    Move-Item -LiteralPath $partialFile -Destination $target
    Write-Host "完成：$($modelFile.Path)"
}
```

只有文件大小、SHA256 都一致，才视为模型下载完成。若下载源不支持续传，命令会停止；不要跳过校验或把 HTML 错误页面改名为模型。手动下载的文件也可用上面同一段命令校验：正确文件会直接复用。

## Start / 启动到 8189

先打开 WN Canvas，记录**地址栏当前的 origin**：协议、主机和端口，去掉后面的路径与末尾 `/`。例如 `http://localhost:3000`；若页面实际是 `http://127.0.0.1:3000`，必须填写后者。二者不能混用。若画布改了端口，也要同步修改。

在 Portable 根目录打开 PowerShell，输入真实画布 origin 后运行：

```powershell
$canvasOrigin = Read-Host '输入画布实际 origin，例如 http://localhost:3000'
& '.\python_embeded\python.exe' -s '.\ComfyUI\main.py' --windows-standalone-build --listen 127.0.0.1 --port 8189 --enable-cors-header $canvasOrigin --disable-auto-launch
```

保留此窗口；`Ctrl+C` 可停止服务。看到 `http://127.0.0.1:8189` 的服务地址后，用浏览器打开它。不要为解决跨域而改成 `0.0.0.0` 或对公网开放端口。若 `8189` 已被占用，先确认是不是你已有的千问服务，不要盲目关闭未知进程。

## Check / 先检查服务、节点和文件

在另一个 PowerShell 窗口执行下面的只读检查：

```powershell
$comfyAddress = 'http://127.0.0.1:8189'
Invoke-RestMethod "$comfyAddress/system_stats"
$nodeInfo = Invoke-RestMethod "$comfyAddress/object_info"
$requiredNodes = @(
    'UNETLoader', 'CLIPLoader', 'VAELoader', 'TextEncodeQwenImage21',
    'QwenImage21Cache', 'ResolutionSelector', 'EmptyLatentImage',
    'KSamplerSelect', 'ManualSigmas', 'SamplerCustom', 'KSampler',
    'LoadImage', 'JoinImageWithAlpha', 'VAEDecode', 'SaveImage'
)
$missingNodes = @($requiredNodes | Where-Object { $null -eq $nodeInfo.PSObject.Properties[$_] })
if ($missingNodes.Count) { throw "缺少节点：$($missingNodes -join ', ')。先查看 ComfyUI 启动错误。" }
$requiredModels = @(
    @{ Node='UNETLoader'; Field='unet_name'; File='qwen_image_2.1_turbo_int8_convrot.safetensors' },
    @{ Node='CLIPLoader'; Field='clip_name'; File='qwen3vl_8b_int8_convrot.safetensors' },
    @{ Node='VAELoader'; Field='vae_name'; File='qwen_image_2.1_vae_bf16.safetensors' }
)
foreach ($requiredModel in $requiredModels) {
    $loader = $nodeInfo.PSObject.Properties[$requiredModel.Node].Value
    $choices = $loader.input.required.PSObject.Properties[$requiredModel.Field].Value[0]
    if ($choices -notcontains $requiredModel.File) { throw "未识别模型：$($requiredModel.File)" }
}
'服务、必需节点和 Turbo 模型文件已识别。尚未验证实际生成。'
```

Qwen 相关节点是 v0.37.0 核心节点，不需要安装同名第三方插件。若缺节点，检查 `/system_stats` 中实际核心版本、启动窗口的导入错误，以及是否启动了正确目录。若缺模型，检查文件名、目录、是否仍有 `.part` 后缀，再重启服务。

## Connect / 在画布连接并验证生成

1. 打开“配置 → 模型与服务 → 连接已有服务”，选择“千问 · 图片”并打开连接配置，将地址设为 `http://127.0.0.1:8189`。本地服务不需要填写 API Key。使用画布已内置的千问工作流。
2. 先选择「千问 2.1 Turbo」，`1024×1024`、1 张，用简单提示词生成。`512×512` 低于画布当前的总像素下限，会在提交后端前被拒绝。只安装 Turbo 三文件时，不要选择原版「千问 2.1」；原版需要表中第四个权重。
3. 等待模型加载、进度走完，确认画布显示新图片，能保存 PNG，刷新后仍能读回。首次加载通常比后续任务慢。
4. 再连接一张参考图，做一次简单编辑。画布会使用同版本编辑工作流；当前编辑输出沿用第一张参考图比例，约 1K。先验证单图，再尝试更多参考图。

**服务连通、节点齐全、识别文件、真实生成是不同的检查。** 只有生成和编辑实际返回可打开的新 PNG，才能记录对应功能在这台电脑验证通过。若画布连不上，但 PowerShell 能访问服务，优先检查启动参数中的 CORS origin 是否与当前画布完全一致。

显存不足时先降到 1K、1 张，并关闭你自行启动的其他 GPU 生成任务。较低显存能否运行尚未验证，不承诺改变某个参数即可解决。保存启动窗口的首个错误，区分缺文件、导入失败、驱动不兼容和显存不足，避免反复重装。

## Verified scope / 本指引核实了什么

| 项目 | 证据与边界 |
|---|---|
| 官方运行包 | 2026-10-13 的 [GitHub Release API](https://api.github.com/repos/Comfy-Org/ComfyUI/releases/tags/v0.37.0) 返回上述名称、大小、SHA256；本轮已完整下载、重算 SHA256 匹配并在独立目录解压。 |
| 节点兼容性 | 官方 v0.37.0 源码的 `nodes_qwen.py`、`nodes_resolution.py`、`nodes_custom_sampler.py` 与已有环境逐字节一致；Portable 中的对应文件使用 Windows 换行，归一化换行后内容一致。本轮新环境识别了全部 15 个必需节点和三个 Turbo 模型。 |
| 四个模型 | [ModelScope 固定修订文件元数据](https://modelscope.cn/api/v1/models/Comfy-Org/Qwen-Image-2.1/repo/files?Revision=8c798285d642b81a1af415b70f2e444e809820d7&Recursive=true) 当前返回上述大小和 SHA256；四条固定下载链接 HEAD 为 200。HEAD 未返回大小/ETag，本指引不把它当作文件完整性证明。原整合环境曾完成四文件全量哈希与 GPU 实测；本轮没有重下大模型。 |
| GPU 历史实测 | 项目已有 ComfyUI 0.37.0、RTX 5070 Ti 16GB 的原版与 Turbo 生图/编辑记录。Turbo 可运行，但旧核心会忽略部分新注意力配置，不能据此承诺最新注意力加速。 |
| 本轮新环境实测 | 全新解压官方 Portable，使用包内 Python 3.13.14、PyTorch 2.13.0+cu130，三个既有权重只读复用并重算完整 SHA256 匹配；无额外 `pip install` 或节点插件。为避开既有服务，临时使用后端 `13120`、画布 `13119`，按实际来源设置 CORS。在 WN 界面完成 Turbo 生图和单图编辑各一次，原始 PNG 均为 1024×1024；后端分别约 10.3、12.1 秒。编辑使用导入的生图结果作为参考，两图项目刷新、编辑结果下载和 ZIP 导出通过。首次生图原会话的刷新未单独验证。 |
| 尚未验证 | 新电脑从零下载全部权重、当前接收电脑、其他显卡和驱动、本轮新 Portable 的原版生成、2K/4K、长期并发及多参考图 GPU 负载。短路径启动与本机 Turbo 实测不能作为跨机器兼容承诺。 |

你的电脑仍需做一次自助验收：在短路径新目录解压官方包 → 运行包和模型全文件校验 → 按实际 origin 启动 8189 → 检查节点/模型 → 画布真实生成 1 张和编辑 1 张 → 保存、刷新读回。通过后再扩大分辨率或参考图数量。

官方补充资料：[ComfyUI Qwen 原生工作流说明](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1)、[ComfyUI Portable 安装说明](https://docs.comfy.org/installation/comfyui_portable_windows)。官方最新模板可能包含可选提示词增强模型；本画布现有工作流不依赖那些额外模型，不必为本指引下载它们。
