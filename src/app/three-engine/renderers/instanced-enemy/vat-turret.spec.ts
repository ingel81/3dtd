import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vector3, type AnimationClip, type Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { parsePackedGlb } from '../../../../test/packed-glb';
import { bakeEnemyVAT, bakeEnemyVATSliced, type VATData } from './vat-baker';
import { TURRET_MARKERS, turnAbout, turretPoint } from './vat-turret';

/**
 * The turret joints of the jumper as the game bakes them (vat-turret.ts):
 * which vertices turn, where the markers sit, which way the angles turn.
 */

const JUMPER = ENEMY_TYPES['jumper'];

/** A texel of the baked VAT (vertex or marker) in frame `frame`, decoded */
function texel(vat: VATData, index: number, frame: number): Vector3 {
  const data = vat.positionTexture.image.data as Float32Array | Uint16Array;
  const row = frame * vat.rowsPerFrame + Math.floor(index / vat.texWidth);
  const o = (row * vat.texWidth + (index % vat.texWidth)) * 4;
  const enc = vat.encoding;
  if (data instanceof Float32Array) return new Vector3(data[o], data[o + 1], data[o + 2]);
  const half = (h: number) => {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    return e === 0 ? s * 2 ** -14 * (m / 1024) : s * 2 ** (e - 15) * (1 + m / 1024);
  };
  return new Vector3(
    half(data[o]) * enc.extent[0] + enc.origin[0],
    half(data[o + 1]) * enc.extent[1] + enc.origin[1],
    half(data[o + 2]) * enc.extent[2] + enc.origin[2],
  );
}

describe('turret joints of the jumper', () => {
  let vat: VATData;
  let model: Object3D;
  let animations: AnimationClip[];

  beforeAll(async () => {
    const gltf = await parsePackedGlb(readFileSync(resolve('public', JUMPER.modelUrl)));
    animations = gltf.animations;
    model = clone(gltf.scene);
    vat = bakeEnemyVAT(JUMPER, model, animations)!;
  }, 60_000);

  it('comes out the same baked in slices, giving the thread back between them', async () => {
    // A task queued before the bake starts: it runs while the bake waits for its next slice
    let other = false;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      other = true;
      channel.port1.close();
    };
    channel.port2.postMessage(null);
    // 8 ms slices: still many slices for this model, without thousands of yields that timed out on CI runners
    const sliced = await bakeEnemyVATSliced(JUMPER, clone(model), animations, undefined, 8);
    expect(other).toBe(true);
    expect(sliced!.positionTexture.image.data).toEqual(vat.positionTexture.image.data);
    expect(sliced!.geometry.getAttribute('position').array).toEqual(vat.geometry.getAttribute('position').array);
    expect(sliced!.turret).toEqual(vat.turret);
  }, 120_000);

  it('bakes the turret behind the vertices, its markers in every frame', () => {
    expect(vat.turret).not.toBeNull();
    const turret = vat.turret!;
    expect(turret.marker).toBe(vat.vertexCount);
    expect(vat.texWidth * vat.rowsPerFrame).toBeGreaterThanOrEqual(vat.vertexCount + TURRET_MARKERS);
    expect(turret.recoil).toBe(JUMPER.turret!.recoil);
    expect(turret.rest.muzzles).toHaveLength(2);
  });

  it('turns the turret and tilts the guns, the body stays', () => {
    const parts = vat.geometry.getAttribute('aTurretPart').array as Float32Array;
    const count = [0, 0, 0];
    for (const p of parts) count[p]++;
    // The body, the turret with its pods and antennas, the gun cradle and both barrels
    expect(count[0]).toBeGreaterThan(count[1]);
    expect(count[1]).toBeGreaterThan(count[2]);
    expect(count[2]).toBeGreaterThan(100);
    // Every gun vertex lies in front of the turret's pivot, along the model's forward (+z)
    const pos = vat.geometry.getAttribute('position');
    const pivot = vat.turret!.rest.yawPivot;
    for (let i = 0; i < parts.length; i++) if (parts[i] === 2) expect(pos.getZ(i)).toBeGreaterThan(pivot.z);
  });

  it('stands at rest as the config says: pivot height, axes up and across the barrels', () => {
    const rest = vat.turret!.rest;
    expect(rest.pitchPivot.y).toBeCloseTo(JUMPER.turret!.pivotHeight, 3);
    expect(rest.yawAxis.y).toBeCloseTo(1, 5);
    // The barrels look along +z (the game's forward), so the pitch axis lies along -x: cross(up, axis) = +z
    const forward = new Vector3().crossVectors(rest.yawAxis, rest.pitchAxis);
    expect(forward.z).toBeCloseTo(1, 3);
    for (const muzzle of rest.muzzles) expect(muzzle.z).toBeGreaterThan(rest.pitchPivot.z);
  });

  it('writes the markers where the rest pose has them, and lets the walk carry them', () => {
    const turret = vat.turret!;
    const walk = vat.animations.get(JUMPER.walkAnimation!)!;
    const ys: number[] = [];
    for (let f = 0; f < walk.frameCount; f++) {
      const yawPivot = texel(vat, turret.marker, walk.frameStart + f);
      const yawUp = texel(vat, turret.marker + 1, walk.frameStart + f).sub(yawPivot).normalize();
      // Up within a few degrees while the body rolls and nods
      expect(yawUp.y).toBeGreaterThan(0.99);
      ys.push(yawPivot.y);
    }
    // The body dips and rises: the pivot moves with it, about BOB (0.003 m, 0.03 model units) each way
    const range = Math.max(...ys) - Math.min(...ys);
    expect(range).toBeGreaterThan(0.03);
    expect(range).toBeLessThan(0.15);
  });

  it('turns a muzzle like the shader: positive yaw from +z towards +x, positive pitch up', () => {
    const rest = vat.turret!.rest;
    const muzzle = rest.muzzles[0];
    const out = new Vector3();
    turretPoint(rest, Math.PI / 2, 0, muzzle, out);
    // A quarter turn puts the muzzle off to +x of the pivot, as a heading of +π/2 faces +x
    expect(out.x - rest.yawPivot.x).toBeGreaterThan(1.5);
    turretPoint(rest, 0, 0.3, muzzle, out);
    expect(out.y).toBeGreaterThan(muzzle.y + 0.3);
    // Rodrigues about the up axis keeps the height
    const turned = turnAbout(muzzle, rest.yawPivot, rest.yawAxis, 1.1, new Vector3());
    expect(turned.y).toBeCloseTo(muzzle.y, 6);
  });
});
