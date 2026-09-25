import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Group, Mesh, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { ThreeTowerRenderer, type TowerRenderData } from './three-tower.renderer';
import { TOWER_TYPES, type TowerTypeId } from '../../configs/tower-types.config';
import { aimAt, aimIdle, createTowerAim, headingToLocalRotation, stepTowerAim, type TowerAim } from '../../entities/tower-aim';

const STEP_MS = 1000 / 60;

/** A tower's aim as TowerManager.placeTower sets it up: its placement, then the guard heading. */
function placedAim(typeId: TowerTypeId, customRotation: number, guardHeading: number | null): TowerAim {
  const aim = createTowerAim(TOWER_TYPES[typeId], customRotation);
  if (guardHeading !== null) aimIdle(aim, guardHeading);
  return aim;
}

/** Absolute angle between two headings, in [0, π]. */
const angleBetween = (a: number, b: number) => {
  const d = (((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return Math.abs(d);
};

/**
 * The renderer draws the tower's aim (Tower.aim), which the simulation turns
 * per sub-step: the turret node follows it every render frame, whenever the
 * model loaded. Real three.js objects; model loading and the coordinate sync
 * are fakes.
 */
describe('ThreeTowerRenderer draws the tower aim', () => {
  let renderer: ThreeTowerRenderer;
  const camera = new PerspectiveCamera();

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

  /** The heading the turret node shows. */
  const turretHeading = (data: TowerRenderData) =>
    -(data.turretPart!.rotation.y + data.mesh.rotation.y + (data.typeConfig.turretBarrelOffset ?? 0));

  /** Sub-steps and render frames at 1x, as the engine runs them. */
  const frames = (aim: TowerAim, ms: number) => {
    for (let t = 0; t < ms; t += STEP_MS) {
      stepTowerAim(aim, STEP_MS);
      renderer.updateAnimations(STEP_MS, camera);
    }
  };

  beforeEach(() => {
    renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
  });

  it('adds no model for a tower removed or built again while its model loaded (a snapshot restore)', async () => {
    const scene = new Scene();
    const local = new ThreeTowerRenderer(scene, sync as never, assetManager as never);
    const aim = placedAim('cannon', 0, 0);

    // Removed before the model arrived: nothing comes up
    const gone = local.create('t1', 'cannon', 0, 0, 0, 0, aim);
    local.remove('t1');
    expect(await gone).toBeNull();
    expect(local.get('t1')).toBeUndefined();

    // Cleared and built again at once: only the second model stands
    const first = local.create('t2', 'cannon', 0, 0, 0, 0, aim);
    local.clear();
    const second = local.create('t2', 'cannon', 0, 0, 0, 0, aim);
    expect(await first).toBeNull();
    const data = await second;
    expect(local.get('t2')).toBe(data);
    expect(scene.children.filter((child) => child === data!.mesh)).toHaveLength(1);
    expect(local.count).toBe(1);
  });

  it('greys out a tower held before its model arrived (a snapshot restore)', async () => {
    const local = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    const pending = local.create('t3', 'cannon', 0, 0, 0, 0, placedAim('cannon', 0, 0));
    local.setHoldFire('t3', true);
    const data = (await pending)!;
    expect(data.holdFire).toBe(true);
    // Released after it came: back to its colours, and a new tower of that id starts unheld
    local.setHoldFire('t3', false);
    expect(data.holdFire).toBe(false);
    local.remove('t3');
    const again = (await local.create('t3', 'cannon', 0, 0, 0, 0, placedAim('cannon', 0, 0)))!;
    expect(again.holdFire).toBe(false);
  });

  it("shows a partner's ring in their lane colour on hover only, and gives the gold one back (coop R14, T51)", async () => {
    const data = (await renderer.create('t4', 'cannon', 0, 0, 0, 0, placedAim('cannon', 0, 0)))!;
    const ring = data.selectionRing!;
    const gold = ring.material;
    expect(ring.visible).toBe(false);
    renderer.setOwnerRing('t4', 0x3fa7ff);
    // Not at all times: that was too much (PLAYTEST T51)
    expect(ring.visible).toBe(false);
    expect((ring.material as unknown as { color: { getHex(): number } }).color.getHex()).toBe(0x3fa7ff);
    renderer.setHovered('t4');
    expect(ring.visible).toBe(true);
    renderer.setHovered(null);
    expect(ring.visible).toBe(false);
    // The shared gold material stays gold
    expect((gold as unknown as { color: { getHex(): number } }).color.getHex()).not.toBe(0x3fa7ff);
    renderer.setOwnerRing('t4', null);
    expect(ring.material).toBe(gold);
    expect(ring.visible).toBe(false);
  });

  it("wears the partner's colour when it was set while the model loaded (coop R14, PLAYTEST T41)", async () => {
    const local = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    const pending = local.create('t5', 'cannon', 0, 0, 0, 0, placedAim('cannon', 0, 0));
    local.setOwnerRing('t5', 0xf97316);
    const ring = (await pending)!.selectionRing!;
    local.setHovered('t5');
    expect(ring.visible).toBe(true);
    expect((ring.material as unknown as { color: { getHex(): number } }).color.getHex()).toBe(0xf97316);
    local.setHovered(null);
    // A new tower of that id starts with the gold ring
    local.remove('t5');
    const again = (await local.create('t5', 'cannon', 0, 0, 0, 0, placedAim('cannon', 0, 0)))!;
    expect(again.selectionRing!.visible).toBe(false);
  });

  it('shows the placed pose first, then the sweep, then the guard heading, never jumping', async () => {
    const aim = placedAim('cannon', 0.4, 1.0);
    const data = (await renderer.create('t1', 'cannon', 0, 0, 0, 0.4, aim))!;
    // Placed as the preview showed it: the model's own turret pose
    expect(data.turretPart!.rotation.y).toBeCloseTo(0, 12);

    const maxStep = Math.PI * (STEP_MS / 1000) + 1e-9;
    let previous = data.turretPart!.rotation.y;
    let sweepMin = 0;
    let sweepMax = 0;
    for (let t = 0; t < 6000; t += STEP_MS) {
      frames(aim, STEP_MS);
      const shown = data.turretPart!.rotation.y;
      expect(shown).toBeCloseTo(headingToLocalRotation(data.typeConfig, data.mesh.rotation.y, aim.current), 12);
      // A whole turn apart is the same pose
      expect(angleBetween(shown, previous)).toBeLessThanOrEqual(maxStep);
      previous = shown;
      if (aim.scanPhase > 0) {
        sweepMin = Math.min(sweepMin, shown);
        sweepMax = Math.max(sweepMax, shown);
      }
    }
    // Reference sweep: 75° either side of the pose it was placed in
    expect(sweepMin).toBeCloseTo(-1.309, 6);
    expect(sweepMax).toBeCloseTo(1.309, 6);
    expect(angleBetween(turretHeading(data), 1.0)).toBeLessThan(1e-9);
  });

  it('shows where the aim turned to while the model loaded', async () => {
    const aim = placedAim('cannon', 0, null);
    aimAt(aim, 2);
    for (let t = 0; t < 1000; t += STEP_MS) stepTowerAim(aim, STEP_MS);
    const data = (await renderer.create('t1', 'cannon', 0, 0, 0, 0, aim))!;
    expect(angleBetween(turretHeading(data), 2)).toBeLessThan(1e-9);
  });

  it('reports the heading of the aim, null for a tower it does not know', async () => {
    const aim = placedAim('cannon', 0.4, 0);
    await renderer.create('t1', 'cannon', 0, 0, 0, 0.4, aim);
    aimAt(aim, 1.2);
    frames(aim, 1000);
    expect(renderer.aimHeading('t1')).toBe(aim.current);
    expect(angleBetween(renderer.aimHeading('t1')!, 1.2)).toBeLessThan(1e-9);
    expect(renderer.aimHeading('none')).toBeNull();
  });

  it('draws the turret where the aim points after a debug turn of the model', async () => {
    const aim = placedAim('cannon', 0, 0.5);
    const data = (await renderer.create('t1', 'cannon', 0, 0, 0, 0, aim))!;
    frames(aim, 6000);
    renderer.applyDebugOverrides('cannon', { scale: 3, heightOffset: 0, shootHeight: 1, rotationY: 1.1 });
    frames(aim, STEP_MS);
    expect(angleBetween(turretHeading(data), 0.5)).toBeLessThan(1e-9);
  });

  // Until 2026-09-13 the Magic turret spun at 0.3 rad/s whenever it had no
  // target, in render frames, and never turned to its guard heading.
  it('turns the magic turret like any other, its orb hovering', async () => {
    const aim = placedAim('magic', 0.4, 1.0);
    const data = (await renderer.create('t1', 'magic', 0, 0, 0, 0.4, aim))!;
    frames(aim, 6000);
    expect(angleBetween(turretHeading(data), 1.0)).toBeLessThan(1e-9);
    aimAt(aim, Math.PI / 2);
    frames(aim, 3000);
    expect(angleBetween(turretHeading(data), Math.PI / 2)).toBeLessThan(1e-9);
  });

  it('turns the aim the same with and without a renderer drawing it', async () => {
    const drawn = placedAim('dual-gatling', 0.4, 1.0);
    const headless = placedAim('dual-gatling', 0.4, 1.0);
    await renderer.create('t1', 'dual-gatling', 0, 0, 0, 0.4, drawn);
    const script = (aim: TowerAim, t: number) => {
      if (t === 90) aimAt(aim, -2);
      if (t === 150) aimAt(aim, 2.5);
      if (t === 200) aimIdle(aim, 1);
    };
    for (let t = 0; t < 400; t++) {
      script(drawn, t);
      script(headless, t);
      stepTowerAim(drawn, STEP_MS);
      stepTowerAim(headless, STEP_MS);
      renderer.updateAnimations(STEP_MS, camera);
      expect(drawn).toEqual(headless);
    }
  });
});

/**
 * Archer, lightning and tentacle models have no turret node. Their aim turns
 * all the same (the blood moon searchlight follows it); the model does not
 * move and firing never waits for it.
 */
describe('ThreeTowerRenderer aim without a turret part', () => {
  const assetManager = {
    loadModel: async () => ({ animations: [] }),
    cloneModel: () => new Group(),
  };
  const sync = {
    geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
  };

  it('reports the aim as it turns, the model stays put', async () => {
    const renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    const aim = placedAim('archer', 0.4, 1.0);
    const data = (await renderer.create('a1', 'archer', 0, 0, 0, 0.4, aim))!;
    expect(data.turretPart).toBeNull();
    const meshRotation = data.mesh.rotation.y;
    // Placed facing the way the model faces, no reference sweep
    expect(angleBetween(renderer.aimHeading('a1')!, -meshRotation)).toBeLessThan(1e-9);
    expect(aim.scanPhase).toBe(0);

    for (let t = 0; t < 1100; t += STEP_MS) {
      stepTowerAim(aim, STEP_MS);
      renderer.updateAnimations(STEP_MS, new PerspectiveCamera());
    }
    expect(angleBetween(renderer.aimHeading('a1')!, 1.0)).toBeLessThan(1e-9);
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
    const data = (await renderer.create('c1', 'chaos', 0, 0, 0, 0, placedAim('chaos', 0, null)))!;
    expect(data.turretPart?.name).toBe('crystal');
  });

  it('falls back to turret_top, tower_top or top without a turretNode', async () => {
    const renderer = new ThreeTowerRenderer(new Scene(), sync as never, assetManager as never);
    const data = (await renderer.create('a1', 'archer', 0, 0, 0, 0, placedAim('archer', 0, null)))!;
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
    const data = (await renderer.create('c1', 'chaos', 0, 0, 0, 0, placedAim('chaos', 0, null)))!;
    await renderer.create('c2', 'chaos', 0, 0, 0, 0, placedAim('chaos', 0, null));

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
    const silo = (await renderer.create('s1', 'missile-silo', 0, 0, 0, 0, placedAim('missile-silo', 0, null)))!;
    const archer = (await renderer.create('a1', 'archer', 0, 0, 0, 0, placedAim('archer', 0, null)))!;
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
    const silo = (await renderer.create('s1', 'missile-silo', 0, 0, 0, 0, placedAim('missile-silo', 0, null)))!;
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
    a = (await renderer.create('a', 'archer', 0, 0, 0, 0, placedAim('archer', 0, null)))!;
    b = (await renderer.create('b', 'archer', 0.001, 0, 0, 0, placedAim('archer', 0, null)))!;
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
    const ring = (await renderer.create('a', 'archer', 3, 4, 12, 0, placedAim('archer', 0, null)))!.rangeIndicator!;
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
    const a = (await renderer.create('a', 'archer', 0, 0, 0, 0, placedAim('archer', 0, null)))!.rangeIndicator!;
    const b = (await renderer.create('b', 'cannon', 0.001, 0, 0, 0, placedAim('cannon', 0, null)))!.rangeIndicator!;
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
    const towerRing = (await renderer.create('a', 'archer', 0, 0, 0, 0, placedAim('archer', 0, null)))!.rangeIndicator!;
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
