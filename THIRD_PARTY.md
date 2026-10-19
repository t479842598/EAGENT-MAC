# 第三方组件与许可（THIRD_PARTY）

本仓库主体代码以 **GPL-3.0** 发布（见 `LICENSE`）。以下第三方内容按各自许可分发，
其原始许可文件一并保留在对应目录内。

---

## 1. open-claude-ui（UI 组件与设计令牌）

- 来源：https://github.com/Caho1/open-claude-ui
- 位置：`vendor/open-claude-ui/`（vendored 原样拷贝，未修改上游源码）
- 固定提交：`4045ce76afdcb7dccef1b7e6417b04c4c6046e9c`
- 许可：**MIT**（见 `vendor/open-claude-ui/LICENSE`）
- 用途：`CdsButton`、`CodeBlock`、`AttachmentCard`、`MediaLightboxViewer`、
  `ConfirmationDialog`、`SegmentedControl`、`StatusIndicators`、`ThinkingAccordion`、
  `ScrollFadeContainer` 等组件，以及 183 个设计令牌与物理动效参数。
- 说明：上游组件为演示级源码，本仓库通过 `src/renderer/types/cds.d.ts` 做类型声明，
  由 `electron.vite.config.ts` 的 `@cds` 别名在运行期指向真身。
  同步脚本：`scripts/sync-cds.sh`。

## 2. resources/skills 内的 Agent Skills

`resources/skills/` 下共 26 个技能包，各自保留 `LICENSE.txt` 与 `NOTICE.md`，
列出原始仓库、固定提交、原作者、原始版本与许可（含 MIT、CC-BY-SA-4.0、Apache-2.0 等）。
分发时请保留这些文件；单个技能的许可条款以其目录内 `LICENSE.txt` 为准。

## 3. 运行时依赖（npm）

```
electron 33            MIT
react 18 / react-dom   MIT
electron-vite          MIT
vite 5                 MIT
tailwindcss 3.4        MIT
framer-motion 11       MIT
lucide-react           ISC
react-markdown 9       MIT
remark-gfm 4           MIT
```

完整依赖树与版本见 `package-lock.json`；各包许可见 `node_modules/<pkg>/LICENSE`。

## 4. 系统组件与服务

- **Chromium**：由 Electron 内置并随包分发（Electron 33 对应 Chromium 130）。
  应用通过 `webContents.debugger`（进程内 DevTools Protocol）驱使它，
  **不依赖用户本机安装 Google Chrome**，也不开放任何调试端口。
- **chat.deepseek.com**：网页内容与服务均属 DeepSeek，本仓库不打包、不反代、不转售；
  应用只是在内嵌视图里加载该站点，等同于用户自己在浏览器中访问。
- **Agent Skills**（`resources/skills/`）：见第 2 节。
- **无自研原生二进制扩展**：鼠标、键盘、截图分别由 CDP `Input.*` 与
  `webContents.capturePage()` 完成，因此不需要辅助功能或屏幕录制权限，
  也没有与 CPU 架构绑定的原生模块需要编译。

---

## 商标声明

EAgent 与 Anthropic、Claude、DeepSeek 均无隶属或背书关系。
界面风格参考 Claude 桌面端，仅为视觉一致性的设计选择。
