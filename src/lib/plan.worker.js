// Фоновый поток для расчёта вариантов: интерфейс не замирает, пока идёт подбор
import { plan } from './planner.js';

self.onmessage = (e) => {
  const { id, jobs } = e.data;
  try {
    self.postMessage({ id, results: jobs.map((j) => plan(j.project, j.opts)) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
