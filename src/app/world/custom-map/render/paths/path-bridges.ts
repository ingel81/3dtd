import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { MapPaths, MapWater } from '../../map-document';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary } from '../map-asset-library';
import { mapToScene } from '../map-coords';
import { edgePolyline } from './path-mask';

/** Catalogue model of one bridge piece: 4 m along local +X, 1 m wide, deck top at 0 */
export const BRIDGE_ASSET = 'bridge-deck';
const PIECE_LENGTH = 4;

/**
 * Bridges: path edges of kind `bridge` get a deck of instanced bridge
 * pieces from end to end, stretched to the edge's width. The deck runs
 * from the terrain height at each end (at least a little over the water)
 * with a slight arch, so roads on both banks meet it.
 */
export class BridgeLayer {
  readonly group = new Group();
  private generation = 0;

  constructor(
    private readonly field: HeightField,
    private readonly assets: MapAssetLibrary,
  ) {
    this.group.name = 'custom-map-bridges';
    this.group.userData['losTransparent'] = true;
  }

  async set(paths: MapPaths, water: MapWater | null): Promise<void> {
    const generation = ++this.generation;
    const matrices = this.pieces(paths, water);
    const model = matrices.length > 0 ? await this.assets.model(BRIDGE_ASSET) : null;
    if (generation !== this.generation) return;
    this.clear();
    if (!model) return;
    for (const part of model.parts) {
      const mesh = new InstancedMesh(part.geometry, part.material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  dispose(): void {
    this.generation++;
    this.clear();
    this.group.removeFromParent();
  }

  private clear(): void {
    for (const m of [...this.group.children] as InstancedMesh[]) {
      m.removeFromParent();
      m.dispose();
    }
  }

  /** Instance matrices of every bridge piece */
  private pieces(paths: MapPaths, water: MapWater | null): Matrix4[] {
    const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
    const out: Matrix4[] = [];
    const minDeck = (water?.level ?? -Infinity) + 1.0;
    const up = new Vector3(0, 1, 0);
    const q = new Quaternion();
    const yaw = new Quaternion();
    const pitch = new Quaternion();
    const forwardZ = new Vector3(0, 0, 1);
    const pos = new Vector3();
    const scale = new Vector3();
    for (const edge of paths.edges) {
      if (edge.kind !== 'bridge') continue;
      const line = edgePolyline(edge, nodes);
      if (!line) continue;
      let total = 0;
      for (let s = 0; s < line.length - 1; s++) total += Math.hypot(line[s + 1].x - line[s].x, line[s + 1].y - line[s].y);
      const a = line[0];
      const b = line[line.length - 1];
      const hA = Math.max(this.field.heightAt(a.x, a.y), minDeck);
      const hB = Math.max(this.field.heightAt(b.x, b.y), minDeck);
      const arch = Math.min(1.5, total * 0.04);
      let walked = 0;
      for (let s = 0; s < line.length - 1; s++) {
        const p = line[s];
        const r = line[s + 1];
        const dx = r.x - p.x;
        const dy = r.y - p.y;
        const len = Math.hypot(dx, dy);
        const n = Math.max(1, Math.round(len / PIECE_LENGTH));
        // Local +X is scene (cos r, 0, -sin r) = map (-cos r, -sin r) after rotation.y = r
        yaw.setFromAxisAngle(up, Math.atan2(-dy, -dx));
        const deck = (t: number): number => hA + (hB - hA) * t + Math.sin(t * Math.PI) * arch;
        for (let k = 0; k < n; k++) {
          const piece = len / n;
          const t0 = (walked + k * piece) / total;
          const t1 = (walked + (k + 1) * piece) / total;
          const x = p.x + dx * ((k + 0.5) / n);
          const y = p.y + dy * ((k + 0.5) / n);
          // Pitch around local Z so each piece follows the arch
          pitch.setFromAxisAngle(forwardZ, Math.atan2(deck(t1) - deck(t0), piece));
          q.copy(yaw).multiply(pitch);
          mapToScene(x, y, (deck(t0) + deck(t1)) / 2, pos);
          scale.set((len / n) / PIECE_LENGTH, 1, edge.width);
          out.push(new Matrix4().compose(pos, q, scale));
        }
        walked += len;
      }
    }
    return out;
  }
}
