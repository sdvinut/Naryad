import { memo, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Users, WandSparkles, X, Check, TriangleAlert, Sparkles, ShieldCheck, Timer, Scale, Repeat, ArrowRight, Info, Hand, Zap } from 'lucide-react';
import { Button, CountUp, Segmented, Toggle, Field, spring, softSpring } from './ui.jsx';
import { fmtShort, fmtHuman } from '../lib/dates.js';

export default function SidePanel(props) {
  const { tab, setTab, planState } = props;
  const nVariants = planState ? planState.groups.reduce((s, g) => s + g.result.variants.length, 0) : 0;
  return (
    <motion.aside className="side glass" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ ...softSpring, delay: 0.15 }}>
      <div className="side-tabs">
        {[
          { id: 'stats', label: 'Нагрузка', icon: Users },
          { id: 'plan', label: 'Распределение', icon: WandSparkles, badge: nVariants },
        ].map((t) => (
          <button key={t.id} className={`side-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {tab === t.id && <motion.span layoutId="side-tab-pill" className="side-tab-pill" transition={spring} />}
            <span className="side-tab-label"><t.icon size={15} />{t.label}</span>
            <AnimatePresence>{t.badge > 0 && <motion.span className="badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>{t.badge}</motion.span>}</AnimatePresence>
          </button>
        ))}
      </div>
      <div className="side-body">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} className="side-page" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
            {tab === 'stats'
              ? <StatsPanel project={props.project} loads={props.loads} naryads={props.naryads} days={props.days} focusPid={props.focusPid} onFocus={props.onFocus} />
              : <PlanPanel {...props} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}

// ---------------- нагрузка ----------------

const StatsPanel = memo(function StatsPanel({ project, loads, naryads, days, focusPid, onFocus }) {
  const [sort, setSort] = useState('load');
  const { duties, groups } = project.settings;
  // по каждому призыву — свой список; цифры сверху считаются только по призывам с автораспределением
  const blocks = useMemo(() => groups.map((g) => {
    const list = project.persons.filter((p) => p.group === g.id && p.active !== false).map((p) => {
      const L = loads[p.id];
      const carry = duties.reduce((s, d) => s + (L.carry[d.id] || 0), 0);
      const inTable = duties.map((d) => ({ duty: d, n: (L.byDuty[d.id] || 0) - (L.carry[d.id] || 0) }));
      return { p, total: L.total, carry, inTable, weekend: L.weekend };
    });
    list.sort(sort === 'load' ? (x, y) => x.total - y.total || x.p.name.localeCompare(y.p.name) : (x, y) => x.p.name.localeCompare(y.p.name));
    const totals = list.map((r) => r.total);
    return { g, list, avg: totals.length ? totals.reduce((x, y) => x + y, 0) / totals.length : 0 };
  }).filter((b) => b.list.length), [groups, project.persons, loads, duties, sort]);

  const autoTotals = blocks.filter((b) => b.g.auto !== false).flatMap((b) => b.list.map((r) => r.total));
  const max = Math.max(1, ...blocks.flatMap((b) => b.list.map((r) => r.total)));
  const avg = autoTotals.length ? autoTotals.reduce((x, y) => x + y, 0) / autoTotals.length : 0;
  const spread = autoTotals.length ? Math.max(...autoTotals) - Math.min(...autoTotals) : 0;
  const autoSet = useMemo(() => new Set(project.persons.filter((p) => groups.find((g) => g.id === p.group)?.auto !== false).map((p) => p.id)), [project.persons, groups]);
  const inMonth = naryads.filter((n) => !n.punishment && autoSet.has(n.pid) && n.start >= days[0] && n.start <= days.at(-1)).length;

  return (
    <div className="stats">
      <div className="kpis">
        <div className="kpi"><span>Среднее</span><b><CountUp value={avg} decimals={1} /></b></div>
        <div className={`kpi ${spread > 2 ? 'warn' : ''}`}><span>Разброс</span><b><CountUp value={spread} /></b></div>
        <div className="kpi"><span>За месяц</span><b><CountUp value={inMonth} /></b></div>
      </div>
      <div className="stats-head">
        <div className="legend-mini">
          <span><i className="sw carry" />прошлые</span>
          {duties.map((d) => <span key={d.id}><i className="sw" style={{ background: d.color }} />{d.code}</span>)}
        </div>
        <Segmented layoutId="stats-sort" value={sort} onChange={setSort} options={[{ value: 'load', label: 'по нагрузке' }, { value: 'name', label: 'А–Я' }]} />
      </div>
      {blocks.map(({ g, list, avg: gAvg }) => (
        <div key={g.id} className="stat-block">
          {blocks.length > 1 && (
            <div className={`stat-group ${g.auto === false ? 'manual' : ''}`}>
              <span>{g.name}</span>
              {g.auto === false ? <span className="gr-badge manual"><Hand size={11} />вручную</span> : <span className="gr-badge auto"><Zap size={11} />авто</span>}
            </div>
          )}
          <div className="stat-list">
            {list.map((r, i) => (
              <motion.button
                layout
                transition={softSpring}
                key={r.p.id}
                className={`stat-row ${focusPid === r.p.id ? 'on' : ''} ${g.auto !== false && r.total <= gAvg - 1.5 ? 'behind' : ''}`}
                onClick={() => onFocus(r.p.id)}
              >
                <span className="sr-rank">{i + 1}</span>
                <span className="sr-name" title={r.p.role === 'dj' ? 'Дежурный' : 'Дневальный'}>{r.p.name}</span>
                <span className="sr-bar">
                  <i className="bseg carry" style={{ width: `${(r.carry / max) * 100}%` }} />
                  {r.inTable.map(({ duty, n }) => (
                    <i key={duty.id} className="bseg" style={{ background: duty.color, width: `${(Math.max(0, n) / max) * 100}%` }} />
                  ))}
                </span>
                <span className="sr-num"><CountUp value={r.total} /></span>
              </motion.button>
            ))}
          </div>
        </div>
      ))}
      <div className="stats-note"><Info size={13} />Сверху — у кого меньше всего нарядов. Программа ставит их первыми; призывы «вручную» она не распределяет и в цифры наверху не считает.</div>
    </div>
  );
});

// ---------------- распределение ----------------

function PlanPanel({ project, days, today, planState, computing, activeVar, pinVar, onHover, onPin, onApply, onClosePlan, onRun, onLeaveEmpty }) {
  if (planState) {
    return (
      <div className="plan">
        <div className="plan-head">
          <div>
            <div className="plan-title">{planState.title}</div>
            {planState.subtitle && <div className="plan-sub">{planState.subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClosePlan} title="Отменить"><X size={17} /></button>
        </div>
        <div className="variants">
          {planState.groups.map((g, gi) => (
            <div key={gi} className="v-group">
              {planState.groups.length > 1 && <div className="v-group-title">{g.title}</div>}
              {g.result.variants.length === 0 && <div className="empty-note">Вариантов нет — некого поставить.</div>}
              {g.result.variants.map((v, vi) => (
                <VariantCard
                  key={`${gi}-${vi}`}
                  index={vi}
                  delay={(gi * 3 + vi) * 0.07}
                  group={g}
                  variant={v}
                  project={project}
                  best={gi === 0 && vi === 0}
                  active={activeVar?.gi === gi && activeVar?.vi === vi}
                  pinned={pinVar?.gi === gi && pinVar?.vi === vi}
                  onHover={(on) => onHover(on ? { gi, vi } : null)}
                  onPin={() => onPin({ gi, vi })}
                  onApply={() => onApply(gi, vi)}
                />
              ))}
            </div>
          ))}
        </div>
        {planState.removed && (
          <button className="leave-empty" onClick={onLeaveEmpty}>Снять без замены — оставить место пустым</button>
        )}
        <div className="plan-hint"><Info size={13} />Наведите на вариант — он появится в таблице пунктиром.</div>
      </div>
    );
  }
  return <PlanForm project={project} days={days} today={today} computing={computing} onRun={onRun} />;
}

// сколько дежурных и дневальных в призывах с автораспределением
function RolesInfo({ project }) {
  const auto = new Set(project.settings.groups.filter((g) => g.auto !== false).map((g) => g.id));
  const people = project.persons.filter((p) => auto.has(p.group) && p.active !== false);
  const dj = people.filter((p) => p.role === 'dj').length;
  const need = project.settings.duties.reduce((s, d) => s + (d.djMin || 0), 0);
  if (dj >= Math.max(1, need) * 3) return <div className="roles-info">Дежурных: <b>{dj}</b> · дневальных: <b>{people.length - dj}</b></div>;
  return (
    <div className="roles-info warn">
      <TriangleAlert size={15} />
      <span>{dj ? `Дежурных всего ${dj} — их не хватит на каждый день.` : 'Дежурные не отмечены.'} Отметьте их в «Настройки → Люди», столбец «Роль».</span>
    </div>
  );
}

function PlanForm({ project, days, today, computing, onRun }) {
  const defFrom = today >= days[0] && today <= days.at(-1) ? today : days[0];
  const [from, setFrom] = useState(defFrom);
  const [to, setTo] = useState(days.at(-1));
  const [mode, setMode] = useState('replan');
  const [keep, setKeep] = useState(false);
  useEffect(() => { setFrom(defFrom); setTo(days.at(-1)); }, [days[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  const { minRest } = project.settings;
  const valid = from && to && from <= to;
  return (
    <div className="plan-form">
      <div className="hero-card">
        <div className="hero-glow" />
        <Sparkles size={22} />
        <div>
          <div className="hero-title">Честное распределение</div>
          <div className="hero-text">Программа расставит наряды на период и предложит несколько вариантов на выбор.</div>
        </div>
      </div>

      <div className="form-grid">
        <Field label="Заступления с"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="по"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>

      <Field label="Что делать с уже расставленным">
        <Segmented
          layoutId="plan-mode"
          value={mode}
          onChange={setMode}
          options={[{ value: 'replan', label: 'Расставить заново', icon: Repeat }, { value: 'fill', label: 'Только пустые места', icon: Check }]}
        />
      </Field>
      {mode === 'replan' && (
        <Toggle checked={keep} onChange={setKeep} label="Менять как можно меньше" hint="Оставить наряды у тех, у кого они уже стоят, если это не портит честность" />
      )}

      <RolesInfo project={project} />
      <ul className="rules">
        <li><ShieldCheck size={15} />Закреплённые и импортированные наряды не трогаются</li>
        {project.settings.groups.some((g) => g.auto === false) && (
          <li><Hand size={15} />Распределяются только призывы «авто»: {project.settings.groups.filter((g) => g.auto !== false).map((g) => g.name).join(', ')}</li>
        )}
        <li><Scale size={15} />У кого меньше нарядов (с учётом прошлых месяцев) — идёт первым</li>
        <li><Timer size={15} />Без «вилок»: минимум {minRest} сут. отдыха между нарядами</li>
        <li><Users size={15} />Ротный наряд — 1 дежурный и 2 дневальных, в технопарке не больше одного дежурного</li>
      </ul>

      <motion.button
        className={`run-btn ${computing ? 'busy' : ''}`}
        disabled={!valid || computing}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => onRun({ from, to, mode, keepExisting: mode === 'replan' && keep })}
      >
        <span className="run-shine" />
        {computing ? <span className="spinner" /> : <WandSparkles size={18} />}
        <span>{computing ? 'Подбираю варианты…' : 'Подобрать варианты'}</span>
      </motion.button>
      {!valid && <div className="form-error">Дата «с» должна быть не позже даты «по»</div>}
    </div>
  );
}

function VariantCard({ index, delay, group, variant, project, best, active, pinned, onHover, onPin, onApply }) {
  const m = variant.metrics;
  const nameOf = (pid) => project.persons.find((p) => p.id === pid)?.name || '?';
  const dutyOf = (id) => project.settings.duties.find((d) => d.id === id);
  const bars = useMemo(() => Object.values(variant.perPerson).map((x) => x.total).sort((a, b) => a - b), [variant]);
  const bmax = Math.max(1, ...bars), bmin = Math.min(...bars);

  return (
    <motion.div
      className={`v-card ${active ? 'active' : ''} ${pinned ? 'pinned' : ''}`}
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { ...softSpring, delay } }}
      whileHover={{ y: -3 }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onPin}
    >
      {pinned && <motion.div layoutId="v-ring" className="v-ring" transition={spring} />}
      <div className="v-head">
        <div className="v-name">Вариант {index + 1}</div>
        {best && <span className="v-best"><Sparkles size={12} />лучший</span>}
      </div>
      <div className="v-metrics">
        {variant.unfilled.length > 0 && <span className="mchip bad"><TriangleAlert size={12} />пусто: {variant.unfilled.length}{variant.unfilled.some((u) => u.role === 'dj') ? ' — не хватает дежурных' : ''}</span>}
        {variant.relaxedCount > 0
          ? <span className="mchip warn"><TriangleAlert size={12} />вилок: {variant.relaxedCount}</span>
          : <span className="mchip ok"><Check size={12} />без вилок</span>}
        {group.kind !== 'replace' && <span className="mchip">разброс {m.spread}</span>}
        {m.minGap != null && <span className="mchip">отдых от {m.minGap} сут.</span>}
        {group.kind === 'replan' && <span className="mchip">изменений {m.changes}</span>}
      </div>
      {group.kind === 'replace' ? (
        <div className="v-list">
          {variant.assignments.map((a) => {
            const d = dutyOf(a.dutyId);
            return (
              <div key={`${a.pid}${a.start}${a.dutyId}`} className="v-assign" style={{ '--c': d.color }}>
                <span className="va-name">{nameOf(a.pid)}</span>
                <ArrowRight size={13} />
                <span className="va-duty">{d.prep} {fmtShort(a.start)}</span>
              </div>
            );
          })}
          {variant.unfilled.map((u) => <div key={`u${u.start}${u.dutyId}`} className="v-assign none">некого поставить на {fmtShort(u.start)}</div>)}
        </div>
      ) : (
        <div className="v-bars" title={`Итоговая нагрузка: от ${bmin} до ${bmax}`}>
          {bars.map((b, i) => (
            <i key={i} style={{ height: `${18 + ((b - bmin) / Math.max(1, bmax - bmin)) * 82}%`, '--d': `${(delay + i * 0.012).toFixed(3)}s` }} />
          ))}
          <span className="v-bars-cap">итог у всех: {bmin === bmax ? bmin : `${bmin}–${bmax}`} нарядов</span>
        </div>
      )}
      <Button variant={pinned ? 'primary' : 'soft'} icon={Check} className="v-apply" onClick={(e) => { e.stopPropagation(); onApply(); }}>Применить</Button>
    </motion.div>
  );
}
