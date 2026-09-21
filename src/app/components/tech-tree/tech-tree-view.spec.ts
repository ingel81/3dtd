import { describe, it, expect } from 'vitest';
import { buildTechTreeView, chainToRoots, TECH_TREE_METRICS, type TechTreeNode } from './tech-tree-view';

const node = (id: string, state: TechTreeNode['state'] = 'available'): TechTreeNode => ({
  id,
  title: id,
  state,
});

describe('buildTechTreeView', () => {
  it('keeps the node data and adds the geometry', () => {
    const view = buildTechTreeView(
      [{ id: 'a', title: 'Gatling', subtitle: '400', subtitleAside: '15s', icon: 'speed', state: 'available' }],
      [],
    );
    expect(view.nodes[0]).toMatchObject({
      id: 'a',
      title: 'Gatling',
      subtitle: '400',
      subtitleAside: '15s',
      icon: 'speed',
      state: 'available',
      level: 0,
      x: 0,
      y: 0,
      width: TECH_TREE_METRICS.nodeWidth,
      height: TECH_TREE_METRICS.nodeHeight,
    });
  });

  it('runs top down by default, one level per step', () => {
    const view = buildTechTreeView([node('a'), node('b')], [{ from: 'a', to: 'b' }]);
    const [a, b] = view.nodes;
    expect(b.y - a.y).toBe(TECH_TREE_METRICS.nodeHeight + TECH_TREE_METRICS.levelGap);
    expect(a.x).toBe(b.x);
  });

  it('lays out sideways when asked', () => {
    const view = buildTechTreeView([node('a'), node('b')], [{ from: 'a', to: 'b' }], 'horizontal');
    const [a, b] = view.nodes;
    expect(b.x - a.x).toBe(TECH_TREE_METRICS.nodeWidth + TECH_TREE_METRICS.levelGap);
    expect(a.y).toBe(b.y);
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

  it('lists the ids of each level, for the tier gutter', () => {
    const view = buildTechTreeView(
      [node('root1'), node('root2'), node('child')],
      [{ from: 'root1', to: 'child' }],
    );
    expect(view.levels).toEqual([['root1', 'root2'], ['child']]);
  });

  it('reports a size that holds every node box', () => {
    const view = buildTechTreeView([node('a'), node('b')], [{ from: 'a', to: 'b' }]);
    expect(view.height).toBe(2 * TECH_TREE_METRICS.nodeHeight + TECH_TREE_METRICS.levelGap);
    for (const n of view.nodes) {
      expect(n.x + n.width).toBeLessThanOrEqual(view.width);
      expect(n.y + n.height).toBeLessThanOrEqual(view.height);
    }
  });

  describe('edge state', () => {
    const edgeOf = (from: TechTreeNode['state'], to: TechTreeNode['state']) =>
      buildTechTreeView([node('p', from), node('c', to)], [{ from: 'p', to: 'c' }]).edges[0].state;

    it('is done as soon as the target is researched, whatever the source is', () => {
      expect(edgeOf('completed', 'completed')).toBe('done');
      expect(edgeOf('available', 'completed')).toBe('done');
    });

    it('carries the work from a finished node into a running one', () => {
      expect(edgeOf('completed', 'active')).toBe('active');
    });

    it('is open out of a finished node, and pending out of one under way', () => {
      expect(edgeOf('completed', 'available')).toBe('open');
      expect(edgeOf('active', 'locked')).toBe('pending');
      expect(edgeOf('queued', 'locked')).toBe('pending');
    });

    it('is locked while its source is neither done nor under way', () => {
      expect(edgeOf('locked', 'locked')).toBe('locked');
      expect(edgeOf('available', 'locked')).toBe('locked');
    });
  });

  it('puts the cap where the edge meets the target', () => {
    const view = buildTechTreeView([node('a'), node('b')], [{ from: 'a', to: 'b' }]);
    const target = view.nodes.find((n) => n.id === 'b')!;
    expect(view.edges[0].capX).toBeCloseTo(target.x + target.width / 2, 6);
    expect(view.edges[0].capY).toBeCloseTo(target.y, 6);
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
    expect(buildTechTreeView([], [])).toEqual({ nodes: [], edges: [], width: 0, height: 0, levels: [] });
  });
});

describe('chainToRoots', () => {
  const edges = [
    { from: 'root', to: 'mid' },
    { from: 'mid', to: 'leaf' },
    { from: 'other', to: 'leaf' },
    { from: 'root', to: 'aside' },
  ];

  it('collects every node on the way back and the edges between them', () => {
    const chain = chainToRoots('leaf', edges);
    expect([...chain.nodes].sort()).toEqual(['leaf', 'mid', 'other', 'root']);
    expect([...chain.edges].sort()).toEqual(['mid>leaf', 'other>leaf', 'root>mid']);
  });

  it('leaves out what only hangs off the same root', () => {
    expect(chainToRoots('leaf', edges).nodes.has('aside')).toBe(false);
  });

  it('is just the node itself for a root', () => {
    const chain = chainToRoots('root', edges);
    expect([...chain.nodes]).toEqual(['root']);
    expect(chain.edges.size).toBe(0);
  });

  it('does not walk in circles when two paths meet', () => {
    const diamond = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'd' },
    ];
    const chain = chainToRoots('d', diamond);
    expect([...chain.nodes].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(chain.edges.size).toBe(4);
  });
});
