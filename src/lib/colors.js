const parse = (hex) => {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};

export const rgba = (hex, a) => { const [r, g, b] = parse(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; };

// Светлый оттенок для печати: смешиваем цвет с белым
export function tint(hex, amount = 0.72) {
  const [r, g, b] = parse(hex).map((c) => Math.round(c + (255 - c) * amount));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
