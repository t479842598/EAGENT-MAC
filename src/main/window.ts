import { BrowserWindow, shell, app } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // 与 open-claude-ui 的 ClaudeDesktopHeader 对齐：隐藏系统标题栏，红绿灯浮在内容上
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#fcfcfb',
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
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

export function appIconPath(): string {
  return path.join(app.getAppPath(), 'resources', 'icon.png');
}
