import fs from 'node:fs';
import path from 'node:path';
import type { CheckResult, DoctorReport, Settings } from '../../../shared/types';
import type { WebViewHost } from '../webview';
import type { DeepSeekDriver } from '../deepseek';

export interface DoctorDeps {
  settings: Settings;
  host: WebViewHost;
  driver: DeepSeekDriver | null;
  skillsDir: string;
  workDir: string;
}

/**
 * 自检 —— 内嵌版与外部 Chrome 版的检查项完全不同。
 *
 * 旧的 chrome / 调试端口 / 辅助功能 / 屏幕录制 四项已经彻底失去意义：
 * 页面由 Electron 自带 Chromium 渲染，CDP 在进程内，截图走 capturePage，
 * 鼠标键盘走 CDP Input —— 全部零系统权限，不再需要任何「前往系统设置授权」。
 * 现在真正会坏的是：页面没起来、没登录、选择器漂移、工作目录不可写。
 */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const { settings, host, driver, skillsDir, workDir } = deps;
  const results: CheckResult[] = [];
  const status = host.getStatus();

  // 1. 内嵌页面
  const pageOk = status.status === 'ready' || status.status === 'login_required';
  results.push({
    id: 'page',
    label: '内嵌 DeepSeek 页面',
    ok: pageOk,
    detail: pageOk ? `已加载：${status.url || '(等待导航)'}` : `页面状态：${status.status}`,
    fix: pageOk ? undefined : { label: '重新加载页面' }
  });

  // 2. 进程内 CDP
  const client = host.getClient();
  let cdpOk = false;
  let cdpDetail = '未附着调试器';
  if (client) {
    try {
      const v = await client.send<{ product: string }>('Browser.getVersion', {});
      cdpOk = true;
      cdpDetail = `已附着：${v.product}`;
    } catch (err) {
      cdpDetail = `附着失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }
  results.push({
    id: 'cdp',
    label: '进程内调试通道',
    ok: cdpOk,
    detail: cdpDetail,
    fix: cdpOk ? undefined : { label: '重新连接' }
  });

  // 3. 页面选择器
  let probe: Record<string, number> | null = null;
  if (driver) {
    try {
      probe = await driver.probeSelectors();
    } catch {
      probe = null;
    }
  }
  const inputOk = !!probe && (probe.input ?? 0) > 0;
  results.push({
    id: 'selectors',
    label: 'DeepSeek 页面选择器',
    ok: inputOk,
    detail: probe
      ? `输入框 ${probe.input ?? 0} 个 / 发送按钮 ${probe.sendButton ?? 0} 个 / 消息区 ${probe.assistant ?? 0} 个`
      : '未连接页面，无法探测',
    fix: inputOk
      ? undefined
      : { label: '若页面结构变了，改 resources/selectors.json 后重启（无需重新打包）' }
  });

  // 4. 登录态
  let loggedIn = false;
  if (driver) {
    try {
      loggedIn = await driver.isLoggedIn();
    } catch {
      loggedIn = false;
    }
  }
  results.push({
    id: 'login',
    label: 'DeepSeek 登录态',
    ok: loggedIn,
    detail: loggedIn ? '已登录（登录态落盘在 persist:deepseek 分区）' : '未登录，请点标题栏「显示网页」在内嵌页面里登录',
    fix: loggedIn ? undefined : { label: '点标题栏「显示网页」后登录一次，之后长期有效' }
  });

  // 5. shell 可用（POSIX 用 zsh，Windows 用 powershell.exe）
  const isWin = process.platform === 'win32';
  const shell = isWin
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : process.env.SHELL || '/bin/zsh';
  const shellOk = (() => {
    try {
      return fs.existsSync(shell);
    } catch {
      return false;
    }
  })();
  results.push({
    id: 'shell',
    label: '终端命令环境',
    ok: shellOk,
    detail: shellOk ? `${shell}（${process.platform}/${process.arch}）` : `未找到 shell: ${shell}`,
    fix: shellOk ? undefined : { label: '检查系统 shell 配置' }
  });

  // 6. 技能目录
  let skillCount = 0;
  try {
    skillCount = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).length;
  } catch {
    skillCount = 0;
  }
  results.push({
    id: 'skills',
    label: '技能目录',
    ok: skillCount > 0,
    detail: skillCount > 0 ? `${skillsDir}（${skillCount} 个技能）` : `目录为空或不存在：${skillsDir}`,
    fix: skillCount > 0 ? undefined : { label: '确认 resources/skills 已随应用分发' }
  });

  // 7. 工作目录可写
  let workDirOk = false;
  try {
    fs.mkdirSync(workDir, { recursive: true });
    const probeFile = path.join(workDir, '.eagent-write-test');
    fs.writeFileSync(probeFile, 'ok');
    fs.unlinkSync(probeFile);
    workDirOk = true;
  } catch {
    workDirOk = false;
  }
  results.push({
    id: 'workdir',
    label: '工作目录可写',
    ok: workDirOk,
    detail: workDirOk ? workDir : `无法写入：${workDir}`,
    fix: workDirOk ? undefined : { label: '在设置里换一个目录' }
  });

  return {
    results,
    page: {
      status: status.status,
      url: status.url,
      visible: status.visible,
      partition: 'persist:deepseek',
      autoApprove: settings.autoApprove,
      alwaysAllow: settings.alwaysAllow
    }
  };
}
