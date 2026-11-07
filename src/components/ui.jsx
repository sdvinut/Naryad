import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, animate } from 'motion/react';
import { X } from 'lucide-react';

export const spring = { type: 'spring', stiffness: 420, damping: 30 };
export const softSpring = { type: 'spring', stiffness: 260, damping: 26 };

export function Button({ children, variant = 'ghost', icon: Icon, className = '', size, ...rest }) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.96 }}
      transition={spring}
      className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={size === 'lg' ? 18 : 16} strokeWidth={2.2} />}
      {children && <span>{children}</span>}
    </motion.button>
  );
}

export function IconButton({ icon: Icon, title, className = '', ...rest }) {
  return (
    <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }} transition={spring} className={`icon-btn ${className}`} title={title} aria-label={title} {...rest}>
      <Icon size={17} strokeWidth={2.1} />
    </motion.button>
  );
}

export function CountUp({ value, decimals = 0, className }) {
  const ref = useRef(null);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return undefined;
    const c = animate(from, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { if (ref.current) ref.current.textContent = v.toFixed(decimals); },
    });
    return () => c.stop();
  }, [value, decimals]);
  return <span ref={ref} className={className}>{Number(value).toFixed(decimals)}</span>;
}

export function Modal({ open, onClose, title, subtitle, icon: Icon, width = 560, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
          <motion.div
            className="modal glass"
            style={{ width }}
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } }}
            exit={{ opacity: 0, scale: 0.95, y: 12, transition: { duration: 0.16 } }}
          >
            <div className="modal-head">
              {Icon && <div className="modal-icon"><Icon size={20} /></div>}
              <div className="modal-titles">
                <h2>{title}</h2>
                {subtitle && <p>{subtitle}</p>}
              </div>
              <IconButton icon={X} title="Закрыть" onClick={onClose} />
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Segmented({ value, onChange, options, layoutId }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={`seg ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={layoutId} className="seg-pill" transition={spring} />}
          <span className="seg-label">{o.icon && <o.icon size={14} />}{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="toggle-row">
      <button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
        <motion.span className="knob" layout transition={spring} />
      </button>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export function Toasts({ items, onDismiss }) {
  return (
    <div className="toasts">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast glass toast-${t.kind || 'info'}`}
            initial={{ opacity: 0, x: 60, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1, transition: softSpring }}
            exit={{ opacity: 0, x: 60, scale: 0.9, transition: { duration: 0.2 } }}
          >
            <div className="toast-dot" />
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.text && <div className="toast-text">{t.text}</div>}
              {t.actions && (
                <div className="toast-actions">
                  {t.actions.map((a) => <button key={a.label} onClick={() => { a.onClick(); onDismiss(t.id); }}>{a.label}</button>)}
                </div>
              )}
            </div>
            <button className="toast-x" onClick={() => onDismiss(t.id)} aria-label="Закрыть"><X size={14} /></button>
            <motion.div className="toast-progress" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: (t.ttl || 5000) / 1000, ease: 'linear' }} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
