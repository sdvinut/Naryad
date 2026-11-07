import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { codeIndex, coverage } from '../lib/model.js';
import { DOW_SHORT, dow, isWeekend } from '../lib/dates.js';
import { GripVertical, Hand, Zap } from 'lucide-react';
import { CountUp } from './ui.jsx';

// Клетки — обычные div с CSS-анимацией появления (класс pop): так таблица из сотен фишек
// не нагружает JavaScript и анимируется силами видеокарты.
//
// Выделение как в Excel: прямоугольники { r0, r1, d0, d1 } (номера строк и даты).
// Протянуть — прямоугольник, Shift — расширить от якоря, Ctrl — добавить ещё один,
// клик по № — вся строка месяца, клик по дате — весь столбец.

function chipView(idx, code) {
  if (!code) return null;
  const info = idx.get(code);
  if (!info) return { kind: 'status', color: '#94a3b8', top: null, label: code };
  if (info.kind === 'status') return { kind: 'status', color: info.status.color, top: null, label: code };
  if (info.kind === 'prep') return { kind: 'prep', color: info.duty.color, top: 'ЗН', label: info.duty.code };
  return { kind: 'duty', color: info.duty.color, top: null, label: code };
}

function Chip({ v, cls, delay }) {
  return (
    <div
      className={`chip chip-${v.kind}${v.label.length > 2 ? ' long' : ''}${cls}`}
      style={delay ? { '--c': v.color, '--d': `${delay}s` } : { '--c': v.color }}
    >
      {v.top && <span className="zn">{v.top}</span>}
      <span className="lbl">{v.label}</span>
    </div>
  );
}

// sel — флаги выделения клетки: '' не выделена, иначе 'x' + края t/b/l/r
const Cell = memo(function Cell({ k, d, code, auto, punishment, ghost, gone, pop, delay, we, today, sel, linked, idx }) {
  const v = chipView(idx, code);
  const g = !v && gone ? chipView(idx, gone) : null;
  let cls = 'cell';
  if (we) cls += ' we';
  if (today) cls += ' today';
  if (sel) {
    cls += ' sel';
    if (sel.includes('t')) cls += ' sel-t';
    if (sel.includes('b')) cls += ' sel-b';
    if (sel.includes('l')) cls += ' sel-l';
    if (sel.includes('r')) cls += ' sel-r';
  }
  if (linked) cls += ' linked';
  return (
    <div className={cls} data-k={k} data-d={d}>
      {v && <Chip key={`${code}${ghost ? '~' : ''}`} v={v} cls={`${ghost ? ' ghost' : ''}${auto ? ' auto' : ''}${punishment ? ' punishment' : ''}${pop || ghost ? ' pop' : ''}`} delay={pop || ghost ? delay : 0} />}
      {g && <Chip key={`gone-${gone}`} v={g} cls=" gone" delay={0} />}
    </div>
  );
});

// rowSel — строка вида "d0~d1~tb;d0~d1~" для прямоугольников, задевающих эту строку (строка, чтобы memo не сбрасывался)
function cellSel(rowSel, d) {
  if (!rowSel) return '';
  let f = '';
  for (const part of rowSel.split(';')) {
    const [d0, d1, tb] = part.split('~');
    if (d < d0 || d > d1) continue;
    f += `x${tb}${d === d0 ? 'l' : ''}${d === d1 ? 'r' : ''}`;
  }
  return f;
}

const Row = memo(function Row({ p, ri, num, manual, L, tone, row, curRow, days, idx, diff, flashKeys, today, focus, rowSel, hoverId, naryadMap, onName, shift, dragging }) {
  return (
    <div
      className={`row${focus ? ' focus' : ''}${p.active === false ? ' inactive' : ''}${rowSel ? ' has-sel' : ''}${dragging ? ' dragging' : ''}${manual ? ' manual' : ''}`}
      data-ri={ri}
      style={shift ? { transform: `translateY(${shift}px)` } : undefined}
    >
      <div className="c sticky s0 num" title="Выделить всю строку">{num}</div>
      <div className="c sticky s1 name" onClick={(e) => { if (!e.target.closest('.grip')) onName(p.id); }} title={p.name}>
        <span className="grip" title="Потяните, чтобы переставить"><GripVertical size={14} /></span>
        <span className="nm">{p.name}</span>
        {p.role === 'dj' && <span className="role-tag" title="Дежурный">деж</span>}
      </div>
      <div className={`c sticky s2 load ${tone}`}><CountUp value={L} /></div>
      {days.map((d, ci) => {
        const k = `${p.id}|${d}`;
        const cell = row[d];
        const changed = !!diff?.has(k);
        const flashed = !!flashKeys?.has(k);
        return (
          <Cell
            key={d}
            k={k}
            d={d}
            idx={idx}
            code={cell?.c || null}
            auto={!!cell?.a}
            punishment={!!cell?.p}
            ghost={changed && !!cell}
            gone={changed && !cell ? curRow[d]?.c : null}
            pop={flashed}
            delay={flashed || changed ? Math.min(0.9, ci * 0.014 + ri * 0.022) : 0}
            we={isWeekend(d)}
            today={d === today}
            sel={cellSel(rowSel, d)}
            linked={!!hoverId && naryadMap.get(k)?.id === hoverId}
          />
        );
      })}
    </div>
  );
});

// строка-заголовок призыва: «24 призыв · 24 чел. · авто» / «23 призыв · вручную»
const GroupRow = memo(function GroupRow({ g, count, days }) {
  return (
    <div className={`row group-row${g.auto ? '' : ' manual'}`}>
      <div className="c sticky s0 gr-head">
        <span className="gr-name">{g.name}</span>
        <span className="gr-count">{count} чел.</span>
        {g.auto
          ? <span className="gr-badge auto" title="Программа распределяет этот призыв сама"><Zap size={11} />авто</span>
          : <span className="gr-badge manual" title="Этот призыв распределяется только вручную"><Hand size={11} />вручную</span>}
      </div>
      <div className="gr-fill" style={{ gridColumn: `4 / span ${days}` }} />
    </div>
  );
});

const norm = (a, b) => ({ r0: Math.min(a.ri, b.ri), r1: Math.max(a.ri, b.ri), d0: a.d < b.d ? a.d : b.d, d1: a.d < b.d ? b.d : a.d });

function Grid({ project, display, diff, days, loads, naryadMap, flash, focusPid, selection, today, onSelect, onName, onReorder }) {
  const settings = display.settings;
  const idx = useMemo(() => codeIndex(settings), [settings]);
  const cov = useMemo(() => coverage(display, days), [display, days]);
  const drag = useRef(null);
  const [dragSel, setDragSel] = useState(null);
  const [hover, setHover] = useState(null); // {id, pid} наряда под курсором
  const scrollRef = useRef(null);
  const [move, setMove] = useState(null); // перетаскивание строки: { from, to, dy, rowH }

  // перетаскивание строки за «ручку»: строка едет за мышью, остальные расступаются
  const startMove = (e, ri) => {
    const scroller = scrollRef.current;
    const rowEl = e.target.closest('.row');
    const rowH = rowEl.offsetHeight;
    const st = { from: ri, to: ri, dy: 0, rowH, y0: e.clientY, s0: scroller.scrollTop };
    setMove(st);
    const onMove = (ev) => {
      const box = scroller.getBoundingClientRect();
      if (ev.clientY > box.bottom - 40) scroller.scrollTop += 12;
      else if (ev.clientY < box.top + 90) scroller.scrollTop -= 12;
      const dy = ev.clientY - st.y0 + (scroller.scrollTop - st.s0);
      const lim = layout[st.from];
      const to = Math.max(lim.start, Math.min(lim.end, st.from + Math.round(dy / rowH)));
      setMove({ ...st, dy, to });
      st.to = to;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMove(null);
      if (st.to !== st.from) onReorder(st.from, st.to);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const shiftOf = (i) => {
    if (!move) return 0;
    if (i === move.from) return move.dy;
    if (move.from < move.to && i > move.from && i <= move.to) return -move.rowH;
    if (move.to < move.from && i >= move.to && i < move.from) return move.rowH;
    return 0;
  };
  const lastRow = project.persons.length - 1;

  const groups = project.settings.groups;
  const groupById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const avgByGroup = useMemo(() => {
    const out = {};
    for (const g of groups) {
      const act = project.persons.filter((p) => p.group === g.id && p.active !== false);
      out[g.id] = act.length ? act.reduce((s, p) => s + (loads[p.id]?.total || 0), 0) / act.length : 0;
    }
    return out;
  }, [groups, project.persons, loads]);
  // номер внутри призыва и границы призыва для каждой строки
  const layout = useMemo(() => {
    const out = [];
    let start = 0;
    project.persons.forEach((p, i) => {
      if (i > 0 && project.persons[i - 1].group !== p.group) start = i;
      out.push({ num: i - start + 1, start, first: i === start });
    });
    for (let i = out.length - 1, end = out.length - 1; i >= 0; i--) { out[i].end = end; if (out[i].first) end = i - 1; }
    return out;
  }, [project.persons]);

  // текущий прямоугольник протягивания с учётом режима (клетки / строки / столбцы)
  const dragRanges = (g) => {
    let a = g.anchor, b = g.focus;
    if (g.kind === 'row') { a = { ri: a.ri, d: days[0] }; b = { ri: b.ri, d: days.at(-1) }; }
    if (g.kind === 'col') { a = { ri: 0, d: a.d }; b = { ri: lastRow, d: b.d }; }
    return { ranges: [...g.base, norm(a, b)], anchor: g.anchor, kind: g.kind };
  };

  useEffect(() => {
    const up = () => {
      const g = drag.current;
      if (!g) return;
      drag.current = null;
      setDragSel(null);
      const sel = dragRanges(g);
      const single = g.kind === 'cell' && !g.moved && !g.shift && !g.base.length;
      onSelect(sel, { single, rect: g.el.getBoundingClientRect(), pid: project.persons[g.focus.ri]?.id, d: g.focus.d });
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }); // обработчик видит свежие days/persons

  // прокрутка к сегодняшнему дню при смене месяца
  useEffect(() => {
    const el = scrollRef.current?.querySelector('.hcell.today');
    if (el && scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, el.offsetLeft - 320);
    else if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [days[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  // что под курсором: клетка, номер строки или заголовок дня
  const hit = (e) => {
    const t = e.target;
    const cell = t.closest?.('.cell');
    if (cell) return { kind: 'cell', el: cell, ri: Number(cell.parentElement.dataset.ri), d: cell.dataset.d };
    const num = t.closest?.('.c.num');
    if (num) return { kind: 'row', el: num, ri: Number(num.parentElement.dataset.ri), d: days[0] };
    const head = t.closest?.('.hcell');
    if (head) return { kind: 'col', el: head, ri: 0, d: head.dataset.d };
    return null;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const grip = e.target.closest?.('.grip');
    if (grip) {
      e.preventDefault();
      startMove(e, Number(grip.closest('.row').dataset.ri));
      return;
    }
    const h = hit(e);
    if (!h) return;
    e.preventDefault();
    const add = e.ctrlKey || e.metaKey;
    const base = add && selection ? selection.ranges : [];
    const extend = e.shiftKey && selection?.anchor && selection.kind === h.kind;
    const anchor = extend ? selection.anchor : { ri: h.ri, d: h.d };
    const g = { kind: h.kind, anchor, focus: { ri: h.ri, d: h.d }, base: extend ? selection.ranges.slice(0, -1) : base, moved: false, shift: !!extend, el: h.el };
    drag.current = g;
    setDragSel(dragRanges(g));
  };

  const onPointerOver = (e) => {
    const h = hit(e);
    const n = h?.kind === 'cell' ? naryadMap.get(h.el.dataset.k) : null;
    setHover((x) => ((x?.id || null) === (n?.id || null) ? x : n ? { id: n.id, pid: n.pid } : null));
    const g = drag.current;
    if (!g || !h) return;
    const focus = g.kind === 'row' ? { ri: h.ri, d: g.focus.d } : g.kind === 'col' ? { ri: g.focus.ri, d: h.d } : { ri: h.kind === 'col' ? g.focus.ri : h.ri, d: h.d };
    if (focus.ri === g.focus.ri && focus.d === g.focus.d) return;
    g.focus = focus; g.moved = true; g.el = h.el;
    setDragSel(dragRanges(g));
  };

  const shown = dragSel || selection;
  const rowSels = useMemo(() => {
    const out = new Array(project.persons.length).fill('');
    if (!shown) return out;
    for (const r of shown.ranges) {
      for (let ri = r.r0; ri <= r.r1 && ri < out.length; ri++) {
        const part = `${r.d0}~${r.d1}~${ri === r.r0 ? 't' : ''}${ri === r.r1 ? 'b' : ''}`;
        out[ri] = out[ri] ? `${out[ri]};${part}` : part;
      }
    }
    return out;
  }, [shown, project.persons.length]);
  const selCols = useMemo(() => {
    const s = new Set();
    if (shown) for (const r of shown.ranges) if (r.r0 === 0 && r.r1 === lastRow) for (const d of days) if (d >= r.d0 && d <= r.d1) s.add(d);
    return s;
  }, [shown, days, lastRow]);

  const cols = `40px 196px 54px repeat(${days.length}, var(--cell-w))`;

  return (
    <div className="grid-scroll" ref={scrollRef} onPointerDown={onPointerDown} onPointerOver={onPointerOver} onPointerLeave={() => setHover(null)}>
      <div className={`grid${move ? ' reordering' : ''}`} style={{ '--cols': cols }}>
        <div className="row head">
          <div className="hc sticky s0">№</div>
          <div className="hc sticky s1 left">Фамилия И.О.</div>
          <div className="hc sticky s2" title="Всего нарядов, с учётом прошлых месяцев">Σ</div>
          {days.map((d) => (
            <div key={d} data-d={d} title="Выделить весь день" className={`hcell${isWeekend(d) ? ' we' : ''}${d === today ? ' today' : ''}${selCols.has(d) ? ' sel' : ''}`}>
              <div className="h-date">{Number(d.slice(8))}</div>
              <div className="h-dow">{DOW_SHORT[dow(d)]}</div>
              <div className="h-cov">
                {settings.duties.map((duty) => {
                  const c = cov[d][duty.id];
                  const empty = c.on === 0 && c.prep === 0;
                  const rule = duty.djMin === duty.djMax ? `нужно дежурных: ${duty.djMin}` : `дежурных не больше ${duty.djMax}`;
                  return (
                    <span
                      key={duty.id}
                      className={`pip ${c.ok ? 'ok' : empty ? 'empty' : 'bad'}${d < today ? ' past' : ''}`}
                      style={{ '--c': duty.color }}
                      title={`${duty.name}: в наряде ${c.on} из ${c.needOn} (дежурных ${c.onDj}), заступает ${c.prep} из ${c.needPrep} (дежурных ${c.prepDj}); ${rule}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {project.persons.map((p, ri) => {
          const L = loads[p.id]?.total ?? 0;
          const g = groupById[p.group];
          const avg = avgByGroup[p.group] ?? 0;
          const lay = layout[ri];
          return (
            <Fragment key={p.id}>
            {lay.first && g && <GroupRow g={g} count={lay.end - lay.start + 1} days={days.length} />}
            <Row
              p={p}
              ri={ri}
              num={lay.num}
              manual={g?.auto === false}
              L={L}
              tone={g?.auto === false ? 'mid' : L < avg - 0.75 ? 'low' : L > avg + 0.75 ? 'high' : 'mid'}
              row={display.cells[p.id] || EMPTY}
              curRow={project.cells[p.id] || EMPTY}
              days={days}
              idx={idx}
              diff={diff}
              flashKeys={flash?.keys}
              today={today}
              focus={focusPid === p.id}
              rowSel={rowSels[ri]}
              hoverId={hover?.pid === p.id ? hover.id : null}
              naryadMap={naryadMap}
              onName={onName}
              shift={shiftOf(ri)}
              dragging={move?.from === ri}
            />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

const EMPTY = {};

export default memo(Grid);
