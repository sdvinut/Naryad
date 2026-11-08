const { app, BrowserWindow, Tray, nativeImage, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const xlsx = require('./xlsx.cjs');
const { buildDocx } = require('./docx.cjs');

const DEV_URL = process.env.NARYADY_DEV_URL;
// для автопроверки: отдельная папка данных и снимок окна после загрузки
if (process.env.NARYADY_USERDATA) app.setPath('userData', process.env.NARYADY_USERDATA);
const SMOKE_SHOT = process.env.NARYADY_SMOKE;
const PERF_OUT = process.env.NARYADY_PERF;
// невидимое окно (рисуется в память) — для автопроверок, чтобы ничего не всплывало на экране
const HEADLESS = !!process.env.NARYADY_HEADLESS;
const PROBE = process.env.NARYADY_PROBE || 'perf-probe.js';
// для опытов с отрисовкой: NARYADY_SWITCHES="use-angle=gl,disable-gpu"
const SWITCHES = (process.env.NARYADY_SWITCHES || '').split(',').filter(Boolean);
for (const sw of SWITCHES) {
  const [k, v] = sw.split('=');
  app.commandLine.appendSwitch(k, v);
}

// Способ отрисовки. На видеокартах Intel Arc стандартный путь Chromium (ANGLE поверх D3D11) сбоит:
// графический процессор перезапускается, и интерфейс идёт рывками (замер: 2–5 кадров/с против 110–165 на D3D11on12).
// Если выбранный способ на каком-то компьютере падает, при следующем запуске берём следующий из списка.
const BACKENDS = ['d3d11on12', 'd3d11', 'gl'];
const renderFile = () => path.join(app.getPath('userData'), 'render.json');
let backend = null;
if (process.platform === 'win32' && !SWITCHES.some((s) => s.startsWith('use-angle') || s === 'disable-gpu')) {
  try { backend = JSON.parse(fs.readFileSync(renderFile(), 'utf8')).angle; } catch { /* первый запуск */ }
  if (!BACKENDS.includes(backend)) backend = BACKENDS[0];
  app.commandLine.appendSwitch('use-angle', backend);
  const startedAt = Date.now();
  app.on('child-process-gone', (_e, d) => {
    // меняем способ, только если графика упала сразу после запуска, а не из-за случайного сбоя позже
    if (d.type !== 'GPU' || d.reason === 'clean-exit' || Date.now() - startedAt > 30000) return;
    const next = BACKENDS[(BACKENDS.indexOf(backend) + 1) % BACKENDS.length];
    try { fs.mkdirSync(path.dirname(renderFile()), { recursive: true }); fs.writeFileSync(renderFile(), JSON.stringify({ angle: next, after: d.reason })); } catch { /* не критично */ }
  });
}
const projectFile = () => path.join(app.getPath('userData'), 'project.json');

let win;
let tray;
let isQuitting = false;
let closePromptOpen = false;

function restoreFromTray() {
  if (!win || win.isDestroyed()) return;
  win.setSkipTaskbar(false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (tray) { tray.destroy(); tray = null; }
}

function ensureTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Наряды');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть «Наряды»', click: restoreFromTray },
    { type: 'separator' },
    { label: 'Выйти', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', restoreFromTray);
}

function hideToTray() {
  if (!win || win.isDestroyed()) return;
  ensureTray();
  win.setSkipTaskbar(true);
  win.hide();
}

async function confirmClose() {
  if (closePromptOpen) return;
  closePromptOpen = true;
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Закрытие приложения',
      message: 'Вы действительно хотите закрыть приложение?',
      detail: 'Можно закрыть программу или скрыть её окно в системный трей.',
      buttons: ['Да', 'Нет', 'Свернуть в трей'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) { isQuitting = true; app.quit(); }
    else if (response === 2) hideToTray();
  } finally {
    closePromptOpen = false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#07090f',
    title: `Наряды ${app.getVersion()}`,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#c7cede', height: 46 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: HEADLESS,
    },
  });
  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    confirmClose();
  });
  if (HEADLESS) win.setSize(1536, 912);
  else win.once('ready-to-show', () => { win.maximize(); win.show(); });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // ссылки — во внешнем браузере, навигацию внутри окна не разрешаем
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault(); });
  if (PERF_OUT || SMOKE_SHOT) {
    win.webContents.on('console-message', (e) => { if (e.level !== 'info' && e.level !== 'debug') console.error(`[${new Date().toISOString().slice(17, 23)}] renderer:`, e.message); });
    win.webContents.on('render-process-gone', (_e, d) => console.error(`[${new Date().toISOString().slice(17, 23)}] renderer gone:`, JSON.stringify(d)));
    app.on('child-process-gone', (_e, d) => console.error(`[${new Date().toISOString().slice(17, 23)}] child gone:`, JSON.stringify(d)));
    win.on('unresponsive', () => console.error(`[${new Date().toISOString().slice(17, 23)}] window unresponsive`));
    win.on('responsive', () => console.error(`[${new Date().toISOString().slice(17, 23)}] window responsive`));
    win.webContents.on('did-start-navigation', (d) => console.error(`[${new Date().toISOString().slice(17, 23)}] navigation:`, d.url?.slice(-40), d.isSameDocument));
  }
  if (PERF_OUT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const probe = fs.readFileSync(path.join(__dirname, '..', 'dev', PROBE), 'utf8');
      const result = await win.webContents.executeJavaScript(probe).catch((err) => { console.error('probe failed:', err.stack || err.message); app.exit(3); });
      if (!result) return;
      const info = await app.getGPUInfo('basic').catch(() => ({}));
      result.push({ name: 'gpu', backend, devices: (info.gpuDevice || []).map((g) => g.deviceString).filter(Boolean) });
      fs.writeFileSync(PERF_OUT, JSON.stringify(result, null, 1));
      if (SMOKE_SHOT) fs.writeFileSync(SMOKE_SHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    }, 2500));
  }
  if (SMOKE_SHOT && !PERF_OUT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(SMOKE_SHOT, img.toPNG());
      app.quit();
    }, 3500));
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

const FILTER_PROJECT = [{ name: 'Проект нарядов', extensions: ['naryady', 'json'] }];

ipcMain.handle('project:load', () => {
  try { return JSON.parse(fs.readFileSync(projectFile(), 'utf8')); } catch { return null; }
});

ipcMain.handle('project:save', (_e, data) => {
  fs.mkdirSync(path.dirname(projectFile()), { recursive: true });
  writeAtomic(projectFile(), JSON.stringify(data));
  return true;
});

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Открыть проект', filters: FILTER_PROJECT, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
});

ipcMain.handle('project:saveAs', async (_e, data) => {
  const r = await dialog.showSaveDialog(win, { title: 'Сохранить копию проекта', defaultPath: 'Наряды.naryady', filters: FILTER_PROJECT });
  if (r.canceled || !r.filePath) return null;
  writeAtomic(r.filePath, JSON.stringify(data, null, 1));
  return r.filePath;
});

ipcMain.handle('xlsx:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Импорт графика из Excel', filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const info = await xlsx.inspect(file);
  return { file, name: path.basename(file), sheets: info.sheets };
});

ipcMain.handle('xlsx:import', (_e, file, sheet) => xlsx.importSheet(file, sheet));

ipcMain.handle('docx:export', async (_e, payload, suggestedName) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Сохранить график для печати',
    defaultPath: path.join(app.getPath('documents'), suggestedName || 'График нарядов.docx'),
    filters: [{ name: 'Документ Word', extensions: ['docx'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const buf = await buildDocx(payload);
  fs.writeFileSync(r.filePath, buf);
  return r.filePath;
});

ipcMain.handle('shell:open', (_e, file) => shell.openPath(file));
ipcMain.handle('shell:show', (_e, file) => shell.showItemInFolder(file));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => app.quit());
