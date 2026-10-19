import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface PermState {
  accessibilityTrusted: boolean;
  screenCaptureAllowed: boolean;
}

/** 读取 macinput info 的权限位；调用失败时返回 permissive 默认值，交给实际执行报错。 */
export async function readPermState(macinputPath: string): Promise<PermState> {
  try {
    const { stdout } = await exec(macinputPath, ['info'], { timeout: 8000 });
    const j = JSON.parse(stdout.trim());
    return {
      accessibilityTrusted: j.accessibilityTrusted !== false,
      screenCaptureAllowed: j.screenCaptureAllowed !== false
    };
  } catch {
    return { accessibilityTrusted: true, screenCaptureAllowed: true };
  }
}

export const AX_HINT =
  '请到 系统设置 → 隐私与安全性 → 辅助功能，勾选 EAgent（或终端）后重启应用。\n' +
  '可直接执行：open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"';

export const SCR_HINT =
  '请到 系统设置 → 隐私与安全性 → 屏幕录制，勾选 EAgent（或终端）后重启应用。\n' +
  '可直接执行：open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"';
