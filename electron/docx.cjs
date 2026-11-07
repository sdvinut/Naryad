// Печатная форма графика в Word (.docx).
//   classic — как лист «График» в Excel: книжный лист в рамке, серые выходные, «ГК», строка призыва;
//   color   — цветная таблица на альбомном листе.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  PageOrientation, ShadingType, VerticalAlign, HeightRule, TableLayoutType, BorderStyle,
  ImageRun, Tab, TabStopType, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, VerticalMergeType,
} = require('docx');

const FONT = 'Times New Roman';
const fmt = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// сколько строк займут блоки призывов: заголовок блока + люди
const blockRows = (p) => p.blocks.reduce((s, b) => s + b.rows.length + 1, 0);

/**
 * p = { title, from, to, days: [{date: 'dd.mm', dow: 'ПН', weekend}], blocks: [{title, rows: [{n, name, cells: [{text, fill}]}]}],
 *       signatures: {composedTitle, composedName, approvedTitle, approvedName}, fontSize }
 */
async function buildColor(p) {
  const pageW = 16838, pageH = 11906, margin = 620;
  const usable = pageW - margin * 2;
  const nDays = Math.max(1, p.days.length);
  const nRows = blockRows(p);
  // чем больше дней и людей, тем мельче шрифт
  let fontPt = p.fontSize || (nDays > 16 ? 7 : nDays > 9 ? 9 : 11);
  if (nRows > 30) fontPt = Math.min(fontPt, 9);
  const size = Math.round(fontPt * 2);
  const numW = nDays > 16 ? 400 : 520;
  const nameW = nDays > 16 ? 2300 : 3100;
  const dayW = Math.floor((usable - numW - nameW) / nDays);
  // высота строки — чтобы весь список и подписи поместились на один лист
  const free = pageH - margin * 2 - 700 - 620 - 1500;
  const rowH = Math.max(Math.round(size * 11.5), Math.min(400, Math.floor(free / Math.max(1, nRows))));

  const run = (text, o = {}) => new TextRun({ text: text ?? '', font: FONT, size: o.size ?? size, bold: o.bold });
  const para = (children, align = AlignmentType.CENTER) => new Paragraph({ alignment: align, spacing: { before: 0, after: 0, line: 240 }, children });
  const cell = (paras, { w, fill } = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill: fill.replace('#', '') } : undefined,
    margins: { top: 0, bottom: 0, left: 50, right: 50 },
    children: paras,
  });

  const header = new TableRow({
    tableHeader: true,
    height: { value: 560, rule: HeightRule.ATLEAST },
    children: [
      cell([para([run('№', { bold: true })])], { w: numW, fill: 'E7E9EE' }),
      cell([para([run('ФИО', { bold: true })])], { w: nameW, fill: 'E7E9EE' }),
      ...p.days.map((d) => cell([para([run(d.date, { bold: true })]), para([run(d.dow, { size: size - 4 })])], { w: dayW, fill: d.weekend ? 'D5D9E2' : 'E7E9EE' })),
    ],
  });

  const rows = p.blocks.flatMap((b) => [
    new TableRow({
      height: { value: rowH, rule: HeightRule.ATLEAST },
      children: [new TableCell({
        columnSpan: nDays + 2,
        width: { size: numW + nameW + dayW * nDays, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F2F5' },
        verticalAlign: VerticalAlign.CENTER,
        children: [para([run(b.title, { bold: true })])],
      })],
    }),
    ...b.rows.map((r) => new TableRow({
      height: { value: rowH, rule: HeightRule.ATLEAST },
      cantSplit: true,
      children: [
        cell([para([run(String(r.n))])], { w: numW }),
        cell([para([run(r.name)], AlignmentType.LEFT)], { w: nameW }),
        ...r.cells.map((c) => cell([para([run(c.text, { bold: !!c.text })])], { w: dayW, fill: c.fill })),
      ],
    })),
  ]);

  const line = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
  const table = new Table({
    width: { size: usable, type: WidthType.DXA },
    columnWidths: [numW, nameW, ...p.days.map(() => dayW)],
    layout: TableLayoutType.FIXED,
    borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    rows: [header, ...rows],
  });

  const sig = (title, name) => (title || name) ? new Paragraph({
    spacing: { before: 160, after: 0 },
    children: [run(`${title || ''}`), run('   ______________   '), run(name || '')],
  }) : null;

  const doc = new Document({
    creator: 'Наряды',
    title: p.title,
    styles: { default: { document: { run: { font: FONT, size } } } },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE, width: pageH, height: pageW },
          margin: { top: margin, bottom: margin, left: margin, right: margin },
        },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 160 },
          children: [run(`${p.title} с ${fmt(p.from)} по ${fmt(p.to)}`, { bold: true, size: size + 6 })],
        }),
        table,
        sig(p.signatures?.composedTitle, p.signatures?.composedName),
        sig(p.signatures?.approvedTitle, p.signatures?.approvedName),
      ].filter(Boolean),
    }],
  });
  return Packer.toBuffer(doc);
}

// ---------- как лист «График» в Excel ----------

const GRAY = 'D9D9D9';
const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const allThin = { top: thin, bottom: thin, left: thin, right: thin };
const noBorders = { top: none, bottom: none, left: none, right: none };

/**
 * p = { title, from, to, dateLine, gkNote, gkLabel, frame,
 *       days: [{date2: '12.окт', dow: 'ПН', weekend, gk}], blocks: [{title, rows: [{n, name, cells: [{text, fill}]}]}], signatures }
 */
async function buildClassic(p) {
  const nDays = Math.max(1, p.days.length);
  const portrait = nDays <= 9; // неделя — на книжном листе, как в Excel; больше дней — на альбомном
  const pageW = portrait ? 11906 : 16838, pageH = portrait ? 16838 : 11906;
  const mX = portrait ? 880 : 760, mTop = portrait ? 1150 : 700, mBottom = portrait ? 900 : 600;
  const usable = pageW - mX * 2;
  const rowsN = blockRows(p);
  // два призыва (40+ строк) на одном листе — шрифт на пункт меньше, как в Excel с масштабом
  let fontPt = nDays > 16 ? 7 : nDays > 9 ? 9 : 11;
  if (rowsN > 30) fontPt = Math.min(fontPt, nDays > 9 ? 8 : 10);
  const size = fontPt * 2;
  const numW = nDays > 16 ? 420 : 540;
  const nameW = nDays > 16 ? 2300 : 2350; // дни пошире, чтобы «ЗН ДТП» влезало в одну строку
  const dayW = Math.floor((usable - numW - nameW) / nDays);
  const hasGk = p.days.some((d) => d.gk);
  const free = pageH - mTop - mBottom - 700 - (hasGk ? 330 : 0) - 700 - 1700;
  const rowH = Math.max(size * 12, Math.min(portrait ? 430 : 380, Math.floor(free / Math.max(1, rowsN))));

  const run = (text, o = {}) => new TextRun({ text: text ?? '', font: FONT, size: o.size ?? size, bold: o.bold });
  const para = (children, align = AlignmentType.CENTER) => new Paragraph({ alignment: align, spacing: { before: 0, after: 0, line: 240 }, children });
  const cell = (text, { w, fill, bold, borders = allThin, span, vMerge, align } = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    columnSpan: span,
    verticalMerge: vMerge,
    verticalAlign: VerticalAlign.CENTER,
    borders,
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    margins: { top: 0, bottom: 0, left: 20, right: 20 },
    children: [para([run(text, { bold })], align)],
  });
  const dayFill = (d) => (d.weekend ? GRAY : undefined);

  const rows = [];
  if (hasGk) {
    rows.push(new TableRow({
      height: { value: 300, rule: HeightRule.ATLEAST },
      children: [
        cell('', { w: numW, borders: noBorders }),
        cell('', { w: nameW, borders: noBorders }),
        ...p.days.map((d) => (d.gk ? cell(p.gkLabel || 'ГК', { w: dayW }) : cell('', { w: dayW, borders: noBorders }))),
      ],
    }));
  }
  rows.push(new TableRow({
    tableHeader: true,
    height: { value: 330, rule: HeightRule.ATLEAST },
    children: [
      cell('№', { w: numW, vMerge: VerticalMergeType.RESTART }),
      cell('ФИО', { w: nameW, vMerge: VerticalMergeType.RESTART }),
      ...p.days.map((d) => cell(d.date2, { w: dayW, fill: dayFill(d) })),
    ],
  }));
  rows.push(new TableRow({
    tableHeader: true,
    height: { value: 330, rule: HeightRule.ATLEAST },
    children: [
      cell('', { w: numW, vMerge: VerticalMergeType.CONTINUE }),
      cell('', { w: nameW, vMerge: VerticalMergeType.CONTINUE }),
      ...p.days.map((d) => cell(d.dow, { w: dayW, fill: dayFill(d) })),
    ],
  }));
  for (const b of p.blocks) {
    // строка призыва на всю ширину: «24 призыв», «23 призыв»; нумерация внутри блока с 1
    rows.push(new TableRow({
      height: { value: rowH, rule: HeightRule.ATLEAST },
      children: [cell(b.title, { w: numW + nameW + dayW * nDays, span: nDays + 2, bold: true })],
    }));
    for (const r of b.rows) {
      rows.push(new TableRow({
        height: { value: rowH, rule: HeightRule.ATLEAST },
        cantSplit: true,
        children: [
          cell(String(r.n), { w: numW }),
          cell(r.name, { w: nameW }),
          ...r.cells.map((c, i) => cell(c.text, { w: dayW, fill: c.fill ? c.fill.replace('#', '') : dayFill(p.days[i]) })),
        ],
      }));
    }
  }

  const table = new Table({
    width: { size: numW + nameW + dayW * nDays, type: WidthType.DXA },
    columnWidths: [numW, nameW, ...p.days.map(() => dayW)],
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    rows,
  });

  // строка «слева текст — справа фамилия» через табуляцию к правому краю
  const twoSide = (left, right, before = 120) => new Paragraph({
    spacing: { before, after: 0 },
    tabStops: [{ type: TabStopType.RIGHT, position: usable }],
    children: [run(left), new TextRun({ children: [new Tab()] }), run(right)],
  });

  // рамка из листа «График» — картинка на весь лист позади текста
  const titleChildren = [];
  if (portrait && p.frame) {
    const inset = 10; // px от края листа
    const pxW = 794, pxH = 1123; // А4 при 96 dpi
    titleChildren.push(new ImageRun({
      type: 'png',
      data: fs.readFileSync(path.join(__dirname, 'assets', 'frame.png')),
      transformation: { width: pxW - inset * 2, height: pxH - inset * 2 },
      floating: {
        horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: inset * 9525 },
        verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: inset * 9525 },
        behindDocument: true,
        allowOverlap: true,
        wrap: { type: TextWrappingType.NONE },
      },
    }));
  }
  const sp = '      ';
  titleChildren.push(run(`${p.title}${sp}с${sp}${fmt(p.from)}${sp}по${sp}${fmt(p.to)}`, { bold: true, size: size + 1 }));

  const sig = p.signatures || {};
  const doc = new Document({
    creator: 'Наряды',
    title: p.title,
    styles: { default: { document: { run: { font: FONT, size } } } },
    sections: [{
      properties: {
        page: {
          size: portrait
            ? { orientation: PageOrientation.PORTRAIT, width: pageW, height: pageH }
            : { orientation: PageOrientation.LANDSCAPE, width: pageH, height: pageW },
          margin: { top: mTop, bottom: mBottom, left: mX, right: mX },
        },
      },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 200 }, children: titleChildren }),
        table,
        (sig.composedTitle || sig.composedName) && twoSide(sig.composedTitle || '', sig.composedName || '', 260),
        (sig.approvedTitle || sig.approvedName) && twoSide(sig.approvedTitle || '', sig.approvedName || ''),
        (p.dateLine || p.gkNote) && twoSide(p.dateLine || '', p.gkNote || '', 300),
      ].filter(Boolean),
    }],
  });
  return Packer.toBuffer(doc);
}

const buildDocx = (p) => (p.style === 'color' ? buildColor(p) : buildClassic(p));

module.exports = { buildDocx };
