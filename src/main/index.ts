import { app, BrowserWindow, globalShortcut, Menu, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { SessionEngine } from './engine/session';
import { ensureTempDir, buildSystemPrompt, writeSystemPromptFile } from './engine/prompt';
import { registerIpc } from './ipc';
import { createMainWindow, getMainWindow } from './window';
import { getSettings, setSettings } from './store';

// 单实例锁：避免重复启动两个 Chrome 抢占同一个调试端口
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

/** 解析 bin/macinput：打包后在 Resources/bin，开发态在仓库 bin/ */
function resolveMacinput(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'bin', 'macinput'),
    path.join(app.getAppPath(), 'bin', 'macinput'),
    path.join(process.cwd(), 'bin', 'macinput')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return candidates[0];
}

function resolveSkillsDir(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'resources', 'skills'),
    path.join(app.getAppPath(), 'resources', 'skills'),
    path.join(process.cwd(), 'resources', 'skills')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return candidates[0];
}

let engine: SessionEngine | null = null;

async function bootstrap() {
  const settings = getSettings();
  const tempDir = ensureTempDir(settings);
  const skillsDir = resolveSkillsDir();
  const macinputPath = resolveMacinput();

  const promptContent = buildSystemPrompt({
    workDir: settings.workDir,
    tempDir,
    skillsDir,
    extra: settings.systemPromptExtra
  });
  const systemPromptPath = writeSystemPromptFile(tempDir, promptContent);

  engine = new SessionEngine({
    settings,
    macinputPath,
    skillsDir,
    systemPromptPath,
    systemPrompt: promptContent,
    // 「始终允许」要落盘，否则重启后白名单丢失，用户会被反复询问同一个工具
    onSettingsChange: (patch) => {
      setSettings(patch);
    }
  });

  registerIpc({ engine, macinputPath, skillsDir, systemPromptPath });

  // macOS 菜单：保留复制粘贴与 ⌘. 急停
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '会话',
      submenu: [
        {
          label: '中止当前任务 (⌘.)',
          accelerator: 'CmdOrCtrl+.',
          click: () => void engine?.abort()
        },
        {
          label: '重新连接浏览器',
          click: () => void engine?.reconnect()
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  nativeTheme.themeSource = getSettings().theme;

  createMainWindow();

  // 全局 ⌘. 急停（窗口失焦时也能打断）
  globalShortcut.register('CommandOrControl+.', () => {
    void engine?.abort();
  });

  // 自动启动浏览器（失败不阻塞 UI，渲染层会显示错误并给出重试按钮）
  void engine.boot().catch(() => undefined);
}

app.whenReady().then(bootstrap).catch((err) => {
  console.error('[EAgent] 启动失败', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  // 尽力关掉我们启动的 Chrome，避免残留占用调试端口
  void engine?.shutdown().catch(() => undefined);
});
