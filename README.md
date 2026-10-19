# EAgent（macOS / Windows）

> 把 chat.deepseek.com 变成一个能真正在你电脑上干活的桌面 Agent。
> Claude 风格界面 · 内嵌页面 · 进程内 CDP · 本地工具执行 · 逐条授权 · 一键急停。

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg)]()
[![Release](https://github.com/t479842598/EAGENT-MAC/actions/workflows/release.yml/badge.svg)](https://github.com/t479842598/EAGENT-MAC/actions/workflows/release.yml)

---

## English (TL;DR)

EAgent is a desktop client (macOS + Windows) that turns **chat.deepseek.com** into a local agent.
It embeds the real DeepSeek web page in a `WebContentsView` and talks to it over the **in-process**
Chromium DevTools Protocol — no external Chrome, no debugging port, no screen-recording or
accessibility permissions.

The model answers with sentinel-fenced tool calls; EAgent parses them and executes them **on your machine**
(shell, screenshot, upload, mouse, keyboard, skills) — every call needs your explicit approval by default,
and one shortcut aborts instantly.

```bash
git clone https://github.com/t479842598/EAGENT-MAC.git
cd EAGENT-MAC && npm install && npm run dev
```

Prebuilt installers are published on the [Releases](https://github.com/t479842598/EAGENT-MAC/releases)
page, produced by GitHub Actions for `macOS arm64/x64` and `Windows x64/arm64`.

---

## 它是什么

EAgent 不是又一个聊天窗口。它把你已经在用的 DeepSeek 网页版，接到本机的执行环境上：

1. 应用内启动一个**内嵌 Chromium 视图**加载 `chat.deepseek.com`（登录一次，长期有效）；
2. 通过 **进程内 CDP**（`webContents.debugger`）注入消息、回收回复，不占用任何调试端口；
3. 模型按约定的**哨兵格式**输出工具调用，EAgent 解析后在**本机真实执行**；
4. 执行结果回填给模型，模型继续推理，直到任务完成。

模型跑在 DeepSeek 云端，所有动作都发生在你的机器上，而且每一条都要你点头。

### 与旧版（外部 Chrome 版）的差别

| 能力 | 旧：外部 Chrome + 9222 端口 | 现在：内嵌视图 + 进程内 CDP |
| --- | --- | --- |
| 通信 | 另起 Chrome，连 DevTools 端口 | `webContents.debugger.attach('1.3')` |
| 鼠标键盘 | 系统级 CGEvent（需辅助功能授权） | CDP `Input.*`，零系统权限 |
| 截图 | `screencapture`（需屏幕录制授权） | `webContents.capturePage()`，零系统权限 |
| 外部依赖 | 需安装 Google Chrome | Electron 自带 Chromium，零外部依赖 |
| 跨平台 | 仅 macOS | macOS + Windows 同一份代码 |

## 界面

- **Claude 风格**：`#151515` 深色底、陶土色（`#d97757`）强调、18px 气泡圆角、20px 输入框圆角，
  设计令牌来自 vendored 的 open-claude-ui。
- **左侧会话栏**：本地会话档案（置顶 / 重命名 / 删除），只存视图，不碰云端对话。
- **中间对话流**：Markdown 渲染、代码块一键复制、工具卡片实时状态、截图缩略图与灯箱。
- **右侧网页栏**：内嵌的 chat.deepseek.com 本体，可随时隐藏/展开，与左侧对话同屏。
- **顶栏运行控制**：显示/隐藏网页 · 重新加载 · 导出登录态 · 环境自检。

## 六个工具

| 工具 | 作用 | 实现 |
| --- | --- | --- |
| `shell` | 执行命令、读写文件、跑脚本 | macOS 走 `zsh -lc`，Windows 走 `powershell.exe -NoProfile` |
| `screenshot` | 截取内嵌网页 | `webContents.capturePage()` → JPEG |
| `upload` | 把本地文件传给网页 | CDP `DOM.setFileInputFiles` |
| `mouse` | 在网页里点击 / 移动 / 滚动 / 枚举可点元素 | CDP `Input.dispatchMouseEvent` |
| `keyboard` | 在网页里输入文本、按快捷键 | CDP `Input.insertText` / `Input.dispatchKeyEvent` |
| `skill` | 读取本地 Agent Skill | 读 `resources/skills/<name>/SKILL.md` |

鼠标与键盘作用于**内嵌页面**而不是操作系统，因此坐标是页面 CSS 像素、也不需要任何系统授权。

## 安全模型

- **默认逐条授权**：每个工具调用先变成一张 `pending_approval` 卡片，点「允许本次」才执行。
- **始终允许**：可按工具粒度加入白名单并落盘，但**危险命令无视白名单**。
- **危险命令硬拦**：`rm -rf`、`Remove-Item -Recurse`、`sudo`、`RunAs`、`diskutil`、`launchctl`、
  `csrutil`、`mkfs`、`Stop-Computer` 等 15 类特征，即使已在白名单也强制二次确认。
- **急停**：`⌘.`（Windows 为 `Ctrl+.`）由主进程 `globalShortcut` + 渲染层双保险，立即杀掉正在跑的子进程。
- **登录态**：只保存在本地 `persist:deepseek` 分区，可导出为 `deepseek-session.json` 迁移到另一台机器。

## 系统要求

- macOS 13+（arm64 / x64）或 Windows 10/11（x64 / arm64）
- 无需安装 Chrome，无需辅助功能/屏幕录制授权
- 首次使用需要登录一次 chat.deepseek.com（登录态随后长期保存在本地）

## 快速开始（源码）

```bash
npm install
npm run dev          # 开发模式（热更新）
npm run typecheck    # 类型检查
npm run build        # 仅构建 out/
npm run dist:mac     # 打 dmg + zip（需在 macOS 上跑）
npm run dist:win     # 打 nsis 安装包 + zip（需在 Windows 上跑）
```

首次启动后：

1. 右侧网页栏会加载 chat.deepseek.com，在里面登录一次；
2. 点「自检」确认 7 项检查全绿（页面 / CDP / 选择器 / 登录 / shell / 技能 / 工作目录）；
3. 在底部输入框说一句话，例如「截个图看看现在的页面」。

## 从 GitHub 打包发布正式版

仓库自带两条流水线：

| 工作流 | 触发 | 做什么 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR | `npm ci` → `typecheck` → `build` |
| `.github/workflows/release.yml` | 推 `v*` tag 或手动运行 | 四平台并行打包 → 上传 artifact →（tag 触发时）建 Release |

发布一个新版本：

```bash
npm version patch --no-git-tag-version   # 或 minor / major
git commit -am "chore: release v1.0.1"
git tag v1.0.1
git push origin main --tags
```

推送 tag 后 GitHub Actions 会并行产出：

- `EAgent-<version>-mac-arm64.dmg` / `.zip`
- `EAgent-<version>-mac-x64.dmg` / `.zip`
- `EAgent-<version>-win-x64.exe` / `.zip`
- `EAgent-<version>-win-arm64.exe` / `.zip`

并自动创建同名 Release 附上全部安装包。手动运行（`workflow_dispatch`）只出 artifact，不建 Release。

> **签名说明**：默认不签名（`CSC_IDENTITY_AUTO_DISCOVERY: false`、`identity: null`）。
> macOS 首次打开需右键「打开」或在「隐私与安全性」里点「仍要打开」；
> Windows SmartScreen 会提示「更多信息 → 仍要运行」。
> 要出正式签名版，在仓库 Secrets 里配 `CSC_LINK` / `CSC_KEY_PASSWORD`（macOS）
> 与 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（Windows），并去掉 `CSC_IDENTITY_AUTO_DISCOVERY` 与 `identity: null`。

## 目录结构

```
src/
  main/                 主进程
    engine/             会话引擎
      cdp.ts            CdpClient：包 webContents.debugger，提供 insertText/mouse/key/setFiles
      webview.ts        WebViewHost：内嵌 WebContentsView 的生命周期与布局
      deepseek.ts       DeepSeekDriver：注入、发送、等待回复、探测选择器
      sentinel.ts       哨兵解析（6 个工具 + 自愈提示）
      prompt.ts         系统提示词（按平台切换 zsh / PowerShell）
      session.ts        SessionEngine：主循环、审批闸门、急停、统计
      session-blob.ts   登录态导入导出
      tools/            shell · screenshot · upload · mouse · keyboard · skill · doctor
    ipc.ts              渲染层全部通道
    store.ts            设置持久化
    window.ts           窗口与标题栏几何（macOS / Windows 分支）
  preload/              contextBridge 白名单（eagent / electronAPI）
  renderer/             React 界面
    components/         TitleBar · Sidebar · MessageList · ToolCard · Composer · Markdown · …
    lib/                api / format / sessions / useSession
    types/cds.d.ts      vendored 组件的类型声明
vendor/open-claude-ui/  vendored UI 组件（MIT，见 THIRD_PARTY.md）
resources/
  selectors.json        DeepSeek 页面选择器（改版可热修，无需重编译）
  skills/               26 个 Agent Skill
build/                  打包图标（icon.icns / icon.ico / icon.png）
.github/workflows/      ci.yml · release.yml
scripts/                sync-cds.sh · dev/（本地 CDP 调试脚本，不入库）
```

## 选择器漂移怎么办

DeepSeek 网页的 class 是构建期哈希，改版会漂移。EAgent 把选择器外置在
`resources/selectors.json`，数组按优先级回退。页面改版后：

1. 在内嵌页面里右键 → 检查（或开 DevTools）找到新的 class；
2. 改 `resources/selectors.json`；
3. 点「自检」→「重新加载页面」，无需重新编译。

## 许可

- 主体代码：**GPL-3.0**（见 `LICENSE`）
- vendored UI 组件 open-claude-ui：**MIT**
- `resources/skills/` 内各技能：见各自 `LICENSE.txt` / `NOTICE.md`

完整归属见 [THIRD_PARTY.md](THIRD_PARTY.md)。
