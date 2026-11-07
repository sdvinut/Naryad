import { addDays, dow, isWeekend, range, toNum } from './dates.js';

// Типы нарядов. Чтобы добавить новый наряд — допишите сюда объект (или добавьте в «Настройках»).
//   code        — что пишется в клетке в день самого наряда
//   prep        — что пишется в день заступления
//   perDay      — сколько человек заступает в сутки
//   lengthByDow — сколько суток длится наряд, если заступить в этот день недели (0 = ВС … 6 = СБ)
//   noStartDows — дни недели, в которые на этот наряд не заступают
//   weight      — «тяжесть» наряда в очках нагрузки
//   djMin/djMax — сколько дежурных должно быть среди заступающих (остальные — дневальные)
export const DEFAULT_DUTIES = [
  { id: 'R', name: 'Ротный наряд', code: 'Р', prep: 'ЗН Р', perDay: 3, djMin: 1, djMax: 1, weight: 1, color: '#8b5cf6', lengthByDow: {}, noStartDows: [] },
  { id: 'DTP', name: 'Наряд по технопарку', code: 'ДТП', prep: 'ЗН ДТП', perDay: 2, djMin: 0, djMax: 1, weight: 1, color: '#f59e0b', lengthByDow: { 6: 2 }, noStartDows: [0] },
];

// Роль человека в нарядах: дежурный или дневальный (по умолчанию)
export const ROLES = { dj: 'Дежурный', dn: 'Дневальный' };
export const roleOf = (p) => (p?.role === 'dj' ? 'dj' : 'dn');

// Статусы, при которых человека нельзя ставить в наряд. Список расширяется в «Настройках».
export const DEFAULT_STATUSES = [
  { code: 'У', name: 'Увольнение', color: '#10b981', blocks: true },
  { code: 'Г', name: 'Госпиталь', color: '#f43f5e', blocks: true },
  { code: 'РГ', name: 'Рабочая группа', color: '#38bdf8', blocks: true },
  { code: '×', name: 'Не ставить', color: '#64748b', blocks: true, print: '' },
];

export const DEFAULT_SETTINGS = {
  title: 'График нарядов роты',
  minRest: 1,
  variants: 3,
  duties: DEFAULT_DUTIES,
  statuses: DEFAULT_STATUSES,
  signatures: { composedTitle: 'График составил', composedName: '', approvedTitle: 'График утвердил', approvedName: '' },
  // Призывы — группы людей. auto: false — призыв распределяется только вручную, программа его в наряды не ставит
  // и в замену не предлагает; норма «человек в сутки» считается только по призывам с auto: true.
  groups: [{ id: 'g1', name: '24 призыв', auto: true }],
  // together — люди заступают в ротный наряд только одной группой; apart — наряды этих людей не должны пересекаться.
  constraints: { together: [], apart: [] },
  // печать: style — 'classic' (как лист «График») или 'color'; gkDays — числа месяца с «ГК»; hideGroups — какие призывы не печатать
  print: { style: 'classic', gkDays: '6, 16, 29', gkLabel: 'ГК', frame: true, colored: false, hideGroups: [] },
};

let idCounter = 0;
export const newId = () => `p${Date.now().toString(36)}${(idCounter++).toString(36)}`;
export const newGroupId = () => `g${Date.now().toString(36)}${(idCounter++).toString(36)}`;
export const newRuleId = () => `c${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function emptyProject() {
  return { version: 1, settings: structuredClone(DEFAULT_SETTINGS), persons: [], cells: {} };
}

// ---------- призывы ----------

export const isAutoGroup = (settings, gid) => (settings.groups || []).find((g) => g.id === gid)?.auto !== false;
// люди, по которым считается норма и которых программа распределяет сама
export const autoPids = (project) => new Set(project.persons.filter((p) => isAutoGroup(project.settings, p.group)).map((p) => p.id));

// люди идут блоками по призывам в порядке списка призывов; внутри — как были
export function sortByGroups(project) {
  const at = new Map((project.settings.groups || []).map((g, i) => [g.id, i]));
  const persons = project.persons.map((p, i) => ({ p, i })).sort((a, b) => (at.get(a.p.group) ?? 99) - (at.get(b.p.group) ?? 99) || a.i - b.i).map((x) => x.p);
  return persons.every((p, i) => p === project.persons[i]) ? project : { ...project, persons };
}

export function normalizeProject(p) {
  const s = { ...structuredClone(DEFAULT_SETTINGS), ...(p.settings || {}) };
  s.signatures = { ...DEFAULT_SETTINGS.signatures, ...(p.settings?.signatures || {}) };
  s.print = { ...DEFAULT_SETTINGS.print, ...(p.settings?.print || {}) };
  s.constraints = { ...DEFAULT_SETTINGS.constraints, ...(p.settings?.constraints || {}) };
  // до появления ролей: ротный наряд — 1 дежурный + 2 дневальных, в технопарке не больше одного дежурного
  s.duties = s.duties.map((d) => {
    if ('djMax' in d) return d;
    if (d.id === 'R') return { ...d, perDay: 3, djMin: 1, djMax: 1 };
    if (d.id === 'DTP') return { ...d, djMin: 0, djMax: 1 };
    return { ...d, djMin: 0, djMax: d.perDay };
  });
  // до появления призывов все были в одном списке с заголовком из настроек печати
  if (!p.settings?.groups?.length) s.groups = [{ id: 'g1', name: p.settings?.print?.section || '24 призыв', auto: true }];
  delete s.print.section;
  const gids = new Set(s.groups.map((g) => g.id));
  const persons = (p.persons || []).map((x) => (gids.has(x.group) ? x : { ...x, group: s.groups[0].id }));
  const pids = new Set(persons.map((x) => x.id));
  for (const kind of ['together', 'apart']) {
    s.constraints[kind] = (Array.isArray(s.constraints[kind]) ? s.constraints[kind] : []).map((rule) => ({
      ...rule,
      id: rule.id || newRuleId(),
      members: [...new Set(Array.isArray(rule.members) ? rule.members : [])].filter((pid) => pids.has(pid)),
    }));
  }
  // Ранние версии превращали незнакомые буквы из Excel (З, П, К, ОСВ…) в отметки — убираем их вместе с клетками
  const junk = new Set(s.statuses.filter((st) => st.imported).map((st) => st.code));
  let cells = p.cells || {};
  if (junk.size) {
    s.statuses = s.statuses.filter((st) => !st.imported);
    cells = Object.fromEntries(Object.entries(cells).map(([pid, row]) => [
      pid, Object.fromEntries(Object.entries(row).filter(([, c]) => !junk.has(c.c))),
    ]));
  }
  return sortByGroups({ version: 1, ...p, persons, cells, settings: s });
}

// ---------- клетки ----------

export const getCell = (project, pid, d) => project.cells[pid]?.[d] || null;

export function setCells(project, changes) {
  // changes: [{pid, d, cell|null}]
  const cells = { ...project.cells };
  const touched = new Set();
  for (const { pid, d, cell } of changes) {
    if (!touched.has(pid)) { cells[pid] = { ...(cells[pid] || {}) }; touched.add(pid); }
    if (cell) cells[pid][d] = cell; else delete cells[pid][d];
  }
  return { ...project, cells };
}

// ---------- справочники ----------

export function codeIndex(settings) {
  const map = new Map();
  for (const duty of settings.duties) {
    map.set(duty.prep, { kind: 'prep', duty });
    map.set(duty.code, { kind: 'duty', duty });
  }
  for (const st of settings.statuses) if (!map.has(st.code)) map.set(st.code, { kind: 'status', status: st });
  return map;
}

export const naryadLength = (duty, startIso) => duty.lengthByDow?.[dow(startIso)] ?? 1;
export const canStart = (duty, iso) => !(duty.noStartDows || []).includes(dow(iso));

// ---------- наряды ----------
// Наряд = заступление (prep) + 1..N суток наряда. Возвращает плоский список нарядов.
// Клетки с кодом наряда без заступления (например, на границе таблицы) считаются отдельным нарядом.
export function extractNaryads(project) {
  const idx = codeIndex(project.settings);
  const out = [];
  for (const person of project.persons) {
    const row = project.cells[person.id];
    if (!row) continue;
    const dates = Object.keys(row).sort();
    const used = new Set();
    for (const d of dates) {
      const info = idx.get(row[d].c);
      if (info?.kind !== 'prep') continue;
      const duty = info.duty;
      const len = naryadLength(duty, d);
      const end = addDays(d, len);
      const days = range(d, end);
      // cellDays — клетки, реально занятые этим нарядом (в days может попасть чужой статус)
      const cellDays = days.filter((x) => x === d || row[x]?.c === duty.code);
      cellDays.forEach((x) => used.add(x));
      out.push({
        id: `${person.id}|${d}|${duty.id}`, pid: person.id, dutyId: duty.id, start: d, end, days, cellDays,
        auto: !!row[d].a, punishment: !!row[d].p, orphan: false, weekend: days.some(isWeekend),
      });
    }
    // «осиротевшие» сутки наряда без заступления
    let run = null;
    const flush = () => {
      if (!run) return;
      out.push({
        id: `${person.id}|${run.days[0]}|${run.duty.id}|o`, pid: person.id, dutyId: run.duty.id,
        start: run.days[0], end: run.days.at(-1), days: run.days, cellDays: run.days, auto: run.auto, orphan: true,
        punishment: run.punishment, weekend: run.days.some(isWeekend),
      });
      run = null;
    };
    for (const d of dates) {
      const info = idx.get(row[d].c);
      if (info?.kind === 'duty' && !used.has(d)) {
        if (run && run.duty.id === info.duty.id && run.punishment === !!row[d].p && toNum(d) === toNum(run.days.at(-1)) + 1) run.days.push(d);
        else { flush(); run = { duty: info.duty, days: [d], auto: !!row[d].a, punishment: !!row[d].p }; }
      } else flush();
    }
    flush();
  }
  return out;
}

// Нагрузка каждого человека: перенос с прошлых месяцев + обычные наряды в таблице.
// Наказания (p: 1) закреплены и занимают даты, но не увеличивают нагрузку.
export function computeLoads(project, naryads = extractNaryads(project)) {
  const dutyW = Object.fromEntries(project.settings.duties.map((d) => [d.id, d.weight ?? 1]));
  const loads = {};
  for (const p of project.persons) {
    const byDuty = {};
    for (const d of project.settings.duties) byDuty[d.id] = Number(p.carry?.[d.id] || 0);
    loads[p.id] = { byDuty, carry: { ...byDuty }, inTable: 0, weekend: 0, total: 0, last: null };
  }
  for (const n of naryads) {
    const L = loads[n.pid];
    if (!L) continue;
    if (!n.punishment) {
      L.byDuty[n.dutyId] = (L.byDuty[n.dutyId] || 0) + 1;
      L.inTable += 1;
      if (n.weekend) L.weekend += 1;
    }
    if (!L.last || n.end > L.last) L.last = n.end;
  }
  for (const L of Object.values(loads)) {
    L.total = Object.entries(L.byDuty).reduce((s, [k, v]) => s + v * (dutyW[k] ?? 1), 0);
  }
  return loads;
}

// Укомплектованность по дням: сколько человек на каждом наряде и сколько заступает.
// по умолчанию считаем только призывы с автораспределением: норма «человек в сутки» относится к ним
export function coverage(project, days, onlyPids = autoPids(project)) {
  const res = {};
  for (const d of days) {
    res[d] = {};
    for (const duty of project.settings.duties) res[d][duty.id] = { on: 0, prep: 0, onDj: 0, prepDj: 0, needOn: duty.perDay, needPrep: canStart(duty, d) ? duty.perDay : 0 };
  }
  const idx = codeIndex(project.settings);
  for (const p of project.persons) {
    if (onlyPids && !onlyPids.has(p.id)) continue;
    const row = project.cells[p.id];
    if (!row) continue;
    for (const d of days) {
      const info = row[d] && idx.get(row[d].c);
      if (!info || info.kind === 'status') continue;
      const c = res[d][info.duty.id];
      const dj = roleOf(p) === 'dj' ? 1 : 0;
      if (info.kind === 'prep') { c.prep += 1; c.prepDj += dj; } else { c.on += 1; c.onDj += dj; }
    }
  }
  // всё ли в порядке: хватает людей и состав по ролям (сколько дежурных)
  for (const d of days) {
    for (const duty of project.settings.duties) {
      const c = res[d][duty.id];
      const min = duty.djMin ?? 0, max = duty.djMax ?? Infinity;
      const rolesOk = (n, dj, need) => (!need || dj >= Math.min(min, n)) && dj <= max;
      c.roleOk = rolesOk(c.on, c.onDj, c.needOn) && rolesOk(c.prep, c.prepDj, c.needPrep);
      c.ok = c.on >= c.needOn && c.prep >= c.needPrep && c.roleOk;
    }
  }
  return res;
}

// Записать наряд в клетки
export function naryadCells(pid, duty, start, auto) {
  const len = naryadLength(duty, start);
  const out = [{ pid, d: start, cell: auto ? { c: duty.prep, a: 1 } : { c: duty.prep } }];
  for (let i = 1; i <= len; i++) out.push({ pid, d: addDays(start, i), cell: auto ? { c: duty.code, a: 1 } : { c: duty.code } });
  return out;
}

export const clearNaryadCells = (n) => n.cellDays.map((d) => ({ pid: n.pid, d, cell: null }));

// Поставить статус на диапазон дат. Наряды человека, которые задевает диапазон, снимаются целиком.
// Возвращает новый проект и снятые наряды.
export function applyStatus(project, pid, from, to, code) {
  const naryads = extractNaryads(project).filter((n) => n.pid === pid && n.start <= to && n.end >= from);
  const changes = naryads.flatMap(clearNaryadCells);
  for (const d of range(from, to)) changes.push({ pid, d, cell: code ? { c: code } : null });
  return { project: setCells(project, changes), removed: naryads };
}

// Отличия двух проектов по клеткам: ключи "pid|date"
export function diffCells(a, b) {
  const keys = new Set();
  const pids = new Set([...Object.keys(a.cells), ...Object.keys(b.cells)]);
  for (const pid of pids) {
    const ra = a.cells[pid] || {}, rb = b.cells[pid] || {};
    for (const d of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if ((ra[d]?.c || null) !== (rb[d]?.c || null)) keys.add(`${pid}|${d}`);
    }
  }
  return keys;
}

// ---------- порядок людей ----------

export const nameKey = (s) => String(s).replace(/[\s.]/g, '').toLowerCase();

// Расставить людей по списку ключей имён (порядок с листа «График»); кого нет в списке — в конец, как были
export function reorderPersons(project, orderKeys) {
  const pos = new Map(orderKeys.map((k, i) => [k, i]));
  const persons = project.persons
    .map((p, i) => ({ p, i, at: pos.has(nameKey(p.name)) ? pos.get(nameKey(p.name)) : orderKeys.length + i }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.p);
  return { ...project, persons };
}

export function movePerson(project, from, to) {
  const persons = project.persons.slice();
  const [p] = persons.splice(from, 1);
  persons.splice(to, 0, p);
  return { ...project, persons };
}

// Импорт листов из Excel. base — текущий проект (добавить к нему) или null (новый проект).
// list: [{ data, group: { name, auto } }] — что прочитано с листа и в какой призыв его положить.
// Берём только известные коды (наряды и отметки из настроек), остальные буквы пропускаем.
// Люди, которые уже есть в проекте (по ФИО), не дублируются.
export function importInto(base, list) {
  const fresh = !base;
  let p = fresh ? emptyProject() : { ...base, settings: { ...base.settings, groups: base.settings.groups.map((g) => ({ ...g })) }, persons: base.persons.slice(), cells: { ...base.cells } };
  const first = list[0]?.data;
  if (fresh && first) {
    if (first.extras?.title) p.settings.title = first.extras.title;
    for (const [k, v] of Object.entries(first.extras?.signatures || {})) if (v) p.settings.signatures[k] = v;
    if (first.extras?.gkDays) p.settings.print.gkDays = first.extras.gkDays;
  }
  const known = codeIndex(p.settings);
  const report = { added: 0, existed: 0, skipped: {}, groups: [] };
  for (const { data, group } of list) {
    const gname = (group.name || data.section || data.sheet || 'Призыв').trim();
    let g = p.settings.groups.find((x) => x.name.trim().toLowerCase() === gname.toLowerCase());
    if (!g) { g = { id: newGroupId(), name: gname, auto: group.auto !== false }; p.settings.groups.push(g); } else g.auto = group.auto !== false;
    const have = new Set(p.persons.map((x) => nameKey(x.name)));
    let added = [];
    for (const row of data.persons) {
      if (have.has(nameKey(row.name))) { report.existed++; continue; }
      const id = newId();
      const carry = {};
      for (const duty of p.settings.duties) carry[duty.id] = Number(row.carry?.[duty.id] || 0);
      added.push({ id, name: row.name, carry, active: true, group: g.id });
      p.cells[id] = {};
      for (const [d, code] of Object.entries(row.cells)) {
        if (known.has(code)) p.cells[id][d] = { c: code };
        else report.skipped[code] = (report.skipped[code] || 0) + 1;
      }
    }
    if (data.order?.length) added = reorderPersons({ persons: added }, data.order).persons; // как на листе «График»
    p.persons.push(...added);
    report.added += added.length;
    report.groups.push({ name: g.name, auto: g.auto, added: added.length });
  }
  // в новом проекте убираем пустой призыв по умолчанию
  if (fresh) p.settings.groups = p.settings.groups.filter((g) => p.persons.some((x) => x.group === g.id));
  if (!p.settings.groups.length) p.settings.groups = structuredClone(DEFAULT_SETTINGS.groups);
  return { project: sortByGroups(p), report };
}

// Один лист — новый проект с одним призывом с автораспределением
export function projectFromImport(data) {
  const { project, report } = importInto(null, [{ data, group: { name: data.section || '24 призыв', auto: true } }]);
  return { project, skipped: report.skipped };
}

export function statusColor(settings, code) {
  return settings.statuses.find((s) => s.code === code)?.color || '#94a3b8';
}
