'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { DEFAULT_SETTINGS } = require('./shared/defaults.js');

const WIDGET_SIZE = { width: 400, height: 322 };
const SETTINGS_VIEW_HEIGHT = 890;
const isMac = process.platform === 'darwin';

// 可用于截图 / 演示时隔离配置，不影响正式使用的数据
if (process.env.SALARY_USER_DATA) {
  app.setPath('userData', process.env.SALARY_USER_DATA);
}

let mainWindow = null;
let tray = null;
let settings = sanitizeSettings(DEFAULT_SETTINGS);
let isQuitting = false;
let persistTimer = null;
let moveTimer = null;
let appliedLoginItem = null;
let hideNoticeShown = false;

const debugLogPath = process.env.SALARY_DEBUG_LOG || '';
function debugLog(message) {
  if (!debugLogPath) return;
  try {
    fs.appendFileSync(debugLogPath, new Date().toISOString() + ' ' + message + '\n');
  } catch (error) { /* ignore */ }
}

app.setAppUserModelId('com.currykernel.salarytime.teacher');
debugLog('main loaded');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
debugLog('single instance lock: ' + hasSingleInstanceLock);

if (!hasSingleInstanceLock) {
  debugLog('quitting: no single instance lock');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    debugLog('app ready');
    settings = readSettings();
    registerIpc();
    createWindow();
    createTray();
    applySystemSettings();
    if (isMac && app.dock) app.dock.hide();
    maybeCapture();
    debugLog('startup complete');
  });
}

app.on('before-quit', () => {
  debugLog('before-quit');
  isQuitting = true;
  persistSettings();
});

app.on('will-quit', () => {
  debugLog('will-quit');
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});

/* ------------------------------------------------------------------ */
/* 设置读写                                                             */
/* ------------------------------------------------------------------ */

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return sanitizeSettings(raw);
  } catch (error) {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
}

function persistSettings() {
  clearTimeout(persistTimer);
  persistTimer = null;
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('保存设置失败:', error);
  }
}

function persistSettingsDebounced() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistSettings, 350);
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max, fallback) {
  const n = toNumber(value, fallback);
  return Math.min(max, Math.max(min, n));
}

function validTime(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? String(value) : fallback;
}

function sanitizeSettings(input) {
  const source = Object.assign({}, DEFAULT_SETTINGS, input || {});
  const s = {};

  s.baseSalary = clamp(source.baseSalary, 0, 1e9, DEFAULT_SETTINGS.baseSalary);
  s.housingAllowance = clamp(source.housingAllowance, 0, 1e9, DEFAULT_SETTINGS.housingAllowance);
  s.classRate = clamp(source.classRate, 0, 10000, DEFAULT_SETTINGS.classRate);
  s.morningClasses = Math.floor(clamp(source.morningClasses, 0, 20, DEFAULT_SETTINGS.morningClasses));
  s.afternoonClasses = Math.floor(clamp(source.afternoonClasses, 0, 20, DEFAULT_SETTINGS.afternoonClasses));
  s.morningCoefficient = clamp(source.morningCoefficient, 0, 5, DEFAULT_SETTINGS.morningCoefficient);
  s.afternoonCoefficient = clamp(source.afternoonCoefficient, 0, 5, DEFAULT_SETTINGS.afternoonCoefficient);

  s.workStart = validTime(source.workStart, DEFAULT_SETTINGS.workStart);
  s.workEnd = validTime(source.workEnd, DEFAULT_SETTINGS.workEnd);
  if (toSeconds(s.workEnd) <= toSeconds(s.workStart)) {
    s.workStart = DEFAULT_SETTINGS.workStart;
    s.workEnd = DEFAULT_SETTINGS.workEnd;
  }

  s.lunchStart = validTime(source.lunchStart, DEFAULT_SETTINGS.lunchStart);
  s.lunchEnd = validTime(source.lunchEnd, DEFAULT_SETTINGS.lunchEnd);
  if (toSeconds(s.lunchEnd) < toSeconds(s.lunchStart)) {
    const tmp = s.lunchStart;
    s.lunchStart = s.lunchEnd;
    s.lunchEnd = tmp;
  }

  s.alwaysOnTop = source.alwaysOnTop !== false;
  s.openAtLogin = !!source.openAtLogin;

  const bounds = source.windowBounds;
  s.windowBounds = bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    ? { x: Math.round(bounds.x), y: Math.round(bounds.y) }
    : null;

  return s;
}

function toSeconds(value) {
  const parts = String(value || '').split(':');
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60;
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                 */
/* ------------------------------------------------------------------ */

function assetPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, '..', 'build', name);
}

function initialBounds() {
  const saved = settings.windowBounds;

  if (saved) {
    const rect = { x: saved.x, y: saved.y, width: WIDGET_SIZE.width, height: WIDGET_SIZE.height };
    const display = screen.getDisplayMatching(rect);
    const wa = display.workArea;
    const intersects = saved.x + WIDGET_SIZE.width > wa.x && saved.x < wa.x + wa.width &&
      saved.y + WIDGET_SIZE.height > wa.y && saved.y < wa.y + wa.height;
    if (intersects) {
      return {
        x: Math.max(wa.x, Math.min(saved.x, wa.x + wa.width - WIDGET_SIZE.width)),
        y: Math.max(wa.y, Math.min(saved.y, wa.y + wa.height - WIDGET_SIZE.height)),
        ...WIDGET_SIZE
      };
    }
  }

  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - WIDGET_SIZE.width - 16,
    y: area.y + area.height - WIDGET_SIZE.height - 16,
    ...WIDGET_SIZE
  };
}

function createWindow() {
  const bounds = initialBounds();

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 300,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'salary-time · 教师版',
    icon: assetPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    debugLog('ready-to-show');
    mainWindow.show();
    if (settings.alwaysOnTop) mainWindow.setAlwaysOnTop(true, 'floating');
  });

  mainWindow.on('move', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const b = mainWindow.getBounds();
      settings.windowBounds = { x: b.x, y: b.y + b.height - WIDGET_SIZE.height };
      persistSettingsDebounced();
    }, 400);
  });

  // 点“关闭”时收进托盘，而不是退出应用
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isMac) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
}

function applySystemSettings() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop, 'floating');
  }
  if (app.isPackaged) {
    const want = !!settings.openAtLogin;
    // 首次启动时只在需要开启自启时写入系统，避免无意义的权限请求
    const shouldApply = appliedLoginItem === null ? want : appliedLoginItem !== want;
    if (shouldApply) {
      try {
        app.setLoginItemSettings({ openAtLogin: want });
      } catch (error) {
        console.error('设置开机自启失败:', error);
      }
    }
    appliedLoginItem = want;
  }
  rebuildTrayMenu();
}

function setView(view) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const targetHeight = view === 'settings' ? SETTINGS_VIEW_HEIGHT : WIDGET_SIZE.height;
  const current = mainWindow.getBounds();
  const area = screen.getDisplayMatching(current).workArea;
  const height = Math.min(targetHeight, area.height - 24);
  let y = current.y + current.height - height;
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - height - 8));
  mainWindow.setBounds({ x: current.x, y, width: current.width, height }, true);
}

/* ------------------------------------------------------------------ */
/* 托盘                                                                 */
/* ------------------------------------------------------------------ */

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  let image = nativeImage.createFromPath(assetPath('tray.png'));
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(assetPath('icon.png'));
  }
  if (isMac) image = image.resize({ width: 18, height: 18 });

  tray = new Tray(image);
  tray.setToolTip('salary-time 教师版');
  rebuildTrayMenu();
  tray.on('click', toggleWindow);
  tray.on('double-click', () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏悬浮窗',
      click: toggleWindow
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: !!settings.alwaysOnTop,
      click: (item) => {
        settings.alwaysOnTop = item.checked;
        applySystemSettings();
        persistSettingsDebounced();
        notifySettingsUpdated();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
}

function notifySettingsUpdated() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings:updated', settings);
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                  */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('app:get-state', () => ({
    settings,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged
  }));

  ipcMain.handle('settings:save', (event, patch) => {
    if (!patch || typeof patch !== 'object') return settings;
    const merged = Object.assign({}, settings, patch, { windowBounds: settings.windowBounds });
    settings = sanitizeSettings(merged);
    applySystemSettings();
    persistSettingsDebounced();
    return settings;
  });

  ipcMain.handle('settings:reset', () => {
    settings = sanitizeSettings(Object.assign({}, DEFAULT_SETTINGS, {
      windowBounds: settings.windowBounds
    }));
    applySystemSettings();
    persistSettingsDebounced();
    return settings;
  });

  ipcMain.on('window:set-view', (event, view) => setView(view === 'settings' ? 'settings' : 'widget'));
  ipcMain.on('window:hide', () => {
    if (!mainWindow) return;
    mainWindow.hide();
    if (process.platform === 'win32' && tray && !hideNoticeShown) {
      hideNoticeShown = true;
      try {
        tray.displayBalloon({
          title: 'salary-time · 教师版',
          content: '已隐藏到系统托盘，单击托盘图标即可重新显示。'
        });
      } catch (error) {
        // 部分 Windows 环境不支持气泡提示，忽略即可
      }
    }
  });
  ipcMain.on('window:quit', () => { isQuitting = true; app.quit(); });
}

/* ------------------------------------------------------------------ */
/* 截图（仅用于自动化验证）                                               */
/* ------------------------------------------------------------------ */

function maybeCapture() {
  const capturePath = process.env.SALARY_CAPTURE;
  if (!capturePath || !mainWindow) return;
  const view = process.env.SALARY_CAPTURE_VIEW || 'widget';

  mainWindow.webContents.once('did-finish-load', () => {
    if (view === 'settings') {
      setTimeout(() => {
        if (mainWindow) mainWindow.webContents.send('debug:view', 'settings');
      }, 500);
    }
    setTimeout(async () => {
      try {
        if (process.env.SALARY_DUMP_LAYOUT) {
          const layout = await mainWindow.webContents.executeJavaScript(`(() => {
            const rect = (selector) => {
              const node = document.querySelector(selector);
              if (!node) return null;
              const r = node.getBoundingClientRect();
              return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
            };
            const scroller = document.querySelector('.settings-scroll');
            return JSON.stringify({
              inner: [window.innerWidth, window.innerHeight],
              main: rect('.main-view'),
              hero: rect('.hero'),
              cards: rect('.cards'),
              footer: rect('.footer'),
              settingsScroll: rect('.settings-scroll'),
              settingsScrollHeight: scroller ? [scroller.clientHeight, scroller.scrollHeight] : null
            });
          })()`);
          console.log('layout:', layout);
        }
        const image = await mainWindow.webContents.capturePage();
        fs.mkdirSync(path.dirname(capturePath), { recursive: true });
        fs.writeFileSync(capturePath, image.toPNG());
        console.log('captured:', capturePath);
      } catch (error) {
        console.error('截图失败:', error);
      }
      isQuitting = true;
      app.quit();
    }, 1800);
  });
}
