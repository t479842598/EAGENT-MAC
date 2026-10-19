# EAgent for macOS

> 把 chat.deepseek.com 变成一个能真正在你 Mac 上干活的桌面 Agent。
> Claude 风格的界面 · 本地工具执行 · 逐条授权 · ⌘. 急停。

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%2013%2B-lightgrey.svg)]()
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg)]()

---

## English (TL;DR)

EAgent is a macOS desktop client that turns **chat.deepseek.com** into a local coding agent.
It drives a real Chrome window over the DevTools Protocol, parses the model's sentinel-formatted
tool calls, and executes them **on your Mac** — shell commands, screenshots, file uploads,
mouse and keyboard input, plus on-disk Agent Skills.

Everything runs through a Claude-style UI (vendored [open-claude-ui](https://github.com/Caho1/open-claude-ui)),
every tool call needs your explicit approval by default, and `⌘.` aborts immediately.

```bash
git clone https://github.com/t479842598/EAGENT-MAC.git eagent-mac
cd eagent-mac && npm install && npm run build:native && npm run dev
```

---

## 它是什么

EAgent 不是又一个聊天窗口。它把你已经在用的 DeepSeek 网页版，接到本机的执行环境上：

1. 启动一个**独立 Chrome 实例**（独立 user-data 目录，不干扰你日常浏览器），打开 chat.deepseek.com；
2. 通过 CDP（DevTools Protocol）注入消息、回收回复；
3. 模型按约定的**哨兵格式**输出工具调用，EAgent 解析后在**本机真实执行**；
4. 执行结果回填给模型，模型继续推理，直到任务完成。

模型本身跑在 DeepSeek 云端，但**所有动作都发生在你的 Mac 上**，而且每一条都要你点头。

## 界面

- **Claude 风格**：`#151515` 深色底、陶土色（`#d97757`）强调、18px 气泡圆角、20px 输入框圆角、
  物理动效曲线，全部来自 vendored 的 open-claude-ui 设计令牌。
- **左侧会话栏**：本地会话档案（置顶 / 重命名 / 删除），只存视图，不碰云端对话。
- **中间对话流**：Markdown 渲染、代码块高亮与一键复制、工具卡片实时状态、截图缩略图与灯箱。
- **顶栏运行控制**：启动浏览器 / 重连 / 自检 / 关闭浏览器。
- **自检面板**：8 项环境检查，每项失败都给可执行的修复动作。

## 六个工具

| 工具 | 作用 | 实现 |
| --- | --- | --- |
| `shell` | 执行 zsh 命令、读写文件、跑脚本 | `child_process` + 独立 temp 脚本，超时可控 |
| `screenshot` | 截全屏或指定窗口 | `macinput`（CoreGraphics） |
| `upload` | 把本地文件传给网页 | CDP `DOM.setFileInputFiles` |
| `mouse` | 移动 / 点击 / 拖拽 | `macinput`（CGEvent） |
| `keyboard` | 输入文本、按快捷键 | `macinput`（CGEvent） |
| `skill` | 读取本地 Agent Skill | 读 `resources/skills/<name>/SKILL.md` |

## 安全模型

- **默认逐条授权**：每个工具调用先变成一张 `pending_approval` 卡片，你点「允许本次」才执行。
- **始终允许**：可按工具粒度加入白名单，但**危险命令无视白名单**。
- **危险命令硬拦**：`rm -rf`、`sudo`、`diskutil`、`launchctl`、`csrutil`、写系统目录等，
  即使已在白名单里也强制二次确认。
- **⌘. 急停**：主进程 `globalShortcut` + 渲染层双保险，随时中断当前轮次。
- **独立浏览器实例**：专用 user-data 目录，退出后不留残留 Chrome 进程。

## 系统要求

- macOS 13 或更新（arm64 优先）
- Google Chrome（运行时装在 `/Applications`，不随包分发）
- Xcode Command Line Tools（编译原生输入工具 `macinput`）
- 首次运行需在「系统设置 → 隐私与安全性」授予**辅助功能**与**屏幕录制**权限

## 快速开始

```bash
# 1. 装依赖
npm install

# 2. 编译原生输入工具（CGEvent）
npm run build:native

# 3. 开发模式
npm run dev

# 4. 打 dmg
npm run dist
```

首次启动后：

1. 点顶栏「启动浏览器」→ 弹出独立 Chrome 窗口 → 在窗口里登录 chat.deepseek.com；
2. 点「自检」确认 8 项检查（辅助功能与屏幕录制需要你在系统设置里授权后重开 App）；
3. 在底部输入框说一句话，例如「看看我现在在做什么，截个屏」。

## 目录结构

```
src/
  main/                 主进程
    engine/             会话引擎（浏览器 / CDP / DeepSeek 驱动 / 哨兵解析 / 工具执行）
      tools/            shell · screenshot · upload · mouse · keyboard · skill · doctor
    native/             macinput.swift（CGEvent 原生工具）
    ipc.ts              渲染层全部通道
    store.ts            设置持久化
    window.ts           窗口与红绿灯几何
  preload/              contextBridge 白名单（eagent / electronAPI）
  renderer/             React 界面
    components/         TitleBar · Sidebar · MessageList · ToolCard · Composer · Markdown · …
    lib/                api / format / sessions / useSession
    types/cds.d.ts      vendored 组件的类型声明
vendor/open-claude-ui/  vendored UI 组件（MIT，见 THIRD_PARTY.md）
resources/
  selectors.json        DeepSeek 页面选择器（改版可热修，无需重编译）
  skills/               26 个 Agent Skill
scripts/
  build-native.sh       swiftc 编译 macinput
  sync-cds.sh           重新同步 open-claude-ui
  dev/                  CDP 调试脚本（doctor-probe / e2e 等）
```

## 选择器漂移怎么办

DeepSeek 网页的 class 是构建期哈希，改版会漂移。EAgent 把选择器外置在
`resources/selectors.json`，数组按优先级回退。页面改版后：

1. 打开 Chrome 窗口的 DevTools 找到新的 class；
2. 改 `resources/selectors.json`；
3. 点「自检」→「重新连接页面」，无需重新编译。

## 许可

- 主体代码：**GPL-3.0**（见 `LICENSE`）
- vendored UI 组件 open-claude-ui：**MIT**
- `resources/skills/` 内各技能：见各自 `LICENSE.txt` / `NOTICE.md`

完整归属见 [THIRD_PARTY.md](THIRD_PARTY.md)。

EAgent 与 Anthropic、Claude、DeepSeek 均无隶属关系。
