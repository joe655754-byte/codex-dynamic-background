# codex动态背景设置

给 agent 一段 **不超过 30 秒的视频**，自动整理为 Codex 动态背景：保留整段运动、静音循环、玻璃主题、卡帧恢复与持续播放验证。

这是一个可安装的 **Codex Skill 项目**。展示名称为“codex动态背景设置”，技能标识为 `codex-dynamic-background`。

## 能做什么

- 读取用户指定的本地视频，检查时长、视频轨和解码情况。
- 保留完整片段，转换为最高 1080p / 60fps 的 H.264 视频；默认保全画面，支持显式裁边铺满。
- 生成离线预览、海报和处理元数据。
- 在 Windows 版 Codex 的独立背景窗口应用视频和深色玻璃主题。根据当前画面自动调整遮罩、次要文字、链接和按钮文案的对比度。
- 持续检测时间与视频帧，卡帧时自动续播，必要时重新加载视频。
- 停止时移除背景，Codex 和聊天保持打开。

不会把一张海报当成动态背景，也不会因为成功播放第一帧就结束验证。超过 30 秒的输入会明确拒绝，让用户选择片段。

## 支持范围

| 项目 | 要求 |
| --- | --- |
| 应用接入 | Windows 10 / 11，Microsoft Store 版 Codex |
| 已验证应用基线 | `OpenAI.Codex 26.924.2738.0` |
| 视频处理 | Python 3.10+、FFmpeg 与 FFprobe 5.1+ |
| 播放助手 | Node.js 22+ |
| 输入时长 | 大于 0、不超过 30 秒 |
| 依赖包 | Python 标准库与 Node 内置 API；无需 pip / npm 运行依赖 |

这是社区实现，**不是 OpenAI 官方壁纸功能**。当前只实现了 Codex 的 Windows 接入；其他操作系统可整理视频和预览，其他 agent 应用需要各自的适配器。未来 Codex 更新可能需要调整接入代码。

## 安装 Skill

在 Codex 中运行：

```text
使用 $skill-installer 安装这个 GitHub 仓库中的 skills/codex-dynamic-background：
https://github.com/joe655754-byte/codex-dynamic-background
```

也可以下载或克隆仓库后，在 PowerShell 中运行：

```powershell
git clone https://github.com/joe655754-byte/codex-dynamic-background.git
cd codex-dynamic-background
.\install-skill.ps1
```

安装脚本将技能复制到当前用户的 `.agents/skills/codex-dynamic-background`，遇到同名技能会停止，不会静默覆盖。Codex 通常会自动发现技能；列表未刷新时再重启应用。技能结构与加载位置见 [OpenAI 官方技能文档](https://developers.openai.com/codex/skills/)。

## 使用

安装后，把视频发给 agent，或提供本地路径：

```text
使用 $codex-dynamic-background，把 D:\Videos\我的背景.mp4 设置成 Codex 动态背景。
保留整段视频和完整画面，并确认能持续循环播放。
```

修改和停止也可以直接描述：

```text
背景不动了，请检查播放状态并修复，不要关闭 Codex。
```

```text
停止这个动态背景，恢复原来的 Codex 界面。
```

### 手动运行

先安装 [Python](https://www.python.org/downloads/)、[Node.js](https://nodejs.org/en/download) 和 [FFmpeg / FFprobe](https://ffmpeg.org/download.html)，将命令加入 PATH。

```powershell
$skill = Join-Path (Get-Location) 'skills\codex-dynamic-background'
$bundle = Join-Path (Get-Location) 'bundles\my-background'
python "$skill\scripts\prepare_video.py" 'D:\Videos\我的背景.mp4' --output $bundle
& "$skill\scripts\start_background.ps1" -BundleDirectory $bundle
node "$skill\scripts\verify_playback.mjs" --runtime "$bundle\.runtime" --seconds 65
```

视频处理参数：`--fit contain`（默认，完整构图）、`--fit cover`（裁边铺满）、`--fps 30` / `--fps 60`、`--ffmpeg <path>`、`--ffprobe <path>`、`--force`。不指定帧率时保留源帧率并限制最高 60fps，不做 AI 补帧。

```powershell
# 查看实时状态
& "$skill\scripts\start_background.ps1" -BundleDirectory $bundle -Status
# 移除背景，不关闭应用
& "$skill\scripts\start_background.ps1" -BundleDirectory $bundle -Stop
```

重新运行背景入口会复用该包自己的窗口。普通 Codex 快捷方式仍按原方式启动。第一次使用独立配置目录时可能需要登录。没有设置开机自启。

### 为什么会出现两个 Codex 窗口？

背景入口使用独立配置目录，因此普通入口已经打开时，会同时看到一个普通窗口和一个背景窗口。它们来自同一份官方安装，并不是安装了两个客户端。以后继续运行同一个包的背景入口会复用背景实例；当前实现不会自动关闭普通窗口，也不会为普通快捷方式改写启动参数。

## 处理与验证

```mermaid
flowchart LR
    A[用户视频 ≤30秒] --> B[检查完整视频]
    B --> C[静音编码与全片解码]
    C --> D[离线预览]
    D --> E[官方 Codex 独立窗口]
    E --> F[持续循环与帧进展验证]
    F --> G[后台检测与卡帧恢复]
```

默认不自动截取、加速、反转或重新绘制视频。原片首尾不连续时，循环可能出现切换感；制作过渡应单独说明并取得用户对内容变化的选择。

运行时仅向已核验的官方 Codex 主页面添加背景，排除嵌入网页、辅助窗口和宠物浮窗；调试地址限定本机回环。不修改安装包、不复制登录资料。调试通道具备控制对应窗口的能力，请勿转发到公网。

文字对比度每隔约 1.8 秒从视频取样，并结合文字位置的遮罩和半透明面板估算实际背景。普通文字以 4.5:1 为目标；颜色变化需连续确认，避免亮点使字体频繁闪烁。浅色主按钮保留深色字，危险与成功状态保留色彩提示。画面无法取样时启用较深遮罩。它只读取视频像素、元素位置和计算样式，不读取聊天内容；复杂渐变与细小高光仍可能需要手动调整主题。

用户视频、生成背景、聊天截图、日志和 `.profile` 配置目录均不属于公开项目内容。本仓库不附带个人素材，示例测试用程序生成的视频。

## 开发与测试

```powershell
python -m unittest discover -s tests -p 'test_*.py'
node --test tests/runtime*.test.mjs
```

需要 FFmpeg / FFprobe 的集成测试会使用本地工具，缺少时明确跳过。可通过 `FFMPEG` / `FFPROBE` 环境变量指定位置。测试不登录账号、不关闭用户应用、不修改已有背景。

运行时故障测试覆盖假播放卡帧、逐级恢复、循环归零、隐藏恢复和停止后的异步清理。真实窗口验证另由 `verify_playback.mjs` 完成，不能用离线单测冒充实机验证。

完整流程见 [SKILL.md](skills/codex-dynamic-background/SKILL.md)，排查见 [troubleshooting.md](skills/codex-dynamic-background/references/troubleshooting.md)。

## License

[MIT](LICENSE)。该许可覆盖本项目代码和文档，不授予任何用户提供的视频或第三方素材的使用权。
