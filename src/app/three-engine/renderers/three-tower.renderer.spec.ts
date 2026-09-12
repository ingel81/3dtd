import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Group, Object3D, Scene, Vector3 } from 'three';
import { ThreeTowerRenderer, type TowerRenderData } from './three-tower.renderer';

/**
 * Turret heading without a target. A turret holds its heading when the target
 * is gone and turns to the guard heading only when asked to, at the aiming
 * speed (π rad/s game-time). Real three.js objects; model loading and the
 * coordinate sync are fakes.
 */
describe('ThreeTowerRenderer turret heading', () => {
  const STEP_MS = 1000 / 60;
  let renderer: ThreeTowerRenderer;

  const assetManager = {
    loadModel: async () => ({ animations: [] }),
    cloneModel: () => {
      const model = new Group();
      const turret = new Object3D();
      turret.name = 'turret_top';
      model.add(turret);
      return model;
    },
    isFbxModel: () => false,
  };
  const sync = {
    geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  };

  /** Run the per-sub-step turret aim for `ms` of game-time. */
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += STEP_MS) renderer.advanceTurretAim(STEP_MS);
  };

  /** Geo heading the turret points at, recovered from its local rotation. */
  const turretHeading = (data: TowerRenderData) =>
    -(data.currentLocalRotation + data.mesh.rotation.y + (data.typeConfig.turretBarrelOffset ?? 0));

  /** Absolute angle between two headings, in [0, π]. */
  const angleBetween = (a: number, b: number) => {
    const d = (((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    return Math.abs(d);
  };

  const create = async (guardHeading: number | null, customRotation = 0.4) =>
    (await renderer.create('t1', 'archer', 0, 0, 0, customRotation, guardHeading))!;

  beforeEach(() => {
    renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
  });

  it('sweeps around the placed pose first, then turns to the guard heading', async () => {
    const data = await create(1.0);
    // Placed as the preview showed it: the model's own turret pose.
    expect(data.currentLocalRotation).toBe(0);
    expect(data.turretPart!.rotation.y).toBe(0);

    // Visible the whole way: the node follows every step, never faster than
    // the aiming speed, so there is no jump.
    const maxStep = Math.PI * (STEP_MS / 1000) + 1e-9;
    let previous = data.turretPart!.rotation.y;
    let sweepMin = 0;
    let sweepMax = 0;
    for (let t = 0; t < 6000; t += STEP_MS) {
      renderer.advanceTurretAim(STEP_MS);
      expect(data.turretPart!.rotation.y).toBe(data.currentLocalRotation);
      expect(Math.abs(data.turretPart!.rotation.y - previous)).toBeLessThanOrEqual(maxStep);
      previous = data.turretPart!.rotation.y;
      if (data.scanPhase > 0) {
        sweepMin = Math.min(sweepMin, data.currentLocalRotation);
        sweepMax = Math.max(sweepMax, data.currentLocalRotation);
      }
    }

    // Reference sweep: 75° either side of the pose it was placed in.
    expect(sweepMin).toBeCloseTo(-1.309, 6);
    expect(sweepMax).toBeCloseTo(1.309, 6);
    // Then the turn to the guard heading.
    expect(data.scanPhase).toBe(0);
    expect(angleBetween(turretHeading(data), 1.0)).toBeLessThan(1e-9);
  });

  it('keeps the model pose when there is no guard heading', async () => {
    const data = await create(null);
    expect(data.currentLocalRotation).toBe(0);
    advance(5000);
    expect(data.currentLocalRotation).toBe(0);
  });

  it('holds the last aim once the target is gone', async () => {
    const data = await create(0);
    renderer.updateRotation('t1', Math.PI / 2);
    advance(1000);
    expect(angleBetween(turretHeading(data), Math.PI / 2)).toBeLessThan(1e-9);

    renderer.releaseTarget('t1');
    advance(3000);
    expect(data.hasTarget).toBe(false);
    expect(angleBetween(turretHeading(data), Math.PI / 2)).toBeLessThan(1e-9);
  });

  it('finishes the turn it is in when the target is gone', async () => {
    const data = await create(0);
    renderer.updateRotation('t1', Math.PI / 2);
    advance(250); // halfway
    renderer.releaseTarget('t1');
    advance(1000);
    expect(angleBetween(turretHeading(data), Math.PI / 2)).toBeLessThan(1e-9);
  });

  it('turns to the guard heading at the aiming speed', async () => {
    const data = await create(0);
    advance(5000); // placement scan done, facing north

    renderer.setIdleHeading('t1', (3 * Math.PI) / 4);
    expect(data.hasTarget).toBe(false);
    advance(500); // π rad/s: a quarter turn
    expect(angleBetween(turretHeading(data), Math.PI / 2)).toBeLessThan(0.02);
    advance(500);
    expect(angleBetween(turretHeading(data), (3 * Math.PI) / 4)).toBeLessThan(1e-9);
  });
});

describe('ThreeTowerRenderer turret node', () => {
  /** A model with a 'top' node and a chaos-style 'crystal' among its siblings. */
  const assetManager = {
    loadModel: async () => ({ animations: [] }),
    cloneModel: () => {
      const model = new Group();
      for (const name of ['crystal-small', 'top', 'crystal']) {
        const node = new Object3D();
        node.name = name;
        model.add(node);
      }
      return model;
    },
    isFbxModel: () => false,
  };
  const sync = {
    geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  };

  it('turns the node the config names, not the default names', async () => {
    const renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    const data = (await renderer.create('c1', 'chaos', 0, 0, 0, 0, null))!;
    expect(data.turretPart?.name).toBe('crystal');
  });

  it('falls back to turret_top, tower_top or top without a turretNode', async () => {
    const renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    const data = (await renderer.create('a1', 'archer', 0, 0, 0, 0, null))!;
    expect(data.turretPart?.name).toBe('top');
  });

  it('turns nothing and warns once per type when the model lacks the turretNode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const withoutCrystal = {
      ...assetManager,
      cloneModel: () => {
        const model = new Group();
        const top = new Object3D();
        top.name = 'top';
        model.add(top);
        return model;
      },
    };
    const renderer = new ThreeTowerRenderer(new Scene(), sync as never, withoutCrystal as never);
    const data = (await renderer.create('c1', 'chaos', 0, 0, 0, 0, null))!;
    await renderer.create('c2', 'chaos', 0, 0, 0, 0, null);

    expect(data.turretPart?.name).toBeUndefined();
    const turretWarnings = warn.mock.calls.filter(([message]) => String(message).includes('turretNode'));
    expect(turretWarnings).toHaveLength(1);
    expect(turretWarnings[0][0]).toContain("'crystal'");
    warn.mockRestore();
  });
});
