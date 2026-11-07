// Все даты внутри приложения — строки 'YYYY-MM-DD' без часовых поясов.
// Для арифметики используем номер дня от 1970-01-01 (UTC).

export const DAY_MS = 86400000;

export const DOW_SHORT = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const pad = (n) => String(n).padStart(2, '0');

export function toNum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromNum(n) {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const addDays = (iso, n) => fromNum(toNum(iso) + n);
export const diffDays = (a, b) => toNum(b) - toNum(a);
// 0 = воскресенье, 6 = суббота
export const dowNum = (n) => (((n + 4) % 7) + 7) % 7;
export const dow = (iso) => dowNum(toNum(iso));
export const isWeekend = (iso) => { const w = dow(iso); return w === 0 || w === 6; };

export function range(from, to) {
  const out = [];
  for (let n = toNum(from), e = toNum(to); n <= e; n++) out.push(fromNum(n));
  return out;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const fmtShort = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
export const fmtFull = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
export const fmtHuman = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;

export const monthKey = (iso) => iso.slice(0, 7);
export function monthDays(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return range(`${key}-01`, `${key}-${pad(last)}`);
}
export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
export const monthTitle = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

export function mondayOf(iso) {
  const w = dow(iso);
  return addDays(iso, w === 0 ? -6 : 1 - w);
}

// Серийный номер даты Excel (1900-система) → ISO
export function excelSerialToIso(serial) {
  return fromNum(Math.floor(serial) - 25569);
}
