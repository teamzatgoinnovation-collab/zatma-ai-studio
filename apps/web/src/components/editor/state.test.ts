import { describe, expect, it } from 'vitest';
import type { DesignDocument, DesignLayer } from '@zatma/validation';
import { alignLayer, editorReducer, HISTORY_LIMIT, initialState, type EditorState } from './state';

const rect = (id: string, x = 10, y = 20): DesignLayer => ({
  id,
  type: 'shape',
  role: 'decoration',
  shape: 'rect',
  x,
  y,
  width: 100,
  height: 50,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  fill: '#FF0000',
  strokeWidth: 0,
  cornerRadius: 0,
});

const doc = (layers: DesignLayer[] = [rect('a'), rect('b'), rect('c')]): DesignDocument => ({
  version: 1,
  width: 1000,
  height: 500,
  background: { type: 'color', color: '#FFFFFF' },
  layers,
});

const run = (s: EditorState, ...actions: Parameters<typeof editorReducer>[1][]) => actions.reduce(editorReducer, s);
const ids = (s: EditorState) => s.doc.layers.map((l) => l.id);

describe('editor reducer', () => {
  it('records history for edits and undoes/redoes them', () => {
    let s = run(initialState(doc()), { type: 'updateLayer', id: 'a', patch: { x: 50 } }, { type: 'updateLayer', id: 'a', patch: { x: 80 } });
    expect(s.doc.layers[0]!.x).toBe(80);
    expect(s.past).toHaveLength(2);
    s = run(s, { type: 'undo' });
    expect(s.doc.layers[0]!.x).toBe(50);
    s = run(s, { type: 'undo' });
    expect(s.doc.layers[0]!.x).toBe(10);
    expect(run(s, { type: 'undo' })).toBe(s); // nothing left to undo
    s = run(s, { type: 'redo' }, { type: 'redo' });
    expect(s.doc.layers[0]!.x).toBe(80);
    expect(run(s, { type: 'redo' })).toBe(s);
  });

  it('clears the redo stack on a new edit and bumps version on every change', () => {
    let s = run(initialState(doc()), { type: 'nudge', id: 'a', dx: 5, dy: 0 }, { type: 'undo' });
    expect(s.future).toHaveLength(1);
    s = run(s, { type: 'nudge', id: 'b', dx: 0, dy: 3 });
    expect(s.future).toHaveLength(0);
    expect(s.version).toBe(3);
  });

  it('ignores no-op updates and selection changes for history', () => {
    const s0 = initialState(doc());
    expect(run(s0, { type: 'updateLayer', id: 'a', patch: { x: 10 } })).toBe(s0);
    const s1 = run(s0, { type: 'select', id: 'b' });
    expect(s1.selectedId).toBe('b');
    expect(s1.past).toHaveLength(0);
    expect(s1.version).toBe(0);
  });

  it('caps history at the limit', () => {
    let s = initialState(doc());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = editorReducer(s, { type: 'nudge', id: 'a', dx: 1, dy: 0 });
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });

  it('adds, duplicates and removes layers, keeping selection consistent', () => {
    let s = run(initialState(doc()), { type: 'addLayer', layer: rect('d') });
    expect(ids(s)).toEqual(['a', 'b', 'c', 'd']);
    expect(s.selectedId).toBe('d');
    s = run(s, { type: 'duplicateLayer', id: 'a', newId: 'a2' });
    expect(ids(s)).toEqual(['a', 'a2', 'b', 'c', 'd']);
    expect(s.doc.layers[1]!.x).toBe(34);
    expect(s.selectedId).toBe('a2');
    s = run(s, { type: 'removeLayer', id: 'a2' });
    expect(s.selectedId).toBeNull();
    expect(ids(s)).toEqual(['a', 'b', 'c', 'd']);
    // Undo after removal restores the layer; selection is dropped only if the layer is gone.
    s = run(s, { type: 'undo' });
    expect(ids(s)).toContain('a2');
  });

  it('reorders layers and does nothing at the ends', () => {
    const s0 = initialState(doc());
    expect(ids(run(s0, { type: 'moveLayer', id: 'a', to: 'up' }))).toEqual(['b', 'a', 'c']);
    expect(ids(run(s0, { type: 'moveLayer', id: 'a', to: 'front' }))).toEqual(['b', 'c', 'a']);
    expect(ids(run(s0, { type: 'moveLayer', id: 'c', to: 'back' }))).toEqual(['c', 'a', 'b']);
    expect(ids(run(s0, { type: 'moveLayer', id: 'c', to: 'down' }))).toEqual(['a', 'c', 'b']);
    expect(run(s0, { type: 'moveLayer', id: 'c', to: 'up' })).toBe(s0);
    expect(run(s0, { type: 'moveLayer', id: 'a', to: 'back' })).toBe(s0);
  });

  it('does not move or align locked layers', () => {
    const s0 = initialState(doc([{ ...rect('a'), locked: true }]));
    expect(run(s0, { type: 'nudge', id: 'a', dx: 1, dy: 1 })).toBe(s0);
    expect(run(s0, { type: 'align', id: 'a', mode: 'center' })).toBe(s0);
  });

  it('aligns layers to the canvas', () => {
    const l = { x: 10, y: 20, width: 100, height: 50 };
    const c = { width: 1000, height: 500 };
    expect(alignLayer(l, c, 'left')).toEqual({ x: 0, y: 20 });
    expect(alignLayer(l, c, 'center')).toEqual({ x: 450, y: 20 });
    expect(alignLayer(l, c, 'right')).toEqual({ x: 900, y: 20 });
    expect(alignLayer(l, c, 'top')).toEqual({ x: 10, y: 0 });
    expect(alignLayer(l, c, 'middle')).toEqual({ x: 10, y: 225 });
    expect(alignLayer(l, c, 'bottom')).toEqual({ x: 10, y: 450 });
  });

  it('changes the background with history', () => {
    const s = run(initialState(doc()), { type: 'setBackground', background: { type: 'gradient', from: '#000000', to: '#FFFFFF', angle: 90 } });
    expect(s.doc.background.type).toBe('gradient');
    expect(run(s, { type: 'undo' }).doc.background).toEqual({ type: 'color', color: '#FFFFFF' });
  });
});
