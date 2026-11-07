// Мост к Electron. В обычном браузере (для разработки) — заглушки и демо-данные.
const desktop = typeof window !== 'undefined' && window.api;
const LS = 'naryady-project';

export const isDesktop = !!desktop;

export const api = desktop || {
  loadProject: async () => { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } },
  saveProject: async (d) => { try { localStorage.setItem(LS, JSON.stringify(d)); } catch { /* приватный режим */ } return true; },
  openProject: async () => null,
  saveProjectAs: async () => null,
  pickXlsx: async () => ({
    file: 'demo', name: 'демо-данные',
    sheets: [{ name: 'Календарь нарядов (ЛЕТ)', people: 24, section: '24 призыв' }, { name: 'Календарь нарядов (ЗИМ)', people: 16, section: '23 призыв' }],
  }),
  importXlsx: async (_file, sheet) => (await fetch(/ЗИМ/.test(sheet) ? '/dev/fixture-import-zim.json' : '/dev/fixture-import.json')).json(),
  exportDocx: async () => null,
  openPath: async () => {},
  showInFolder: async () => {},
};
