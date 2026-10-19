# Assets & Compliance Policy

## ⚖️ 开源资产与版权合规声明 (DMCA & Asset Policy)

为了遵守开源软件规范及 DMCA / 知识产权法律，`open-claude-ui` **不公开分发任何属于 Anthropic, PBC 的专有二进制资产**（包括但不限于商业可变字体文件 `.ttf`、语音模式对话录音 `.mp3` 以及官方商业标识）。

### 1. 字体解决方案 (Font Stack Policy)
本项目组件已全量配置系统级高保真字体回退栈，无需下载任何专有商业字体文件即可完美呈现优雅排版：
- **正文无衬线 (Sans)**：优先采用系统原生现代字体栈（macOS / iOS 的 San Francisco、Windows 的 Segoe UI、Android / Linux 的 Roboto）；
- **衬线标题 (Serif)**：优先采用 New York、Georgia、Cambria 系统衬线字体；
- **等宽代码 (Monospace)**：优先采用 SF Mono、Menlo、Monaco、Consolas 原生等宽字体。

若你拥有合法授权的可变字体，可在你的前端项目中通过 CSS `@font-face` 引入，组件将自动无缝匹配。

### 2. 交互音效解决方案 (Synthetic Audio Engine)
`ClaudeAudioPlayer.ts` 已经内置了基于 **Web Audio API 振荡器（OscillatorNode）** 的原生纯代码合成引擎：
- **零外部依赖**：不依赖任何本地或远端 `.mp3` 文件；
- **即时响应**：0ms 网络加载延迟，开箱即用；
- **自定义扩展 (BYO)**：支持开发者通过 `ClaudeAudioPlayer.getInstance().setSfxPath(name, yourUrl)` 自由接入自己的免版权提示音。
