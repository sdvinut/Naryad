import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronLeft, ChevronRight, Undo2, Redo2, FileSpreadsheet, Printer, Settings2, FolderOpen, Save,
  WandSparkles, CalendarCheck, Plus, MousePointerClick, Move,
} from 'lucide-react';
import { api, isDesktop } from './api.js';
import { historyReducer, initialHistory } from './lib/store.js';
import {
  normalizeProject, extractNaryads, computeLoads, applyStatus, diffCells, projectFromImport, setCells,
  naryadCells, clearNaryadCells, emptyProject, naryadLength, movePerson, autoPids, importInto,
} from './lib/model.js';
import { applyVariant } from './lib/planner.js';
import { planMany } from './lib/planAsync.js';
import { todayIso, monthKey, shiftMonth, monthDays, monthTitle, addDays, range, toNum, fmtHuman, fmtFull, fmtShort } from './lib/dates.js';
import Grid from './components/Grid.jsx';
import CellMenu from './components/CellMenu.jsx';
import SidePanel from './components/SidePanel.jsx';
import { RemoveModal, ImportModal, ExportModal, SettingsModal } from './components/Modals.jsx';
import SelectionBar from './components/SelectionBar.jsx';
import { Button, IconButton, Toasts, softSpring } from './components/ui.jsx';

const seed = () => Math.floor(Math.random() * 1e6);
// выделение из одной клетки — это просто клик (открывает меню клетки)
const isSingle = (s) => !!s && s.ranges.length === 1 && s.ranges[0].r0 === s.ranges[0].r1 && s.ranges[0].d0 === s.ranges[0].d1;

export default function App() {
  const [hist, dispatch] = useReducer(historyReducer, initialHistory);
  const project = hist.present;
  const [ready, setReady] = useState(false);
  const [month, setMonth] = useState(monthKey(todayIso()));
  const [monthDir, setMonthDir] = useState(0);
  const [tab, setTab] = useState('stats');
  const [planState, setPlanState] = useState(null);
  const [hoverVar, setHoverVar] = useState(null);
  const [pinVar, setPinVar] = useState(null);
  const [menu, setMenu] = useState(null);
  const [sel, setSel] = useState(null); // выделение: { ranges: [{r0, r1, d0, d1}], anchor, kind }
  const keysRef = useRef(null);
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState(null);
  const [focusPid, setFocusPid] = useState(null);
  const [computing, setComputing] = useState(false);
  const [toasts, setToasts] = useState([]);
  const today = todayIso();

  // ---------- уведомления ----------
  const toast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    const item = typeof t === 'string' ? { title: t } : t;
    setToasts((xs) => [...xs.slice(-3), { id, ttl: 5000, ...item }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), item.ttl || 5000);
  }, []);
  const dismiss = useCallback((id) => setToasts((xs) => xs.filter((x) => x.id !== id)), []);

  // ---------- загрузка и автосохранение ----------
  useEffect(() => {
    api.loadProject().then((p) => {
      if (p) {
        const np = normalizeProject(p);
        dispatch({ type: 'reset', project: np });
        if (np.view?.month) setMonth(np.view.month);
      }
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (!ready || !project) return undefined;
    const t = setTimeout(() => api.saveProject({ ...project, view: { month } }), 400);
    return () => clearTimeout(t);
  }, [project, month, ready]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  const closePlan = useCallback(() => { setPlanState(null); setPinVar(null); setHoverVar(null); }, []);

  const commit = useCallback((next, { animate = true } = {}) => {
    if (animate && hist.present) {
      const keys = diffCells(hist.present, next);
      if (keys.size) setFlash({ keys, at: Date.now() });
    }
    dispatch({ type: 'set', project: next });
    closePlan();
  }, [hist.present, closePlan]);

  // ---------- горячие клавиши ----------
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'я') && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }); closePlan(); }
      else if ((e.ctrlKey || e.metaKey) && ((k === 'y' || k === 'н') || ((k === 'z' || k === 'я') && e.shiftKey))) { e.preventDefault(); dispatch({ type: 'redo' }); closePlan(); }
      else if (e.key === 'Escape' && !menu && !modal && !keysRef.current?.sel) closePlan();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, modal, closePlan]);

  // ---------- производные данные ----------
  const days = useMemo(() => monthDays(month), [month]);
  const naryads = useMemo(() => (project ? extractNaryads(project) : []), [project]);
  const loads = useMemo(() => (project ? computeLoads(project, naryads) : {}), [project, naryads]);
  const naryadMap = useMemo(() => {
    const m = new Map();
    for (const n of naryads) for (const d of n.cellDays) m.set(`${n.pid}|${d}`, n);
    return m;
  }, [naryads]);

  const activeVar = hoverVar || pinVar;
  // таблица догоняет наведение на варианты без блокировки: при быстром проведении мышью рисуется только последний
  const shownVar = useDeferredValue(activeVar);
  const preview = useMemo(() => {
    if (!shownVar || !planState || !project) return null;
    const g = planState.groups[shownVar.gi];
    const v = g?.result.variants[shownVar.vi];
    if (!v) return null;
    const p = applyVariant(g.base, g.result, v);
    return { project: p, diff: diffCells(project, p) };
  }, [shownVar, planState, project]);

  const nameOf = (pid) => project?.persons.find((p) => p.id === pid)?.name || '';

  // ---------- распределение ----------
  const runDistribute = async (opts) => {
    setComputing(true);
    try {
      const base = project;
      const [result] = await planMany([{ project: base, opts: { ...opts, seed: seed() } }]);
      if (!result.slots) { toast({ title: 'Все места уже заняты', text: 'В этом периоде распределять нечего.' }); return; }
      setPlanState({
        title: 'Варианты распределения',
        subtitle: `${fmtHuman(opts.from)} — ${fmtHuman(opts.to)} · мест в нарядах: ${result.slots}`,
        groups: [{ title: 'Варианты', kind: opts.keepExisting ? 'replan' : 'distribute', base, result }],
      });
      setPinVar({ gi: 0, vi: 0 });
    } catch (e) {
      toast({ title: 'Не удалось подобрать варианты', text: String(e.message || e), kind: 'error' });
    } finally { setComputing(false); }
  };

  const startReplacement = async (temp, removed, title) => {
    // призывы «вручную» программа не распределяет: их наряды просто снимаются
    const autoSet = autoPids(temp);
    if (!removed.some((n) => !n.orphan && autoSet.has(n.pid))) {
      commit(temp);
      toast({ title: `Снято нарядов: ${removed.length}`, text: 'Этот призыв распределяется вручную — замену поставьте сами. Отменить — Ctrl+Z', kind: 'ok' });
      return;
    }
    setComputing(true);
    setTab('plan');
    try {
      const real = removed.filter((n) => !n.orphan && autoSet.has(n.pid));
      const starts = real.map((n) => n.start).sort();
      const from = starts[0], to = starts.at(-1);
      const jobs = [];
      const titles = [];
      if (real.length) {
        jobs.push({ project: temp, opts: { from, to, mode: 'fill', onlySlots: real.map((n) => ({ dutyId: n.dutyId, start: n.start })), seed: seed() } });
        titles.push({ title: 'Только замена — остальной график не трогаем', kind: 'replace' });
        const horizon = extractNaryads(temp).filter((n) => n.auto && n.start > to).map((n) => n.start).sort().at(-1);
        if (horizon) {
          jobs.push({ project: temp, opts: { from, to: horizon, mode: 'replan', keepExisting: true, variants: 2, seed: seed() } });
          titles.push({ title: `Перестроить график до ${fmtHuman(horizon)}`, kind: 'replan' });
        }
      }
      const results = jobs.length ? await planMany(jobs) : [];
      const groups = results.map((result, i) => ({ ...titles[i], base: temp, result }));
      setPlanState({ title, subtitle: `Снято нарядов: ${removed.length}`, groups, removed, base: temp });
      setPinVar(groups.length && groups[0].result.variants.length ? { gi: 0, vi: 0 } : null);
    } catch (e) {
      toast({ title: 'Не удалось подобрать замену', text: String(e.message || e), kind: 'error' });
    } finally { setComputing(false); }
  };

  const applyVar = (gi, vi) => {
    const g = planState.groups[gi];
    const v = g.result.variants[vi];
    commit(applyVariant(g.base, g.result, v));
    setTab('stats');
    toast({ title: `Применён вариант ${vi + 1}`, text: `Расставлено нарядов: ${v.assignments.length}${v.unfilled.length ? `, пустых мест: ${v.unfilled.length}` : ''}. Отменить — Ctrl+Z`, kind: v.unfilled.length ? 'warn' : 'ok' });
  };

  // ---------- действия с клетками ----------
  const actions = {
    setStatus: (pid, from, to, code) => {
      setMenu(null);
      const st = project.settings.statuses.find((s) => s.code === code);
      const { project: temp, removed } = applyStatus(project, pid, from, to, code);
      if (!removed.length) { commit(temp); return; }
      startReplacement(temp, removed, `${nameOf(pid)}: ${st?.name?.toLowerCase() || code}`);
    },
    clearRange: (pid, from, to) => {
      setMenu(null);
      commit(applyStatus(project, pid, from, to, null).project);
    },
    placeDuty: (pid, d, duty) => {
      setMenu(null);
      const len = naryadLength(duty, d);
      const busy = range(d, addDays(d, len)).filter((x) => project.cells[pid]?.[x]);
      if (busy.length) { toast({ title: 'Клетки заняты', text: `У ${nameOf(pid)} уже есть отметки на ${busy.map(fmtShort).join(', ')}`, kind: 'warn' }); return; }
      const minRest = project.settings.minRest;
      const s = toNum(d), e = s + len;
      const close = naryads.find((n) => {
        if (n.pid !== pid) return false;
        const a = toNum(n.start), b = toNum(n.end);
        const gap = e < a ? a - e - 1 : b < s ? s - b - 1 : -1;
        return gap < minRest;
      });
      commit(setCells(project, naryadCells(pid, duty, d, false)));
      if (close) toast({ title: 'Получилась «вилка»', text: `Между нарядами у ${nameOf(pid)} меньше ${minRest} сут. отдыха`, kind: 'warn' });
    },
    removeWithReplacement: (n) => { setMenu(null); setModal({ type: 'remove', naryad: n }); },
    deleteNaryad: (n) => { setMenu(null); commit(setCells(project, clearNaryadCells(n))); },
    toggleLock: (n) => {
      setMenu(null);
      const changes = n.cellDays.map((d) => {
        const c = project.cells[n.pid][d];
        return { pid: n.pid, d, cell: n.auto ? { c: c.c } : { c: c.c, a: 1 } };
      });
      dispatch({ type: 'set', project: setCells(project, changes) });
      toast(n.auto ? 'Наряд закреплён — перестройка его не тронет' : 'Наряд откреплён');
    },
    setPunishment: (n, value) => {
      setMenu(null);
      const changes = n.cellDays.map((d) => {
        const c = project.cells[n.pid][d];
        return { pid: n.pid, d, cell: value ? { c: c.c, p: 1 } : { c: c.c } };
      });
      dispatch({ type: 'set', project: setCells(project, changes) });
      toast(value ? 'Наряд закреплён как наказание — в общую нагрузку не входит' : 'Отметка наказания снята — наряд остаётся закреплённым');
    },
  };

  // ---------- выделение как в Excel ----------
  const onSelect = useCallback((s, info) => {
    setSel(s);
    setMenu(info.single ? { type: 'cell', pid: info.pid, d: info.d, rect: info.rect } : null);
  }, []);
  const onReorder = useCallback((from, to) => {
    setSel(null);
    setMenu(null);
    dispatch({ type: 'set', project: movePerson(hist.present, from, to) });
  }, [hist.present]);
  // порядок людей с листа «График» выбранного Excel-файла (для кнопки в настройках)
  const pickOrder = async () => {
    try {
      const info = await api.pickXlsx();
      if (!info) return null;
      // порядок нужен для всех призывов — собираем его со всех листов-календарей
      const order = [];
      for (const sh of info.sheets) {
        const d = await api.importXlsx(info.file, sh.name);
        for (const k of d.order || []) if (!order.includes(k)) order.push(k);
      }
      const data = { order };
      if (!data.order?.length) { toast({ title: 'Не нашёл лист «График» с фамилиями', kind: 'warn' }); return null; }
      toast({ title: `Порядок взят с листа «График»: ${data.order.length} чел.`, text: 'Нажмите «Сохранить», чтобы применить', kind: 'ok' });
      return data.order;
    } catch (e) {
      toast({ title: 'Не удалось прочитать файл', text: String(e.message || e), kind: 'error' });
      return null;
    }
  };
  const closeMenu = useCallback(() => { setMenu(null); setSel((s) => (isSingle(s) ? null : s)); }, []);

  // Залить выделенные клетки отметкой (code) или очистить (null).
  // Если под заливку попали наряды — они снимаются и сразу подбирается замена.
  const applyToSelection = (code) => {
    if (!sel || !project) return;
    const st = project.settings.statuses.find((x) => x.code === code);
    let temp = project;
    const removed = [];
    const pids = new Set();
    let cellsN = 0;
    for (const r of sel.ranges) {
      const n = range(r.d0, r.d1).length;
      for (let ri = r.r0; ri <= r.r1; ri++) {
        const pid = project.persons[ri]?.id;
        if (!pid) continue;
        pids.add(pid);
        cellsN += n;
        const res = applyStatus(temp, pid, r.d0, r.d1, code);
        temp = res.project;
        for (const x of res.removed) if (!removed.some((m) => m.id === x.id)) removed.push(x);
      }
    }
    setSel(null);
    setMenu(null);
    if (code && removed.length) { startReplacement(temp, removed, `${st?.name || code}: ${pids.size} чел.`); return; }
    commit(temp);
    toast({
      title: code ? `${st?.name || code}: ${pids.size} чел.` : 'Очищено',
      text: `${code ? 'Отмечено' : 'Очищено'} клеток: ${cellsN}${!code && removed.length ? `, снято нарядов: ${removed.length}` : ''}. Отменить — Ctrl+Z`,
      kind: 'ok',
    });
  };
  const onName = useCallback((pid) => setFocusPid((x) => (x === pid ? null : pid)), []);

  // ---------- импорт / экспорт ----------
  const startImport = async () => {
    try {
      const info = await api.pickXlsx();
      if (!info) return;
      setModal({ type: 'import', info });
    } catch (e) {
      toast({ title: 'Не удалось открыть файл', text: String(e.message || e), kind: 'error' });
    }
  };
  // choices: [{ sheet, name, auto }], mode: 'replace' | 'add'
  const doImport = async (info, choices, mode) => {
    try {
      const list = [];
      for (const c of choices) list.push({ data: await api.importXlsx(info.file, c.sheet), group: { name: c.name, auto: c.auto } });
      const add = mode === 'add' && project?.persons.length;
      const { project: np, report } = importInto(add ? project : null, list);
      const skippedText = Object.entries(report.skipped).map(([c, n]) => `${c} (${n})`).join(', ');
      if (project) commit(np, { animate: !!add }); else dispatch({ type: 'reset', project: np });
      if (!add) {
        const d = list[0].data;
        setMonth(monthKey(d.to < today ? d.to : (d.from > today ? d.from : today)));
      }
      setModal(null);
      toast({
        title: add ? `Добавлено: ${report.added} чел.` : `Загружено: ${np.persons.length} чел.`,
        text: `${report.groups.map((g) => `${g.name} — ${g.added} чел. (${g.auto ? 'авто' : 'вручную'})`).join('; ')}.${report.existed ? ` Уже были в программе: ${report.existed}.` : ''}${skippedText ? ` Пропущены незнакомые отметки: ${skippedText}.` : ''}`,
        kind: 'ok', ttl: 9000,
      });
    } catch (e) {
      toast({ title: 'Ошибка импорта', text: String(e.message || e), kind: 'error', ttl: 9000 });
    }
  };
  const doExport = async (payload, { signatures, title, print }) => {
    const s = project.settings;
    if (JSON.stringify(s.signatures) !== JSON.stringify(signatures) || s.title !== title || JSON.stringify(s.print) !== JSON.stringify(print)) {
      dispatch({ type: 'set', project: { ...project, settings: { ...s, signatures, title, print } } });
    }
    if (!isDesktop) { toast({ title: 'Печать в Word работает в приложении', kind: 'warn' }); return; }
    try {
      const file = await api.exportDocx(payload, `График нарядов ${fmtShort(payload.from)}–${fmtShort(payload.to)}.docx`);
      if (!file) return;
      setModal(null);
      toast({
        title: 'График сохранён', text: file, kind: 'ok', ttl: 10000,
        actions: [{ label: 'Открыть в Word', onClick: () => api.openPath(file) }, { label: 'Показать в папке', onClick: () => api.showInFolder(file) }],
      });
    } catch (e) {
      toast({ title: 'Не удалось сохранить документ', text: `${e.message || e}. Если файл открыт в Word — закройте его.`, kind: 'error', ttl: 9000 });
    }
  };
  const openProject = async () => {
    const p = await api.openProject();
    if (p) { commit(normalizeProject(p), { animate: false }); toast({ title: 'Проект открыт', kind: 'ok' }); }
  };
  const saveCopy = async () => {
    const file = await api.saveProjectAs(project);
    if (file) toast({ title: 'Копия сохранена', text: file, kind: 'ok' });
  };

  const goMonth = (delta) => {
    setMenu(null);
    setSel(null);
    setMonthDir(delta);
    startTransition(() => setMonth((m) => shiftMonth(m, delta)));
  };

  keysRef.current = { sel, menu, modal, applyToSelection, statuses: project?.settings.statuses || [], days, n: project?.persons.length || 0 };
  useEffect(() => {
    const onKey = (e) => {
      const c = keysRef.current;
      if (e.target.closest?.('input, textarea') || c.modal) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 'a' || k === 'ф')) {
        if (!c.n) return;
        e.preventDefault();
        setMenu(null);
        setSel({ ranges: [{ r0: 0, r1: c.n - 1, d0: c.days[0], d1: c.days.at(-1) }], anchor: { ri: 0, d: c.days[0] }, kind: 'cell' });
        return;
      }
      if (!c.sel || c.menu || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Escape') { setSel(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); c.applyToSelection(null); return; }
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < c.statuses.length) { e.preventDefault(); c.applyToSelection(c.statuses[i].code); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return <div className="app"><Aurora /></div>;

  if (!project) {
    return (
      <div className="app">
        <Aurora />
        <div className="titlebar"><Brand /></div>
        <Welcome onImport={startImport} onOpen={openProject} onNew={() => dispatch({ type: 'reset', project: emptyProject() })} />
        <ImportModal open={modal?.type === 'import'} info={modal?.info} project={null} onClose={() => setModal(null)} onImport={(choices, mode) => doImport(modal.info, choices, mode)} />
        <Toasts items={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  const display = preview?.project || project;

  return (
    <div className="app">
      <Aurora />
      <motion.header className="titlebar" initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={softSpring}>
        <Brand />
        <div className="month-nav no-drag">
          <IconButton icon={ChevronLeft} title="Предыдущий месяц" onClick={() => goMonth(-1)} />
          <div className="month-title">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={month} initial={{ y: monthDir >= 0 ? 18 : -18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: monthDir >= 0 ? -18 : 18, opacity: 0 }} transition={softSpring}>
                {monthTitle(month)}
              </motion.span>
            </AnimatePresence>
          </div>
          <IconButton icon={ChevronRight} title="Следующий месяц" onClick={() => goMonth(1)} />
          {monthKey(today) !== month && <Button size="sm" icon={CalendarCheck} onClick={() => { setSel(null); setMonthDir(monthKey(today) > month ? 1 : -1); startTransition(() => setMonth(monthKey(today))); }}>Сегодня</Button>}
        </div>
        <div className="tb-actions no-drag">
          <IconButton icon={Undo2} title="Отменить (Ctrl+Z)" disabled={!hist.past.length} onClick={() => { dispatch({ type: 'undo' }); closePlan(); }} />
          <IconButton icon={Redo2} title="Вернуть (Ctrl+Y)" disabled={!hist.future.length} onClick={() => { dispatch({ type: 'redo' }); closePlan(); }} />
          <span className="tb-sep" />
          <IconButton icon={FolderOpen} title="Открыть проект" onClick={openProject} />
          <IconButton icon={Save} title="Сохранить копию проекта" onClick={saveCopy} />
          <Button icon={FileSpreadsheet} onClick={startImport}>Импорт</Button>
          <Button icon={Printer} onClick={() => setModal({ type: 'export' })}>Печать</Button>
          <IconButton icon={Settings2} title="Настройки" onClick={() => setModal({ type: 'settings' })} />
          <Button variant="primary" icon={WandSparkles} onClick={() => setTab('plan')}>Распределить</Button>
        </div>
      </motion.header>

      <main className="workspace">
        <motion.section className="grid-panel glass" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...softSpring, delay: 0.05 }}>
          {project.persons.length === 0 ? (
            <div className="empty-grid">
              <p>В графике пока никого нет.</p>
              <div className="empty-actions">
                <Button variant="primary" icon={FileSpreadsheet} onClick={startImport}>Импорт из Excel</Button>
                <Button icon={Plus} onClick={() => setModal({ type: 'settings' })}>Добавить людей вручную</Button>
              </div>
            </div>
          ) : (
            <motion.div
                key={month}
                className="grid-anim"
                initial={monthDir ? { x: monthDir * 50, opacity: 0 } : false}
                animate={{ x: 0, opacity: 1 }}
                transition={softSpring}
              >
                <Grid
                  project={project}
                  display={display}
                  diff={preview?.diff}
                  days={days}
                  loads={loads}
                  naryadMap={naryadMap}
                  flash={flash}
                  focusPid={focusPid}
                  selection={sel}
                  today={today}
                  onSelect={onSelect}
                  onReorder={onReorder}
                  onName={onName}
                />
              </motion.div>
          )}
          <Legend settings={project.settings} previewing={!!preview} />
          <AnimatePresence>
            {sel && !menu && !isSingle(sel) && !computing && (
              <SelectionBar key="selbar" sel={sel} statuses={project.settings.statuses} onApply={applyToSelection} onClose={() => setSel(null)} />
            )}
            {computing && (
              <motion.div className="computing" initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.9 }}>
                <span className="spinner" />Подбираю варианты…
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        <SidePanel
          tab={tab}
          setTab={setTab}
          project={project}
          loads={loads}
          naryads={naryads}
          days={days}
          today={today}
          focusPid={focusPid}
          onFocus={onName}
          planState={planState}
          computing={computing}
          activeVar={activeVar}
          pinVar={pinVar}
          onHover={setHoverVar}
          onPin={setPinVar}
          onApply={applyVar}
          onClosePlan={closePlan}
          onRun={runDistribute}
          onLeaveEmpty={() => commit(planState.base)}
        />
      </main>

      <AnimatePresence>
        {menu && <CellMenu key={`${menu.pid}${menu.d || menu.from}${menu.to || ''}`} menu={menu} project={project} naryadMap={naryadMap} onClose={closeMenu} actions={actions} />}
      </AnimatePresence>

      <RemoveModal
        open={modal?.type === 'remove'}
        naryad={modal?.naryad}
        project={project}
        onClose={() => setModal(null)}
        onConfirm={({ code, from, to }) => {
          const n = modal.naryad;
          setModal(null);
          const { project: temp, removed } = applyStatus(project, n.pid, from, to, code);
          if (!removed.some((r) => r.id === n.id)) removed.push(n);
          const cleaned = setCells(temp, n.cellDays.filter((d) => d < from || d > to).map((d) => ({ pid: n.pid, d, cell: null })));
          startReplacement(cleaned, removed, `${nameOf(n.pid)}: замена`);
        }}
      />
      <ImportModal open={modal?.type === 'import'} info={modal?.info} project={project} onClose={() => setModal(null)} onImport={(choices, mode) => doImport(modal.info, choices, mode)} />
      <ExportModal open={modal?.type === 'export'} project={project} month={month} today={today} onClose={() => setModal(null)} onExport={doExport} />
      <SettingsModal open={modal?.type === 'settings'} project={project} onPickOrder={pickOrder} onClose={() => setModal(null)} onSave={(p) => { commit(normalizeProject(p), { animate: false }); setModal(null); toast({ title: 'Настройки сохранены', kind: 'ok' }); }} />
      <Toasts items={toasts} onDismiss={dismiss} />
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark"><span>Н</span></div>
      <div className="brand-text">НАРЯДЫ</div>
      <div className="brand-ver" title="Версия программы">v{__APP_VERSION__}</div>
    </div>
  );
}

function Aurora() {
  return (
    <div className="aurora" aria-hidden />
  );
}

function Legend({ settings, previewing }) {
  return (
    <div className="legend">
      {settings.duties.map((d) => (
        <span key={d.id} className="lg-item">
          <i className="chip chip-prep mini" style={{ '--c': d.color }}><span className="lbl">ЗН</span></i>
          <i className="chip chip-duty mini" style={{ '--c': d.color }}><span className="lbl">{d.code}</span></i>
          {d.name}
        </span>
      ))}
      {settings.statuses.map((s) => (
        <span key={s.code} className="lg-item"><i className="chip chip-status mini" style={{ '--c': s.color }}><span className="lbl">{s.code}</span></i>{s.name}</span>
      ))}
      <span className="lg-spacer" />
      {previewing
        ? <span className="lg-hint preview">Пунктир — так будет после применения варианта</span>
        : <span className="lg-hint"><MousePointerClick size={13} />клик — меню <Move size={13} />протянуть, № или дата — выделить <span className="kbd">Shift</span><span className="kbd">Ctrl</span> как в Excel <span className="kbd">Ctrl+Z</span> отменить</span>}
    </div>
  );
}

function Welcome({ onImport, onOpen, onNew }) {
  return (
    <div className="welcome">
      <motion.div className="welcome-card glass" initial={{ opacity: 0, y: 40, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 22 }}>
        <motion.div className="welcome-mark" initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.15 }}>
          <span>Н</span>
        </motion.div>
        <h1>Наряды</h1>
        <div className="welcome-ver">версия {__APP_VERSION__}</div>
        <p>Честное распределение нарядов роты: учёт нагрузки, замены в один клик и печать графика в Word.</p>
        <div className="welcome-actions">
          <Button variant="primary" size="lg" icon={FileSpreadsheet} onClick={onImport}>Загрузить график из Excel</Button>
          <Button size="lg" icon={FolderOpen} onClick={onOpen}>Открыть проект</Button>
        </div>
        <button className="link" onClick={onNew}>Начать с пустого графика</button>
      </motion.div>
    </div>
  );
}
