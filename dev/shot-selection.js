// Выделяет прямоугольник для снимка панели заливки
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cell = (ri, d) => document.querySelector(`.row[data-ri="${ri}"] .cell[data-d="${d}"]`);
  const s = document.querySelector('.grid-scroll');
  s.scrollLeft = 520;
  cell(3, '2026-10-20').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  cell(8, '2026-10-27').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await wait(900);
  return [{ name: 'ok' }];
})();
