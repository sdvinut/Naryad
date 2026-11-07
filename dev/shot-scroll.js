// Прокручивает таблицу к границе призывов для снимка
(async () => {
  const s = document.querySelector('.grid-scroll');
  const g = document.querySelectorAll('.group-row')[1];
  s.scrollTop = g.offsetTop - 330;
  await new Promise((r) => setTimeout(r, 700));
  return [{ name: 'ok' }];
})();
