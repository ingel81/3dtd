import { BufferAttribute, BufferGeometry, Mesh, Vector2, Vector4, type ShaderMaterial } from 'three';
import type { MapRiver, MapRiverPoint } from '../../map-document';
import { riverCover, type CoverAt, type RiverGround, type RiverNetwork } from '../../../../map-ops/river-network';
import type { HeightField } from '../height-field';
import type { HeightTexture } from '../terrain/height-texture';
import { CRATER_SLOTS, createWaterMaterial, setWaterEffects, setWaterSky } from './water-material';
import type { MapEffects } from '../map-effects';
import type { SceneCopy } from './scene-copy';
import { setHeatHaze } from './heat-haze';

/**
 * A river or lava flow: a ribbon along the river's line (Catmull-Rom through
 * its points, a row every 2 m), as wide and as high as the points say,
 * flowing from the first point to the last. The water material cuts it
 * where the terrain rises above the surface and fades its sides, and moves
 * its waves (or lava crust) downstream at a speed that grows with the drop.
 * Where it meets other water of its kind (map-ops/river-network.ts) it gives
 * way to the water that draws there and mixes that one's current into its
 * own, so a junction shows one surface.
 */

const ACROSS = 8;

export class RiverSurface {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;

  constructor(
    field: HeightField,
    heights: HeightTexture,
    river: MapRiver,
    /** The network of the map's rivers (riverNetwork) and this river's index in it */
    terrain: RiverGround,
    network: RiverNetwork,
    index: number,
  ) {
    const material = createWaterMaterial({
      kind: river.kind,
      river: true,
      heights,
      color: river.color ?? '',
      mapHalf: new Vector2(((field.columns - 1) * field.cellSize) / 2, ((field.rows - 1) * field.cellSize) / 2),
    });
    this.mesh = new Mesh(buildRiver(river, terrain, network, index), material);
    this.mesh.name = `custom-map-river-${river.id}`;
    this.mesh.userData['losTransparent'] = true;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
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

  /**
   * What craters do to it now (crater-water.ts), at most CRATER_SLOTS: per
   * crater the stretch through its bowl that is gone (metres along), and the
   * bed below it running dry: from `from`, dry out to `from + dry`, filled
   * again to `from + filled`, the water sunk `sink` metres there
   */
  setCraters(craters: readonly { gone: readonly [number, number]; from: number; dry: number; filled: number; sink: number }[]): void {
    const gone = this.mesh.material.uniforms['uCraterGone'].value as Vector2[];
    const dry = this.mesh.material.uniforms['uCraterDry'].value as Vector4[];
    for (let i = 0; i < CRATER_SLOTS; i++) {
      const c = craters[i];
      gone[i].set(c ? c.gone[0] : 0, c ? c.gone[1] : 0);
      dry[i].set(c ? c.from : 0, c ? c.dry : 0, c ? c.filled : 0, c ? c.sink : 0);
    }
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

/** Metres a vertex drawn over by other water sinks, so the water that draws there wins the depth test */
const GIVE_WAY = 0.03;

/** The current at sample `r` of a line in map x and y, m/s: along it, slow on the flat, fast down a drop */
function currentAt(line: readonly MapRiverPoint[], r: number, kind: MapRiver['kind']): [number, number] {
  const a = line[Math.max(0, r - 1)];
  const b = line[Math.min(line.length - 1, r + 1)];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const drop = Math.max(0, a.height - b.height) / len;
  const speed = kind === 'lava' ? 0.4 + Math.min(1.5, drop * 15) : 0.5 + Math.min(3, drop * 40);
  return [((b.x - a.x) / len) * speed, ((b.y - a.y) / len) * speed];
}

function buildRiver(river: MapRiver, terrain: RiverGround, network: RiverNetwork, own: number): BufferGeometry {
  const line = network.lines[own]?.samples ?? [];
  const rows = line.length;
  const pos = new Float32Array(rows * (ACROSS + 1) * 3);
  const flow = new Float32Array(rows * (ACROSS + 1) * 2);
  const across = new Float32Array(rows * (ACROSS + 1));
  const join = new Float32Array(rows * (ACROSS + 1) * 2);
  const along = new Float32Array(rows * (ACROSS + 1));
  const alongLine = network.lines[own]?.along;
  const depth = new Float32Array(rows * (ACROSS + 1)).fill(1);
  const rivers = terrain.rivers ?? [];
  const otherCurrent = (r2: number, k2: number) => currentAt(network.lines[r2]!.samples, k2, rivers[r2].kind);
  const at: CoverAt = { cover: 0, open: 0, flowX: 0, flowY: 0, mix: 0 };
  for (let r = 0; r < rows; r++) {
    const a = line[Math.max(0, r - 1)];
    const b = line[Math.min(rows - 1, r + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    const [fx, fy] = currentAt(line, r, river.kind);
    const p = line[r];
    for (let c = 0; c <= ACROSS; c++) {
      const u = (c / ACROSS) * 2 - 1;
      // Map: left normal of the direction (tx, ty) is (-ty, tx)
      const mx = p.x - ty * u * (p.width / 2);
      const my = p.y + tx * u * (p.width / 2);
      const k = r * (ACROSS + 1) + c;
      riverCover(terrain, network, own, r, mx, my, otherCurrent, at);
      pos.set([-mx, p.height - GIVE_WAY * at.cover, my], k * 3);
      // The current, mixed with the one drawn under it at a junction; scene direction of map (x, y) is (-x, y)
      flow.set([-(fx + (at.flowX - fx) * at.mix), fy + (at.flowY - fy) * at.mix], k * 2);
      across[k] = u;
      along[k] = alongLine?.[r] ?? 0;
      join.set([at.cover, at.open], k * 2);
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
  g.setAttribute('aAlong', new BufferAttribute(along, 1));
  g.setAttribute('aJoin', new BufferAttribute(join, 2));
  g.setAttribute('aDepth', new BufferAttribute(depth, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
