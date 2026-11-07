// Рисует иконку приложения (256×256 PNG) средствами самого Electron
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const font = fs.readFileSync(path.resolve(__dirname, '..', 'node_modules/@fontsource/unbounded/files/unbounded-cyrillic-700-normal.woff2')).toString('base64');
const html = `<html><head><style>
@font-face { font-family: U; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html,body { margin:0; background:transparent; }
.i { width:256px; height:256px; display:grid; place-items:center; }
.m { width:224px; height:224px; border-radius:60px; display:grid; place-items:center; position:relative; overflow:hidden;
  background: linear-gradient(135deg,#8b5cf6 0%,#5b7cff 50%,#22d3ee 100%);
  box-shadow: inset 0 4px 0 rgba(255,255,255,.35), inset 0 -10px 30px rgba(20,10,60,.35); }
.m::before { content:''; position:absolute; width:260px; height:160px; left:-60px; top:-90px; border-radius:50%; background:rgba(255,255,255,.18); }
.m span { position:relative; font-family:U; font-weight:700; font-size:132px; color:#fff; line-height:1; margin-top:-6px; text-shadow:0 6px 18px rgba(40,20,120,.45); }
</style></head><body><div class="i"><div class="m"><span>Н</span></div></div></body></html>`;
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 256, height: 256, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await w.webContents.executeJavaScript('document.fonts.ready.then(() => document.fonts.size)');
  await new Promise((r) => setTimeout(r, 500));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), img.resize({ width: 256, height: 256 }).toPNG());
  app.quit();
});
