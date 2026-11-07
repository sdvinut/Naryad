// Открывает окно печати для снимка превью
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Печать').click();
  await wait(1200);
  return [{ name: 'ok' }];
})();
