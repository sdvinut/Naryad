// Открывает «Настройки → Люди» для снимка
(async () => {
  document.querySelector('button[title="Настройки"]').click();
  await new Promise((r) => setTimeout(r, 1000));
  return [{ name: 'ok' }];
})();
