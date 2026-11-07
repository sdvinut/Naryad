import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectFromImport, normalizeProject } from '../src/lib/model.js';

const fixture = new URL('../dev/fixture-import.json', import.meta.url);

test('импорт берёт только известные коды, остальные пропускает', { skip: !fs.existsSync(fixture) }, () => {
  const { project, skipped } = projectFromImport(JSON.parse(fs.readFileSync(fixture, 'utf8')));
  assert.deepEqual(skipped, { З: 2, ОСВ: 7, П: 7, К: 21 });
  assert.deepEqual(project.settings.statuses.map((s) => s.code), ['У', 'Г', 'РГ', '×']);
  const codes = new Set(Object.values(project.cells).flatMap((row) => Object.values(row).map((c) => c.c)));
  assert.deepEqual([...codes].sort(), ['ДТП', 'ЗН ДТП', 'ЗН Р', 'Р', 'РГ', 'У', 'Г'].sort());
  // порядок — как на листе «График»
  assert.deepEqual(project.persons.slice(0, 4).map((p) => p.name), ['Сотрудник 06', 'Сотрудник 11', 'Сотрудник 14', 'Сотрудник 13']);
  assert.equal(project.persons.at(-1).name, 'Сотрудник 22');
});

test('старый проект: отметки из Excel удаляются вместе с клетками', () => {
  const old = {
    persons: [{ id: 'a', name: 'Тест Т.Т.' }],
    cells: { a: { '2026-10-01': { c: 'К' }, '2026-10-02': { c: 'Р' }, '2026-10-03': { c: 'У' } } },
    settings: { statuses: [{ code: 'У', name: 'Увольнение', color: '#10b981', blocks: true }, { code: 'К', name: 'Код «К» из Excel', color: '#facc15', blocks: true, imported: true }] },
  };
  const p = normalizeProject(old);
  assert.deepEqual(p.settings.statuses.map((s) => s.code), ['У']);
  assert.deepEqual(p.cells.a, { '2026-10-02': { c: 'Р' }, '2026-10-03': { c: 'У' } });
});

test('добавить 23 призыв к текущему проекту: распределения 24-го сохраняются, дублей нет', { skip: !fs.existsSync(fixture) || !fs.existsSync(new URL('../dev/fixture-import-zim.json', import.meta.url)) }, async () => {
  const { importInto, setCells, naryadCells } = await import('../src/lib/model.js');
  const leto = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const zima = JSON.parse(fs.readFileSync(new URL('../dev/fixture-import-zim.json', import.meta.url), 'utf8'));
  let base = projectFromImport(leto).project;
  const pid = base.persons[0].id;
  base = setCells(base, naryadCells(pid, base.settings.duties[0], '2026-11-03', true)); // «распределение», сделанное в программе
  const { project, report } = importInto(base, [{ data: zima, group: { name: '23 призыв', auto: false } }, { data: leto, group: { name: '24 призыв', auto: true } }]);
  assert.equal(report.added, 16);
  assert.equal(report.existed, 24, 'летние повторно не добавляются');
  assert.equal(project.persons.length, 40);
  assert.deepEqual(project.settings.groups.map((g) => `${g.name}:${g.auto}`), ['24 призыв:true', '23 призыв:false']);
  assert.equal(project.cells[pid]['2026-11-03'].c, 'ЗН Р', 'сделанное в программе на месте');
  assert.equal(project.persons[24].name, 'Сотрудник 25', '23 призыв идёт после 24-го, в порядке листа «График»');
});

test('старый проект без призывов: все попадают в «24 призыв» с автораспределением', () => {
  const p = normalizeProject({ persons: [{ id: 'a', name: 'Тест Т.Т.' }], cells: {}, settings: { print: { section: '24 призыв' } } });
  assert.deepEqual(p.settings.groups.map((g) => `${g.name}:${g.auto}`), ['24 призыв:true']);
  assert.equal(p.persons[0].group, p.settings.groups[0].id);
});
