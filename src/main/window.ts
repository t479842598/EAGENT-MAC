import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let resizeHook: (() => void) | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** 由 index.ts 注入：窗口尺寸变化时重新摆放内嵌网页视图 */
export function setResizeHook(fn: () => void): void {
  resizeHook = fn;
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  // 自绘 45px 标题栏：macOS 走 hidden + 红绿灯浮层，Windows 走 titleBarOverlay
  // （Windows 无红绿灯，用系统最小化/最大化/关闭三键叠在右上角，颜色由渲染层控制）。
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(isMac
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 18, y: 18 } }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#151515', symbolColor: '#d4d4d4', height: 45 }
        }),
    backgroundColor: '#151515',
    // Windows 需要显式指定窗口图标；macOS 由 .icns 决定，传了反而不生效
    ...(isMac ? {} : { icon: path.join(process.resourcesPath ?? app.getAppPath(), 'resources', 'icon.png') }),
    ...(isMac ? { vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // 外链一律走系统浏览器，避免在应用内开新窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });

  // 窗口状态广播给渲染层（ClaudeDesktopHeader 依赖）
  const sendState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:fullscreen-changed', mainWindow.isFullScreen());
    mainWindow.webContents.send('window:zoom-changed', mainWindow.webContents.getZoomFactor());
  };
  mainWindow.on('enter-full-screen', sendState);
  mainWindow.on('leave-full-screen', sendState);
  mainWindow.on('maximize', sendState);
  mainWindow.on('unmaximize', sendState);

  // 内嵌网页视图是原生层，窗口变化必须显式重排，否则会错位
  const relayout = () => {
    try {
      resizeHook?.();
    } catch {
      /* ignore */
    }
  };
  mainWindow.on('resize', relayout);
  mainWindow.on('enter-full-screen', relayout);
  mainWindow.on('leave-full-screen', relayout);
  mainWindow.on('maximize', relayout);
  mainWindow.on('unmaximize', relayout);
  mainWindow.on('restore', relayout);

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function toggleDevTools() {
  mainWindow?.webContents.toggleDevTools();
}

