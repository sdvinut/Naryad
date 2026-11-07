import { Fragment, useEffect, useMemo, useState } from 'react';
import { motion, Reorder, useDragControls } from 'motion/react';
import { UserMinus, Settings2, Printer, FileSpreadsheet, Plus, Trash2, Users, Swords, Palette, SlidersHorizontal, FileText, TriangleAlert, GripVertical, ArrowDownAZ, Check, Hand, Zap, Link2, UserX } from 'lucide-react';
import { Modal, Button, Field, Segmented, Toggle } from './ui.jsx';
import { DOW_SHORT, addDays, dow, fmtFull, fmtHuman, fmtShort, isWeekend, mondayOf, monthDays, range } from '../lib/dates.js';
import { codeIndex, newId, newGroupId, newRuleId, reorderPersons } from '../lib/model.js';
import { buildPrintPayload } from '../lib/print.js';
import frameUrl from '../../electron/assets/frame.png';

// ---------------- снять с наряда ----------------

export function RemoveModal({ open, naryad, project, onClose, onConfirm }) {
  const [code, setCode] = useState('×');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    if (naryad) { setFrom(naryad.start); setTo(naryad.end); setCode('×'); }
  }, [naryad]);
  if (!naryad) return <Modal open={false} />;
  const person = project.persons.find((p) => p.id === naryad.pid);
  const manual = project.settings.groups.find((g) => g.id === person?.group)?.auto === false;
  const duty = project.settings.duties.find((d) => d.id === naryad.dutyId);
  const status = project.settings.statuses.find((s) => s.code === code);
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={UserMinus}
      title="Снять с наряда"
      subtitle={`${person?.name} · ${duty?.name}, заступает ${fmtHuman(naryad.start)}`}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon={UserMinus} disabled={!from || !to || from > to} onClick={() => onConfirm({ code, from, to })}>{manual ? 'Снять' : 'Подобрать замену'}</Button>
        </>
      }
    >
      <div className="field-label">Почему снимаем</div>
      <div className="menu-chips big">
        {project.settings.statuses.map((s) => (
          <motion.button key={s.code} whileHover={{ y: -2 }} whileTap={{ scale: 0.94 }} className={`status-chip ${code === s.code ? 'on' : ''}`} style={{ '--c': s.color }} onClick={() => setCode(s.code)}>
            <b>{s.code}</b><span>{s.name}</span>
          </motion.button>
        ))}
      </div>
      <div className="form-grid">
        <Field label="Отметка с"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="по"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <p className="note">
        В эти дни у человека будет стоять «{status?.code}» ({status?.name?.toLowerCase()}), и программа не поставит его в наряд.
        Все его наряды, которые попадают в этот период, тоже снимаются{manual ? '. Этот призыв распределяется вручную — замену поставьте сами.' : ', и для них подбирается замена.'}
      </p>
    </Modal>
  );
}

// ---------------- импорт ----------------

export function ImportModal({ open, info, project, onClose, onImport }) {
  const hasPeople = !!project?.persons.length;
  const [rows, setRows] = useState([]);
  const [mode, setMode] = useState('add');
  useEffect(() => {
    if (!info) return;
    const groups = project?.settings.groups || [];
    setRows(info.sheets.map((s) => {
      const name = s.section || s.name;
      const existing = groups.find((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase());
      const loaded = existing && project.persons.some((p) => p.group === existing.id);
      return {
        sheet: s.name,
        people: s.people,
        name,
        auto: existing ? existing.auto !== false : !/ЗИМ/i.test(s.name),
        checked: hasPeople ? !loaded : true,
        loaded,
      };
    }));
    setMode(hasPeople ? 'add' : 'replace');
  }, [info]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!info) return <Modal open={false} />;
  const set = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.checked);
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={FileSpreadsheet}
      width={640}
      title="Импорт из Excel"
      subtitle={info.name}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" icon={FileSpreadsheet} disabled={!chosen.length} onClick={() => onImport(chosen.map((r) => ({ sheet: r.sheet, name: r.name, auto: r.auto })), mode)}>
            {mode === 'add' && hasPeople ? 'Добавить' : 'Загрузить'}
          </Button>
        </>
      }
    >
      {info.sheets.length === 0 ? (
        <p className="note warn"><TriangleAlert size={15} /> В файле не нашёл листа, где есть столбец «ФИО» и строка с датами.</p>
      ) : (
        <>
          <div className="field-label">Какие листы загрузить и в какой призыв</div>
          <div className="import-list">
            {rows.map((r, i) => (
              <div key={r.sheet} className={`import-row ${r.checked ? 'on' : ''}`}>
                <button type="button" className={`group-check ${r.checked ? 'on' : ''}`} onClick={() => set(i, { checked: !r.checked })}>
                  <span className="box">{r.checked && <Check size={12} />}</span>
                  <span className="ir-sheet">{r.sheet}<small>{r.people} чел.{r.loaded ? ' · уже в программе' : ''}</small></span>
                </button>
                <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Название призыва" disabled={!r.checked} />
                <Segmented
                  layoutId={`import-auto-${i}`}
                  value={r.auto ? 'auto' : 'manual'}
                  onChange={(v) => set(i, { auto: v === 'auto' })}
                  options={[{ value: 'auto', label: 'Авто', icon: Zap }, { value: 'manual', label: 'Вручную', icon: Hand }]}
                />
              </div>
            ))}
          </div>
          <p className="note">«Вручную» — программа не ставит этих людей в наряды и не предлагает их в замену, вы расставляете их сами.</p>
        </>
      )}
      {hasPeople && (
        <Field label="Что сделать с текущими данными">
          <Segmented
            layoutId="import-mode"
            value={mode}
            onChange={setMode}
            options={[{ value: 'add', label: 'Добавить к текущим' }, { value: 'replace', label: 'Заменить всё' }]}
          />
        </Field>
      )}
      {hasPeople && (
        <p className="note">
          {mode === 'add'
            ? 'Люди с выбранных листов добавятся новыми призывами. Кто уже есть в программе — не продублируется, ваши распределения сохранятся.'
            : 'Текущие данные будут заменены. Вернуть их можно сочетанием Ctrl+Z, пока программа открыта.'}
        </p>
      )}
    </Modal>
  );
}

// ---------------- печать в Word ----------------

export function ExportModal({ open, project, month, today, onClose, onExport }) {
  const pr = project.settings.print;
  const [start, setStart] = useState('');
  const [span, setSpan] = useState('8');
  const [style, setStyle] = useState(pr.style);
  const [colored, setColored] = useState(pr.colored);
  const [frame, setFrame] = useState(pr.frame);
  const [hideGroups, setHideGroups] = useState(pr.hideGroups || []);
  const [gkDays, setGkDays] = useState(pr.gkDays);
  const [dateIso, setDateIso] = useState(today);
  const [sig, setSig] = useState(project.settings.signatures);
  const [title, setTitle] = useState(project.settings.title);

  useEffect(() => {
    if (!open) return;
    const days = monthDays(month);
    const inMonth = today >= days[0] && today <= days.at(-1);
    // текущая неделя, а если смотрим другой месяц — первая неделя, которая начинается в нём
    setStart(inMonth ? mondayOf(today) : (mondayOf(days[0]) < days[0] ? mondayOf(addDays(days[0], 7)) : days[0]));
    const p = project.settings.print;
    setStyle(p.style); setColored(p.colored); setFrame(p.frame); setHideGroups(p.hideGroups || []); setGkDays(p.gkDays);
    setDateIso(today);
    setSig(project.settings.signatures);
    setTitle(project.settings.title);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => {
    if (!start) return [];
    if (span === 'month') return monthDays(month);
    return range(start, addDays(start, Number(span) - 1));
  }, [start, span, month]);

  const classic = style === 'classic';
  const payload = useMemo(
    () => buildPrintPayload(project, days, { style, colored: classic ? colored : true, signatures: sig, title, dateIso, gkDays, gkLabel: pr.gkLabel, frame, hideGroups }),
    [project, days, style, classic, colored, sig, title, dateIso, gkDays, pr.gkLabel, frame, hideGroups],
  );
  const portrait = classic && payload.days.length <= 9;
  const hasGk = payload.days.some((d) => d.gk);
  const fullDate = (iso) => iso && fmtFull(iso);

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Printer}
      width={900}
      title="Печать графика в Word"
      subtitle="Документ откроется в Word — оттуда его можно распечатать"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            icon={FileText}
            disabled={!days.length}
            onClick={() => onExport(payload, { signatures: sig, title, print: { ...pr, style, colored, frame, hideGroups, gkDays } })}
          >
            Сохранить в Word
          </Button>
        </>
      }
    >
      <div className="export-grid">
        <div className="export-form">
          <Field label="Оформление">
            <Segmented layoutId="export-style" value={style} onChange={setStyle} options={[{ value: 'classic', label: 'Как в Excel' }, { value: 'color', label: 'Цветная таблица' }]} />
          </Field>
          <Field label="Период">
            <Segmented layoutId="export-span" value={span} onChange={setSpan} options={[{ value: '7', label: 'ПН–ВС' }, { value: '8', label: 'ПН–ПН' }, { value: '14', label: '2 нед.' }, { value: 'month', label: 'Месяц' }]} />
          </Field>
          {project.settings.groups.length > 1 && (
            <Field label="Какие призывы печатать">
              <div className="group-checks">
                {project.settings.groups.map((g) => {
                  const on = !hideGroups.includes(g.id);
                  return (
                    <button key={g.id} type="button" className={`group-check ${on ? 'on' : ''}`} onClick={() => setHideGroups(on ? [...hideGroups, g.id] : hideGroups.filter((x) => x !== g.id))}>
                      <span className="box">{on && <Check size={12} />}</span>{g.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          <div className="form-grid">
            {span !== 'month' && <Field label="Первый день"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
            {classic && <Field label="Дата под графиком"><input type="date" value={dateIso} onChange={(e) => setDateIso(e.target.value)} /></Field>}
          </div>
          {classic && (
            <>
              <div className="form-grid">
                <Field label="ГК — числа месяца"><input value={gkDays} onChange={(e) => setGkDays(e.target.value)} placeholder="6, 16, 29" /></Field>
              </div>
              {payload.days.length <= 9 && <Toggle checked={frame} onChange={setFrame} label="Рамка, как на листе «График»" />}
              <Toggle checked={colored} onChange={setColored} label="Цветные наряды" hint="Обычно выключено: печать чёрно-белая, выходные серые" />
            </>
          )}
          <Field label="Заголовок"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Составил"><input value={sig.composedTitle} onChange={(e) => setSig({ ...sig, composedTitle: e.target.value })} /></Field>
          <Field label="ФИО составителя"><input value={sig.composedName} onChange={(e) => setSig({ ...sig, composedName: e.target.value })} /></Field>
          <Field label="Утвердил"><input value={sig.approvedTitle} onChange={(e) => setSig({ ...sig, approvedTitle: e.target.value })} /></Field>
          <Field label="ФИО утвердившего"><input value={sig.approvedName} onChange={(e) => setSig({ ...sig, approvedName: e.target.value })} /></Field>
        </div>
        <div className="paper-wrap">
          <motion.div
            className={`paper ${portrait ? 'portrait' : 'landscape'}${classic ? ' classic' : ''}`}
            key={`${start}${span}${style}`}
            initial={{ rotateX: 12, y: 16, opacity: 0 }}
            animate={{ rotateX: 0, y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 24 }}
          >
            {portrait && frame && <img className="paper-frame" src={frameUrl} alt="" />}
            <div className="paper-inner">
              <div className="paper-title">
                {classic
                  ? <>{title}<span className="sp" />с<span className="sp" />{fullDate(days[0])}<span className="sp" />по<span className="sp" />{fullDate(days.at(-1))}</>
                  : <>{title} с {fullDate(days[0])} по {fullDate(days.at(-1))}</>}
              </div>
              <table>
                <colgroup><col className="c-num" /><col className="c-name" />{payload.days.map((d) => <col key={d.date} />)}</colgroup>
                <thead>
                  {classic && hasGk && (
                    <tr className="gk-row"><th className="blank" /><th className="blank" />{payload.days.map((d) => (d.gk ? <th key={d.date}>{payload.gkLabel}</th> : <th key={d.date} className="blank" />))}</tr>
                  )}
                  {classic ? (
                    <>
                      <tr><th rowSpan={2}>№</th><th rowSpan={2}>ФИО</th>{payload.days.map((d) => <th key={d.date} className={d.weekend ? 'we' : ''}>{d.date2}</th>)}</tr>
                      <tr>{payload.days.map((d) => <th key={d.date} className={d.weekend ? 'we' : ''}>{d.dow}</th>)}</tr>
                    </>
                  ) : (
                    <tr><th>№</th><th>ФИО</th>{payload.days.map((d) => <th key={d.date} className={d.weekend ? 'we' : ''}>{d.date}<br />{d.dow}</th>)}</tr>
                  )}
                </thead>
                <tbody>
                  {payload.blocks.map((b) => (
                    <Fragment key={b.title}>
                      <tr><td className="section" colSpan={payload.days.length + 2}>{b.title}</td></tr>
                      {b.rows.map((r) => (
                        <tr key={`${b.title}${r.n}`}>
                          <td>{r.n}</td>
                          <td className={classic ? '' : 'pn'}>{r.name}</td>
                          {r.cells.map((c, i) => <td key={i} className={classic && payload.days[i].weekend ? 'we' : ''} style={{ background: c.fill || undefined }}>{c.text}</td>)}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <div className="paper-sign"><span>{sig.composedTitle}</span><span>{sig.composedName}</span></div>
              <div className="paper-sign"><span>{sig.approvedTitle}</span><span>{sig.approvedName}</span></div>
              {classic && <div className="paper-sign date"><span>{payload.dateLine}</span><span>{payload.gkNote}</span></div>}
            </div>
          </motion.div>
          <div className="paper-cap">{payload.blocks.reduce((n, b) => n + b.rows.length, 0)} человек · {payload.days.length} дн. · {portrait ? 'книжный лист' : 'альбомный лист'}</div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- настройки ----------------

// строка человека в настройках: тянуть можно только за «ручку», чтобы не мешать вводу в поля
function PersonRow({ p, duties, groups, setPerson, onDelete }) {
  const controls = useDragControls();
  return (
    <Reorder.Item as="div" value={p} dragListener={false} dragControls={controls} className={`people-row ${p.active === false ? 'off' : ''}`} whileDrag={{ scale: 1.02, boxShadow: '0 14px 30px -10px rgba(0,0,0,0.8)' }}>
      <span className="grip" title="Потяните, чтобы переставить" onPointerDown={(e) => { e.preventDefault(); controls.start(e); }}><GripVertical size={15} /></span>
      <input value={p.name} onChange={(e) => setPerson(p.id, { name: e.target.value })} />
      <select value={p.group} onChange={(e) => setPerson(p.id, { group: e.target.value })} title="Призыв">
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <button type="button" className={`role-btn ${p.role === 'dj' ? 'dj' : ''}`} onClick={() => setPerson(p.id, { role: p.role === 'dj' ? 'dn' : 'dj' })} title="Нажмите, чтобы поменять">
        {p.role === 'dj' ? 'Дежурный' : 'Дневальный'}
      </button>
      {duties.map((d) => (
        <input key={d.id} type="number" min="0" value={p.carry?.[d.id] ?? 0} onChange={(e) => setPerson(p.id, { carry: { ...p.carry, [d.id]: Number(e.target.value) || 0 } })} />
      ))}
      <Toggle checked={p.active !== false} onChange={(v) => setPerson(p.id, { active: v })} label="" />
      <button className="icon-btn danger" title="Удалить человека" onClick={onDelete}><Trash2 size={15} /></button>
    </Reorder.Item>
  );
}

function ConstraintRules({ rules, persons, onChange, unique = false, max = null }) {
  const nameOf = (pid) => persons.find((p) => p.id === pid)?.name || 'Удалённый человек';
  const update = (index, members) => onChange(rules.map((rule, i) => (i === index ? { ...rule, members } : rule)));
  return (
    <div className="constraint-rules">
      {rules.map((rule, index) => {
        const usedElsewhere = new Set(unique ? rules.filter((_, i) => i !== index).flatMap((x) => x.members) : []);
        const available = persons.filter((p) => !rule.members.includes(p.id) && !usedElsewhere.has(p.id));
        const full = max !== null && rule.members.length >= max;
        return (
          <div className="constraint-card" key={rule.id}>
            <div className="constraint-head">
              <b>Группа {index + 1}</b>
              <span>{rule.members.length} чел.</span>
              <button className="icon-btn danger" title="Удалить правило" onClick={() => onChange(rules.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
            </div>
            <div className="constraint-members">
              {rule.members.map((pid) => (
                <button key={pid} title="Убрать из группы" onClick={() => update(index, rule.members.filter((x) => x !== pid))}>
                  {nameOf(pid)}<span>×</span>
                </button>
              ))}
              {!rule.members.length && <span className="constraint-empty">Пока никто не выбран</span>}
            </div>
            <select value="" disabled={full || !available.length} onChange={(e) => { if (e.target.value) update(index, [...rule.members, e.target.value]); }}>
              <option value="">{full ? `Не больше ${max} чел.` : 'Добавить человека…'}</option>
              {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {rule.members.length < 2 && <p className="constraint-warning">Добавьте минимум двух человек.</p>}
          </div>
        );
      })}
      <Button icon={Plus} size="sm" onClick={() => onChange([...rules, { id: newRuleId(), members: [] }])}>Добавить группу</Button>
    </div>
  );
}

export function SettingsModal({ open, project, onClose, onSave, onPickOrder }) {
  const [tab, setTab] = useState('people');
  const [draft, setDraft] = useState(project);
  useEffect(() => { if (open) setDraft(project); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = draft.settings;
  const setS = (patch) => setDraft({ ...draft, settings: { ...s, ...patch } });
  const setPerson = (id, patch) => setDraft({ ...draft, persons: draft.persons.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const usedCodes = useMemo(() => {
    const set = new Set();
    for (const row of Object.values(draft.cells)) for (const c of Object.values(row)) set.add(c.c);
    return set;
  }, [draft.cells]);
  const constraints = s.constraints || { together: [], apart: [] };
  const autoPeople = draft.persons.filter((p) => p.active !== false && s.groups.find((g) => g.id === p.group)?.auto !== false);
  const maxTogether = s.duties.find((d) => d.id === 'R')?.perDay || 3;
  const togetherPids = constraints.together.flatMap((rule) => rule.members);
  const constraintsValid = [...constraints.together, ...constraints.apart].every((rule) => rule.members.length >= 2)
    && constraints.together.every((rule) => rule.members.length <= maxTogether)
    && new Set(togetherPids).size === togetherPids.length;
  const setConstraints = (kind, rules) => setS({ constraints: { ...constraints, [kind]: rules } });

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Settings2}
      width={860}
      title="Настройки"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!constraintsValid} onClick={() => onSave(draft)}>Сохранить</Button></>}
    >
      <Segmented
        layoutId="settings-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'people', label: 'Люди', icon: Users },
          { value: 'constraints', label: 'Ограничения', icon: Link2 },
          { value: 'duties', label: 'Наряды', icon: Swords },
          { value: 'statuses', label: 'Отметки', icon: Palette },
          { value: 'general', label: 'Общее', icon: SlidersHorizontal },
        ]}
      />
      <div className="settings-body">
        {tab === 'people' && (
          <div className="people">
            <div className="groups-edit">
              <div className="field-label">Призывы</div>
              {s.groups.map((g, i) => {
                const count = draft.persons.filter((p) => p.group === g.id).length;
                const djCount = draft.persons.filter((p) => p.group === g.id && p.role === 'dj').length;
                return (
                  <div key={g.id} className="group-edit-row">
                    <input value={g.name} onChange={(e) => setS({ groups: s.groups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <Segmented
                      layoutId={`group-auto-${g.id}`}
                      value={g.auto === false ? 'manual' : 'auto'}
                      onChange={(v) => setS({ groups: s.groups.map((x, j) => (j === i ? { ...x, auto: v === 'auto' } : x)) })}
                      options={[{ value: 'auto', label: 'Авто', icon: Zap }, { value: 'manual', label: 'Вручную', icon: Hand }]}
                    />
                    <span className="ge-count">{count} чел.{g.auto !== false && <><br /><span className={djCount ? '' : 'warn'}>дежурных: {djCount}</span></>}</span>
                    <button className="icon-btn danger" title={count ? 'Сначала переведите людей в другой призыв' : 'Удалить призыв'} disabled={!!count || s.groups.length < 2} onClick={() => setS({ groups: s.groups.filter((_, j) => j !== i) })}><Trash2 size={15} /></button>
                  </div>
                );
              })}
              <Button icon={Plus} size="sm" onClick={() => setS({ groups: [...s.groups, { id: newGroupId(), name: 'Новый призыв', auto: true }] })}>Добавить призыв</Button>
              <p className="note">«Вручную» — программа не ставит этих людей в наряды, не предлагает их в замену и не считает их наряды в норму «человек в сутки».</p>
            </div>
            <div className="people-tools">
              <Button icon={FileSpreadsheet} size="sm" onClick={async () => { const order = await onPickOrder(); if (order) setDraft((d) => reorderPersons(d, order)); }}>Порядок как в Excel</Button>
              <Button icon={ArrowDownAZ} size="sm" onClick={() => setDraft({ ...draft, persons: draft.persons.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru')) })}>По алфавиту</Button>
              <span className="people-hint">Перетащите за ⋮⋮, чтобы поменять порядок — так же он будет в таблице и в печати</span>
            </div>
            <div className="people-head">
              <span /><span>Фамилия И.О.</span><span>Призыв</span><span>Роль</span>
              {s.duties.map((d) => <span key={d.id} title={`Нарядов «${d.code}» до начала таблицы (с прошлых месяцев)`}>{d.code} до таблицы</span>)}
              <span>В нарядах</span><span />
            </div>
            <Reorder.Group as="div" axis="y" values={draft.persons} onReorder={(persons) => setDraft((d) => ({ ...d, persons }))} className="people-list">
              {draft.persons.map((p) => (
                <PersonRow
                  key={p.id}
                  p={p}
                  duties={s.duties}
                  groups={s.groups}
                  setPerson={setPerson}
                  onDelete={() => { if (window.confirm(`Удалить ${p.name} вместе со всеми его отметками?`)) { const cells = { ...draft.cells }; delete cells[p.id]; setDraft({ ...draft, persons: draft.persons.filter((x) => x.id !== p.id), cells }); } }}
                />
              ))}
            </Reorder.Group>
            <Button icon={Plus} onClick={() => setDraft({ ...draft, persons: [...draft.persons, { id: newId(), name: 'Новый Н.Н.', carry: {}, active: true, group: s.groups[0].id }] })}>Добавить человека</Button>
            <p className="note">«До таблицы» — сколько нарядов было до первого дня в таблице. Учитывается при подсчёте честности. Выключенный человек не ставится в наряды, но остаётся в графике.</p>
          </div>
        )}

        {tab === 'constraints' && (
          <div className="constraints-settings">
            <p className="note">Правила действуют при автоматическом распределении и подборе замен. Участвовать могут только активные люди из призывов «Авто». Если выполнить правила невозможно, место останется пустым.</p>
            <section className="constraint-section">
              <div className="constraint-title"><Link2 size={18} /><div><h3>Вместе в ротном наряде</h3><p>Если программа ставит одного участника в ротный наряд, остальные участники группы заступают в тот же день. Не больше {maxTogether} человек; один человек может входить только в одну такую группу.</p></div></div>
              <ConstraintRules rules={constraints.together} persons={autoPeople} onChange={(rules) => setConstraints('together', rules)} unique max={maxTogether} />
            </section>
            <section className="constraint-section">
              <div className="constraint-title"><UserX size={18} /><div><h3>Не в нарядах одновременно</h3><p>Наряды любых двух участников группы не должны пересекаться по датам, даже если это разные типы нарядов. Учитываются заступление и все сутки наряда.</p></div></div>
              <ConstraintRules rules={constraints.apart} persons={autoPeople} onChange={(rules) => setConstraints('apart', rules)} />
            </section>
            {!constraintsValid && <p className="note warn"><TriangleAlert size={15} />В каждой группе должно быть минимум два человека, без превышения вместимости и повторов в совместных группах.</p>}
          </div>
        )}

        {tab === 'duties' && (
          <div className="duties">
            {s.duties.map((d, i) => (
              <div key={d.id} className="duty-card" style={{ '--c': d.color }}>
                <div className="duty-top">
                  <input type="color" value={d.color} onChange={(e) => setS({ duties: s.duties.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
                  <input className="grow" value={d.name} onChange={(e) => setS({ duties: s.duties.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <span className="code-pill">{d.prep} → {d.code}</span>
                </div>
                <div className="form-grid three">
                  <Field label="Дежурных в наряде: от" hint="остальные — дневальные"><input type="number" min="0" max={d.perDay} value={d.djMin ?? 0} onChange={(e) => setS({ duties: s.duties.map((x, j) => (j === i ? { ...x, djMin: Math.max(0, Number(e.target.value) || 0) } : x)) })} /></Field>
                  <Field label="до"><input type="number" min="0" max={d.perDay} value={d.djMax ?? d.perDay} onChange={(e) => setS({ duties: s.duties.map((x, j) => (j === i ? { ...x, djMax: Math.max(0, Number(e.target.value) || 0) } : x)) })} /></Field>
                  <span />
                </div>
                <div className="form-grid three">
                  <Field label="Человек в сутки"><input type="number" min="0" max="10" value={d.perDay} onChange={(e) => setS({ duties: s.duties.map((x, j) => (j === i ? { ...x, perDay: Number(e.target.value) || 0 } : x)) })} /></Field>
                  <Field label="Вес наряда" hint="1 — обычный"><input type="number" min="0.1" step="0.1" value={d.weight ?? 1} onChange={(e) => setS({ duties: s.duties.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) || 1 } : x)) })} /></Field>
                  <Field label="Особенности">
                    <div className="duty-rule">
                      {Object.entries(d.lengthByDow || {}).map(([w, len]) => <span key={w}>в {DOW_SHORT[w]} заступают на {len} сут.</span>)}
                      {(d.noStartDows || []).map((w) => <span key={w}>в {DOW_SHORT[w]} не заступают</span>)}
                      {!Object.keys(d.lengthByDow || {}).length && !(d.noStartDows || []).length && <span>каждый день на 1 сутки</span>}
                    </div>
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'statuses' && (
          <div className="statuses">
            {s.statuses.map((st, i) => (
              <div key={i} className="status-row">
                <input type="color" value={st.color} onChange={(e) => setS({ statuses: s.statuses.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
                <input className="code" value={st.code} onChange={(e) => setS({ statuses: s.statuses.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)) })} disabled={usedCodes.has(st.code)} title={usedCodes.has(st.code) ? 'Код уже используется в таблице' : ''} />
                <input className="grow" value={st.name} onChange={(e) => setS({ statuses: s.statuses.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <button className="icon-btn danger" title={usedCodes.has(st.code) ? 'Код используется в таблице — сначала уберите его оттуда' : 'Удалить'} disabled={usedCodes.has(st.code)} onClick={() => setS({ statuses: s.statuses.filter((_, j) => j !== i) })}><Trash2 size={15} /></button>
              </div>
            ))}
            <Button icon={Plus} onClick={() => setS({ statuses: [...s.statuses, { code: 'Н', name: 'Новая отметка', color: '#a78bfa', blocks: true }] })}>Добавить отметку</Button>
            <p className="note">Отметки — всё, кроме нарядов: увольнение, госпиталь, рабочая группа и любые свои. В дни с отметкой человек в наряд не ставится.</p>
          </div>
        )}

        {tab === 'general' && (
          <div className="general">
            <div className="form-grid">
              <Field label="Минимум свободных суток между нарядами" hint="1 — после смены с наряда хотя бы один день отдыха"><input type="number" min="0" max="7" value={s.minRest} onChange={(e) => setS({ minRest: Math.max(0, Number(e.target.value) || 0) })} /></Field>
              <Field label="Сколько вариантов предлагать"><input type="number" min="1" max="5" value={s.variants} onChange={(e) => setS({ variants: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
            </div>
            <Field label="Заголовок графика"><input value={s.title} onChange={(e) => setS({ title: e.target.value })} /></Field>
            <div className="form-grid">
              <Field label="Составил (должность, звание)"><input value={s.signatures.composedTitle} onChange={(e) => setS({ signatures: { ...s.signatures, composedTitle: e.target.value } })} /></Field>
              <Field label="ФИО"><input value={s.signatures.composedName} onChange={(e) => setS({ signatures: { ...s.signatures, composedName: e.target.value } })} /></Field>
              <Field label="Утвердил (должность, звание)"><input value={s.signatures.approvedTitle} onChange={(e) => setS({ signatures: { ...s.signatures, approvedTitle: e.target.value } })} /></Field>
              <Field label="ФИО"><input value={s.signatures.approvedName} onChange={(e) => setS({ signatures: { ...s.signatures, approvedName: e.target.value } })} /></Field>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
