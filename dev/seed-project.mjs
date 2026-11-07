// Готовит project.json из демо-данных для автопроверки окна приложения
import fs from 'node:fs';
import { projectFromImport } from '../src/lib/model.js';
const data = JSON.parse(fs.readFileSync(new URL('./fixture-import.json', import.meta.url), 'utf8'));
const { project } = projectFromImport(data);
// первые 8 по листу «График» — дежурные
project.persons = project.persons.map((p, i) => (i < 8 ? { ...p, role: 'dj' } : p));
fs.writeFileSync(process.argv[2], JSON.stringify({ ...project, view: { month: '2026-10' } }));
