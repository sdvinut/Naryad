import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectFromImport, extractNaryads, computeLoads, coverage, applyStatus, setCells } from '../src/lib/model.js';
import { plan, applyVariant } from '../src/lib/planner.js';
import { range, toNum, addDays } from '../src/lib/dates.js';

const fixture = new URL('../dev/fixture-import.json', import.meta.url);
const hasFixture = fs.existsSync(fixture);
// 8 дежурных (первые 8 по листу «График»), остальные — дневальные
export const markDuty = (project, n = 8) => ({ ...project, persons: project.persons.map((p, i) => (i < n ? { ...p, role: 'dj' } : p)) });
const load = () => markDuty(projectFromImport(JSON.parse(fs.readFileSync(fixture, 'utf8'))).project);

function checkRules(project, from, to, variant) {
  const minRest = project.settings.minRest;
  const relaxed = new Set(variant.assignments.filter((a) => a.relaxed).map((a) => `${a.pid}|${a.start}`));
  const byPerson = {};
  for (const n of extractNaryads(project)) (byPerson[n.pid] ||= []).push(n);
  let violations = 0;
  for (const list of Object.values(byPerson)) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < list.length; i++) {
      const gap = toNum(list[i].start) - toNum(list[i - 1].end) - 1;
      const planned = list[i].start >= from || list[i - 1].start >= from;
      const flagged = relaxed.has(`${list[i].pid}|${list[i].start}`) || relaxed.has(`${list[i - 1].pid}|${list[i - 1].start}`);
      if (planned && gap < minRest && !flagged) violations++;
      if (planned) assert.ok(gap >= 0, `наряды наложились: ${list[i].pid} ${list[i].start}`);
    }
  }
  assert.equal(violations, 0, 'нарушен минимальный отдых без пометки');
  const cov = coverage(project, range(from, to));
  for (const d of range(addDays(from, 1), to)) {
    for (const duty of project.settings.duties) {
      const c = cov[d][duty.id];
      assert.equal(c.on, duty.perDay, `${d} ${duty.code}: на наряде ${c.on} из ${duty.perDay}`);
      assert.equal(c.prep, c.needPrep, `${d} ${duty.prep}: заступает ${c.prep} из ${c.needPrep}`);
      assert.ok(c.roleOk, `${d} ${duty.code}: состав — дежурных в наряде ${c.onDj}, заступает дежурных ${c.prepDj}`);
      if (duty.id === 'R') assert.equal(c.prepDj, 1, `${d}: в ротном наряде ровно 1 дежурный`);
      if (duty.id === 'DTP') assert.ok(c.prepDj <= 1, `${d}: в технопарке два дежурных`);
    }
  }
}

test('распределение на обезличенных данных: все места заняты, без вилок, нагрузка ровная', { skip: !hasFixture }, () => {
  const project = load();
  const from = '2026-10-23', to = '2026-11-30';
  const t0 = performance.now();
  const res = plan(project, { from, to, seed: 7 });
  const ms = performance.now() - t0;
  console.log(`мест: ${res.slots}, идеальный отдых: ${res.idealGap} дн., вариантов: ${res.variants.length}, время: ${ms.toFixed(0)} мс`);
  for (const v of res.variants) console.log(`  ${v.id}: заполнено ${v.metrics.filled}/${v.metrics.slots}, вилок ${v.relaxedCount}, разброс ${v.metrics.spread}, мин. отдых ${v.metrics.minGap}, отличий ${v.metrics.changes}`);
  assert.ok(res.variants.length >= 2, 'нужно несколько вариантов');
  const best = res.variants[0];
  assert.equal(best.unfilled.length, 0);
  const applied = applyVariant(project, res, best);
  checkRules(applied, from, to, best);

  const loads = computeLoads(applied);
  const rows = applied.persons.map((p) => ({ name: p.name, total: loads[p.id].total, R: loads[p.id].byDuty.R, DTP: loads[p.id].byDuty.DTP, wk: loads[p.id].weekend }));
  rows.sort((a, b) => a.total - b.total);
  console.log(rows.map((r) => `  ${r.name.padEnd(18)} всего ${r.total} (Р ${r.R}, ДТП ${r.DTP}, вых ${r.wk})`).join('\n'));
});

test('снятие с наряда: замена одним человеком и перестройка', { skip: !hasFixture }, () => {
  let project = load();
  const res = plan(project, { from: '2026-10-23', to: '2026-11-30', seed: 3, variants: 1 });
  project = applyVariant(project, res, res.variants[0]);
  const victim = extractNaryads(project).find((n) => n.start === '2026-11-05' && n.dutyId === 'R');
  const { project: sick, removed } = applyStatus(project, victim.pid, '2026-11-04', '2026-11-10', 'Г');
  assert.ok(removed.length >= 1);

  const fill = plan(sick, { from: '2026-11-04', to: '2026-11-10', mode: 'fill', onlySlots: removed.map((n) => ({ dutyId: n.dutyId, start: n.start })), seed: 1 });
  const names = (v) => v.assignments.map((a) => sick.persons.find((p) => p.id === a.pid).name).join(', ');
  console.log(`снят ${sick.persons.find((p) => p.id === victim.pid).name}, нарядов снято: ${removed.length}`);
  fill.variants.forEach((v) => console.log(`  замена ${v.id}: ${names(v)} (вилок ${v.relaxedCount})`));
  assert.ok(fill.variants.length >= 2, 'нужно несколько кандидатов на замену');
  const roleOfPid = (pid) => (sick.persons.find((p) => p.id === pid).role === 'dj' ? 'dj' : 'dn');
  for (const v of fill.variants) {
    assert.equal(v.unfilled.length, 0);
    assert.ok(v.assignments.every((a) => roleOfPid(a.pid) === roleOfPid(victim.pid)), 'замена той же роли');
    assert.ok(v.assignments.every((a) => a.pid !== victim.pid), 'снятый не должен попасть обратно');
    checkRules(applyVariant(sick, fill, v), '2026-11-04', '2026-11-10', v);
  }

  const re = plan(sick, { from: '2026-11-04', to: '2026-11-30', mode: 'replan', seed: 2, keepExisting: true });
  re.variants.forEach((v) => console.log(`  перестройка ${v.id}: отличий ${v.metrics.changes}, разброс ${v.metrics.spread}`));
  for (const v of re.variants) checkRules(applyVariant(sick, re, v), '2026-11-04', '2026-11-30', v);
});

test('два призыва: ручной (23) программа не распределяет и в норму не считает', { skip: !hasFixture || !fs.existsSync(new URL('../dev/fixture-import-zim.json', import.meta.url)) }, async () => {
  const { importInto } = await import('../src/lib/model.js');
  const leto = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const zima = JSON.parse(fs.readFileSync(new URL('../dev/fixture-import-zim.json', import.meta.url), 'utf8'));
  const imported = importInto(null, [
    { data: leto, group: { name: '24 призыв', auto: true } },
    { data: zima, group: { name: '23 призыв', auto: false } },
  ]);
  const report = imported.report;
  const project = markDuty(imported.project);
  assert.equal(project.persons.length, 40);
  assert.deepEqual(report.groups.map((g) => `${g.name}:${g.added}:${g.auto}`), ['24 призыв:24:true', '23 призыв:16:false']);
  const winter = new Set(project.persons.filter((p) => p.group === project.settings.groups[1].id).map((p) => p.id));
  // блоками: сначала 24 призыв, потом 23
  assert.ok(project.persons.slice(24).every((p) => winter.has(p.id)));

  // зимний вручную ставим в ЗН ДТП на 2 ноября — летним всё равно нужно 2 человека
  const { setCells, naryadCells } = await import('../src/lib/model.js');
  const zid = [...winter][0];
  const manual = setCells(project, naryadCells(zid, project.settings.duties[1], '2026-11-02', false));
  const res = plan(manual, { from: '2026-11-01', to: '2026-11-30', seed: 5, variants: 1 });
  const v = res.variants[0];
  assert.equal(v.unfilled.length, 0);
  assert.ok(v.assignments.every((a) => !winter.has(a.pid)), 'зимних в автораспределении быть не должно');
  const applied = applyVariant(manual, res, v);
  const cov = coverage(applied, ['2026-11-02', '2026-11-03']);
  assert.equal(cov['2026-11-02'].DTP.prep, 2, 'норма по летним не уменьшилась из-за ручного зимнего');
  assert.equal(applied.cells[zid]['2026-11-02'].c, 'ЗН ДТП', 'ручной наряд зимнего на месте');
});


test('дежурные: в ротном наряде ровно один, в технопарке не больше одного, без дежурных — пустые места', { skip: !hasFixture }, () => {
  const project = load();
  const res = plan(project, { from: '2026-11-01', to: '2026-11-30', seed: 11, variants: 1 });
  const v = res.variants[0];
  assert.equal(v.unfilled.length, 0);
  const applied = applyVariant(project, res, v);
  checkRules(applied, '2026-11-02', '2026-11-30', v); // ДТП на 2 ноября заступает 31 октября — вне периода
  const loads = computeLoads(applied);
  const dj = project.persons.slice(0, 8).map((p) => loads[p.id].total);
  const dn = project.persons.slice(8).map((p) => loads[p.id].total);
  console.log(`  нагрузка к 30.11: дежурные ${Math.min(...dj)}–${Math.max(...dj)}, дневальные ${Math.min(...dn)}–${Math.max(...dn)}`);

  // без дежурных ротный наряд не собрать — места дежурного остаются пустыми, дневальных на них не ставим
  const none = load();
  none.persons = none.persons.map((p) => ({ ...p, role: 'dn' }));
  const r2 = plan(none, { from: '2026-11-01', to: '2026-11-07', seed: 1, variants: 1 });
  assert.ok(r2.variants[0].unfilled.length >= 7 && r2.variants[0].unfilled.every((u) => u.role === 'dj'));
});

test('ограничение «вместе»: ротные наряды назначаются группой, замена не сдвигает оставшегося', { skip: !hasFixture }, () => {
  const base = load();
  const members = base.persons.slice(8, 10).map((p) => p.id);
  const project = { ...base, settings: { ...base.settings, constraints: { together: [{ id: 't1', members }], apart: [] } } };
  const res = plan(project, { from: '2026-11-01', to: '2026-11-30', seed: 17 });
  assert.ok(res.variants.length >= 2);
  for (const v of res.variants) {
    assert.equal(v.unfilled.length, 0);
    const starts = members.map((pid) => v.assignments.filter((a) => a.pid === pid && a.dutyId === 'R').map((a) => a.start));
    assert.ok(starts[0].length > 0, 'группа должна участвовать в ротных нарядах');
    assert.deepEqual(starts[0], starts[1], 'участники заступают в ротный наряд только вместе');
    checkRules(applyVariant(project, res, v), '2026-11-02', '2026-11-30', v);
  }

  const applied = applyVariant(project, res, res.variants[0]);
  const victim = extractNaryads(applied).find((n) => n.pid === members[0] && n.dutyId === 'R' && n.start >= '2026-11-01');
  const { project: sick, removed } = applyStatus(applied, victim.pid, victim.start, victim.end, 'Г');
  const replacement = plan(sick, {
    from: victim.start, to: victim.start, mode: 'fill',
    onlySlots: removed.map((n) => ({ dutyId: n.dutyId, start: n.start })), seed: 19,
  });
  for (const v of replacement.variants) {
    assert.equal(v.unfilled.length, 0);
    assert.ok(v.assignments.some((a) => a.dutyId === 'R' && a.start === victim.start));
    assert.ok(v.assignments.every((a) => a.pid !== members[0]), 'снятый по госпиталю не назначается на замену');
    const restored = applyVariant(sick, replacement, v);
    assert.ok(extractNaryads(restored).some((n) => n.pid === members[1] && n.dutyId === 'R' && n.start === victim.start),
      'оставшийся участник не переназначается');
  }
});

test('ограничение «не одновременно»: наряды участников не пересекаются', { skip: !hasFixture }, () => {
  const base = load();
  const members = [base.persons[0].id, base.persons[1].id, base.persons[8].id];
  const project = { ...base, settings: { ...base.settings, constraints: { together: [], apart: [{ id: 'a1', members }] } } };
  const res = plan(project, { from: '2026-11-01', to: '2026-11-30', seed: 23 });
  for (const v of res.variants) {
    assert.equal(v.unfilled.length, 0);
    const applied = applyVariant(project, res, v);
    checkRules(applied, '2026-11-02', '2026-11-30', v);
    const list = extractNaryads(applied).filter((n) => members.includes(n.pid) && n.start >= '2026-11-01');
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      if (list[a].pid === list[b].pid) continue;
      assert.ok(toNum(list[a].end) < toNum(list[b].start) || toNum(list[b].end) < toNum(list[a].start),
        `пересекаются наряды: ${list[a].pid} ${list[a].start} и ${list[b].pid} ${list[b].start}`);
    }
  }
});

test('наказание не входит в нагрузку и сохраняется при перестройке', { skip: !hasFixture }, () => {
  const project = load();
  const from = '2026-11-02', to = '2026-11-14';
  const initial = plan(project, { from, to, seed: 31, variants: 1 });
  const scheduled = applyVariant(project, initial, initial.variants[0]);
  const target = extractNaryads(scheduled).find((n) => n.auto && n.start >= from && n.start <= to);
  const before = computeLoads(scheduled)[target.pid];
  const duty = scheduled.settings.duties.find((d) => d.id === target.dutyId);
  const punished = setCells(scheduled, target.cellDays.map((d) => ({ pid: target.pid, d, cell: { c: scheduled.cells[target.pid][d].c, p: 1 } })));
  const marked = extractNaryads(punished).find((n) => n.id === target.id);
  assert.ok(marked.punishment && !marked.auto, 'наказание одновременно является закреплённым нарядом');
  const after = computeLoads(punished)[target.pid];
  assert.equal(after.total, before.total - (duty.weight ?? 1));
  assert.equal(after.inTable, before.inTable - 1);
  assert.equal(after.byDuty[target.dutyId], before.byDuty[target.dutyId] - 1);

  const rebuilt = plan(punished, { from, to, mode: 'replan', seed: 32, variants: 1 });
  assert.ok(!rebuilt.cleared.some((n) => n.id === target.id), 'генерация не снимает наказание');
  const next = applyVariant(punished, rebuilt, rebuilt.variants[0]);
  const preserved = extractNaryads(next).find((n) => n.id === target.id);
  assert.ok(preserved?.punishment);
  for (const d of target.cellDays) assert.equal(next.cells[target.pid][d].p, 1);
  assert.ok(rebuilt.variants[0].assignments.some((a) => a.pid === target.pid && a.start !== target.start),
    'человек продолжает участвовать в распределении');
  checkRules(next, from, to, rebuilt.variants[0]);
});

test('персональные запреты исключают ротный наряд и ДТП при генерации', { skip: !hasFixture }, () => {
  const base = load();
  const noR = base.persons[0].id, noDtp = base.persons[8].id;
  const project = {
    ...base,
    persons: base.persons.map((p) => ({
      ...p,
      forbiddenDuties: p.id === noR ? ['R'] : p.id === noDtp ? ['DTP'] : [],
    })),
  };
  const res = plan(project, { from: '2026-11-01', to: '2026-11-30', seed: 41 });
  for (const v of res.variants) {
    assert.equal(v.unfilled.length, 0);
    assert.ok(v.assignments.every((a) => a.pid !== noR || a.dutyId !== 'R'));
    assert.ok(v.assignments.every((a) => a.pid !== noDtp || a.dutyId !== 'DTP'));
    checkRules(applyVariant(project, res, v), '2026-11-02', '2026-11-30', v);
  }
});
