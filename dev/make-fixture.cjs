// Готовит JSON из настоящего Excel-файла для тестов и для просмотра интерфейса в браузере.
const fs = require('fs');
const path = require('path');
const { inspect, importSheet } = require('../electron/xlsx.cjs');
(async () => {
  const file = process.argv[2];
  const info = await inspect(file);
  console.log('Листы:', info.sheets.map((s) => `${s.name} — ${s.people} чел., ${s.section || 'призыв не найден'}`).join(' | '));
  for (const [sheet, out] of [[/ЛЕТ/, 'fixture-import.json'], [/ЗИМ/, 'fixture-import-zim.json']]) {
    const s = info.sheets.find((x) => sheet.test(x.name));
    if (!s) continue;
    const data = await importSheet(file, s.name);
    fs.writeFileSync(path.join(__dirname, out), JSON.stringify(data, null, 1));
    const codes = {};
    for (const p of data.persons) for (const c of Object.values(p.cells)) codes[c] = (codes[c] || 0) + 1;
    console.log(`${data.sheet}: ${data.persons.length} чел., ${data.from} — ${data.to}, призыв «${data.section}», порядок: ${data.order ? data.order.slice(0, 4).join(', ') + '…' : 'нет'}`);
    console.log('  коды:', JSON.stringify(codes));
  }
})().catch((e) => { console.error(e); process.exit(1); });
