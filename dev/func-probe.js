// Проверка сценариев в невидимом окне: месяц, распределение, применение, замена, печать, отмена.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
  const waitFor = async (fn, ms = 10000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
  const res = [];
  const check = (name, ok, extra = '') => res.push({ name, ok: !!ok, extra: String(extra) });
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));

  await waitFor(() => document.querySelector('.row'));
  check('нет отметок «из Excel»', !document.body.textContent.includes('из Excel'), [...document.querySelectorAll('.lg-item')].map((x) => x.textContent).join(' | '));
  const empty = [...document.querySelectorAll('.cell')].find((c) => !c.querySelector('.chip'));
  empty.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await waitFor(() => document.querySelector('.cell-menu'));
  check('в меню клетки только свои отметки', document.querySelectorAll('.cell-menu .status-chip').length === 5, [...document.querySelectorAll('.cell-menu .status-chip b')].map((x) => x.textContent).join(' '));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(300);
  check('таблица открылась', document.querySelectorAll('.row[data-ri]').length === 24, document.querySelectorAll('.row[data-ri]').length);

  // ---- выделение как в Excel (октябрь) ----
  const cellEl = (ri, d) => document.querySelector(`.row[data-ri="${ri}"] .cell[data-d="${d}"]`);
  const down = (el, opt = {}) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ...opt }));
  const over = (el) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  const up = () => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  const key = (k, opt = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opt }));
  const barText = () => document.querySelector('.selbar-info')?.textContent || '';
  const rowCodes = (ri) => [...document.querySelectorAll(`.row[data-ri="${ri}"] .cell .lbl`)].map((x) => x.textContent);

  down(document.querySelector('.row[data-ri="2"] .c.num')); up();
  check('клик по № — вся строка', (await waitFor(() => barText().includes('31 клеток'))), barText());
  key('3');
  // если в строке были наряды — РГ показывается в предпросмотре вместе с вариантами замены
  await waitFor(() => rowCodes(2).filter((c) => c === 'РГ').length === 31, 4000);
  check('цифра 3 — РГ на весь месяц', rowCodes(2).filter((c) => c === 'РГ').length === 31, rowCodes(2).length);
  if (document.querySelector('.v-card')) { document.querySelector('.v-card .v-apply').click(); await wait(400); }

  down(cellEl(4, '2026-10-24')); over(cellEl(5, '2026-10-25')); over(cellEl(6, '2026-10-26')); up();
  check('прямоугольник 3×3', await waitFor(() => barText().includes('9 клеток')), barText());
  check('рамка выделения', document.querySelectorAll('.cell.sel').length === 9 && document.querySelectorAll('.cell.sel-t').length === 3, document.querySelectorAll('.cell.sel').length);
  key('Delete');
  await wait(300);
  check('Delete очищает', [4, 5, 6].every((ri) => ['2026-10-24', '2026-10-25', '2026-10-26'].every((d) => !cellEl(ri, d).querySelector('.chip'))));

  down(document.querySelector('.hcell[data-d="2026-10-25"]')); up();
  check('клик по дате — весь столбец', await waitFor(() => barText().includes('× 1 дн.')), barText());
  key('Escape');
  await wait(300);
  check('Esc снимает выделение', !document.querySelector('.selbar'));

  down(cellEl(0, '2026-10-29')); up();
  await waitFor(() => document.querySelector('.cell-menu'));
  down(cellEl(1, '2026-10-31'), { shiftKey: true }); up();
  check('Shift расширяет', await waitFor(() => barText().includes('6 клеток')), barText());
  [...document.querySelectorAll('.selbar .status-chip')].find((b) => b.textContent.includes('Увольнение')).click();
  await wait(300);
  check('кнопка «Увольнение»', rowCodes(0).slice(-3).join() === 'У,У,У' && rowCodes(1).slice(-3).join() === 'У,У,У', rowCodes(0).slice(-3).join());

  const prepCell = [...document.querySelectorAll('.cell')].find((c) => c.querySelector('.chip-prep') && c.dataset.d >= '2026-10-12' && c.dataset.d <= '2026-10-25');
  const pri = Number(prepCell.parentElement.dataset.ri);
  const pd = prepCell.dataset.d;
  const pd2 = new Date(Date.parse(pd) + 2 * 86400000).toISOString().slice(0, 10);
  down(cellEl(pri, pd)); over(cellEl(pri, pd2)); up();
  await waitFor(() => document.querySelector('.selbar'));
  key('2');
  const applyDuration = await waitFor(() => btn('Проставить'));
  check('Г запрашивает количество дней', !!applyDuration);
  applyDuration.click();
  check('Г поверх нарядов — подбор замены', await waitFor(() => document.querySelectorAll('.v-assign').length), [...document.querySelectorAll('.v-assign .va-name')].map((x) => x.textContent).join(', '));
  document.querySelector('.plan-head .icon-btn').click();
  await wait(300);

  // ---- порядок людей ----
  const names = () => [...document.querySelectorAll('.row[data-ri] .nm')].map((x) => x.textContent);
  check('порядок как на листе «График»', names().slice(0, 3).join() === 'Сотрудник 06,Сотрудник 11,Сотрудник 14', names().slice(0, 3).join(', '));
  const before = names();
  const grip = document.querySelector('.row[data-ri="0"] .grip');
  const gr = grip.getBoundingClientRect();
  const rowH = grip.closest('.row').offsetHeight;
  grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: gr.x + 5, clientY: gr.y + 5 }));
  for (let i = 1; i <= 6; i++) { window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: gr.x + 5, clientY: gr.y + 5 + (rowH * 3 * i) / 6 })); await wait(30); }
  check('строки расступаются при перетаскивании', document.querySelector('.grid.reordering') && document.querySelector('.row.dragging'));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await wait(300);
  const after = names();
  check('перетаскивание строки', after[3] === before[0] && after[0] === before[1], `${before[0]} → место ${after.indexOf(before[0]) + 1}`);
  key('z', { ctrlKey: true });
  await wait(300);
  check('Ctrl+Z возвращает порядок', names().join() === before.join());
  document.querySelector('button[title="Настройки"]').click();
  await waitFor(() => btn('По алфавиту'));
  check('настройки: ручки перетаскивания', document.querySelectorAll('.people-row .grip').length === before.length);
  btn('По алфавиту').click();
  await wait(200);
  btn('Сохранить').click();
  await wait(500);
  check('кнопка «По алфавиту»', names().slice(0, 2).join() === 'Сотрудник 01,Сотрудник 02', names().slice(0, 2).join(', '));
  key('z', { ctrlKey: true });
  await wait(300);

  key('a', { ctrlKey: true });
  check('Ctrl+A — весь месяц', await waitFor(() => barText().includes('744 клеток')), barText());
  key('Escape');
  await wait(200);
  btn('Нагрузка')?.click();
  await wait(200);

  document.querySelector('button[title="Следующий месяц"]').click();
  check('смена месяца', await waitFor(() => document.querySelector('.hcell .h-date') && [...document.querySelectorAll('.month-title span')].some((s) => s.textContent.includes('Ноябрь'))));

  btn('Распределить').click();
  const run = await waitFor(() => btn('Подобрать варианты'));
  check('форма распределения', run, document.querySelector('.plan-form input[type=date]')?.value);
  let ticks = 0;
  const iv = setInterval(() => ticks++, 10);
  const t0 = performance.now();
  run.click();
  const cards = await waitFor(() => document.querySelectorAll('.v-card').length >= 3 && document.querySelectorAll('.v-card'), 15000);
  clearInterval(iv);
  const ms = performance.now() - t0;
  check('варианты подобраны в фоне', cards, `за ${Math.round(ms)} мс, таймер успел сработать ${ticks} раз (основной поток не занят)`);
  await wait(400);
  check('предпросмотр пунктиром', document.querySelectorAll('.chip.ghost').length > 100, document.querySelectorAll('.chip.ghost').length);

  for (let i = 0; i < 3; i++) { document.querySelectorAll('.v-card')[i].click(); await wait(150); }
  document.querySelector('.v-card .v-apply').click();
  await wait(700);
  check('вариант применён', [...document.querySelectorAll('.toast-title')].some((t) => t.textContent.startsWith('Применён')), document.querySelectorAll('.chip').length + ' фишек');
  check('волна появления', document.querySelectorAll('.chip.pop').length > 100, document.querySelectorAll('.chip.pop').length);

  // клик по наряду → снять → госпиталь → замена
  const cell = document.querySelector('.cell .chip-prep.auto')?.closest('.cell');
  cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  const removeBtn = await waitFor(() => btn('Снять и подобрать замену'));
  check('меню наряда', removeBtn);
  removeBtn.click();
  await waitFor(() => btn('Подобрать замену'));
  [...document.querySelectorAll('.modal .status-chip')].find((b) => b.textContent.includes('Госпиталь')).click();
  btn('Подобрать замену').click();
  const groups = await waitFor(() => document.querySelectorAll('.v-group').length >= 1 && document.querySelectorAll('.v-assign').length && document.querySelectorAll('.v-group'), 15000);
  check('замена подобрана', groups, [...document.querySelectorAll('.v-assign .va-name')].map((x) => x.textContent).join(', '));
  document.querySelector('.v-card .v-apply').click();
  await wait(500);
  check('замена применена', [...document.querySelectorAll('.chip-status .lbl')].some((x) => x.textContent === 'Г'));

  // отмена
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
  await wait(400);
  check('Ctrl+Z', true);

  // окно печати
  btn('Печать').click();
  check('окно печати', await waitFor(() => document.querySelector('.paper table tbody tr')), document.querySelectorAll('.paper tbody tr').length + ' строк в превью');
  check('ошибок в странице нет', errors.length === 0, errors.join(' | '));
  return res;
})();
