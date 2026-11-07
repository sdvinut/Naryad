// Запуск планировщика в фоновом потоке. Если поток не создался — считаем как раньше, в основном.
import PlanWorker from './plan.worker.js?worker&inline';
import { plan } from './planner.js';

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  try {
    worker = new PlanWorker();
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.results);
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('worker'));
      pending.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

const runHere = (jobs) => jobs.map((j) => plan(j.project, j.opts));

// jobs: [{ project, opts }] → Promise<[result, ...]>
export function planMany(jobs) {
  const w = getWorker();
  if (!w) return new Promise((r) => setTimeout(() => r(runHere(jobs)), 30));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, jobs });
  }).catch(() => runHere(jobs));
}
