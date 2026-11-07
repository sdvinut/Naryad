// Проверка двух призывов в невидимом окне: 24 — авто, 23 — вручную.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
  const waitFor = async (fn, ms = 10000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(40); } return null; };
  const down = (el, opt = {}) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ...opt }));
  const up = () => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  const res = [];
  const check = (name, ok, extra = '') => res.push({ name, ok: !!ok, extra: String(extra) });
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));

  await waitFor(() => document.querySelector('.row[data-ri]'));
  const heads = [...document.querySelectorAll('.group-row')].map((r) => r.textContent);
  check('заголовки призывов в таблице', heads.length === 2 && heads[0].includes('24 призыв') && heads[1].includes('23 призыв') && heads[1].includes('вручную'), heads.join(' | '));
  const manualRows = [...document.querySelectorAll('.row.manual[data-ri]')];
  check('23 призыв помечен «вручную»', manualRows.length === 16, manualRows.length);
  check('нумерация 23 призыва с 1', manualRows[0]?.querySelector('.c.num').textContent === '1' && manualRows[0]?.querySelector('.nm').textContent === 'Сотрудник 25', manualRows[0]?.textContent.slice(0, 20));
  check('нагрузка по призывам', document.querySelectorAll('.stat-group').length === 2);
  check('пометки «деж» у 8 дежурных', document.querySelectorAll('.row[data-ri] .role-tag').length === 8, document.querySelectorAll('.row[data-ri] .role-tag').length);

  // распределение ноября: зимних в вариантах быть не должно
  document.querySelector('button[title="Следующий месяц"]').click();
  await wait(500);
  btn('Распределить').click();
  const run = await waitFor(() => btn('Подобрать варианты'));
  check('в форме сказано, кого распределяем', document.body.textContent.includes('Распределяются только призывы «авто»'));
  check('в форме видно дежурных', document.querySelector('.roles-info')?.textContent.includes('Дежурных: 8'), document.querySelector('.roles-info')?.textContent);
  run.click();
  await waitFor(() => document.querySelectorAll('.v-card').length >= 1, 15000);
  await wait(400);
  const ghostsWinter = document.querySelectorAll('.row.manual .chip.ghost').length;
  const ghostsSummer = document.querySelectorAll('.row:not(.manual) .chip.ghost').length;
  check('автораспределение не трогает 23 призыв', ghostsWinter === 0 && ghostsSummer > 100, `летние ${ghostsSummer}, зимние ${ghostsWinter}`);
  document.querySelector('.v-card .v-apply').click();
  await wait(700);
  check('после применения у 23 призыва ноябрь пустой', document.querySelectorAll('.row.manual .chip').length === 0);

  // вручную ставим зимнего в ротный наряд
  const wcell = document.querySelector('.row.manual[data-ri] .cell[data-d="2026-11-10"]');
  down(wcell); up();
  const place = await waitFor(() => [...document.querySelectorAll('.cell-menu .menu-item.duty')].find((b) => b.textContent.includes('Ротный')));
  place.click();
  await wait(400);
  const wr = wcell.closest('.row');
  check('ручная постановка 23 призыва', wr.querySelectorAll('.chip').length === 2, [...wr.querySelectorAll('.chip .lbl')].map((x) => x.textContent).join(' '));

  // снимаем его — без подбора замены
  down(wr.querySelector('.cell[data-d="2026-11-10"]')); up();
  const rm = await waitFor(() => btn('Снять с наряда (вручную'));
  check('в меню «снять без замены»', rm);
  rm.click();
  const ok = await waitFor(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Снять'));
  check('в окне кнопка «Снять»', ok);
  ok.click();
  await wait(600);
  check('замена не предлагается', !document.querySelector('.v-card') && [...document.querySelectorAll('.toast-title')].some((t) => t.textContent.startsWith('Снято нарядов')));
  check('наряд снят, отметка стоит', wr.querySelectorAll('.chip-duty, .chip-prep').length === 0 && wr.querySelectorAll('.chip-status').length >= 1);

  // настройки: призывы
  document.querySelector('button[title="Настройки"]').click();
  await waitFor(() => document.querySelector('.groups-edit'));
  check('настройки: два призыва', document.querySelectorAll('.group-edit-row').length === 2 && document.querySelectorAll('.people-row select').length === 40);
  check('настройки: роли и счётчик', document.querySelectorAll('.role-btn.dj').length === 8 && document.querySelector('.ge-count').textContent.includes('дежурных: 8'), document.querySelector('.ge-count')?.textContent);
  document.querySelectorAll('.role-btn')[9].click();
  await wait(150);
  check('кнопка роли переключает', document.querySelectorAll('.role-btn.dj').length === 9 && document.querySelector('.ge-count').textContent.includes('дежурных: 9'));
  btn('Отмена').click();
  await wait(300);

  // печать: оба блока
  btn('Печать').click();
  await waitFor(() => document.querySelector('.paper'));
  const sections = [...document.querySelectorAll('.paper td.section')].map((x) => x.textContent);
  check('печать блоками призывов', sections.join() === '24 призыв,23 призыв', sections.join(', '));
  check('галочки призывов в печати', document.querySelectorAll('.group-checks .group-check').length === 2);
  check('ошибок в странице нет', errors.length === 0, errors.join(' | '));
  return res;
})();
