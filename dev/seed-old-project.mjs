// Проект «как у пользователя»: старый импорт с отметками З, П, К, ОСВ — для проверки, что они убираются
import fs from 'node:fs';
import { emptyProject, newId } from '../src/lib/model.js';
const data = JSON.parse(fs.readFileSync(new URL('./fixture-import.json', import.meta.url), 'utf8'));
const p = emptyProject();
const extra = ['З', 'ОСВ', 'П', 'К'];
extra.forEach((code) => p.settings.statuses.push({ code, name: `Код «${code}» из Excel`, color: '#facc15', blocks: true, imported: true }));
for (const row of data.persons) {
  const id = newId();
  p.persons.push({ id, name: row.name, carry: row.carry, active: true });
  p.cells[id] = Object.fromEntries(Object.entries(row.cells).map(([d, c]) => [d, { c }]));
}
fs.writeFileSync(process.argv[2], JSON.stringify({ ...p, view: { month: '2026-10' } }));
