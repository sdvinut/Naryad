import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { UserMinus, Trash2, Lock, LockOpen, Eraser, CalendarRange, Plus, Gavel } from 'lucide-react';
import { codeIndex, naryadLength } from '../lib/model.js';
import { addDays, fmtHuman, fmtShort } from '../lib/dates.js';

// Всплывающее меню у клетки или выделенного периода
export default function CellMenu({ menu, project, naryadMap, onClose, actions }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = menu.rect, w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 12) top = r.top - h - 8;
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
    top = Math.max(54, top);
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.cell')) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [menu, onClose]);

  if (!menu) return null;
  const { settings } = project;
  const person = project.persons.find((p) => p.id === menu.pid);
  const manual = settings.groups.find((g) => g.id === person?.group)?.auto === false;
  const idx = codeIndex(settings);
  const isRange = menu.type === 'range';
  const cell = !isRange ? project.cells[menu.pid]?.[menu.d] : null;
  const naryad = !isRange ? naryadMap.get(`${menu.pid}|${menu.d}`) : null;
  const info = cell && idx.get(cell.c);
  const duty = naryad && settings.duties.find((d) => d.id === naryad.dutyId);
  const from = isRange ? menu.from : menu.d;
  const to = isRange ? menu.to : menu.d;

  const statusChips = (
    <div className="menu-chips">
      {settings.statuses.map((s) => (
        <motion.button
          key={s.code}
          whileHover={{ y: -2, scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
          className={`status-chip ${cell?.c === s.code ? 'on' : ''}`}
          style={{ '--c': s.color }}
          title={s.name}
          onClick={() => actions.setStatus(menu.pid, from, to, s.code)}
        >
          <b>{s.code}</b><span>{s.name}</span>
        </motion.button>
      ))}
    </div>
  );

  return (
    <motion.div
      ref={ref}
      className="cell-menu glass"
      style={pos}
      initial={{ opacity: 0, scale: 0.9, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    >
      <div className="menu-head">
        <div className="menu-name">{person?.name}</div>
        <div className="menu-sub">{isRange ? `с ${fmtHuman(from)} по ${fmtHuman(to)}` : fmtHuman(menu.d)}</div>
      </div>

      {naryad && duty && (
        <>
          <div className="menu-naryad" style={{ '--c': duty.color }}>
            <div className="mn-title">{duty.name}</div>
            <div className="mn-sub">
              заступает {fmtShort(naryad.start)} · сменяется {fmtShort(naryad.end)}
              <span className={`tag ${naryad.punishment ? 'tag-punishment' : naryad.auto ? 'tag-auto' : 'tag-manual'}`}>
                {naryad.punishment ? 'наказание' : naryad.auto ? 'авто' : 'закреплён'}
              </span>
            </div>
          </div>
          <div className="menu-actions">
            <button className="menu-item primary" onClick={() => actions.removeWithReplacement(naryad)}>
              <UserMinus size={16} />{manual ? 'Снять с наряда (вручную, без замены)' : 'Снять и подобрать замену'}
            </button>
            {!manual && (
              <button className="menu-item" onClick={() => actions.toggleLock(naryad)}>
                {naryad.auto ? <Lock size={16} /> : <LockOpen size={16} />}
                {naryad.auto ? 'Закрепить (не менять при перестройке)' : 'Открепить'}
              </button>
            )}
            <button className="menu-item punishment-action" onClick={() => actions.setPunishment(naryad, !naryad.punishment)}>
              <Gavel size={16} />{naryad.punishment ? 'Убрать отметку «наказание»' : naryad.auto ? 'Закрепить как наказание' : 'Отметить как наказание'}
            </button>
            <button className="menu-item danger" onClick={() => actions.deleteNaryad(naryad)}><Trash2 size={16} />Удалить без замены</button>
          </div>
        </>
      )}

      {!naryad && (
        <>
          {!isRange && (
            <div className="menu-section">
              <div className="menu-label">Поставить в наряд</div>
              <div className="menu-actions">
                {settings.duties.map((d) => {
                  const len = naryadLength(d, menu.d);
                  return (
                    <button key={d.id} className="menu-item duty" style={{ '--c': d.color }} onClick={() => actions.placeDuty(menu.pid, menu.d, d)}>
                      <Plus size={16} />
                      <span className="grow">{d.name}</span>
                      <small>{d.prep} {fmtShort(menu.d)} → {d.code} {fmtShort(addDays(menu.d, len))}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="menu-section">
            <div className="menu-label">{isRange ? 'Отметить весь период' : 'Отметить день'}</div>
            {statusChips}
            {!isRange && <div className="menu-hint"><CalendarRange size={13} /> Протяните мышью по строке, чтобы отметить несколько дней</div>}
          </div>
          {(cell || isRange) && (
            <div className="menu-actions">
              <button className="menu-item" onClick={() => actions.clearRange(menu.pid, from, to)}><Eraser size={16} />Очистить{isRange ? ' период' : ''}</button>
            </div>
          )}
        </>
      )}
      {info?.kind === 'status' && !isRange && <div className="menu-foot">Сейчас: {info.status.name}</div>}
    </motion.div>
  );
}
