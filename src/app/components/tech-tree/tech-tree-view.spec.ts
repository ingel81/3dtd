import { describe, it, expect } from 'vitest';
import { buildTechTreeView, TECH_TREE_METRICS, type TechTreeNode } from './tech-tree-view';

const node = (id: string, state: TechTreeNode['state'] = 'available'): TechTreeNode => ({
  id,
  title: id,
  state,
});

describe('buildTechTreeView', () => {
  it('keeps the node data and adds the geometry', () => {
    const view = buildTechTreeView(
      [{ id: 'a', title: 'Gatling', subtitle: '400 · 15s', icon: 'speed', state: 'available' }],
      [],
    );
    expect(view.nodes[0]).toMatchObject({
      id: 'a',
      title: 'Gatling',
      subtitle: '400 · 15s',
      icon: 'speed',
      state: 'available',
      level: 0,
      x: 0,
      y: 0,
      width: TECH_TREE_METRICS.nodeWidth,
      height: TECH_TREE_METRICS.nodeHeight,
    });
  });

  it('dims the edge into a locked node, not the one into an open node', () => {
    const view = buildTechTreeView(
      [node('root', 'completed'), node('open', 'available'), node('shut', 'locked')],
      [
        { from: 'root', to: 'open' },
        { from: 'root', to: 'shut' },
      ],
    );
    const toOpen = view.edges.find((e) => e.to === 'open')!;
    const toShut = view.edges.find((e) => e.to === 'shut')!;
    expect(toOpen.dimmed).toBe(false);
    expect(toShut.dimmed).toBe(true);
  });

  it('orders the nodes by level, so tab order follows the tree', () => {
    // Input deliberately has the deepest node first.
    const view = buildTechTreeView(
      [node('c'), node('a'), node('b')],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    );
    expect(view.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('reports a size that holds every node box', () => {
    const view = buildTechTreeView([node('a'), node('b')], [{ from: 'a', to: 'b' }]);
    expect(view.width).toBe(2 * TECH_TREE_METRICS.nodeWidth + TECH_TREE_METRICS.levelGap);
    for (const n of view.nodes) {
      expect(n.x + n.width).toBeLessThanOrEqual(view.width);
      expect(n.y + n.height).toBeLessThanOrEqual(view.height);
    }
  });

  it('lays out vertically when asked', () => {
    const view = buildTechTreeView([node('a'), node('b')], [{ from: 'a', to: 'b' }], 'vertical');
    const [a, b] = view.nodes;
    expect(b.y - a.y).toBe(TECH_TREE_METRICS.nodeHeight + TECH_TREE_METRICS.levelGap);
    expect(a.x).toBe(b.x);
  });

  it('marks an edge that runs past a level', () => {
    const view = buildTechTreeView([node('a'), node('b'), node('c')], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'c' },
    ]);
    expect(view.edges.find((e) => e.from === 'a' && e.to === 'c')!.skipsLevels).toBe(true);
    expect(view.edges.find((e) => e.from === 'a' && e.to === 'b')!.skipsLevels).toBe(false);
  });

  it('is empty for an empty tree instead of throwing', () => {
    expect(buildTechTreeView([], [])).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });
});
