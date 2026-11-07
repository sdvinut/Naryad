import { codeIndex } from './model.js';
import { DOW_SHORT, MONTHS_GEN, dow, fmtShort, isWeekend } from './dates.js';
import { tint } from './colors.js';

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// «12.окт» — как в шапке листа «График»
export const fmtDayMonth = (iso) => `${iso.slice(8, 10)}.${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]}`;
// «15 октября 2026 г.»
export const fmtLongDate = (iso) => `${iso.slice(8, 10)} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)} г.`;
// «6, 16, 29» → [6, 16, 29]
export const parseGkDays = (s) => String(s || '').split(/[^\d]+/).map(Number).filter((n) => n >= 1 && n <= 31);

/**
 * Данные для печатной формы (Word): блоки по призывам («24 призыв», «23 призыв») с людьми и клетками за выбранные дни.
 * opts: { style: 'classic' | 'color', colored, signatures, title, dateIso, gkDays, gkLabel, frame, hideGroups }
 */
export function buildPrintPayload(project, days, opts) {
  const { style = 'classic', colored, signatures, title, dateIso, gkDays, gkLabel = 'ГК', frame = true, hideGroups = [] } = opts;
  const idx = codeIndex(project.settings);
  const gk = parseGkDays(gkDays);
  const cellsOf = (p) => days.map((d) => {
    const code = project.cells[p.id]?.[d]?.c;
    if (!code) return { text: '', fill: null };
    const info = idx.get(code);
    const text = info?.kind === 'status' && info.status.print !== undefined ? info.status.print : code;
    const color = info?.kind === 'status' ? info.status.color : info?.duty?.color;
    return { text, fill: colored && text && color ? tint(color, info?.kind === 'prep' ? 0.82 : 0.66) : null };
  });
  const blocks = project.settings.groups
    .filter((g) => !hideGroups.includes(g.id))
    .map((g) => ({
      title: g.name,
      rows: project.persons
        .filter((p) => p.group === g.id && (p.active !== false || days.some((d) => project.cells[p.id]?.[d])))
        .map((p, i) => ({ n: i + 1, name: p.name, cells: cellsOf(p) })),
    }))
    .filter((b) => b.rows.length);
  return {
    style,
    title,
    from: days[0],
    to: days.at(-1),
    days: days.map((d) => ({
      date: fmtShort(d),
      date2: fmtDayMonth(d),
      dow: DOW_SHORT[dow(d)],
      weekend: isWeekend(d),
      gk: gk.includes(Number(d.slice(8, 10))),
    })),
    blocks,
    signatures,
    dateLine: dateIso ? fmtLongDate(dateIso) : '',
    gkLabel,
    gkNote: gk.length ? `${gkLabel} - ${gk.join(',')}` : '',
    frame,
  };
}
