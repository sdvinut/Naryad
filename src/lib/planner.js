// Распределение нарядов.
//
// Что считается «честно»:
//   1. Все наряды весят одинаково (вес задаётся в настройках у каждого типа наряда).
//   2. Нагрузка = перенос с прошлых месяцев + все наряды в таблице. У кого меньше — тот и идёт:
//      вернувшиеся из госпиталя / РГ «догоняют» остальных.
//   3. Между сменой с наряда и следующим заступлением — не меньше settings.minRest свободных суток (никаких «вилок»).
//   4. Состав: в ротном наряде ровно 1 дежурный и 2 дневальных, в технопарке не больше одного дежурного
//      (duty.djMin/djMax). Замена идёт по той же роли.
//   5. Второстепенно выравниваются: соотношение Р/ДТП у человека, наряды на выходных, равномерность промежутков.
//   6. constraints.together — группа заступает в ротный наряд только вместе;
//      constraints.apart — наряды перечисленных людей не пересекаются по датам.
//
// Алгоритм: жадная расстановка по дням (кто меньше всех загружен) + локальный поиск (переназначения и обмены).
// Совместные группы назначаются атомарно и не разделяются на этапе локального поиска.
// Несколько вариантов получаются штрафом за повтор назначений из уже найденных вариантов.

import { toNum, fromNum, dowNum } from './dates.js';
import { extractNaryads, computeLoads, naryadLength, canStart, setCells, naryadCells, clearNaryadCells, autoPids, roleOf } from './model.js';

// Веса целевой функции. Меняя их, можно подстроить, что важнее.
export const WEIGHTS = {
  unfilled: 1e6,  // пустое место в наряде
  relaxed: 1e4,   // пришлось нарушить минимальный отдых
  load: 5,        // квадрат общей нагрузки — главное: выравнивание числа нарядов
  type: 1.5,      // перекос между видами нарядов у одного человека
  weekend: 2,     // наряды на выходных
  spacing: 1,     // слишком короткий промежуток между нарядами
  repeat: 4,      // штраф за повтор назначения из прошлых вариантов (только для поиска альтернатив)
  keep: 8,        // бонус за то, что наряд остался у того же человека (перестройка с минимумом изменений)
};

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gapOk = (a, b, s, e, rest) => (e < a ? a - e - 1 >= rest : b < s ? s - b - 1 >= rest : false);

/**
 * @param project   проект
 * @param opts.from, opts.to   период: даты заступления, которые распределяем
 * @param opts.mode  'replan' — снять автоматические наряды в периоде и расставить заново;
 *                   'fill'   — оставить всё как есть и заполнить только пустые места
 * @param opts.onlySlots  [{dutyId, start}] — заполнить только эти места (для замены снятого человека)
 * @param opts.keepExisting  при перестройке стараться оставить наряды у тех, у кого они уже стоят
 */
export function plan(project, opts = {}) {
  const { from, to, mode = 'replan', onlySlots = null, seed = 12345, keepExisting = false } = opts;
  const settings = project.settings;
  const nVariants = opts.variants ?? settings.variants ?? 3;
  const runs = opts.runs ?? 8;
  const iterations = opts.iterations ?? 4000;
  const minRest = settings.minRest ?? 1;
  const duties = settings.duties;
  const dutyById = Object.fromEntries(duties.map((d) => [d.id, d]));
  // распределяем только призывы с автораспределением; ручные призывы не трогаем и не считаем в норму
  const quotaPids = autoPids(project);
  const persons = project.persons.filter((p) => p.active !== false && quotaPids.has(p.id));
  const P = persons.length;
  const fromN = toNum(from), toN = toNum(to);

  const all = extractNaryads(project);
  const cleared = mode === 'replan'
    ? all.filter((n) => n.auto && !n.orphan && quotaPids.has(n.pid) && toNum(n.start) >= fromN && toNum(n.start) <= toN)
    : [];
  const clearedIds = new Set(cleared.map((n) => n.id));
  const keep = all.filter((n) => !clearedIds.has(n.id));
  const base = setCells(project, cleared.flatMap(clearNaryadCells));

  // ---------- места в нарядах ----------
  // У каждого места роль: 'dj' — только дежурный, 'dn' — только дневальный, 'any' — любой, но дежурных
  // в этом наряде (наряд = тип + день заступления) не больше djCap.
  const roleByPid = new Map(project.persons.map((p) => [p.id, roleOf(p)]));
  const have = new Map(); // "тип|дата" → { total, dj } уже стоящих
  for (const k of keep) {
    if (k.orphan || !quotaPids.has(k.pid)) continue;
    const key = `${k.dutyId}|${k.start}`;
    const e = have.get(key) || { total: 0, dj: 0 };
    e.total += 1;
    if (roleByPid.get(k.pid) === 'dj') e.dj += 1;
    have.set(key, e);
  }
  const slots = [];
  const addSlots = (n, duty, count) => {
    const iso = fromNum(n);
    const len = naryadLength(duty, iso);
    let weekend = false;
    for (let d = n; d <= n + len; d++) { const w = dowNum(d); if (w === 0 || w === 6) weekend = true; }
    const e = have.get(`${duty.id}|${iso}`) || { total: 0, dj: 0 };
    const min = duty.djMin ?? 0, max = duty.djMax ?? Infinity;
    let dj = e.dj;
    const roles = [];
    for (let i = 0; i < count; i++) {
      if (dj < min) { roles.push('dj'); dj++; } else if (dj >= max) roles.push('dn'); else roles.push('any');
    }
    const djCap = Math.max(0, max - dj);
    for (const role of roles) slots.push({ s: n, e: n + len, dutyId: duty.id, weekend, role, capKey: `${duty.id}|${n}`, djCap });
  };
  if (onlySlots) {
    const want = new Map();
    for (const o of onlySlots) want.set(`${o.dutyId}|${o.start}`, (want.get(`${o.dutyId}|${o.start}`) || 0) + 1);
    for (const [key, count] of want) { const [dutyId, start] = key.split('|'); addSlots(toNum(start), dutyById[dutyId], count); }
  } else {
    for (let n = fromN; n <= toN; n++) {
      const iso = fromNum(n);
      for (const duty of duties) {
        if (!duty.perDay || !canStart(duty, iso)) continue;
        const need = duty.perDay - (have.get(`${duty.id}|${iso}`)?.total || 0);
        if (need > 0) addSlots(n, duty, need);
      }
    }
  }
  const K = slots.length;

  // ---------- исходное состояние людей ----------
  const pidx = new Map(persons.map((p, i) => [p.id, i]));
  const isDj = persons.map((p) => roleOf(p) === 'dj');
  const forbidden = persons.map((p) => new Set(p.forbiddenDuties || []));
  const occ = persons.map((p) => new Set(Object.keys(base.cells[p.id] || {}).map(toNum)));
  const fixedIv = persons.map(() => []);
  const fixedByPid = new Map();
  for (const n of keep) {
    const iv = [toNum(n.start), toNum(n.end)];
    if (!fixedByPid.has(n.pid)) fixedByPid.set(n.pid, []);
    fixedByPid.get(n.pid).push(iv);
    const i = pidx.get(n.pid);
    if (i !== undefined) fixedIv[i].push(iv);
  }

  // Несовместимые люди не должны иметь пересекающиеся наряды, в том числе разных типов.
  const apartByPid = new Map(persons.map((p) => [p.id, new Set()]));
  const apartRules = Array.isArray(settings.constraints?.apart) ? settings.constraints.apart : [];
  for (const rule of apartRules) {
    const members = [...new Set(rule.members || [])];
    for (let a = 0; a < members.length; a++) for (let b = a + 1; b < members.length; b++) {
      if (members[a] === members[b]) continue;
      apartByPid.get(members[a])?.add(members[b]);
      apartByPid.get(members[b])?.add(members[a]);
    }
  }

  // Совместная группа назначается на один ротный наряд атомарно. Некорректная группа
  // не игнорируется: её участники не получают автоматический ротный наряд поодиночке.
  const togetherRules = (Array.isArray(settings.constraints?.together) ? settings.constraints.together : [])
    .map((rule) => ({ ...rule, members: [...new Set(rule.members || [])] }))
    .filter((rule) => rule.members.length >= 2);
  const ruleCountByPid = new Map();
  for (const rule of togetherRules) for (const pid of rule.members) ruleCountByPid.set(pid, (ruleCountByPid.get(pid) || 0) + 1);
  const togetherByPid = new Map();
  const togetherGroups = [];
  for (const rule of togetherRules) {
    for (const pid of rule.members) togetherByPid.set(pid, rule.id);
    const valid = rule.members.length <= (dutyById.R?.perDay || 0)
      && rule.members.every((pid) => pidx.has(pid) && ruleCountByPid.get(pid) === 1);
    if (valid) togetherGroups.push({ ...rule, indices: rule.members.map((pid) => pidx.get(pid)) });
  }

  const fixedNear = fixedIv.map((iv) => iv.filter(([a, b]) => b >= fromN - 30 && a <= toN + 30));
  const baseLoads = computeLoads(base, keep);
  const baseCnt = persons.map((p) => ({ ...baseLoads[p.id].byDuty }));
  const baseWk = persons.map((p) => baseLoads[p.id].weekend);

  // идеальный промежуток между нарядами: сколько дней в среднем отдыхает человек
  const days = toN - fromN + 1;
  let availDays = 0;
  for (let i = 0; i < P; i++) for (let d = fromN; d <= toN; d++) if (!occ[i].has(d)) availDays++;
  const avgAvail = availDays / Math.max(1, days);
  const slotsPerDay = duties.reduce((s, d) => s + (d.perDay || 0), 0) || 1;
  const avgLen = K ? slots.reduce((s, x) => s + x.e - x.s + 1, 0) / K : 2;
  const idealGap = Math.max(minRest, Math.floor(avgAvail / slotsPerDay - avgLen));

  const keyOf = (i, k) => `${persons[i].id}|${slots[k].dutyId}|${slots[k].s}`;
  const clearedKeys = new Set(cleared.map((n) => `${n.pid}|${n.dutyId}|${toNum(n.start)}`));
  // смещение стоимости отдельных назначений: бонус за сохранение, штраф за повтор прошлых вариантов
  const bias = new Map();
  if (keepExisting) for (const key of clearedKeys) bias.set(key, -WEIGHTS.keep);

  // ---------- состояние поиска ----------
  function newState(tabu) {
    const st = {
      assign: new Int32Array(K).fill(-1), relaxed: new Uint8Array(K),
      piv: persons.map(() => []), pocc: persons.map(() => new Set()),
      cnt: baseCnt.map((o) => ({ ...o })), wk: baseWk.slice(),
      pc: new Float64Array(P), pcSum: 0, unfilled: K, relaxedN: 0, tabuCost: 0, tabu,
      djUsed: new Map(),
    };
    for (let i = 0; i < P; i++) { st.pc[i] = personCost(st, i); st.pcSum += st.pc[i]; }
    return st;
  }

  function personCost(st, i) {
    const c = st.cnt[i];
    let L = 0, sum = 0;
    for (const d of duties) { L += c[d.id] * (d.weight ?? 1); sum += c[d.id]; }
    const mean = sum / duties.length;
    let t = 0;
    for (const d of duties) t += (c[d.id] - mean) ** 2;
    let o = WEIGHTS.load * L * L + WEIGHTS.type * t + WEIGHTS.weekend * st.wk[i] ** 2;
    if (st.piv[i].length) {
      const iv = fixedNear[i].concat(st.piv[i].map((k) => [slots[k].s, slots[k].e])).sort((x, y) => x[0] - y[0]);
      for (let j = 1; j < iv.length; j++) {
        const g = iv[j][0] - iv[j - 1][1] - 1;
        if (g < idealGap) o += WEIGHTS.spacing * (idealGap - g) ** 2;
      }
    }
    return o;
  }

  const refresh = (st, i) => { st.pcSum -= st.pc[i]; st.pc[i] = personCost(st, i); st.pcSum += st.pc[i]; };
  const total = (st) => st.unfilled * WEIGHTS.unfilled + st.relaxedN * WEIGHTS.relaxed + st.pcSum + st.tabuCost;

  function fitsBase(st, i, k, rest) {
    const sl = slots[k];
    if (forbidden[i].has(sl.dutyId)) return false;
    if (sl.role === 'dj' ? !isDj[i] : sl.role === 'dn' ? isDj[i] : isDj[i] && (st.djUsed.get(sl.capKey) || 0) >= sl.djCap) return false;
    const { s, e } = sl;
    const o = occ[i], po = st.pocc[i];
    for (let d = s; d <= e; d++) if (o.has(d) || po.has(d)) return false;
    for (const [a, b] of fixedIv[i]) if (!gapOk(a, b, s, e, rest)) return false;
    for (const k2 of st.piv[i]) { const x = slots[k2]; if (!gapOk(x.s, x.e, s, e, rest)) return false; }
    for (const otherPid of apartByPid.get(persons[i].id) || []) {
      for (const [a, b] of fixedByPid.get(otherPid) || []) if (s <= b && a <= e) return false;
      const j = pidx.get(otherPid);
      if (j !== undefined) for (const k2 of st.piv[j]) {
        const x = slots[k2];
        if (s <= x.e && x.s <= e) return false;
      }
    }
    return true;
  }

  function fits(st, i, k, rest) {
    if (slots[k].dutyId === 'R' && togetherByPid.has(persons[i].id)) return false;
    return fitsBase(st, i, k, rest);
  }

  function place(st, i, k, rel) {
    const sl = slots[k];
    st.assign[k] = i; st.unfilled--;
    if (rel) { st.relaxed[k] = 1; st.relaxedN++; }
    st.piv[i].push(k);
    for (let d = sl.s; d <= sl.e; d++) st.pocc[i].add(d);
    st.cnt[i][sl.dutyId] += 1;
    if (sl.weekend) st.wk[i]++;
    if (sl.role === 'any' && isDj[i]) st.djUsed.set(sl.capKey, (st.djUsed.get(sl.capKey) || 0) + 1);
    if (st.tabu?.has(keyOf(i, k))) st.tabuCost += st.tabu.get(keyOf(i, k));
    refresh(st, i);
  }

  function unplace(st, k) {
    const i = st.assign[k];
    if (i < 0) return;
    const sl = slots[k];
    st.assign[k] = -1; st.unfilled++;
    if (st.relaxed[k]) { st.relaxed[k] = 0; st.relaxedN--; }
    st.piv[i].splice(st.piv[i].indexOf(k), 1);
    for (let d = sl.s; d <= sl.e; d++) st.pocc[i].delete(d);
    st.cnt[i][sl.dutyId] -= 1;
    if (sl.weekend) st.wk[i]--;
    if (sl.role === 'any' && isDj[i]) st.djUsed.set(sl.capKey, st.djUsed.get(sl.capKey) - 1);
    if (st.tabu?.has(keyOf(i, k))) st.tabuCost -= st.tabu.get(keyOf(i, k));
    refresh(st, i);
  }

  // жадный выбор: у кого меньше нагрузка, тот и идёт
  function choiceScore(st, i, k) {
    const sl = slots[k];
    const c = st.cnt[i];
    let L = 0, other = 0;
    for (const d of duties) { L += c[d.id] * (d.weight ?? 1); if (d.id !== sl.dutyId) other += c[d.id]; }
    other /= Math.max(1, duties.length - 1);
    let sc = L * 10 + (c[sl.dutyId] - other) * 2;
    if (sl.weekend) sc += st.wk[i] * 2;
    let gp = Infinity, gn = Infinity;
    const scan = (a, b) => { if (b < sl.s) gp = Math.min(gp, sl.s - b - 1); else if (a > sl.e) gn = Math.min(gn, a - sl.e - 1); };
    for (const [a, b] of fixedNear[i]) scan(a, b);
    for (const k2 of st.piv[i]) scan(slots[k2].s, slots[k2].e);
    if (gp < idealGap) sc += (idealGap - gp) ** 2;
    if (gn < idealGap) sc += (idealGap - gn) ** 2;
    if (st.tabu?.has(keyOf(i, k))) sc += st.tabu.get(keyOf(i, k));
    return sc;
  }

  function bestTogether(st, k, rest) {
    if (slots[k].dutyId !== 'R' || !togetherGroups.length) return null;
    const start = slots[k].s;
    const openSlots = slots.map((_, k2) => k2).filter((k2) => slots[k2].dutyId === 'R' && slots[k2].s === start && st.assign[k2] < 0);
    let best = null;
    for (const group of togetherGroups) {
      const pids = new Set(group.members);
      const fixed = new Set(keep.filter((n) => !n.orphan && n.dutyId === 'R' && toNum(n.start) === start && pids.has(n.pid)).map((n) => n.pid));
      const indices = group.indices.filter((i) => !fixed.has(persons[i].id));
      if (!indices.length || indices.length > openSlots.length) continue;
      if (group.indices.some((i) => st.piv[i].some((k2) => slots[k2].dutyId === 'R' && slots[k2].s === start))) continue;
      const used = new Set(), placements = [];
      const visit = (at, score) => {
        if (at === indices.length) {
          const value = score / indices.length;
          if (!best || value < best.score) best = { score: value, placements: placements.slice() };
          return;
        }
        const i = indices[at];
        for (const k2 of openSlots) {
          if (used.has(k2) || !fitsBase(st, i, k2, rest)) continue;
          const rel = rest < minRest;
          const nextScore = score + choiceScore(st, i, k2);
          used.add(k2);
          place(st, i, k2, rel);
          placements.push({ i, k: k2, rel });
          visit(at + 1, nextScore);
          placements.pop();
          unplace(st, k2);
          used.delete(k2);
        }
      };
      visit(0, 0);
    }
    return best;
  }

  function greedy(rng, jitter, tabu) {
    const st = newState(tabu);
    const order = slots.map((_, k) => k);
    for (let j = order.length - 1; j > 0; j--) { const r = Math.floor(rng() * (j + 1)); [order[j], order[r]] = [order[r], order[j]]; }
    order.sort((a, b) => slots[a].s - slots[b].s || (slots[b].e - slots[b].s) - (slots[a].e - slots[a].s));
    for (const k of order) {
      if (st.assign[k] >= 0) continue;
      let best = -1, bestSc = Infinity, bestBundle = null, bestRel = false;
      for (const rest of minRest > 0 ? [minRest, 0] : [0]) {
        const bundle = bestTogether(st, k, rest);
        if (bundle) {
          const sc = bundle.score + rng() * jitter;
          if (sc < bestSc) { bestSc = sc; best = -1; bestBundle = bundle; }
        }
        for (let i = 0; i < P; i++) {
          if (!fits(st, i, k, rest)) continue;
          const sc = choiceScore(st, i, k) + rng() * jitter;
          if (sc < bestSc) { bestSc = sc; best = i; bestBundle = null; bestRel = rest < minRest; }
        }
        if (best >= 0 || bestBundle) break;
      }
      if (bestBundle) for (const x of bestBundle.placements) place(st, x.i, x.k, x.rel);
      else if (best >= 0) place(st, best, k, bestRel);
    }
    return st;
  }

  function localSearch(st, rng, iters) {
    if (!K || !P) return;
    const linkedTogether = (k) => {
      const i = st.assign[k];
      return i >= 0 && slots[k].dutyId === 'R' && togetherByPid.has(persons[i].id);
    };
    let cur = total(st);
    for (let it = 0; it < iters; it++) {
      const k = Math.floor(rng() * K);
      if (linkedTogether(k)) continue;
      if (rng() < 0.55) {
        // переназначить место другому человеку
        const old = st.assign[k], oldRel = st.relaxed[k];
        const i = Math.floor(rng() * P);
        if (i === old) continue;
        if (old >= 0) unplace(st, k);
        let rel = false;
        let ok = fits(st, i, k, minRest);
        if (!ok && (old < 0 || oldRel) && fits(st, i, k, 0)) { ok = true; rel = true; }
        if (ok) {
          place(st, i, k, rel);
          const nv = total(st);
          if (nv <= cur) { cur = nv; continue; }
          unplace(st, k);
        }
        if (old >= 0) place(st, old, k, oldRel);
      } else {
        // обменять двух людей между нарядами
        const k2 = Math.floor(rng() * K);
        const a = st.assign[k], b = st.assign[k2];
        if (k === k2 || a < 0 || b < 0 || a === b || linkedTogether(k2)) continue;
        const ra = st.relaxed[k], rb = st.relaxed[k2];
        unplace(st, k); unplace(st, k2);
        let done = false;
        if (fits(st, b, k, minRest)) {
          place(st, b, k, false);
          if (fits(st, a, k2, minRest)) {
            place(st, a, k2, false);
            const nv = total(st);
            if (nv <= cur) { cur = nv; done = true; } else unplace(st, k2);
          }
          if (!done) unplace(st, k);
        }
        if (!done) { place(st, a, k, ra); place(st, b, k2, rb); }
      }
    }
  }

  const assignKeys = (st) => {
    const set = new Set();
    for (let k = 0; k < K; k++) if (st.assign[k] >= 0) set.add(keyOf(st.assign[k], k));
    return set;
  };
  const distance = (A, B) => { let n = 0; for (const x of A) if (!B.has(x)) n++; return n; };

  // ---------- поиск вариантов ----------
  const chosen = [];
  const minDiff = Math.max(1, Math.round(K * 0.08));
  let rngSeed = seed;
  for (let v = 0; v < nVariants && K > 0; v++) {
    let found = null;
    for (let attempt = 0; attempt < 4 && !found; attempt++) {
      let tabu = bias.size ? new Map(bias) : null;
      if (chosen.length) {
        tabu ||= new Map();
        const pen = WEIGHTS.repeat * 4 ** attempt;
        for (const c of chosen) for (const key of c.keys) tabu.set(key, (tabu.get(key) || 0) + pen);
      }
      let best = null;
      const nRuns = v === 0 ? runs : Math.max(3, Math.ceil(runs / 2));
      for (let r = 0; r < nRuns; r++) {
        const rng = mulberry32(rngSeed++ * 2654435761);
        const st = greedy(rng, r === 0 && v === 0 ? 0.01 : 6, tabu);
        localSearch(st, rng, iterations);
        const t = total(st);
        if (!best || t < best.t) best = { st, t };
      }
      const keys = assignKeys(best.st);
      if (chosen.every((c) => distance(keys, c.keys) >= minDiff)) found = { st: best.st, keys, score: best.t - best.st.tabuCost };
    }
    if (found) chosen.push(found);
  }
  if (K === 0) chosen.push({ st: newState(null), keys: new Set(), score: 0 });

  // ---------- результат ----------
  const fullyAvailable = persons.map((_, i) => { for (let d = fromN; d <= toN; d++) if (occ[i].has(d)) return false; return true; });

  const variants = chosen.map((c, vi) => {
    const st = c.st;
    const assignments = [], unfilled = [];
    for (let k = 0; k < K; k++) {
      const sl = slots[k];
      if (st.assign[k] < 0) unfilled.push({ dutyId: sl.dutyId, start: fromNum(sl.s), role: sl.role });
      else assignments.push({ pid: persons[st.assign[k]].id, dutyId: sl.dutyId, start: fromNum(sl.s), relaxed: !!st.relaxed[k] });
    }
    const perPerson = {};
    const loadsArr = [];
    persons.forEach((p, i) => {
      const L = duties.reduce((s, d) => s + st.cnt[i][d.id] * (d.weight ?? 1), 0);
      perPerson[p.id] = { planned: st.piv[i].length, total: L, weekend: st.wk[i] };
      loadsArr.push({ L, full: fullyAvailable[i] });
    });
    const pool = loadsArr.some((x) => x.full) ? loadsArr.filter((x) => x.full) : loadsArr;
    const Ls = pool.map((x) => x.L);
    let minGap = Infinity;
    persons.forEach((_, i) => {
      if (!st.piv[i].length) return;
      const iv = fixedNear[i].map(([a, b]) => [a, b, false]).concat(st.piv[i].map((k) => [slots[k].s, slots[k].e, true])).sort((x, y) => x[0] - y[0]);
      for (let j = 1; j < iv.length; j++) if (iv[j][2] || iv[j - 1][2]) minGap = Math.min(minGap, iv[j][0] - iv[j - 1][1] - 1);
    });
    return {
      id: `v${vi + 1}`,
      score: c.score,
      assignments, unfilled,
      relaxedCount: st.relaxedN,
      perPerson,
      metrics: {
        slots: K,
        filled: K - unfilled.length,
        spread: Ls.length ? Math.max(...Ls) - Math.min(...Ls) : 0,
        minGap: Number.isFinite(minGap) ? minGap : null,
        changes: mode === 'replan' ? assignments.filter((a) => !clearedKeys.has(`${a.pid}|${a.dutyId}|${toNum(a.start)}`)).length : assignments.length,
      },
    };
  });

  return { from, to, mode, cleared, slots: K, idealGap, variants };
}

// Применить вариант к проекту
export function applyVariant(project, result, variant) {
  const dutyById = Object.fromEntries(project.settings.duties.map((d) => [d.id, d]));
  const cleared = setCells(project, result.cleared.flatMap(clearNaryadCells));
  return setCells(cleared, variant.assignments.flatMap((a) => naryadCells(a.pid, dutyById[a.dutyId], a.start, true)));
}
