import { describe, it, expect } from 'vitest';
import { layoutDag, DagLayoutError, type DagEdge, type DagNode, type DagLayoutOptions } from './dag-layout';
import { RESEARCH_TREE } from '../configs/research/research-tree.config';

const OPTS: DagLayoutOptions = {
  nodeWidth: 100,
  nodeHeight: 40,
  levelGap: 60,
  siblingGap: 20,
  orientation: 'horizontal',
};

const nodes = (...ids: string[]): DagNode[] => ids.map((id) => ({ id }));
const edge = (from: string, to: string): DagEdge => ({ from, to });
const levelOf = (layout: ReturnType<typeof layoutDag>, id: string) =>
  layout.nodes.find((n) => n.id === id)!.level;
const orderOf = (layout: ReturnType<typeof layoutDag>, id: string) =>
  layout.nodes.find((n) => n.id === id)!.order;

describe('layoutDag', () => {
  describe('levels', () => {
    it('is empty for an empty graph', () => {
      const layout = layoutDag([], [], OPTS);
      expect(layout).toEqual({ nodes: [], edges: [], width: 0, height: 0, levelCount: 0 });
    });

    it('puts a lone node on level 0', () => {
      const layout = layoutDag(nodes('a'), [], OPTS);
      expect(levelOf(layout, 'a')).toBe(0);
      expect(layout.levelCount).toBe(1);
    });

    it('counts a chain one level per step', () => {
      const layout = layoutDag(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c')], OPTS);
      expect([levelOf(layout, 'a'), levelOf(layout, 'b'), levelOf(layout, 'c')]).toEqual([0, 1, 2]);
    });

    it('keeps an isolated node on level 0 rather than treating it as a special case', () => {
      // tentacle-biology in the real tree: a root with no children at all.
      const layout = layoutDag(nodes('a', 'b', 'lonely'), [edge('a', 'b')], OPTS);
      expect(levelOf(layout, 'lonely')).toBe(0);
    });

    it('uses the LONGEST path when parents sit on different levels', () => {
      // deep: a -> b -> c, and a -> c directly. c must clear b, not sit beside it.
      const layout = layoutDag(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')], OPTS);
      expect(levelOf(layout, 'c')).toBe(2);
    });

    it('places a node behind the deeper of two independent parents', () => {
      const layout = layoutDag(
        nodes('root1', 'root2', 'mid', 'join'),
        [edge('root1', 'mid'), edge('mid', 'join'), edge('root2', 'join')],
        OPTS,
      );
      expect(levelOf(layout, 'join')).toBe(2);
    });
  });

  describe('order within a level', () => {
    it('sorts children by the position of their parents', () => {
      const layout = layoutDag(
        nodes('top', 'bottom', 'fromBottom', 'fromTop'),
        [edge('top', 'fromTop'), edge('bottom', 'fromBottom')],
        OPTS,
      );
      // 'top' is first on level 0, so its child leads level 1 although the
      // input lists fromBottom first.
      expect(orderOf(layout, 'fromTop')).toBeLessThan(orderOf(layout, 'fromBottom'));
    });

    it('keeps the input order for roots', () => {
      const layout = layoutDag(nodes('c', 'a', 'b'), [], OPTS);
      expect([orderOf(layout, 'c'), orderOf(layout, 'a'), orderOf(layout, 'b')]).toEqual([0, 1, 2]);
    });

    it('breaks a tie by input order, so the result is stable', () => {
      const ns = nodes('p', 'second', 'first');
      const es = [edge('p', 'second'), edge('p', 'first')];
      const once = layoutDag(ns, es, OPTS);
      const twice = layoutDag(ns, es, OPTS);
      expect(orderOf(once, 'second')).toBeLessThan(orderOf(once, 'first'));
      expect(twice.nodes).toEqual(once.nodes);
      expect(twice.edges).toEqual(once.edges);
    });
  });

  describe('coordinates', () => {
    it('advances one node box plus the gap per level, horizontally', () => {
      const layout = layoutDag(nodes('a', 'b'), [edge('a', 'b')], OPTS);
      const a = layout.nodes.find((n) => n.id === 'a')!;
      const b = layout.nodes.find((n) => n.id === 'b')!;
      expect(b.x - a.x).toBe(OPTS.nodeWidth + OPTS.levelGap);
      expect(a.y).toBe(b.y);
    });

    it('swaps the axes when vertical', () => {
      const layout = layoutDag(nodes('a', 'b'), [edge('a', 'b')], { ...OPTS, orientation: 'vertical' });
      const a = layout.nodes.find((n) => n.id === 'a')!;
      const b = layout.nodes.find((n) => n.id === 'b')!;
      expect(b.y - a.y).toBe(OPTS.nodeHeight + OPTS.levelGap);
      expect(a.x).toBe(b.x);
    });

    it('centres a narrow level against the widest one', () => {
      // Level 0 holds one node, level 1 holds three.
      const layout = layoutDag(
        nodes('root', 'x', 'y', 'z'),
        [edge('root', 'x'), edge('root', 'y'), edge('root', 'z')],
        OPTS,
      );
      const root = layout.nodes.find((n) => n.id === 'root')!;
      const level1 = layout.nodes.filter((n) => n.level === 1);
      const midOfLevel1 = (level1[0].y + level1[level1.length - 1].y + OPTS.nodeHeight) / 2;
      expect(root.y + OPTS.nodeHeight / 2).toBeCloseTo(midOfLevel1, 6);
    });

    it('reports a bounding box that covers every node', () => {
      const layout = layoutDag(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c')], OPTS);
      for (const node of layout.nodes) {
        expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
        expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
      }
      expect(layout.width).toBe(3 * OPTS.nodeWidth + 2 * OPTS.levelGap);
    });
  });

  describe('edges', () => {
    it('marks an edge that spans more than one level', () => {
      const layout = layoutDag(nodes('a', 'b', 'c'), [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')], OPTS);
      const direct = layout.edges.find((e) => e.from === 'a' && e.to === 'c')!;
      const step = layout.edges.find((e) => e.from === 'a' && e.to === 'b')!;
      expect(direct.skipsLevels).toBe(true);
      expect(step.skipsLevels).toBe(false);
      expect(direct.path).not.toBe(step.path);
    });

    it('starts at the trailing edge of the source and ends at the leading edge of the target', () => {
      const layout = layoutDag(nodes('a', 'b'), [edge('a', 'b')], OPTS);
      const a = layout.nodes.find((n) => n.id === 'a')!;
      const b = layout.nodes.find((n) => n.id === 'b')!;
      const numbers = layout.edges[0].path.match(/-?[\d.]+/g)!.map(Number);
      const [startX, startY] = numbers;
      const [endX, endY] = numbers.slice(-2);
      expect(startX).toBeCloseTo(a.x + a.width, 2);
      expect(startY).toBeCloseTo(a.y + a.height / 2, 2);
      expect(endX).toBeCloseTo(b.x, 2);
      expect(endY).toBeCloseTo(b.y + b.height / 2, 2);
    });

    it('keeps one laid out edge per input edge, in input order', () => {
      const es = [edge('a', 'b'), edge('a', 'c')];
      const layout = layoutDag(nodes('a', 'b', 'c'), es, OPTS);
      expect(layout.edges.map((e) => [e.from, e.to])).toEqual([
        ['a', 'b'],
        ['a', 'c'],
      ]);
    });
  });

  describe('rejects broken input', () => {
    it('throws on an edge naming an unknown node', () => {
      expect(() => layoutDag(nodes('a'), [edge('a', 'ghost')], OPTS)).toThrow(DagLayoutError);
    });

    it('throws on a duplicate id', () => {
      expect(() => layoutDag(nodes('a', 'a'), [], OPTS)).toThrow(DagLayoutError);
    });

    it('throws on a cycle instead of falling back quietly', () => {
      expect(() => layoutDag(nodes('a', 'b'), [edge('a', 'b'), edge('b', 'a')], OPTS)).toThrow(DagLayoutError);
    });

    it('throws on a self loop', () => {
      expect(() => layoutDag(nodes('a'), [edge('a', 'a')], OPTS)).toThrow(DagLayoutError);
    });

    it('throws on a cycle that hangs off a healthy root', () => {
      const layout = () =>
        layoutDag(nodes('root', 'a', 'b'), [edge('root', 'a'), edge('a', 'b'), edge('b', 'a')], OPTS);
      expect(layout).toThrow(/Cycle through/);
    });
  });

  describe('the real research tree', () => {
    const researchNodes = Object.keys(RESEARCH_TREE).map((id) => ({ id }));
    const researchEdges = Object.values(RESEARCH_TREE).flatMap((r) =>
      r.prerequisites.map((p) => ({ from: p as string, to: r.id as string })),
    );

    it('lays out without a cycle', () => {
      const layout = layoutDag(researchNodes, researchEdges, OPTS);
      expect(layout.nodes).toHaveLength(researchNodes.length);
      expect(layout.edges).toHaveLength(researchEdges.length);
    });

    it('puts every node behind all of its prerequisites', () => {
      const layout = layoutDag(researchNodes, researchEdges, OPTS);
      const level = new Map(layout.nodes.map((n) => [n.id, n.level]));
      for (const research of Object.values(RESEARCH_TREE)) {
        for (const prerequisite of research.prerequisites) {
          expect(level.get(research.id)!).toBeGreaterThan(level.get(prerequisite)!);
        }
      }
    });

    it('starts the nodes without prerequisites on level 0', () => {
      const layout = layoutDag(researchNodes, researchEdges, OPTS);
      const roots = Object.values(RESEARCH_TREE).filter((r) => r.prerequisites.length === 0);
      expect(roots.length).toBeGreaterThan(0);
      for (const root of roots) expect(levelOf(layout, root.id)).toBe(0);
    });
  });
});
