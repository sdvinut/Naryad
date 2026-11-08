import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { projectFromImport, importInto, setCells } from '../src/lib/model.js';
import { buildPrintPayload } from '../src/lib/print.js';
import { range } from '../src/lib/dates.js';

const require = createRequire(import.meta.url);
const { buildDocx } = require('../electron/docx.cjs');
const JSZip = require('jszip');
const fixture = new URL('../dev/fixture-import.json', import.meta.url);

const load = () => projectFromImport(JSON.parse(fs.readFileSync(fixture, 'utf8'))).project;
const docXml = async (buf) => (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
const opts = (p, extra) => ({ signatures: p.settings.signatures, title: p.settings.title, ...p.settings.print, ...extra });

const zimFixture = new URL('../dev/fixture-import-zim.json', import.meta.url);
const loadBoth = () => importInto(null, [
  { data: JSON.parse(fs.readFileSync(fixture, 'utf8')), group: { name: '24 призыв', auto: true } },
  { data: JSON.parse(fs.readFileSync(zimFixture, 'utf8')), group: { name: '23 призыв', auto: false } },
]).project;

test('Word «как в Excel»: книжный лист в рамке, оба призыва, ГК, дата', { skip: !fs.existsSync(fixture) || !fs.existsSync(zimFixture) }, async () => {
  const project = loadBoth();
  const withLazaret = setCells(project, [{ pid: project.persons[0].id, d: '2026-10-15', cell: { c: 'Л' } }]);
  const payload = buildPrintPayload(withLazaret, range('2026-10-12', '2026-10-19'), opts(project, { dateIso: '2026-10-15' }));
  const buf = await buildDocx(payload);
  fs.writeFileSync(new URL('../dev/test-week.docx', import.meta.url), buf);
  const zip = await JSZip.loadAsync(buf);
  const xml = await docXml(buf);
  assert.match(xml.match(/<w:pgSz[^>]*>/)[0], /w:w="11906" w:h="16838"/);
  assert.ok(Object.keys(zip.files).some((f) => f.startsWith('word/media/')), 'рамка-картинка');
  assert.match(xml, /behindDoc="1"/);
  for (const t of ['24 призыв', '23 призыв', 'Сотрудник 25', '12.окт', '16.окт', 'ГК - 6,16,29', '15 октября 2026 г.', 'И. Иванов', 'П. Петров', 'ЗН ДТП']) assert.ok(xml.includes(t), t);
  assert.match(xml, />Л</, 'лазарет печатается буквой Л');
  // ГК — только над 16 октября
  assert.equal((xml.match(/>ГК</g) || []).length, 1);
  // нумерация внутри каждого призыва с 1: «16» — последний в 23 призыве, «24» — в 24 призыве
  assert.equal(payload.blocks.map((b) => b.rows.length).join(), '24,16');
});

test('Word «цветная таблица»: альбомный лист и месяц на одной странице', { skip: !fs.existsSync(fixture) }, async () => {
  const project = load();
  const week = buildPrintPayload(project, range('2026-10-12', '2026-10-19'), opts(project, { style: 'color', colored: true }));
  const xml = await docXml(await buildDocx(week));
  assert.match(xml.match(/<w:pgSz[^>]*>/)[0], /w:orient="landscape"/);
  const month = buildPrintPayload(project, range('2026-10-01', '2026-10-31'), opts(project, { dateIso: '2026-10-26' }));
  fs.writeFileSync(new URL('../dev/test-month.docx', import.meta.url), await buildDocx(month));
});
