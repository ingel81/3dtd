import { BufferAttribute, BufferGeometry, Mesh, Vector2, Vector3, Vector4, type ShaderMaterial } from 'three';
import type { MapRiver, MapRiverPoint } from '../../map-document';
import { riverCover, type CoverAt, type RiverGround, type RiverNetwork } from '../../../../map-ops/river-network';
import type { HeightField } from '../height-field';
import type { HeightTexture } from '../terrain/height-texture';
import { CRATER_SLOTS, createWaterMaterial, setWaterEffects, setWaterSky } from './water-material';
import type { MapEffects } from '../map-effects';
import type { SceneCopy } from './scene-copy';
import { setHeatHaze } from './heat-haze';
import { WallStrip } from './water-walls';

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
  private readonly field: HeightField;
  /** The walls across the river where craters cut it (water-walls.ts), drawn by its material; rebuilt when the cuts change */
  private cutWalls: Mesh<BufferGeometry, ShaderMaterial> | null = null;
  private cutKey = '';

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
    this.field = field;
    this.mesh = new Mesh(buildRiver(field, river, terrain, network, index), material);
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
   * again to `from + filled`, the water sunk `sink` metres there; `lake` the
   * level its lake stands at now (the walls across the cut stand in it)
   */
  setCraters(craters: readonly { gone: readonly [number, number]; from: number; dry: number; filled: number; sink: number; lake?: number }[]): void {
    const gone = this.mesh.material.uniforms['uCraterGone'].value as Vector3[];
    const dry = this.mesh.material.uniforms['uCraterDry'].value as Vector4[];
    for (let i = 0; i < CRATER_SLOTS; i++) {
      const c = craters[i];
      gone[i].set(c ? c.gone[0] : 0, c ? c.gone[1] : 0, c?.lake ?? -1e9);
      dry[i].set(c ? c.from : 0, c ? c.dry : 0, c ? c.filled : 0, c ? c.sink : 0);
    }
    // The cut's ends, where the river stops at the bowl: a wall across it at each (not at an open end, the front of
    // a stream still coming down)
    const ends: [number, number][] = [];
    for (const c of craters.slice(0, CRATER_SLOTS)) {
      if (c.gone[1] <= c.gone[0]) continue;
      if (c.gone[0] > 0) ends.push([c.gone[0] - 0.01, 1]);
      if (c.gone[1] < 1e8) ends.push([c.gone[1] + 0.01, -1]);
    }
    const key = ends.map((e) => e[0].toFixed(2)).join(',');
    if (key === this.cutKey) return;
    this.cutKey = key;
    if (this.cutWalls) {
      this.cutWalls.geometry.dispose();
      this.cutWalls.removeFromParent();
      this.cutWalls = null;
    }
    const g = ends.length ? crossWalls(this.field, this.mesh.geometry, ends) : null;
    if (!g) return;
    this.cutWalls = new Mesh(g, this.mesh.material);
    this.cutWalls.name = `${this.mesh.name}-cuts`;
    this.cutWalls.userData['losTransparent'] = true;
    this.cutWalls.renderOrder = 1;
    this.cutWalls.matrixAutoUpdate = false;
    this.mesh.add(this.cutWalls);
  }

  update(dt: number): void {
    this.mesh.material.uniforms['uTime'].value += dt;
  }

  dispose(): void {
    setHeatHaze(this.mesh, null);
    this.cutWalls?.geometry.dispose();
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

/** Metres a river runs out over where it ends on the map: one and a half widths, within these */
const RUN_OUT_MIN = 4;
const RUN_OUT_MAX = 14;
/** Metres under the bed its surface ends at, so the ground cuts it cleanly */
const RUN_OUT_BELOW = 0.1;

/** Below this share of other water drawing over a vertex (riverCover) the river's edge there is its own */
const OWN_EDGE = 0.01;

function buildRiver(field: HeightField, river: MapRiver, terrain: RiverGround, network: RiverNetwork, own: number): BufferGeometry {
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
  // A river that ends on the map (not at its border, not into other water) runs out there: over its last metres
  // the surface sinks to the bed, the ground cuts it on its own line, shallow and clear, instead of ending as a
  // sheet with a wall under it in the middle of its channel. Likewise where it rises
  const halfX = ((field.columns - 1) * field.cellSize) / 2;
  const halfY = ((field.rows - 1) * field.cellSize) / 2;
  const runsOut = (r: number): boolean => {
    const p = line[r];
    const border = Math.abs(p.x) > halfX - field.cellSize * 2 || Math.abs(p.y) > halfY - field.cellSize * 2;
    return !border && join[(r * (ACROSS + 1) + ACROSS / 2) * 2] < OWN_EDGE;
  };
  const ends = rows > 1 ? [0, rows - 1].filter(runsOut) : [];
  for (const end of ends) {
    const reach = Math.min(RUN_OUT_MAX, Math.max(RUN_OUT_MIN, line[end].width * 1.5));
    let walked = 0;
    for (let r = end; r >= 0 && r < rows && walked < reach; r += end === 0 ? 1 : -1) {
      if (r !== end) {
        const q = line[r + (end === 0 ? -1 : 1)];
        walked += Math.hypot(line[r].x - q.x, line[r].y - q.y);
      }
      const t = Math.min(1, walked / reach);
      const keep = t * t * (3 - 2 * t);
      for (let c = 0; c <= ACROSS; c++) {
        const k = r * (ACROSS + 1) + c;
        const ground = field.heightAt(-pos[k * 3], pos[k * 3 + 2]) - RUN_OUT_BELOW;
        if (ground < pos[k * 3 + 1]) pos[k * 3 + 1] = ground + (pos[k * 3 + 1] - ground) * keep;
      }
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
  // The walls (water-walls.ts) under the ribbon's ends where they stand in the air (at the map's border; an end on
  // the map runs out instead), where no other water goes on past them; their vertices copy the edge vertex's
  // current and place along the river. None along its sides: they fade over the bank, a wall there showed as a
  // strip beside the fading edge and as flanks in a junction
  const surfaceCount = rows * (ACROSS + 1);
  const wallPos: number[] = [];
  const wallTop: number[] = [];
  const wallOf: number[] = [];
  let from = 0;
  const strip = new WallStrip((v) => {
    wallPos.push(-v.x, v.height, v.y);
    wallTop.push(v.top);
    wallOf.push(from);
    return surfaceCount + wallOf.length - 1;
  }, index);
  const ownEdge = (k: number): boolean => join[k * 2] < OWN_EDGE && join[k * 2 + 1] < OWN_EDGE;
  const edge = (k: number, m: number, outX: number, outY: number): void => {
    if (!ownEdge(k) || !ownEdge(m)) return;
    const ax = -pos[k * 3];
    const ay = pos[k * 3 + 2];
    const bx = -pos[m * 3];
    const by = pos[m * 3 + 2];
    const before = wallOf.length;
    from = k;
    strip.add(ax, ay, pos[k * 3 + 1], field.heightAt(ax, ay), bx, by, pos[m * 3 + 1], field.heightAt(bx, by), outX, outY);
    // The second end's two vertices come from m
    if (wallOf.length > before) wallOf[before + 1] = wallOf[before + 3] = m;
  };
  for (const r of rows > 1 ? [0, rows - 1].filter((e) => !ends.includes(e)) : []) {
    const inner = r === 0 ? 1 : rows - 2;
    for (let c = 0; c < ACROSS; c++) {
      const k = r * (ACROSS + 1) + c;
      const m = k + 1;
      const kin = inner * (ACROSS + 1) + c;
      edge(k, m, -pos[k * 3] + pos[kin * 3], pos[k * 3 + 2] - pos[kin * 3 + 2]);
    }
  }
  const total = surfaceCount + wallOf.length;
  const grow = <T extends Float32Array>(a: T, size: number): Float32Array => {
    const out = new Float32Array(total * size);
    out.set(a);
    for (let w = 0; w < wallOf.length; w++) for (let s = 0; s < size; s++) out[(surfaceCount + w) * size + s] = a[wallOf[w] * size + s];
    return out;
  };
  const allPos = new Float32Array(total * 3);
  allPos.set(pos);
  allPos.set(wallPos, surfaceCount * 3);
  const allJoin = new Float32Array(total * 2);
  allJoin.set(join);
  // No haze over a wall (heat-haze.ts reads the depth)
  const allDepth = new Float32Array(total);
  allDepth.set(depth);
  const wall = new Float32Array(total * 2);
  for (let w = 0; w < wallOf.length; w++) wall.set([1, wallTop[w]], (surfaceCount + w) * 2);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(allPos, 3));
  g.setAttribute('aFlow', new BufferAttribute(grow(flow, 2), 2));
  g.setAttribute('aAcross', new BufferAttribute(grow(across, 1), 1));
  g.setAttribute('aAlong', new BufferAttribute(grow(along, 1), 1));
  g.setAttribute('aJoin', new BufferAttribute(allJoin, 2));
  g.setAttribute('aDepth', new BufferAttribute(allDepth, 1));
  g.setAttribute('aWall', new BufferAttribute(wall, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/**
 * Walls across the ribbon at places along it (metres along, and +1 where
 * the river goes on upstream of it: the wall faces downstream, -1 the
 * other way), between its rows: the cross-section the river shows where a
 * crater cut it off. Null when none stands in the air
 */
function crossWalls(field: HeightField, ribbon: BufferGeometry, ends: readonly [number, number][]): BufferGeometry | null {
  const pos = ribbon.getAttribute('position') as BufferAttribute;
  const along = ribbon.getAttribute('aAlong') as BufferAttribute;
  const flow = ribbon.getAttribute('aFlow') as BufferAttribute;
  const across = ribbon.getAttribute('aAcross') as BufferAttribute;
  const wallAttr = ribbon.getAttribute('aWall') as BufferAttribute;
  // The ribbon's rows: its surface vertices come first, ACROSS + 1 per row
  let surface = 0;
  while (surface < wallAttr.count && wallAttr.getX(surface) < 0.5) surface++;
  const rows = surface / (ACROSS + 1);
  const outPos: number[] = [];
  const outFlow: number[] = [];
  const outAcross: number[] = [];
  const outAlong: number[] = [];
  const outWall: number[] = [];
  const index: number[] = [];
  let at = { a: 0, place: 0 };
  const strip = new WallStrip((v) => {
    outPos.push(-v.x, v.height, v.y);
    outWall.push(1, v.top);
    // The current and side of the column it hangs from
    outFlow.push(flow.getX(at.a), flow.getY(at.a));
    outAcross.push(across.getX(at.a));
    outAlong.push(at.place);
    return outPos.length / 3 - 1;
  }, index);
  for (const [place, dir] of ends) {
    let r = 1;
    while (r < rows && along.getX(r * (ACROSS + 1)) < place) r++;
    if (r >= rows) continue;
    const r0 = r - 1;
    const a0 = along.getX(r0 * (ACROSS + 1));
    const a1 = along.getX(r * (ACROSS + 1));
    const t = a1 > a0 ? Math.min(1, Math.max(0, (place - a0) / (a1 - a0))) : 0;
    const point = (c: number): [number, number, number] => {
      const k0 = r0 * (ACROSS + 1) + c;
      const k1 = r * (ACROSS + 1) + c;
      const lerp = (u: number, v: number) => u + (v - u) * t;
      return [-lerp(pos.getX(k0), pos.getX(k1)), lerp(pos.getZ(k0), pos.getZ(k1)), lerp(pos.getY(k0), pos.getY(k1))];
    };
    // Downstream (map x, y) at the place: the wall faces along it (dir 1) or against it
    const mid = ACROSS / 2;
    const dx = -(pos.getX(r * (ACROSS + 1) + mid) - pos.getX(r0 * (ACROSS + 1) + mid));
    const dy = pos.getZ(r * (ACROSS + 1) + mid) - pos.getZ(r0 * (ACROSS + 1) + mid);
    for (let c = 0; c < ACROSS; c++) {
      const [ax, ay, ah] = point(c);
      const [bx, by, bh] = point(c + 1);
      at = { a: r * (ACROSS + 1) + c, place };
      strip.add(ax, ay, ah, field.heightAt(ax, ay), bx, by, bh, field.heightAt(bx, by), dx * dir, dy * dir);
    }
  }
  if (!index.length) return null;
  const count = outPos.length / 3;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(outPos), 3));
  g.setAttribute('aFlow', new BufferAttribute(new Float32Array(outFlow), 2));
  g.setAttribute('aAcross', new BufferAttribute(new Float32Array(outAcross), 1));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(outAlong), 1));
  g.setAttribute('aJoin', new BufferAttribute(new Float32Array(count * 2), 2));
  g.setAttribute('aDepth', new BufferAttribute(new Float32Array(count), 1));
  g.setAttribute('aWall', new BufferAttribute(new Float32Array(outWall), 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
