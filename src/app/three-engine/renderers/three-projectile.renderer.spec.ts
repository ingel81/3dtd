import { describe, it, expect, beforeEach } from 'vitest';
import { BoxGeometry, Euler, MeshBasicMaterial, Scene, Vector3 } from 'three';
import { createRocketGeometry, ProjectileInstanceManager, ThreeProjectileRenderer } from './three-projectile.renderer';
import { StateLerp } from './state-lerp';
import type { CoordinateSync } from './index';
import { PROJECTILE_TYPES } from '../../configs/projectile-types.config';
import { MAGIC_ORB_FRAGMENT } from './magic-orb-shaders';
import { DISPLAY_OUTPUT_GLSL } from './display-output';

describe('orb shader (magic, ice, poison, chaos)', () => {
  it('writes its additive light for the target, with log depth', () => {
    expect(MAGIC_ORB_FRAGMENT).toContain(DISPLAY_OUTPUT_GLSL);
    expect(MAGIC_ORB_FRAGMENT).toContain('gl_FragColor = displayLight(vec4(finalColor, sphereFade * 0.9));');
    expect(MAGIC_ORB_FRAGMENT).toContain('#include <logdepthbuf_fragment>');
  });
});

describe('createRocketGeometry', () => {
  const geometry = createRocketGeometry();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  it('points the nose along +Y, centred on the projectile position', () => {
    expect(box.max.y).toBeCloseTo(-box.min.y, 5);
    expect(box.max.y - box.min.y).toBeGreaterThan(3.5); // readable length
  });

  it('starts the trail at the nozzle', () => {
    const rocket = PROJECTILE_TYPES.rocket;
    expect(rocket.tailOffset).toBeCloseTo(-box.min.y * rocket.scale, 5);
  });

  it('colours every vertex (one material, one draw call)', () => {
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
    expect(geometry.groups).toHaveLength(0);
  });
});

describe('ProjectileInstanceManager', () => {
  let manager: ProjectileInstanceManager;
  const scale = new Vector3(1, 1, 1);
  const add = (id: string) => manager.add(id, new Vector3(), new Euler(), scale);

  beforeEach(() => {
    manager = new ProjectileInstanceManager(new BoxGeometry(), new MeshBasicMaterial(), 4);
  });

  it('shrinks the draw count when the top projectiles are removed', () => {
    add('a');
    add('b');
    add('c');
    const mesh = manager.instancedMesh;
    expect(mesh.count).toBe(3);

    manager.remove('b'); // a hole, c still holds the top slot
    expect(mesh.count).toBe(3);
    manager.remove('c');
    expect(mesh.count).toBe(1);

    add('d');
    expect(mesh.count).toBe(2);
    manager.clear();
    expect(mesh.count).toBe(0);
    expect(manager.count).toBe(0);
  });

  it('uploads one range over the drawn slots per flush', () => {
    add('a');
    add('b');
    add('c');
    const matrix = manager.instancedMesh.instanceMatrix;
    const version = matrix.version;
    manager.updatePosition('a', new Vector3(1, 2, 3));
    manager.update('b', new Vector3(4, 5, 6), new Euler(0.1, 0.2, 0.3));
    expect(matrix.version).toBe(version); // nothing uploads before the flush

    manager.flush();
    expect(matrix.version).toBe(version + 1);
    expect(matrix.updateRanges).toEqual([{ start: 0, count: 48 }]);

    manager.remove('c');
    manager.flush();
    expect(matrix.updateRanges).toEqual([{ start: 0, count: 32 }]);

    manager.flush(); // nothing written since
    expect(matrix.version).toBe(version + 2);
  });

  it('adds no zero-length range once every projectile is gone', () => {
    add('a');
    manager.flush();
    const matrix = manager.instancedMesh.instanceMatrix;
    matrix.clearUpdateRanges(); // stands in for the upload
    const version = matrix.version;

    manager.remove('a');
    manager.flush();
    // (0, 0) would make three upload the whole buffer.
    expect(matrix.updateRanges).toEqual([]);
    expect(matrix.version).toBe(version);
  });

  it('skips projectiles beyond the pool size instead of drawing past the buffer', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) add(id);
    expect(manager.count).toBe(4);
    expect(manager.instancedMesh.count).toBe(4);

    manager.remove('e'); // never placed: no-op
    manager.remove('a');
    add('f');
    expect(manager.count).toBe(4);
  });

  describe('between two states (state-lerp.ts)', () => {
    const x = (index = 0) => (manager.instancedMesh.instanceMatrix.array as Float32Array)[index * 16 + 12];
    const at = (px: number) => new Vector3(px, 0, 0);

    beforeEach(() => {
      manager.slides = true;
      manager.carry = 0;
      add('a');
    });

    it('slides from where it was shown to its newest state, rotation and scale kept', () => {
      manager.updatePosition('a', at(3));
      expect(manager.lastOffset.x).toBe(-3);
      expect(x()).toBe(0);
      manager.slide(0.5);
      expect(x()).toBeCloseTo(1.5, 6);
      manager.slide(1);
      expect(x()).toBe(3);
      // Arrived: nothing left to write
      (manager.instancedMesh.instanceMatrix.array as Float32Array)[12] = 99;
      manager.slide(1);
      expect(x()).toBe(99);
    });

    it('goes on from where it is shown when the next state comes early', () => {
      manager.updatePosition('a', at(3));
      manager.slide(0.5);
      manager.carry = 0.5;
      manager.update('a', at(6), new Euler());
      expect(x()).toBeCloseTo(1.5, 6);
      manager.slide(1);
      expect(x()).toBe(6);
    });

    it('flies out of the muzzle: the first state of a fast shot, metres ahead, still slides from where it was made', () => {
      manager.updatePosition('a', at(24));
      expect(x()).toBe(0);
      manager.slide(0.5);
      expect(x()).toBeCloseTo(12, 6);
    });

    it('stands at once after a jump, in a slot taken again, and with the slide off', () => {
      manager.updatePosition('a', at(100));
      expect(x()).toBe(100);
      manager.updatePosition('a', at(102));
      manager.remove('a');
      manager.add('b', at(7), new Euler(), scale);
      manager.slide(0.2);
      expect(x()).toBe(7);

      manager.slides = false;
      manager.updatePosition('b', at(9));
      expect(x()).toBe(9);
      expect(manager.lastOffset.x).toBe(0);
    });
  });

  it('stays out of the render list while no projectile is in flight', () => {
    const mesh = manager.instancedMesh;
    expect(mesh.visible).toBe(false);

    add('a');
    add('b');
    expect(mesh.visible).toBe(true);
    manager.remove('a');
    expect(mesh.visible).toBe(true);
    manager.remove('b');
    expect(mesh.visible).toBe(false);

    add('c');
    manager.clear();
    expect(mesh.visible).toBe(false);
  });
});

describe('ThreeProjectileRenderer, a hit shown to its end', () => {
  // Local x = lat, y = height: a shot along x
  const sync = { geoToLocal: (lat: number, _lon: number, height: number) => new Vector3(lat, height, 0) } as unknown as CoordinateSync;
  let renderer: ThreeProjectileRenderer;
  const flying = () => renderer.count;

  beforeEach(() => {
    renderer = new ThreeProjectileRenderer(new Scene(), sync);
    renderer.stateLerp = new StateLerp();
    renderer.beginState(0);
    renderer.create('p', 'bullet', 0, 0, 0, { dx: 1, dy: 0, dz: 0 });
    renderer.beginState(0);
    renderer.update('p', 10, 0, 0);
  });

  it('slides to its hit point with the next state and goes one state later, with its trail', () => {
    renderer.finish('p', 30, 0, 0);
    expect(flying()).toBe(1);

    renderer.beginState(0);
    expect(renderer.landed).toEqual([]);
    expect(renderer.landingNow).toHaveLength(1);
    const [landing] = renderer.landingNow;
    expect(landing.id).toBe('p');
    // Shown where its last state put it, the rest of the way to the hit ahead
    expect(landing.shown.x).toBeCloseTo(10, 6);
    expect(landing.lead.x).toBeCloseTo(20, 6);
    expect(flying()).toBe(1);

    renderer.beginState(0);
    expect(renderer.landed).toEqual(['p']);
    expect(renderer.landingNow).toEqual([]);
    expect(flying()).toBe(0);
  });

  it('goes at once with the slide off', () => {
    renderer.stateLerp = new StateLerp(false);
    renderer.finish('p', 30, 0, 0);
    renderer.beginState(0);
    expect(renderer.landed).toEqual(['p']);
    expect(flying()).toBe(0);
  });

  it('forgets a hit that a remove or a clear took first', () => {
    renderer.finish('p', 30, 0, 0);
    renderer.remove('p');
    renderer.beginState(0);
    expect(renderer.landingNow).toEqual([]);

    renderer.create('q', 'bullet', 0, 0, 0, { dx: 1, dy: 0, dz: 0 });
    renderer.finish('q', 5, 0, 0);
    renderer.clear();
    renderer.beginState(0);
    expect(renderer.landingNow).toEqual([]);
    expect(renderer.landed).toEqual([]);
  });
});
