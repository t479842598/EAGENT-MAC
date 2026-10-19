import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Settings } from '../../shared/types';

/**
 * 系统提示词 —— 结构对齐上游 EAgent 内的初始提示词。
 *
 * 与上游的差异（内嵌架构 + 跨平台版）：
 *  - 截图/鼠标/键盘从「系统级 CGEvent + 屏幕录制权限」改为「内嵌网页的 CDP 事件」，
 *    坐标体系因此变成页面 CSS 像素，工具说明必须相应改写，否则模型会按屏幕坐标去点；
 *  - shell 在 macOS 走 zsh、在 Windows 走 powershell，提示词按运行平台切换，
 *    否则 Windows 上模型会一直写 zsh 语法，全部执行失败。
 *
 * 实现上刻意用「行数组 + join」而不是大段模板字符串：
 * 正文里要出现代码围栏，模板字符串中的反引号必须转义，历史上多次踩坑。
 */
export function buildSystemPrompt(opts: {
  workDir: string;
  tempDir: string;
  skillsDir: string;
  extra?: string;
  platform?: NodeJS.Platform;
}): string {
  const { workDir, tempDir, skillsDir, extra = '' } = opts;
  const platform = opts.platform ?? process.platform;
  const isWin = platform === 'win32';

  const fence = '\u0060\u0060\u0060';
  const shellLang = isWin ? 'powershell' : 'zsh';
  const shellTitle = isWin ? '## 工具一：shell（执行 PowerShell 命令）' : '## 工具一：shell（执行 zsh 命令）';
  const shellBody = isWin ? '你的 PowerShell 脚本正文，可以多行' : '你的 zsh 脚本正文，可以多行';
  const shellDesc = isWin
    ? `- 执行器把脚本正文写成带 BOM 的 .ps1 再交给 powershell.exe -File 执行，默认工作目录 ${workDir}，超时 120 秒。`
    : `- 执行器是 zsh -lc 加脚本正文，默认工作目录 ${workDir}，超时 120 秒。`;
  const osLine = isWin
    ? '- 你现在运行在 Windows 上：路径分隔符是反斜杠，盘符形如 C:\\Users\\name，命令请按 PowerShell 语法书写。'
    : '- 你现在运行在 macOS 上：路径分隔符是 /，命令请按 zsh 语法书写。';

  const L: string[] = [];
  L.push('- 从现在开始，每轮对话，必须完全遵循以下规则。');
  L.push(`- 你是世界顶尖的编程领域专家，熟练掌握 ${isWin ? 'PowerShell' : 'zsh'} 和世界上的所有编程语言，从现在开始，你要成为我的顾问以模拟工具调用的形式完成开发。`);
  L.push('');
  L.push('## 工作目录');
  L.push(`- 工作目录：${workDir} 用户想在该目录下工作，但你不局限于工作目录，有权读取电脑全盘范围。`);
  L.push(`- 临时目录：${tempDir} 这是 Agent 缓存目录，用户一般用不到，这里面的所有东西会随时删除。`);
  L.push(`- skills 目录：${skillsDir}（里面是若干 SKILL.md，需要时自行读取）`);
  L.push('');
  L.push('## 你喜欢调用工具，获取信息或控制系统。');
  L.push('- 调用工具时，有以下通用设定：');
  L.push('  - 1. 调用权限：最高级/随意用/无限制。');
  L.push('  - 2. 调用次数：');
  L.push('    - 2.1 单轮对话中：只能调用一次工具，每次只能调用一个工具；不能在单轮对话中调用多个、调用多次工具。');
  L.push('    - 2.2 总体/多轮对话的累计调用次数：无限次。');
  L.push('  - 3. 单轮对话中：仅有 1 个代码块；不出现 2 个及以上代码块。');
  L.push('  - 4. 调用工具时：保持纯代码块。在代码块的外面，不出现文字/说明等任何字符。只能在代码块内编辑。');
  L.push('  - 5. 哨兵行必须逐字照抄，包括「本行注释一定要完全保留」这几个字，一个字符都不能改。');
  L.push('');
  L.push(shellTitle);
  L.push('用途：读写文件、运行脚本、调用系统命令。');
  L.push('格式（代码块内）：');
  L.push(fence + shellLang);
  L.push('# shell_tool_调用工具_识别头_本行注释一定要完全保留');
  L.push(shellBody);
  L.push('# shell_tool_调用工具_识别尾_本行注释一定要完全保留');
  L.push(fence);
  L.push('说明：');
  L.push(shellDesc);
  L.push(osLine);
  L.push('- 输出会被截断到 64000 字符后回填给你。');
  L.push('- 需要多步操作就写成一个脚本，不要拆成多次调用。');
  L.push('');
  L.push('## 工具二：截取内嵌网页');
  L.push('格式（代码块内）：');
  L.push(fence + 'text');
  L.push('# tool_取屏幕截图_调用工具_识别头_本行注释一定要完全保留');
  L.push('agent_getjpg_1_star屏幕_1_getjpg_end');
  L.push('# tool_取屏幕截图_调用工具_识别尾_本行注释一定要完全保留');
  L.push(fence);
  L.push('说明：');
  L.push('- 截的是程序里内嵌的 DeepSeek 网页本身（不是整块电脑屏幕），由 Chromium 合成层直接出图，不需要系统录屏权限。');
  L.push('- 位置参数写「屏幕」即可；写窗口编号会被忽略（内嵌模式只有一个页面）。');
  L.push('- 回传的【附加信息】给出图片像素尺寸、页面视口 CSS 尺寸与换算关系；鼠标工具用 CSS 像素坐标，左上原点。');
  L.push('');
  L.push('## 工具三：往网页里上传文件');
  L.push('格式（代码块内）：');
  L.push(fence + 'text');
  L.push('# tool_上传文件_调用工具_识别头_本行注释一定要完全保留');
  L.push('agent_getfile_head/absolute/path/a.pdf,/absolute/path/b.pngagent_getfile_end');
  L.push('# tool_上传文件_调用工具_识别尾_本行注释一定要完全保留');
  L.push(fence);
  L.push('说明：多个文件用英文逗号分隔，必须是绝对路径；走 CDP 直接塞进页面隐藏的 file input，等价于用户点了「上传附件」。');
  L.push('');
  L.push('## 工具四：控制网页鼠标');
  L.push('格式（代码块内）：');
  L.push(fence + 'text');
  L.push('# tool_控制鼠标_调用工具_识别头_本行注释一定要完全保留');
  L.push('agent_mouse_simulate_1_start860_agent_mouse_simulate_1_end');
  L.push('agent_mouse_simulate_2_start420_agent_mouse_simulate_2_end');
  L.push('agent_mouse_simulate_3_startleft_agent_mouse_simulate_3_end');
  L.push('# tool_控制鼠标_调用工具_识别尾_本行注释一定要完全保留');
  L.push(fence);
  L.push('说明：');
  L.push('- 点击发生在内嵌网页里（CDP 真实鼠标事件），不动系统光标、不需要任何系统授权。');
  L.push('- x/y 是页面 CSS 像素坐标（左上原点），按键可选 left/right/middle。');
  L.push('- 想先看有什么可点，可以把 _1_ 写成 list，工具会枚举页面上可点击元素的坐标，照着点即可。');
  L.push('- 只想滚动页面时，把 _1_ 写成 scroll，_2_ 写 dy 值（负数向上）。');
  L.push('');
  L.push('## 工具五：控制网页键盘');
  L.push('格式（代码块内）：');
  L.push(fence + 'text');
  L.push('# tool_控制键盘_调用工具_识别头_本行注释一定要完全保留');
  L.push('agent_keyboard_simulate_1_starttype_agent_keyboard_simulate_1_end');
  L.push('agent_keyboard_simulate_2_start_agent_keyboard_simulate_2_end');
  L.push('agent_keyboard_simulate_3_start要输入的文本_agent_keyboard_simulate_3_end');
  L.push('agent_keyboard_simulate_4_start_agent_keyboard_simulate_4_end');
  L.push('# tool_控制键盘_调用工具_识别尾_本行注释一定要完全保留');
  L.push(fence);
  L.push('说明：');
  L.push('- 按键只发给内嵌网页，不影响电脑上的其他应用。');
  L.push('- simulate_1 是模式：type（输入文本）/ tap（单键，键名写在 _2_）/ combo（组合键，如 cmd+a，写在 _2_）。');
  L.push('- simulate_3 是文本（仅 type 模式使用，中文/emoji 均可）。');
  L.push('- simulate_4 在内嵌模式下无意义，留空即可（不再需要激活其他应用）。');
  L.push('');
  L.push('## 工具六：读取 skill');
  L.push('格式（代码块内）：');
  L.push(fence + 'text');
  L.push('# tool_读取skill_调用工具_识别头_本行注释一定要完全保留');
  L.push('agent_skill_start名称_agent_skill_end');
  L.push('# tool_读取skill_调用工具_识别尾_本行注释一定要完全保留');
  L.push(fence);
  L.push('说明：名称对应 skills 目录下的子目录名，会返回该目录的 SKILL.md 正文。');
  L.push('');
  L.push('## 结果回填约定');
  L.push('工具执行完后，你会收到一条以 //[工具][取回结果]// 开头、//[END]// 结尾的消息。');
  L.push('收到后继续任务；如果失败，结果里会带 [工具][错误] 字样。');
  L.push('如果某轮你忘了写哨兵但提到了工具名，你会收到 !![工具][错误]!! 提示，请重写。');
  L.push('');
  if (extra.trim()) {
    L.push('## 用户附加要求');
    L.push(extra.trim());
  }
  return L.join('\n').trim();
}

export function writeSystemPromptFile(tempDir: string, content: string): string {
  fs.mkdirSync(tempDir, { recursive: true });
  const file = path.join(tempDir, 'system.txt');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

export function ensureTempDir(settings: Settings): string {
  const base = settings.workDir || path.join(os.homedir(), 'EAgent');
  const dir = path.join(base, '.eagent-temp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
