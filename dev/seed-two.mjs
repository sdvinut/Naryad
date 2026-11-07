// Проект с двумя призывами (24 — авто, 23 — вручную) для проверки окна приложения
import fs from 'node:fs';
import { importInto } from '../src/lib/model.js';
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
const { project } = importInto(null, [
  { data: read('./fixture-import.json'), group: { name: '24 призыв', auto: true } },
  { data: read('./fixture-import-zim.json'), group: { name: '23 призыв', auto: false } },
]);
// первые 8 по листу «График» — дежурные
project.persons = project.persons.map((p, i) => (i < 8 ? { ...p, role: 'dj' } : p));
fs.writeFileSync(process.argv[2], JSON.stringify({ ...project, view: { month: '2026-10' } }));
