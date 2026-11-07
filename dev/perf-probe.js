// Замер плавности: запускается внутри окна приложения (NARYADY_PERF=файл), прогоняет типичные действия
// и считает длительность кадров. Возвращает массив результатов.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t));
  const longs = [];
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(e.duration))).observe({ type: 'longtask' }); } catch { /* нет API */ }

  async function measure(name, action, ms = 1500) {
    console.warn(`шаг: ${name} ${Math.round(performance.now())}`);
    const frames = [];
    let last = performance.now(), run = true;
    const f = (t) => { frames.push(t - last); last = t; if (run) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    const l0 = longs.length, t0 = performance.now();
    if (action) await action();
    const actionMs = performance.now() - t0;
    await wait(ms);
    run = false;
    const total = (performance.now() - t0) / 1000;
    const sorted = frames.slice().sort((a, b) => a - b);
    const q = (p) => Number((sorted[Math.floor(sorted.length * p)] || 0).toFixed(1));
    return {
      name, fps: Math.round(frames.length / total), p50: q(0.5), p95: q(0.95), max: q(0.999),
      janky: frames.filter((x) => x > 25).length, longTasks: longs.slice(l0).map(Math.round), actionMs: Math.round(actionMs),
    };
  }

  const res = [];
  res.push(await measure('покой', null, 2500));
  res.push(await measure('месяц вперёд', async () => document.querySelector('button[title="Следующий месяц"]').click()));
  res.push(await measure('месяц назад', async () => document.querySelector('button[title="Предыдущий месяц"]').click()));
  res.push(await measure('месяц вперёд 2', async () => document.querySelector('button[title="Следующий месяц"]').click()));
  res.push(await measure('прокрутка', async () => {
    const s = document.querySelector('.grid-scroll');
    // шаги по таймеру, а не по кадрам: если отрисовка встанет, замер это покажет, а не зависнет
    for (let i = 0; i < 40; i++) { s.scrollLeft = (i % 10) * 80; s.scrollTop = (i % 5) * 60; await wait(16); }
  }, 300));
  res.push(await measure('наведение на клетки', async () => {
    const cells = [...document.querySelectorAll('.cell')];
    for (let i = 0; i < 90; i++) { cells[(i * 37) % cells.length].dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); await wait(8); }
  }, 300));
  btn('Распределить').click();
  await wait(600);
  res.push(await measure('подбор вариантов', async () => btn('Подобрать варианты').click(), 2500));
  res.push(await measure('переключение вариантов', async () => {
    for (let i = 0; i < 6; i++) { document.querySelectorAll('.v-card')[i % 3]?.click(); await wait(300); }
  }, 600));
  res.push(await measure('покой с предпросмотром', null, 2000));
  res.push(await measure('применить', async () => document.querySelector('.v-card .v-apply')?.click(), 2200));
  res.push(await measure('покой после', null, 2000));
  res.push({ name: 'размер', w: innerWidth, h: innerHeight, dpr: devicePixelRatio, chips: document.querySelectorAll('.chip').length });
  return res;
})();
