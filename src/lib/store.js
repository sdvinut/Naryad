// История изменений проекта для Ctrl+Z / Ctrl+Y
const LIMIT = 80;

export const initialHistory = { past: [], present: null, future: [] };

export function historyReducer(state, action) {
  switch (action.type) {
    case 'set':
      if (action.project === state.present) return state;
      return { past: [...state.past, state.present].filter(Boolean).slice(-LIMIT), present: action.project, future: [] };
    case 'reset':
      return { past: [], present: action.project, future: [] };
    case 'undo':
      if (!state.past.length) return state;
      return { past: state.past.slice(0, -1), present: state.past.at(-1), future: [state.present, ...state.future] };
    case 'redo':
      if (!state.future.length) return state;
      return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
    default:
      return state;
  }
}
