import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Vector3 } from 'three';

// The GPU viz needs a renderer; the fake records what it is asked.
const losViz = vi.hoisted(() => ({
  instances: [] as {
    opts: Record<string, unknown>;
    filterMode: string | null;
    parent: unknown;
    tips: number[];
    moves: { x: number; cells: number }[];
    visible: boolean;
    ticks: number[];
    disposed: boolean;
  }[],
}));
vi.mock('../utils/tower-los-viz', () => ({
  TowerLosViz: class {
    filterMode: string | null = null;
    parent: unknown = null;
    tips: number[] = [];
    moves: { x: number; cells: number }[] = [];
    visible = true;
    ticks: number[] = [];
    disposed = false;
    constructor(public opts: Record<string, unknown>) {
      losViz.instances.push(this);
    }
    setFilterMode(mode: string) { this.filterMode = mode; }
    addTo(scene: unknown) { this.parent = scene; }
    updateTowerTip(tip: { x: number }) { this.tips.push(tip.x); }
    moveTo(tip: { x: number }, cells: unknown[]) { this.moves.push({ x: tip.x, cells: cells.length }); }
    setVisible(visible: boolean) { this.visible = visible; }
    tick(time: number) { this.ticks.push(time); }
    dispose() { this.disposed = true; }
  },
}));

import { BuildPreviewLos } from './build-preview-los';
import { TOWER_TYPES } from '../configs/tower-types.config';
import type { GlobalRouteGridService } from './world/global-route-grid.service';
import type { ThreeTilesEngine } from '../three-engine';

/**
 * The build-preview LOS viz on its own: when it is built, when only the tip
 * moves, and what it is built from. The service spec runs it behind the
 * cursor.
 */
describe('BuildPreviewLos', () => {
  /** Local frame: lon is x, lat is z, height is y. */
  const sync = { geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }) };

  let grid: {
    isInitialized: ReturnType<typeof vi.fn>;
    getCellsInRange: ReturnType<typeof vi.fn>;
    getCellSize: () => number;
  };
  let blockerGroup: object | null;
  let engine: ThreeTilesEngine;
  let scene: object;
  let mapper: object;
  let airUnlocked: boolean;
  let preview: BuildPreviewLos;

  beforeEach(() => {
    losViz.instances.length = 0;
    grid = {
      isInitialized: vi.fn(() => true),
      getCellsInRange: vi.fn(() => [{}, {}, {}]),
      getCellSize: () => 2,
    };
    blockerGroup = {};
    scene = {};
    mapper = {};
    engine = {
      sync,
      getLosBlockerGroup: () => blockerGroup,
      getTowerShadowMapper: () => mapper,
      getScene: () => scene,
    } as unknown as ThreeTilesEngine;
    airUnlocked = false;
    preview = new BuildPreviewLos(grid as unknown as GlobalRouteGridService, () => airUnlocked);
  });

  it('builds the viz from the cells in range at the tower tip, with the filter mode', () => {
    preview.update(engine, 10, 20, 5, 'archer', 'air');

    const config = TOWER_TYPES.archer;
    expect(grid.getCellsInRange).toHaveBeenCalledWith(20, 10, config.range);
    const [viz] = losViz.instances;
    expect(viz.opts).toMatchObject({
      groundRange: config.range,
      airRange: config.range,
      canTargetGround: true,
      canTargetAir: true,
      gridCellSize: 2,
      shadowMapper: mapper,
      blockerGroup,
    });
    const tip = viz.opts['towerTip'] as Vector3;
    expect(tip.y).toBeCloseTo(5 + config.heightOffset + config.shootHeight);
    expect(viz.filterMode).toBe('air');
    expect(viz.parent).toBe(scene);
  });

  it('moves only the tip within a meter and the cells beyond it, in the same viz', () => {
    preview.update(engine, 0, 0, 0, 'archer', 'both');
    preview.update(engine, 0, 0.9, 0, 'archer', 'both');
    expect(losViz.instances).toHaveLength(1);
    expect(losViz.instances[0].tips).toEqual([0.9]);

    grid.getCellsInRange.mockReturnValue([{}, {}]);
    preview.update(engine, 0, 2, 0, 'archer', 'both');
    expect(losViz.instances).toHaveLength(1);
    expect(losViz.instances[0].moves).toEqual([{ x: 2, cells: 2 }]);
    expect(losViz.instances[0].disposed).toBe(false);
  });

  it('gives the viz room for every cell its range can reach', () => {
    preview.update(engine, 0, 0, 0, 'archer', 'both');
    const capacity = losViz.instances[0].opts['capacity'] as number;
    // The grid slots of the box around the reach (GlobalRouteGrid.getCellsInRange)
    const slots = (2 * TOWER_TYPES.archer.range) / 2 + 2;
    expect(capacity).toBeGreaterThanOrEqual(slots * slots);
  });

  it('hides the viz on an invalid spot or without cells, and moves it to the next spot that has some', () => {
    preview.update(engine, 0, 0, 0, 'archer', 'both');
    const [viz] = losViz.instances;
    preview.hide();
    expect(viz.visible).toBe(false);
    preview.tick(1);
    expect(viz.ticks).toEqual([]);

    // Back within the meter: the cells are collected again, it was hidden
    preview.update(engine, 0, 0.5, 0, 'archer', 'both');
    expect(viz.moves).toEqual([{ x: 0.5, cells: 3 }]);
    expect(viz.visible).toBe(true);

    grid.getCellsInRange.mockReturnValue([]);
    preview.update(engine, 0, 5, 0, 'archer', 'both');
    expect(viz.visible).toBe(false);
    expect(losViz.instances).toHaveLength(1);
    expect(viz.disposed).toBe(false);
  });

  it('builds the viz anew for another type, and for the air retrofit of a retrofittable type', () => {
    preview.update(engine, 0, 0, 0, 'dual-gatling', 'both');
    expect(losViz.instances[0].opts).toMatchObject({ canTargetAir: false });

    airUnlocked = true;
    preview.update(engine, 0, 5, 0, 'dual-gatling', 'both');
    expect(losViz.instances[0].disposed).toBe(true);
    expect(losViz.instances[1].opts).toMatchObject({ canTargetAir: true });

    preview.update(engine, 0, 5.5, 0, 'cannon', 'both');
    expect(losViz.instances[1].disposed).toBe(true);
    expect(losViz.instances[2].opts).toMatchObject({ groundRange: TOWER_TYPES.cannon.range });
  });

  it('builds nothing without an initialized grid, a blocker group or cells in range', () => {
    grid.isInitialized.mockReturnValue(false);
    preview.update(engine, 0, 0, 0, 'archer', 'both');
    expect(grid.getCellsInRange).not.toHaveBeenCalled();

    grid.isInitialized.mockReturnValue(true);
    blockerGroup = null;
    preview.update(engine, 0, 0, 0, 'archer', 'both');
    blockerGroup = {};
    grid.getCellsInRange.mockReturnValue([]);
    preview.update(engine, 0, 5, 0, 'archer', 'both');

    expect(losViz.instances).toHaveLength(0);
  });

  it('forwards filter changes and frame ticks, and drops the viz on dispose', () => {
    preview.tick(1);
    preview.setFilterMode('ground');
    preview.update(engine, 0, 0, 0, 'archer', 'both');
    preview.setFilterMode('ground');
    preview.tick(2);

    const [viz] = losViz.instances;
    expect(viz.filterMode).toBe('ground');
    expect(viz.ticks).toEqual([2]);

    preview.dispose();
    preview.dispose();
    expect(viz.disposed).toBe(true);
    preview.update(engine, 0, 0, 0, 'archer', 'both');
    expect(losViz.instances).toHaveLength(2);
  });
});
