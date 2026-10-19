import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';
import { DEFAULTS, getSettings, setSettings } from './store';
import { SessionEngine } from './engine/session';
import { runDoctor } from './engine/tools/doctor';
import { ensureTempDir, buildSystemPrompt, writeSystemPromptFile } from './engine/prompt';
import { getMainWindow } from './window';

export interface IpcDeps {
  engine: SessionEngine;
  macinputPath: string;
  skillsDir: string;
  systemPromptPath: string;
}

/** 所有渲染层可调用的通道，集中注册一次 */
export function registerIpc(deps: IpcDeps) {
  const { engine, macinputPath, skillsDir, systemPromptPath } = deps;

  // ---------- 引擎事件广播 ----------
  engine.on('event', (event) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('session:event', event);
  });

  // ---------- 会话控制 ----------
  ipcMain.handle('session:boot', async () => {
    await engine.boot();
    return engine.getState();
  });

  ipcMain.handle('session:reconnect', async () => {
    await engine.reconnect();
    return engine.getState();
  });

  ipcMain.handle('session:shutdown', async () => {
    await engine.shutdown();
    return engine.getState();
  });

  ipcMain.handle('session:abort', async () => {
    await engine.abort();
    return engine.getState();
  });

  ipcMain.handle('session:send', async (_e, payload: { text: string; files?: string[] }) => {
    await engine.send(payload.text, payload.files ?? []);
    return true;
  });

  ipcMain.handle(
    'session:approve',
    (_e, payload: { callId: string; verdict: 'allow_once' | 'always_allow' | 'deny' }) => {
      return engine.resolveApproval(payload.callId, payload.verdict);
    }
  );

  // ---------- 设置 ----------
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = setSettings(patch);
    engine.updateSettings(next);
    return next;
  });
  ipcMain.handle('settings:defaults', () => DEFAULTS);

  // ---------- 自检 ----------
  ipcMain.handle('doctor:run', async () => {
    return await runDoctor({
      settings: getSettings(),
      browser: engine.getBrowser(),
      driver: engine.getDriver(),
      macinputPath,
      workDir: getSettings().workDir
    });
  });

  // ---------- 文件选择 ----------
  ipcMain.handle('dialog:pick-files', async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: '选择要上传的文件',
      properties: ['openFile', 'multiSelections']
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('dialog:pick-dir', async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: '选择工作目录',
      properties: ['openDirectory', 'createDirectory']
    });
    return res.canceled ? [] : res.filePaths;
  });

  // ---------- 图片读取（渲染层无法直接读本地文件）----------
  ipcMain.handle('file:read-image', async (_e, filePath: string) => {
    try {
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      return `data:image/${mime};base64,${buf.toString('base64')}`;
    } catch {
      return '';
    }
  });

  // ---------- 系统集成 ----------
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('system:open-external', async (_e, url: string) => {
    if (!/^https?:|^x-apple\./.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('system:reveal-path', (_e, p: string) => {
    shell.showItemInFolder(p);
    return true;
  });

  ipcMain.handle('system:rebuild-prompt', (_e, extra: string) => {
    const settings = getSettings();
    const tempDir = ensureTempDir(settings);
    const content = buildSystemPrompt({
      workDir: settings.workDir,
      tempDir,
      skillsDir,
      extra
    });
    writeSystemPromptFile(tempDir, content);
    return content;
  });

  // ---------- 窗口状态（ClaudeDesktopHeader 依赖）----------
  ipcMain.handle('window:get-fullscreen', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win?.isFullScreen() ?? false;
  });

  ipcMain.handle('window:get-zoom', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win?.webContents.getZoomFactor() ?? 1;
  });

  ipcMain.handle('window:set-zoom', (e, factor: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.webContents.setZoomFactor(Math.min(2, Math.max(0.5, factor)));
    return win?.webContents.getZoomFactor() ?? 1;
  });

  ipcMain.handle('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
    return true;
  });

  ipcMain.handle('window:toggle-maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
}

/** 解析打包/开发两种布局下的资源路径 */
export function resolveAsset(...segments: string[]): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', ...segments),
    path.join(app.getAppPath(), ...segments),
    path.join(process.cwd(), ...segments)
  ];
  return candidates[0];
}
