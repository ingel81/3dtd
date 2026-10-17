import { BufferAttribute, BufferGeometry, Mesh, Vector2, type ShaderMaterial } from 'three';
import type { MapRiver } from '../../map-document';
import type { HeightField } from '../height-field';
import type { HeightTexture } from '../terrain/height-texture';
import { createWaterMaterial, setWaterColor, setWaterEffects, setWaterSky } from './water-material';
import type { MapEffects } from '../map-effects';
import type { SceneCopy } from './scene-copy';
import { setHeatHaze } from './heat-haze';
import { sampleRiver } from './river-line';

/**
 * A river or lava flow: a ribbon along the river's line (Catmull-Rom through
 * its points, a row every 2 m), as wide and as high as the points say,
 * flowing from the first point to the last. The water material cuts it
 * where the terrain rises above the surface and fades its sides, and moves
 * its waves (or lava crust) downstream at a speed that grows with the drop.
 */

const ACROSS = 8;

export class RiverSurface {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;

  constructor(
    field: HeightField,
    heights: HeightTexture,
    river: MapRiver,
  ) {
    const material = createWaterMaterial({
      kind: river.kind,
      river: true,
      heights,
      color: river.color ?? '',
      mapHalf: new Vector2(((field.columns - 1) * field.cellSize) / 2, ((field.rows - 1) * field.cellSize) / 2),
    });
    this.mesh = new Mesh(buildRiver(river), material);
    this.mesh.name = `custom-map-river-${river.id}`;
    this.mesh.userData['losTransparent'] = true;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
  }

  set(river: MapRiver): void {
    setWaterColor(this.mesh.material, river.kind, river.color ?? '');
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildRiver(river);
  }

  setSky(skyUniforms: ShaderMaterial['uniforms'], sunIntensity: number, darkness = 0): void {
    setWaterSky(this.mesh.material, skyUniforms, sunIntensity, darkness);
  }

  /** Switchable effects (refraction); `copy` is the view's frame copy */
  setEffects(on: MapEffects, copy: SceneCopy, kind: MapRiver['kind']): void {
    const { refraction } = setWaterEffects(this.mesh.material, kind, on, copy);
    this.mesh.onBeforeRender = refraction ? (renderer) => copy.capture(renderer) : () => undefined;
    setHeatHaze(this.mesh, on.lavaGlow && kind === 'lava' ? copy : null);
  }

  update(dt: number): void {
    this.mesh.material.uniforms['uTime'].value += dt;
  }

  dispose(): void {
    setHeatHaze(this.mesh, null);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

function buildRiver(river: MapRiver): BufferGeometry {
  const line = river.points.length >= 2 ? sampleRiver(river.points) : [];
  const rows = line.length;
  const pos = new Float32Array(rows * (ACROSS + 1) * 3);
  const flow = new Float32Array(rows * (ACROSS + 1) * 2);
  const across = new Float32Array(rows * (ACROSS + 1));
  const depth = new Float32Array(rows * (ACROSS + 1)).fill(1);
  for (let r = 0; r < rows; r++) {
    const a = line[Math.max(0, r - 1)];
    const b = line[Math.min(rows - 1, r + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const drop = Math.max(0, a.height - b.height) / len;
    // Flow speed in m/s from the slope: slow and wide on the flat, fast down a drop
    const speed = river.kind === 'lava' ? 0.4 + Math.min(1.5, drop * 15) : 0.5 + Math.min(3, drop * 40);
    const p = line[r];
    for (let c = 0; c <= ACROSS; c++) {
      const u = (c / ACROSS) * 2 - 1;
      // Map: left normal of the direction (tx, ty) is (-ty, tx)
      const mx = p.x - ty * u * (p.width / 2);
      const my = p.y + tx * u * (p.width / 2);
      const k = r * (ACROSS + 1) + c;
      pos.set([-mx, p.height, my], k * 3);
      // Scene direction of map (tx, ty) is (-tx, ty)
      flow.set([-tx * speed, ty * speed], k * 2);
      across[k] = u;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < ACROSS; c++) {
      const k = r * (ACROSS + 1) + c;
      const n = k + ACROSS + 1;
      // Both windings, the line may run either way
      index.push(k, n, k + 1, k + 1, n, n + 1, k, k + 1, n, k + 1, n + 1, n);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aFlow', new BufferAttribute(flow, 2));
  g.setAttribute('aAcross', new BufferAttribute(across, 1));
  g.setAttribute('aDepth', new BufferAttribute(depth, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
