// Чтение графика нарядов из Excel.
// Ищем листы, где в шапке есть «ФИО», а в одной из первых строк идут даты подряд.
const ExcelJS = require('exceljs');

const pad = (n) => String(n).padStart(2, '0');
const isoUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (typeof v.text === 'string') return v.text;
    return null;
  }
  return v;
}

function toIso(v) {
  if (v instanceof Date) return isoUTC(v);
  if (typeof v === 'number' && v > 30000 && v < 80000) return isoUTC(new Date((Math.floor(v) - 25569) * 86400000));
  return null;
}

function normCode(raw) {
  let s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.includes('/')) s = s.split('/').pop().trim(); // «Р / ЗН Р» → последний наряд
  s = s.toUpperCase().replace(/^ЗН\s*(?=\S)/, 'ЗН ');
  return s || null;
}

const text = (ws, r, c) => {
  const v = cellValue(ws.getRow(r).getCell(c).value);
  return v == null ? '' : String(v).trim();
};

function findLayout(ws) {
  let nameCol = 0, headerRow = 0;
  for (let r = 1; r <= 5 && !nameCol; r++) {
    for (let c = 1; c <= 6; c++) if (text(ws, r, c).toUpperCase() === 'ФИО') { nameCol = c; headerRow = r; break; }
  }
  if (!nameCol) return null;
  // строка с датами — самая длинная цепочка дней подряд (объединённые ячейки повторяют одну дату, их отсекаем)
  const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
  let best = null;
  for (let r = 1; r <= 6; r++) {
    const row = ws.getRow(r);
    let run = [];
    const consider = () => { if (run.length >= 5 && (!best || run.length > best.dates.length)) best = { r, dates: run }; };
    for (let c = 1; c <= Math.min(ws.columnCount + 1, 400); c++) {
      const iso = toIso(cellValue(row.getCell(c).value));
      if (iso && run.length && dayNum(iso) === dayNum(run.at(-1).iso) + 1) run.push({ c, iso });
      else { consider(); run = iso ? [{ c, iso }] : []; }
    }
    consider();
  }
  if (!best) return null;
  return { nameCol, headerRow, dateRow: best.r, dates: best.dates };
}

function listCalendars(wb) {
  return wb.worksheets.filter((ws) => findLayout(ws)).map((ws) => ws.name);
}

function parseSheet(ws) {
  const L = findLayout(ws);
  if (!L) throw new Error(`На листе «${ws.name}» не нашёл столбец «ФИО» и строку с датами`);
  // столбцы переноса с прошлого месяца: «"ДТП" в прошлом месяце», «"Н" в прошлом месяце»
  const carryCols = [];
  for (let c = 1; c < L.dates[0].c; c++) {
    const h = text(ws, L.headerRow, c);
    if (/прошл/i.test(h)) carryCols.push({ c, duty: /ДТП/i.test(h) ? 'DTP' : 'R' });
  }
  const persons = [];
  for (let r = Math.max(L.headerRow, L.dateRow) + 1; r <= ws.rowCount; r++) {
    const name = text(ws, r, L.nameCol);
    if (!name || /^провер/i.test(name)) break;
    const carry = {};
    for (const cc of carryCols) {
      const v = Number(cellValue(ws.getRow(r).getCell(cc.c).value));
      carry[cc.duty] = (carry[cc.duty] || 0) + (Number.isFinite(v) ? v : 0);
    }
    const cells = {};
    for (const { c, iso } of L.dates) {
      const v = cellValue(ws.getRow(r).getCell(c).value);
      if (v == null || v instanceof Date || typeof v === 'number') continue;
      const code = normCode(v);
      if (code) cells[iso] = code;
    }
    persons.push({ name: name.replace(/\s+/g, ' '), carry, cells });
  }
  return { sheet: ws.name, from: L.dates[0].iso, to: L.dates.at(-1).iso, persons };
}

// Подписи и заголовок с листов «Настройка графика» и «График»
function parseExtras(wb) {
  const out = { signatures: {} };
  for (const ws of wb.worksheets) {
    ws.eachRow((row, r) => {
      row.eachCell((cell, c) => {
        const t = String(cellValue(cell.value) ?? '').replace(/\s+/g, ' ').trim();
        const nextName = () => {
          for (let cc = c + 1; cc <= c + 12; cc++) {
            const n = text(ws, r, cc).replace(/\s+/g, ' ');
            if (n && n !== t) return n; // объединённые ячейки повторяют текст подписи — пропускаем
          }
          return '';
        };
        if (/^График составил .+/i.test(t) && !out.signatures.composedTitle) {
          out.signatures.composedTitle = t; out.signatures.composedName = nextName();
        } else if (/^График утвердил .+/i.test(t) && !out.signatures.approvedTitle) {
          out.signatures.approvedTitle = t; out.signatures.approvedName = nextName();
        } else if (/^График нарядов/i.test(t) && !out.title) {
          out.title = t.replace(/\s+с\s*$/i, '').trim();
        } else if (/^\d+\s+призыв$/i.test(t) && !out.section) {
          out.section = t; // «24 призыв» — строка над списком на листе «График»
        } else if (/^ГК\s*-\s*[\d,\s]+$/i.test(t) && !out.gkDays) {
          out.gkDays = t.replace(/^ГК\s*-\s*/i, '').split(/[^\d]+/).filter(Boolean).join(', ');
        }
      });
    });
  }
  return out;
}

async function readBook(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

const nameKey = (s) => String(s).replace(/[\s.]/g, '').toLowerCase();
const SECTION_RE = /^\d+\s+призыв$/i;

// Порядок людей и призыв каждого — с печатного листа «График». Берём самый левый столбец, где встречается
// больше всего фамилий из календаря; порядок — как сверху вниз; призыв — ближайшая строка «24 призыв» выше.
// Возвращает { order: [ключи имён], sectionOf: {ключ: "24 призыв"} } или null.
function findOrder(wb, names, skip) {
  const want = new Set(names.map(nameKey));
  const sheets = wb.worksheets.filter((ws) => !skip.includes(ws.name));
  const ws = sheets.find((s) => /^график$/i.test(s.name.trim())) || sheets.find((s) => /^график/i.test(s.name.trim()) && !/настрой/i.test(s.name));
  if (!ws) return null;
  const counts = new Map();
  ws.eachRow((row) => row.eachCell((cell, c) => {
    const v = cellValue(cell.value);
    if (typeof v === 'string' && want.has(nameKey(v))) counts.set(c, (counts.get(c) || 0) + 1);
  }));
  let col = 0;
  for (const [c, n] of [...counts].sort((a, b) => a[0] - b[0])) if (!col || n > counts.get(col)) col = c;
  if (!col) return null;
  const order = [];
  const sectionOf = {};
  let section = '';
  ws.eachRow((row) => {
    for (let c = 1; c <= col + 12; c++) {
      const t = String(cellValue(row.getCell(c).value) ?? '').replace(/\s+/g, ' ').trim();
      if (SECTION_RE.test(t)) { section = t; break; }
    }
    const v = cellValue(row.getCell(col).value);
    const k = typeof v === 'string' ? nameKey(v) : null;
    if (k && want.has(k) && !order.includes(k)) { order.push(k); if (section) sectionOf[k] = section; }
  });
  return order.length >= Math.min(5, names.length) ? { order, sectionOf } : null;
}

// призыв листа — тот, к которому на «Графике» относится большинство его людей
function sheetSection(found, names) {
  if (!found) return '';
  const votes = {};
  for (const n of names) { const s = found.sectionOf[nameKey(n)]; if (s) votes[s] = (votes[s] || 0) + 1; }
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

async function inspect(path) {
  const wb = await readBook(path);
  const cals = listCalendars(wb);
  const sheets = cals.map((name) => {
    const names = parseSheet(wb.getWorksheet(name)).persons.map((p) => p.name);
    return { name, people: names.length, section: sheetSection(findOrder(wb, names, cals), names) };
  });
  return { sheets };
}

async function importSheet(path, sheetName) {
  const wb = await readBook(path);
  const cals = listCalendars(wb);
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.getWorksheet(cals[0]);
  if (!ws) throw new Error('В файле нет листа с графиком нарядов');
  const data = parseSheet(ws);
  const names = data.persons.map((p) => p.name);
  const found = findOrder(wb, names, cals);
  return { ...data, order: found?.order || null, section: sheetSection(found, names), extras: parseExtras(wb) };
}

module.exports = { inspect, importSheet };
