import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from './height-texture';
import { addHeightFog } from '../environment/height-fog';
import { ImpactMarkKind, type ImpactMark } from '../../custom-map-ground-damage';
import { RUBBLE_COLOURS, RUBBLE_MATERIALS, type RubbleMaterial } from '../../rubble-material';

/** The kinds of piece on a heap */
const PIECES = ['slab', 'bricks', 'beam', 'chunk'] as const;
type Piece = (typeof PIECES)[number];

/** Pieces of a kind at most, over every heap of a map */
export const MAX_PIECES = 6000;

/** Which pieces a class's heap is made of, as weights in PIECES order */
const MIX: Record<RubbleMaterial, readonly [number, number, number, number]> = {
  plaster: [3, 3, 1, 2],
  concrete: [5, 0, 0, 4],
  metal: [4, 0, 3, 1],
  brick: [1, 6, 1, 1],
  stone: [1, 2, 0, 6],
  wood: [1, 0, 6, 1],
};

/** A repeatable number 0..1 from a seed and a counter */
function rand(seed: number, n: number): number {
  let h = Math.imul((seed * 1000) | 0, 0x27d4eb2d) ^ Math.imul(n + 1, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * A slab of concrete or plaster broken off a wall or a floor: a jagged
 * outline, thick, two bars of its reinforcement sticking out of one edge
 */
function slabGeometry(): BufferGeometry {
  const shape = new Shape();
  const outline: [number, number][] = [[-0.6, -0.4], [-0.15, -0.46], [0.22, -0.36], [0.58, -0.42], [0.66, 0.05], [0.42, 0.38], [0.05, 0.31], [-0.34, 0.44], [-0.62, 0.12]];
  shape.moveTo(...outline[0]);
  for (const p of outline.slice(1)) shape.lineTo(...p);
  shape.closePath();
  const plate = new ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.02, 0);
  const bar = (x: number, z: number, length: number, turn: number) =>
    new BoxGeometry(length, 0.025, 0.025).translate(length / 2, 0, 0).rotateY(turn).translate(x, 0.07, z);
  const parts = [plate, bar(0.62, 0.0, 0.45, 0.3), bar(0.55, 0.22, 0.32, -0.25)].map((g) => g.toNonIndexed());
  return mergeGeometries(parts)!;
}

/** Bricks still held together by their mortar, a few loose ones beside them */
function bricksGeometry(): BufferGeometry {
  const brick = (x: number, y: number, z: number, turn: number) =>
    new BoxGeometry(0.46, 0.14, 0.22).rotateY(turn).translate(x, y + 0.07, z).toNonIndexed();
  return mergeGeometries([
    brick(0, 0, 0, 0), brick(0.24, 0, 0.23, 0), brick(-0.22, 0, 0.23, 0), brick(0.02, 0.14, 0.12, 0.05),
    brick(0.55, 0, -0.18, 0.9), brick(-0.5, 0, -0.25, -0.6),
  ])!;
}

/** A beam broken in two: square, its end splintered at a slant */
function beamGeometry(): BufferGeometry {
  const beam = new BoxGeometry(2.2, 0.2, 0.2, 6, 1, 1);
  const p = beam.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    // The broken end: the far side shorter by a slant and a little ragged
    if (x > 1.05) p.setX(i, x - 0.35 * (p.getZ(i) + 0.1) / 0.2 - (p.getY(i) > 0 ? 0.12 : 0));
  }
  beam.computeVertexNormals();
  return beam.translate(0, 0.1, 0).toNonIndexed();
}

/** A lump of stone or masonry: a rough twelve-faced block, its corners pushed about */
function chunkGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(0.42, 0).toNonIndexed();
  const p = g.getAttribute('position');
  const pushed = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = pushed.get(key);
    if (k === undefined) {
      k = 0.75 + rand(pushed.size, 7) * 0.45;
      pushed.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k * 1.2, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g.translate(0, 0.2, 0);
}

const GEOMETRIES: Record<Piece, () => BufferGeometry> = { slab: slabGeometry, bricks: bricksGeometry, beam: beamGeometry, chunk: chunkGeometry };

/**
 * The pieces lying on the fallen structures' heaps (docs/DESTRUCTION_PLAN.md,
 * Z3): slabs with their reinforcement, bricks in their mortar, broken beams,
 * lumps of masonry, each class of structure a mix of its own
 * (rubble-material.ts), tinted by its grit. One instanced mesh per kind of
 * piece for every heap of the map, four draw calls however much fell.
 *
 * The pieces lie on the ground as the height texture has it: the vertex
 * shader lifts each instance by the terrain's height under its origin, so
 * they follow the heap as its tiles come in and never float or sink. Where
 * a heap lies and what it is made of comes from its mark (ImpactMark of kind
 * Rubble); its seed rolls the same pieces on every client, in every replay.
 */
export class RubblePieces {
  readonly meshes: InstancedMesh<BufferGeometry, MeshStandardMaterial>[];
  private readonly matrix = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly axis = new Vector3();
  private readonly color = new Color();

  constructor(heights: HeightTexture) {
    this.meshes = PIECES.map((piece) => {
      const material = new MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true });
      material.name = `custom-map-rubble-${piece}`;
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, heights.uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${TERRAIN_HEIGHT_GLSL}`)
          .replace(
            '#include <project_vertex>',
            /* glsl */ `
            vec4 mvPosition = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              mvPosition = instanceMatrix * mvPosition;
              // On the ground under the piece's origin as the height texture has it (scene x is map -x)
              mvPosition.y += terrainHeightAt(vec2(-instanceMatrix[3].x, instanceMatrix[3].z));
            #endif
            mvPosition = modelViewMatrix * mvPosition;
            gl_Position = projectionMatrix * mvPosition;`,
          );
      };
      material.customProgramCacheKey = () => `custom-map-rubble-${piece}-1`;
      addHeightFog(material);
      const mesh = new InstancedMesh(GEOMETRIES[piece](), material, MAX_PIECES);
      mesh.name = `custom-map-rubble-${piece}`;
      // One piece of no size while none lies: the view's warm-up builds the program with the map's
      this.matrix.makeScale(0, 0, 0);
      mesh.setMatrixAt(0, this.matrix);
      mesh.setColorAt(0, this.color.setRGB(1, 1, 1));
      mesh.count = 1;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.userData['losTransparent'] = true;
      return mesh;
    });
  }

  /** The pieces of every heap among `marks` (the rubble ones), rolled from each heap's seed */
  set(marks: Iterable<ImpactMark>): void {
    const counts = PIECES.map(() => 0);
    for (const m of marks) {
      if (m.kind !== ImpactMarkKind.Rubble) continue;
      const material = RUBBLE_MATERIALS[m.material] ?? 'plaster';
      const weights = MIX[material];
      const total = weights.reduce((a, b) => a + b, 0);
      const grit = RUBBLE_COLOURS[material].grit;
      // A piece per 2.5 m² of the heap's core, more on a big one
      const reach = m.size / 2;
      const n = Math.min(60, Math.max(6, Math.round((reach * reach * 1.6) / 2.5)));
      for (let k = 0; k < n; k++) {
        let pick = rand(m.seed, k * 7) * total;
        let kind = 0;
        while (kind < PIECES.length - 1 && pick >= weights[kind]) pick -= weights[kind++];
        const at = counts[kind];
        if (at >= MAX_PIECES) continue;
        // Most on the heap's middle, fewer towards its foot
        const a = rand(m.seed, k * 7 + 1) * Math.PI * 2;
        const d = Math.sqrt(rand(m.seed, k * 7 + 2)) * reach * 0.8;
        const x = m.x + Math.cos(a) * d;
        const y = m.y + Math.sin(a) * d;
        this.axis.set(rand(m.seed, k * 7 + 3) - 0.5, 1.6, rand(m.seed, k * 7 + 4) - 0.5).normalize();
        this.quat.setFromAxisAngle(this.axis, rand(m.seed, k * 7 + 5) * Math.PI * 2);
        const s = (0.75 + rand(m.seed, k * 7 + 6) * 0.7) * (0.8 + m.strength * 0.6);
        this.scale.set(s, s, s);
        // Half sunk into the heap, as a piece that fell into it lies
        this.pos.set(-x, -0.06 * s, y);
        this.matrix.compose(this.pos, this.quat, this.scale);
        const mesh = this.meshes[kind];
        mesh.setMatrixAt(at, this.matrix);
        const tone = 0.7 + rand(m.seed, k * 7 + 9) * 0.5;
        mesh.setColorAt(at, this.color.setRGB(grit[0] * tone, grit[1] * tone, grit[2] * tone));
        counts[kind]++;
      }
    }
    this.meshes.forEach((mesh, kind) => {
      const n = counts[kind];
      if (n === 0) {
        this.matrix.makeScale(0, 0, 0);
        mesh.setMatrixAt(0, this.matrix);
      }
      mesh.count = Math.max(1, n);
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.removeFromParent();
    }
  }
}
