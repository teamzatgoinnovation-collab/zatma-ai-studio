import { describe, expect, it } from 'vitest';
import { WORKFLOW_TEMPLATES, type WorkflowGraph } from '@zatma/validation';
import { autoLayout, defaultConfig, newNodeId, nextPosition, summarize, toFlow, toGraph } from './automation';

const graph: WorkflowGraph = {
  nodes: [
    { id: 't1', type: 'trigger', kind: 'lead.created', config: { sources: ['meta_ads'] }, position: { x: 0, y: 0 } },
    { id: 'c1', type: 'condition', kind: 'lead.score', config: { op: 'gt', value: 70 }, position: { x: 0, y: 150 } },
    { id: 'a1', type: 'action', kind: 'add_tag', config: { tag: 'hot' }, position: { x: -150, y: 300 } },
    { id: 'a2', type: 'action', kind: 'add_tag', config: { tag: 'cold' }, position: { x: 150, y: 300 } },
  ],
  edges: [
    { source: 't1', sourceHandle: 'next', target: 'c1' },
    { source: 'c1', sourceHandle: 'yes', target: 'a1' },
    { source: 'c1', sourceHandle: 'no', target: 'a2' },
  ],
};

describe('graph conversion', () => {
  it('round-trips between the saved graph and the canvas', () => {
    const { nodes, edges } = toFlow(graph);
    expect(nodes.map((n) => n.id)).toEqual(['t1', 'c1', 'a1', 'a2']);
    expect(edges.find((e) => e.target === 'a2')).toMatchObject({ source: 'c1', sourceHandle: 'no' });
    expect(toGraph(nodes, edges)).toEqual(graph);
  });
  it('rounds positions and defaults a missing handle to "next"', () => {
    const { nodes, edges } = toFlow(graph);
    nodes[0]!.position = { x: 10.4, y: -3.6 };
    const g = toGraph(nodes, [{ id: 'e', source: 't1', target: 'c1' }]);
    expect(g.nodes[0]!.position).toEqual({ x: 10, y: -4 });
    expect(g.edges).toEqual([{ source: 't1', sourceHandle: 'next', target: 'c1' }]);
    expect(edges).toHaveLength(3);
  });
  it('gives new steps unused ids', () => {
    expect(newNodeId(['a1', 'a2', 'a4'], 'action')).toBe('a3');
    expect(newNodeId([], 'trigger')).toBe('t1');
    expect(newNodeId(['d1'], 'delay')).toBe('d2');
  });
});

describe('defaults and summaries', () => {
  it('copies defaults instead of sharing them', () => {
    const a = defaultConfig('action', 'assign_owner') as { userIds: string[] };
    a.userIds.push('x');
    expect((defaultConfig('action', 'assign_owner') as { userIds: string[] }).userIds).toEqual([]);
    expect(defaultConfig('delay', 'delay')).toEqual({ amount: 1, unit: 'days' });
  });
  it('describes each step in a line', () => {
    expect(summarize('condition', 'lead.score', { op: 'gt', value: 70 })).toBe('Score > 70');
    expect(summarize('trigger', 'lead.status_changed', { from: [], to: ['QUALIFIED'] })).toBe('to QUALIFIED');
    expect(summarize('trigger', 'lead.created', { sources: [] })).toBe('From any source');
    expect(summarize('action', 'assign_owner', { userIds: ['a', 'b'], strategy: 'round_robin' })).toBe('Rotate 2 people');
    expect(summarize('action', 'assign_owner', { userIds: [], strategy: 'round_robin' })).toBe('Choose people');
    expect(summarize('delay', 'delay', { amount: 2, unit: 'hours' })).toBe('2 hours');
    expect(summarize('action', 'notify_team', { userIds: ['a'], toOwner: true })).toBe('Owner + 1 person');
  });
});

describe('layout', () => {
  it('lays steps out in rows below the trigger, with branches side by side', () => {
    const g = autoLayout(graph);
    const pos = Object.fromEntries(g.nodes.map((n) => [n.id, n.position]));
    expect(pos.t1!.y).toBe(0);
    expect(pos.c1!.y).toBe(150);
    expect(pos.a1!.y).toBe(300);
    expect(pos.a1!.x).toBeLessThan(pos.a2!.x);
    expect(pos.t1!.x).toBe(0);
  });
  it('keeps unconnected steps visible and lays every shipped template out without overlaps', () => {
    const lone = autoLayout({ ...graph, nodes: [...graph.nodes, { id: 'z', type: 'action', kind: 'add_tag', config: {}, position: { x: 0, y: 0 } }] });
    expect(lone.nodes.find((n) => n.id === 'z')!.position.y).toBe(450);
    for (const t of WORKFLOW_TEMPLATES) {
      const g = autoLayout(t.graph);
      const keys = g.nodes.map((n) => `${n.position.x},${n.position.y}`);
      expect(new Set(keys).size, t.id).toBe(keys.length);
    }
  });
  it('places a new step under the selected one and avoids occupied spots', () => {
    const { nodes } = toFlow(graph);
    // (0, 300) would overlap the two branch steps already there, so the new one moves sideways in the same row.
    const p = nextPosition(nodes, 'c1', 'next');
    expect(p.y).toBe(300);
    for (const o of nodes.filter((x) => x.position.y === 300)) expect(Math.abs(o.position.x - p.x)).toBeGreaterThanOrEqual(220);
    const under = nextPosition(nodes.filter((x) => x.id !== 'a1' && x.id !== 'a2'), 'c1', 'next');
    expect(under).toEqual({ x: 0, y: 300 });
    expect(nextPosition([], null)).toEqual({ x: 0, y: 0 });
  });
});
