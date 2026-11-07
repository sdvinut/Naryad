import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Eraser, X, BoxSelect } from 'lucide-react';
import { range } from '../lib/dates.js';

// Панель внизу таблицы, когда выделено несколько клеток: залить отметкой одной кнопкой
export default function SelectionBar({ sel, statuses, onApply, onClose }) {
  const { cells, people, days } = useMemo(() => {
    const keys = new Set(), rows = new Set(), ds = new Set();
    for (const r of sel.ranges) {
      const dd = range(r.d0, r.d1);
      for (let ri = r.r0; ri <= r.r1; ri++) {
        rows.add(ri);
        for (const d of dd) { keys.add(`${ri}|${d}`); ds.add(d); }
      }
    }
    return { cells: keys.size, people: rows.size, days: ds.size };
  }, [sel]);

  return (
    <motion.div
      className="selbar glass"
      initial={{ opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.96, transition: { duration: 0.14 } }}
      transition={{ type: 'spring', stiffness: 460, damping: 30 }}
    >
      <div className="selbar-info">
        <BoxSelect size={16} />
        <span><b>{cells}</b> клеток · {people} чел. × {days} дн.</span>
      </div>
      <div className="selbar-chips">
        {statuses.map((s, i) => (
          <motion.button
            key={s.code}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.93 }}
            className="status-chip"
            style={{ '--c': s.color }}
            title={`${s.name} — клавиша ${i + 1}`}
            onClick={() => onApply(s.code)}
          >
            <b>{s.code}</b><span>{s.name}</span>{i < 9 && <kbd>{i + 1}</kbd>}
          </motion.button>
        ))}
      </div>
      <button className="selbar-clear" onClick={() => onApply(null)} title="Очистить выделенное — Delete">
        <Eraser size={15} />Очистить<kbd>Del</kbd>
      </button>
      <button className="icon-btn" onClick={onClose} title="Снять выделение — Esc"><X size={16} /></button>
    </motion.div>
  );
}
