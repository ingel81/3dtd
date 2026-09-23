import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { ThreeTowerRenderer, type TowerRenderData } from './three-tower.renderer';
import { TOWER_TYPES } from '../../configs/tower-types.config';

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

  it('reports the heading the turret points at, null for a tower it does not know', async () => {
    const data = await create(0);
    advance(5000);
    renderer.updateRotation('t1', 1.2);
    advance(1000);
    expect(angleBetween(renderer.aimHeading('t1')!, 1.2)).toBeLessThan(1e-9);
    expect(renderer.aimHeading('t1')).toBeCloseTo(turretHeading(data), 12);
    expect(renderer.aimHeading('none')).toBeNull();
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

  // Until 2026-09-13 the Magic turret spun at 0.3 rad/s whenever it had no
  // target, in render frames, and never turned to its guard heading.
  describe('magic tower', () => {
    const camera = new PerspectiveCamera();

    /** Render frames and game sub-steps at 1x, as the engine runs them. */
    const frames = (ms: number) => {
      for (let t = 0; t < ms; t += STEP_MS) {
        renderer.updateAnimations(STEP_MS, camera);
        renderer.advanceTurretAim(STEP_MS);
      }
    };

    it('turns to the guard heading after its sweep and holds it', async () => {
      const data = (await renderer.create('t1', 'magic', 0, 0, 0, 0.4, 1.0))!;
      frames(6000);
      expect(data.scanPhase).toBe(0);
      expect(angleBetween(turretHeading(data), 1.0)).toBeLessThan(1e-9);
      frames(3000);
      expect(angleBetween(turretHeading(data), 1.0)).toBeLessThan(1e-9);
    });

    it('holds the last aim once the target is gone', async () => {
      const data = (await renderer.create('t1', 'magic', 0, 0, 0, 0.4, 0))!;
      frames(6000);
      renderer.updateRotation('t1', Math.PI / 2);
      frames(1000);
      renderer.releaseTarget('t1');
      frames(3000);
      expect(angleBetween(turretHeading(data), Math.PI / 2)).toBeLessThan(1e-9);
    });
  });
});

/**
 * Archer, lightning and tentacle models have no turret node. Their aim turns
 * all the same (the blood moon searchlight follows it); the model does not
 * move and firing never waits for it.
 */
describe('ThreeTowerRenderer aim without a turret part', () => {
  const STEP_MS = 1000 / 60;
  const assetManager = {
    loadModel: async () => ({ animations: [] }),
    cloneModel: () => new Group(),
  };
  const sync = {
    geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  };
  const angleBetween = (a: number, b: number) => {
    const d = (((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    return Math.abs(d);
  };

  it('turns its aim to the guard heading and onto a target, the model stays put and fires at once', async () => {
    const renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    const advance = (ms: number) => {
      for (let t = 0; t < ms; t += STEP_MS) renderer.advanceTurretAim(STEP_MS);
    };
    const data = (await renderer.create('a1', 'archer', 0, 0, 0, 0.4, 1.0))!;
    expect(data.turretPart).toBeNull();
    const meshRotation = data.mesh.rotation.y;
    // Placed facing the way the model faces, no reference sweep
    expect(angleBetween(renderer.aimHeading('a1')!, -meshRotation)).toBeLessThan(1e-9);
    expect(data.scanPhase).toBe(0);

    advance(1100);
    expect(angleBetween(renderer.aimHeading('a1')!, 1.0)).toBeLessThan(1e-9);

    renderer.updateRotation('a1', -1);
    expect(renderer.isTurretAligned('a1')).toBe(true);
    advance(1100);
    expect(angleBetween(renderer.aimHeading('a1')!, -1)).toBeLessThan(1e-9);
    expect(data.mesh.rotation.y).toBe(meshRotation);
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

describe('ThreeTowerRenderer model parts', () => {
  /** A silo-like model: the building and the missile standing in it */
  const assetManager = {
    loadModel: async () => ({ animations: [] }),
    cloneModel: () => {
      const model = new Group();
      for (const name of ['silo', 'missile']) {
        const node = new Object3D();
        node.name = name;
        model.add(node);
      }
      return model;
    },
  };
  const sync = {
    geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  };
  const part = (data: TowerRenderData, name: string) => data.mesh.getObjectByName(name)!;

  it('hides and shows a node in every tower of the type, not in other types, and leaves the tower itself visible', async () => {
    const renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    const silo = (await renderer.create('s1', 'missile-silo', 0, 0, 0))!;
    const archer = (await renderer.create('a1', 'archer', 0, 0, 0))!;
    expect(renderer.isPartShown('missile-silo', 'missile')).toBe(true);

    renderer.setPartShown('missile-silo', 'missile', false);
    expect(part(silo, 'missile').visible).toBe(false);
    expect(part(silo, 'silo').visible).toBe(true);
    expect(silo.mesh.visible).toBe(true);
    expect(part(archer, 'missile').visible).toBe(true);
    expect(renderer.isPartShown('missile-silo', 'missile')).toBe(false);

    renderer.setPartShown('missile-silo', 'missile', true);
    expect(part(silo, 'missile').visible).toBe(true);
  });

  it('builds a new tower of the type with the node as the game last said', async () => {
    const renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    renderer.setPartShown('missile-silo', 'missile', false);
    const silo = (await renderer.create('s1', 'missile-silo', 0, 0, 0))!;
    expect(part(silo, 'missile').visible).toBe(false);
    // A model without the node is left as it is
    renderer.setPartShown('missile-silo', 'hatch', false);
    expect(part(silo, 'silo').visible).toBe(true);
  });
});

describe('ThreeTowerRenderer hover range', () => {
  const assetManager = {
    loadModel: async () => ({ animations: [] }),
    cloneModel: () => new Group(),
  };
  const sync = {
    geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  };
  let renderer: ThreeTowerRenderer;
  let a: TowerRenderData;
  let b: TowerRenderData;
  const shows = (data: TowerRenderData) => [data.rangeIndicator!.visible, data.selectionRing!.visible];

  beforeEach(async () => {
    renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    a = (await renderer.create('a', 'archer', 0, 0, 0, 0, null))!;
    b = (await renderer.create('b', 'archer', 0.001, 0, 0, 0, null))!;
  });

  it('shows the range of the hovered tower and hides it when the pointer moves on', () => {
    renderer.setHovered('a');
    expect(shows(a)).toEqual([true, true]);
    renderer.setHovered('b');
    expect(shows(a)).toEqual([false, false]);
    expect(shows(b)).toEqual([true, true]);
    renderer.setHovered(null);
    expect(shows(b)).toEqual([false, false]);
  });

  it('leaves the selected tower its range when the hover moves off it', () => {
    renderer.select('a');
    renderer.setHovered('a');
    renderer.setHovered(null);
    expect(shows(a)).toEqual([true, true]);
  });

  it('keeps the range of a deselected tower that is still under the pointer', () => {
    renderer.select('a');
    renderer.setHovered('a');
    renderer.deselect('a');
    expect(shows(a)).toEqual([true, true]);
    renderer.setHovered(null);
    expect(shows(a)).toEqual([false, false]);
  });

  it('forgets a hovered tower that is removed', () => {
    renderer.setHovered('a');
    renderer.remove('a');
    // A new tower with the id of the removed one starts without the hover
    expect(() => renderer.setHovered(null)).not.toThrow();
    expect(shows(b)).toEqual([false, false]);
  });
});

describe('ThreeTowerRenderer range ring', () => {
  const assetManager = {
    loadModel: async () => ({ animations: [] }),
    cloneModel: () => new Group(),
    releaseModel: () => undefined,
  };
  const sync = {
    geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  };
  let scene: Scene;
  let renderer: ThreeTowerRenderer;

  beforeEach(() => {
    scene = new Scene();
    renderer = new ThreeTowerRenderer(scene, sync as never, assetManager as never);
  });

  it('stands at the tower foot with the range as its radius and follows a range upgrade', async () => {
    const ring = (await renderer.create('a', 'archer', 3, 4, 12, 0, null))!.rangeIndicator!;
    expect(ring.parent).toBe(scene);
    expect(ring.visible).toBe(false);
    expect(ring.position.toArray()).toEqual([4, 12, 3]);
    expect(ring.scale.toArray()).toEqual([TOWER_TYPES.archer.range, 1, TOWER_TYPES.archer.range]);

    renderer.updateRangeIndicator('a', 77);
    expect(ring.scale.toArray()).toEqual([77, 1, 77]);
    renderer.updateRangeIndicator('a');
    expect(ring.scale.x).toBe(TOWER_TYPES.archer.range);

    renderer.updatePosition('a', 5, 6, 20);
    expect(ring.position.toArray()).toEqual([6, 20, 5]);
    expect(ring.scale.x).toBe(TOWER_TYPES.archer.range);
  });

  it('shares geometry and materials between the rings and keeps them when a tower goes', async () => {
    const a = (await renderer.create('a', 'archer', 0, 0, 0, 0, null))!.rangeIndicator!;
    const b = (await renderer.create('b', 'cannon', 0.001, 0, 0, 0, null))!.rangeIndicator!;
    const meshesA = a.children as Mesh[];
    const meshesB = b.children as Mesh[];
    expect(meshesB.map((mesh) => mesh.geometry)).toEqual(meshesA.map((mesh) => mesh.geometry));
    expect(meshesB.map((mesh) => mesh.material)).toEqual(meshesA.map((mesh) => mesh.material));

    const dispose = vi.spyOn(meshesA[0].geometry, 'dispose');
    renderer.remove('a');
    expect(a.parent).toBeNull();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('shows one ring for the build preview, built like a tower ring', async () => {
    const towerRing = (await renderer.create('a', 'archer', 0, 0, 0, 0, null))!.rangeIndicator!;
    const previewRings = scene.children.filter((child) => child.name === 'range-ring' && child !== towerRing);
    expect(previewRings).toHaveLength(1);
    const [previewRing] = previewRings;
    expect(previewRing.visible).toBe(false);
    expect((previewRing.children as Mesh[]).map((mesh) => mesh.material))
      .toEqual((towerRing.children as Mesh[]).map((mesh) => mesh.material));

    renderer.showPreviewRange(1, 2, 3, 55);
    renderer.showPreviewRange(4, 5, 6, 60);
    expect(previewRing.visible).toBe(true);
    expect(previewRing.position.toArray()).toEqual([4, 5, 6]);
    expect(previewRing.scale.toArray()).toEqual([60, 1, 60]);

    renderer.hidePreviewRange();
    expect(previewRing.visible).toBe(false);

    renderer.dispose();
    expect(scene.children.some((child) => child.name === 'range-ring')).toBe(false);
  });
});

describe('ThreeTowerRenderer model top', () => {
  /** A 4 m tall box standing on the model's origin */
  const assetManager = {
    loadModel: async () => ({ animations: [] }),
    cloneModel: () => {
      const model = new Group();
      model.add(new Mesh(new BoxGeometry(1, 4, 1).translate(0, 2, 0)));
      return model;
    },
  };
  const sync = {
    geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  };

  it('measures the top of the model once, in its own frame, and forgets it with the tower', async () => {
    const scene = new Scene();
    // The towers' parent stands 100 m up: the top is read in the frame of the tower's position
    const parent = new Group();
    parent.position.y = 100;
    scene.add(parent);
    const renderer = new ThreeTowerRenderer(scene, sync as never, assetManager as never);
    expect(renderer.modelTopY('t1')).toBeNull();

    const data = (await renderer.create('t1', 'archer', 0, 0, 30, 0, null))!;
    parent.add(data.mesh);
    const top = renderer.modelTopY('t1')!;
    expect(top).toBeCloseTo(data.mesh.position.y + 4 * data.mesh.scale.y);

    // Measured once: a model moved afterwards keeps it
    data.mesh.position.y += 50;
    expect(renderer.modelTopY('t1')).toBe(top);

    renderer.remove('t1');
    expect(renderer.modelTopY('t1')).toBeNull();
  });
});
