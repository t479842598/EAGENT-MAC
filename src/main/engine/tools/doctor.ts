import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CheckResult, DoctorReport, Settings } from '../../../shared/types';
import type { BrowserManager } from '../browser';
import type { DeepSeekDriver } from '../deepseek';

const exec = promisify(execFile);

const PERMISSION_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

export interface DoctorDeps {
  settings: Settings;
  browser: BrowserManager;
  driver: DeepSeekDriver | null;
  macinputPath: string;
  workDir: string;
}

/**
 * 七项自检 —— 对应验收标准里的 DoctorSheet 全绿。
 * 每项都给出可执行的修复建议，而不是只说「失败」。
 */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const { settings, browser, driver, macinputPath, workDir } = deps;
  const results: CheckResult[] = [];

  // 1. Chrome 是否安装
  const chromeExists = fs.existsSync(settings.chromePath);
  results.push({
    id: 'chrome',
    label: 'Chrome 浏览器',
    ok: chromeExists,
    detail: chromeExists ? settings.chromePath : `未找到: ${settings.chromePath}`,
    fix: chromeExists
      ? undefined
      : { label: '安装 Google Chrome', url: 'https://www.google.com/chrome/' }
  });

  // 2. 调试端口
  const portAlive = await browser.isPortAlive();
  const version = portAlive ? await browser.version() : undefined;
  results.push({
    id: 'cdp',
    label: 'Chrome 调试端口',
    ok: portAlive,
    detail: portAlive
      ? `127.0.0.1:${settings.debugPort} 已连通（${version ?? '未知版本'}）`
      : `127.0.0.1:${settings.debugPort} 未连通，点击「启动浏览器」`,
    fix: portAlive ? undefined : { label: '启动浏览器' }
  });

  // 3. 页面与选择器
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
    fix: inputOk ? undefined : { label: '重新连接页面' }
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
    detail: loggedIn ? '已登录' : '未登录，请在 Chrome 窗口内扫码/密码登录',
    fix: loggedIn ? undefined : { label: '在 Chrome 中登录 chat.deepseek.com' }
  });

  // 5. 原生工具 + 辅助功能权限
  let info: Record<string, any> | null = null;
  let macinputOk = false;
  try {
    const { stdout } = await exec(macinputPath, ['info'], { timeout: 8000 });
    info = JSON.parse(stdout.trim());
    macinputOk = fs.existsSync(macinputPath);
  } catch {
    macinputOk = false;
  }
  results.push({
    id: 'macinput',
    label: '原生输入工具 (macinput)',
    ok: macinputOk,
    detail: macinputOk ? `已就绪：${macinputPath}` : `缺失或无法执行：${macinputPath}（运行 npm run build:native）`,
    fix: macinputOk ? undefined : { label: '编译原生工具', command: 'npm run build:native' }
  });

  const accTrusted = !!info?.accessibilityTrusted;
  results.push({
    id: 'accessibility',
    label: '辅助功能权限',
    ok: accTrusted,
    detail: accTrusted ? '已授权（鼠标/键盘模拟可用）' : '未授权，鼠标与键盘模拟会被系统拦截',
    fix: accTrusted
      ? undefined
      : { label: '打开系统设置 → 隐私与安全性 → 辅助功能', command: `open "${PERMISSION_URL}"` }
  });

  // 6. 屏幕录制权限
  const screenOk = !!info?.screenCaptureAllowed;
  results.push({
    id: 'screen',
    label: '屏幕录制权限',
    ok: screenOk,
    detail: screenOk ? '已授权（截图工具可用）' : '未授权，截图会被系统拦截',
    fix: screenOk
      ? undefined
      : {
          label: '打开系统设置 → 隐私与安全性 → 屏幕录制',
          command: 'open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"'
        }
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

  return { results, macinput: info };
}
