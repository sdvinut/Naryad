// Снимок посреди перетаскивания строки
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const grip = document.querySelector('.row[data-ri="1"] .grip');
  const gr = grip.getBoundingClientRect();
  const rowH = grip.closest('.row').offsetHeight;
  grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: gr.x + 5, clientY: gr.y + 5 }));
  for (let i = 1; i <= 5; i++) { window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: gr.x + 5, clientY: gr.y + 5 + rowH * 0.62 * i })); await wait(40); }
  await wait(400);
  return [{ name: 'ok' }];
})();
