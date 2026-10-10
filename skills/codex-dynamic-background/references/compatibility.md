# 兼容性与运行方式

| 部分 | 支持范围 |
| --- | --- |
| 视频整理 | Python 3.10+，FFmpeg / FFprobe 5.1+；不依赖 Python 第三方包 |
| Codex 应用接入 | Windows，Microsoft Store 安装的 `OpenAI.Codex` |
| 本机验证基线 | Codex `26.924.2738.0`；实际运行程序名为 `ChatGPT.exe` |
| 后台助手 | Node.js 22+，内置 WebSocket，无 npm 运行依赖 |
| 输入 | 本地可解码视频，时长大于 0 且不超过 30 秒 |
| 输出 | 静音 H.264 MP4、yuv420p、faststart，最高 1080p / 60fps |

应用背景是社区实现，不是 OpenAI 官方视频壁纸设置。通过独立配置目录启动已安装的官方程序，在自己的主页面添加视频和玻璃主题。未来页面结构、程序布局或调试开关变化可能需要更新脚本；不把这个基线当作所有未来版本的兼容保证。没有实现其他 agent 产品或 macOS / Linux 桌面应用的注入。

助手验证端口所属 PID 和官方可执行文件，调试地址限定本机回环。此调试连接能控制对应应用窗口；只在受信任的本机使用，不转发端口。输入和编码都在本地进行，不要求上传视频，也不复制用户现有浏览器资料。

`.runtime` 保存状态和日志，`.profile` 是背景窗口自己的应用配置目录。它们不应提交到 GitHub。独立窗口可能要求用户登录；让用户自行完成登录，不读出或搬运登录信息。停止背景不会删除该配置目录，也不会关闭应用。

依赖来源：[Python](https://www.python.org/downloads/)、[Node.js](https://nodejs.org/en/download)、[FFmpeg 官方下载入口](https://ffmpeg.org/download.html)。FFmpeg 官方入口列出 Windows 编译包来源；本项目不捆绑二进制、不自动安装依赖。
