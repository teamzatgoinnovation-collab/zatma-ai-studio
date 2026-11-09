import type { DesignBackground, DesignDocument, DesignLayer } from '@zatma/validation';

/** Editor state: the document plus undo/redo history. Pure reducer, unit-tested. */
export interface EditorState {
  doc: DesignDocument;
  selectedId: string | null;
  past: DesignDocument[];
  future: DesignDocument[];
  /** Incremented on every document change; autosave watches it. */
  version: number;
}

export const HISTORY_LIMIT = 100;

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export type EditorAction =
  | { type: 'load'; doc: DesignDocument }
  | { type: 'select'; id: string | null }
  | { type: 'updateLayer'; id: string; patch: Partial<DesignLayer> }
  | { type: 'addLayer'; layer: DesignLayer }
  | { type: 'removeLayer'; id: string }
  | { type: 'duplicateLayer'; id: string; newId: string }
  | { type: 'moveLayer'; id: string; to: 'up' | 'down' | 'front' | 'back' }
  | { type: 'setBackground'; background: DesignBackground }
  | { type: 'align'; id: string; mode: AlignMode }
  | { type: 'nudge'; id: string; dx: number; dy: number }
  | { type: 'undo' }
  | { type: 'redo' };

export function initialState(doc: DesignDocument): EditorState {
  return { doc, selectedId: null, past: [], future: [], version: 0 };
}

/** Records the previous document in history and applies the new one. */
function commit(state: EditorState, doc: DesignDocument, selectedId = state.selectedId): EditorState {
  if (doc === state.doc) return state;
  const past = [...state.past, state.doc];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { doc, selectedId, past, future: [], version: state.version + 1 };
}

const mapLayer = (doc: DesignDocument, id: string, fn: (l: DesignLayer) => DesignLayer): DesignDocument => ({
  ...doc,
  layers: doc.layers.map((l) => (l.id === id ? fn(l) : l)),
});

/** Moves a layer to an aligned position on the canvas. */
export function alignLayer(layer: Pick<DesignLayer, 'x' | 'y' | 'width' | 'height'>, canvas: { width: number; height: number }, mode: AlignMode): { x: number; y: number } {
  switch (mode) {
    case 'left':
      return { x: 0, y: layer.y };
    case 'center':
      return { x: Math.round((canvas.width - layer.width) / 2), y: layer.y };
    case 'right':
      return { x: canvas.width - layer.width, y: layer.y };
    case 'top':
      return { x: layer.x, y: 0 };
    case 'middle':
      return { x: layer.x, y: Math.round((canvas.height - layer.height) / 2) };
    case 'bottom':
      return { x: layer.x, y: canvas.height - layer.height };
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { doc } = state;
  switch (action.type) {
    case 'load':
      return initialState(action.doc);
    case 'select':
      return { ...state, selectedId: action.id };
    case 'updateLayer': {
      const target = doc.layers.find((l) => l.id === action.id);
      if (!target) return state;
      const changed = Object.entries(action.patch).some(([k, v]) => (target as Record<string, unknown>)[k] !== v);
      if (!changed) return state;
      return commit(state, mapLayer(doc, action.id, (l) => ({ ...l, ...action.patch }) as DesignLayer));
    }
    case 'addLayer':
      return commit(state, { ...doc, layers: [...doc.layers, action.layer] }, action.layer.id);
    case 'removeLayer':
      if (!doc.layers.some((l) => l.id === action.id)) return state;
      return commit(state, { ...doc, layers: doc.layers.filter((l) => l.id !== action.id) }, state.selectedId === action.id ? null : state.selectedId);
    case 'duplicateLayer': {
      const idx = doc.layers.findIndex((l) => l.id === action.id);
      if (idx === -1) return state;
      const src = doc.layers[idx]!;
      const copy = { ...src, id: action.newId, x: src.x + 24, y: src.y + 24, locked: false } as DesignLayer;
      const layers = [...doc.layers];
      layers.splice(idx + 1, 0, copy);
      return commit(state, { ...doc, layers }, copy.id);
    }
    case 'moveLayer': {
      const idx = doc.layers.findIndex((l) => l.id === action.id);
      if (idx === -1) return state;
      const layers = [...doc.layers];
      const [layer] = layers.splice(idx, 1);
      const target =
        action.to === 'front' ? layers.length : action.to === 'back' ? 0 : action.to === 'up' ? Math.min(layers.length, idx + 1) : Math.max(0, idx - 1);
      if (target === idx) return state;
      layers.splice(target, 0, layer!);
      return commit(state, { ...doc, layers });
    }
    case 'setBackground':
      return commit(state, { ...doc, background: action.background });
    case 'align': {
      const layer = doc.layers.find((l) => l.id === action.id);
      if (!layer || layer.locked) return state;
      const pos = alignLayer(layer, doc, action.mode);
      if (pos.x === layer.x && pos.y === layer.y) return state;
      return commit(state, mapLayer(doc, action.id, (l) => ({ ...l, ...pos }) as DesignLayer));
    }
    case 'nudge': {
      const layer = doc.layers.find((l) => l.id === action.id);
      if (!layer || layer.locked) return state;
      return commit(state, mapLayer(doc, action.id, (l) => ({ ...l, x: l.x + action.dx, y: l.y + action.dy }) as DesignLayer));
    }
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      const selectedId = prev.layers.some((l) => l.id === state.selectedId) ? state.selectedId : null;
      return { doc: prev, selectedId, past: state.past.slice(0, -1), future: [state.doc, ...state.future], version: state.version + 1 };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      const selectedId = next.layers.some((l) => l.id === state.selectedId) ? state.selectedId : null;
      return { doc: next, selectedId, past: [...state.past, state.doc], future: state.future.slice(1), version: state.version + 1 };
    }
  }
}
