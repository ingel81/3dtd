import {
  AdditiveBlending,
  BufferAttribute,
  DataTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  MathUtils,
  Mesh,
  NormalBlending,
  RGBAFormat,
  ShaderMaterial,
  Uniform,
  type Scene,
} from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK } from '../../configs/visual-effects.config';
import { DrawGate } from './draw-gate';
import { unpickable } from './effect-buffers';

const CELLS = LOOK.atlas.cells;
const CELL_PX = LOOK.atlas.cellSize;
/** Puffs in the billow atlas */
export const ATLAS_FRAMES = CELLS * CELLS;
/** How steeply the bumps of a puff tilt its normals */
const NORMAL_STRENGTH = 10;
/** Metres over which a sprite fades out towards the ground under its cloud */
const FLOOR_FADE = 4;

/**
 * A quad per sprite, turned to the camera around its centre and by its own
 * rotation, `aShape.x` metres across. It fades out as the camera comes into
 * it, so none fills the screen with a hard edge, and towards the ground
 * under its cloud (`aCenter.w`), where it would cut into the terrain. LIT
 * hands the direction of the sun (world up) into the sprite's frame.
 */
const SPRITE_VERTEX_SHADER = /* glsl */ `
  attribute vec4 aCenter;
  attribute vec4 aShape;
  attribute vec3 aColor;
  uniform float uCells;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vAboveFloor;
  #ifdef LIT
  attribute vec3 aGlow;
  varying vec3 vGlow;
  varying vec3 vSun;
  #endif

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    float size = max(aShape.x, 0.01);
    float c = cos(aShape.y);
    float s = sin(aShape.y);
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
    vec4 mvCenter = modelViewMatrix * vec4(aCenter.xyz, 1.0);
    gl_Position = projectionMatrix * vec4(mvCenter.xyz + vec3(corner, 0.0), 1.0);

    float cell = floor(aShape.w + 0.5);
    vUv = (vec2(mod(cell, uCells), floor(cell / uCells)) + position.xy + 0.5) / uCells;
    vColor = aColor;
    vAlpha = aShape.z * smoothstep(0.3 * size, size, -mvCenter.z);
    // A row vector times the view rotation: the corner's offset in the world
    vAboveFloor = aCenter.y + (vec3(corner, 0.0) * mat3(viewMatrix)).y - aCenter.w;
    #ifdef LIT
    vGlow = aGlow;
    vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    vSun = vec3(c * up.x + s * up.y, c * up.y - s * up.x, up.z);
    #endif

    #include <logdepthbuf_vertex>
  }
`;

/**
 * Smoke: the billow's normal from the atlas, lit by the sun from above and
 * by the fire from below (`vGlow`), darker in its crevices. Unlit (uLit 0,
 * impact effects off) its colour plus half the fire light.
 */
const SMOKE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uLit;
  uniform float uFloorFade;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vAboveFloor;
  varying vec3 vGlow;
  varying vec3 vSun;

  #include <logdepthbuf_pars_fragment>

  void main() {
    vec4 texel = texture2D(uAtlas, vUv);
    float alpha = texel.a * vAlpha * smoothstep(0.0, uFloorFade, vAboveFloor);
    if (alpha < 0.004) discard;
    vec3 color;
    if (uLit > 0.5) {
      vec2 slope = texel.rg * 2.0 - 1.0;
      vec3 normal = vec3(slope, sqrt(max(1.0 - dot(slope, slope), 0.0)));
      float sun = max(dot(normal, vSun), 0.0);
      float fire = max(-dot(normal, vSun), 0.0);
      color = (vColor * (0.5 + 0.7 * sun) + vGlow * (0.3 + 0.9 * fire)) * texel.b;
    } else {
      color = vColor * 0.85 + vGlow * 0.55;
    }
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
    #include <logdepthbuf_fragment>
  }
`;

/** Glow: its colour times the billow's density squared, added. */
const GLOW_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uFloorFade;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vAboveFloor;

  #include <logdepthbuf_pars_fragment>

  void main() {
    float density = texture2D(uAtlas, vUv).a;
    float light = density * density * vAlpha * smoothstep(0.0, uFloorFade, vAboveFloor);
    if (light < 0.003) discard;
    gl_FragColor = vec4(vColor * light, 1.0);
    #include <colorspace_fragment>
    #include <logdepthbuf_fragment>
  }
`;

/** Hash of three integers, 0 to 1 */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x2f0b3a49);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Three octaves of value noise, 0 to 1 */
function fbm(x: number, y: number, seed: number): number {
  const sum =
    0.5 * valueNoise(x, y, seed) +
    0.25 * valueNoise(x * 2.03 + 5.1, y * 2.03 + 1.7, seed + 1) +
    0.125 * valueNoise(x * 4.1 + 9.3, y * 4.1 + 3.9, seed + 2);
  return sum / 0.875;
}

/**
 * Billow atlas, CELLS by CELLS puffs of cumulus: each a few round lobes,
 * more of them on top, with noise eaten into the edge. RG hold the normal
 * of the puff's surface (x right, y up), B how open a spot is (crevices
 * darker), A the density; every cell is empty along its border, so its
 * neighbours do not bleed in. Hashed noise, so every run draws the same
 * puffs.
 */
export function billowAtlas(): DataTexture {
  const size = CELLS * CELL_PX;
  const data = new Uint8Array(size * size * 4);
  const height = new Float32Array(CELL_PX * CELL_PX);
  const density = new Float32Array(CELL_PX * CELL_PX);
  const open = new Float32Array(CELL_PX * CELL_PX);
  /** x, y, radius per lobe */
  const lobes = new Float32Array(3 * 8);
  for (let cell = 0; cell < ATLAS_FRAMES; cell++) {
    // One lobe in the middle, the others around it, mostly on top
    const count = 5 + Math.floor(hash(cell, 1, 7) * 3);
    lobes[0] = 0;
    lobes[1] = -0.1;
    lobes[2] = 0.5;
    for (let k = 1; k < count; k++) {
      const a = (-0.15 + 1.3 * hash(cell, k, 11)) * Math.PI;
      const d = 0.22 + 0.2 * hash(cell, k, 13);
      lobes[k * 3] = Math.cos(a) * d;
      lobes[k * 3 + 1] = Math.sin(a) * d;
      lobes[k * 3 + 2] = 0.2 + 0.16 * hash(cell, k, 17);
    }
    const scale = 2.4 + 1.2 * hash(cell, 3, 19);
    const ox = 40 * hash(cell, 5, 23);
    const oy = 40 * hash(cell, 6, 29);
    for (let py = 0; py < CELL_PX; py++) {
      for (let px = 0; px < CELL_PX; px++) {
        const u = ((px + 0.5) / CELL_PX) * 2 - 1;
        const v = ((py + 0.5) / CELL_PX) * 2 - 1;
        let body = 0;
        for (let k = 0; k < count; k++) {
          const dx = (u - lobes[k * 3]) / lobes[k * 3 + 2];
          const dy = (v - lobes[k * 3 + 1]) / lobes[k * 3 + 2];
          body = Math.max(body, 1 - dx * dx - dy * dy);
        }
        const n = fbm(u * scale + ox, v * scale + oy, cell * 3);
        const i = py * CELL_PX + px;
        const edge = 1 - MathUtils.smoothstep(Math.sqrt(u * u + v * v), 0.8, 0.97);
        density[i] = MathUtils.smoothstep(body + 0.6 * (n - 0.5), 0, 0.45) * edge;
        height[i] = 0.8 * Math.sqrt(Math.max(0, body)) + 0.35 * n;
        open[i] = 0.55 + 0.45 * MathUtils.smoothstep(n, 0.25, 0.75);
      }
    }
    // Normals from the slope of the height; y runs up with the rows
    const x0 = (cell % CELLS) * CELL_PX;
    const y0 = Math.floor(cell / CELLS) * CELL_PX;
    for (let py = 0; py < CELL_PX; py++) {
      const row = py * CELL_PX;
      const above = Math.min(CELL_PX - 1, py + 1) * CELL_PX;
      const below = Math.max(0, py - 1) * CELL_PX;
      for (let px = 0; px < CELL_PX; px++) {
        const i = row + px;
        const nx = -(height[row + Math.min(CELL_PX - 1, px + 1)] - height[row + Math.max(0, px - 1)]) * NORMAL_STRENGTH;
        const ny = -(height[above + px] - height[below + px]) * NORMAL_STRENGTH;
        const length = Math.sqrt(nx * nx + ny * ny + 1);
        const o = ((y0 + py) * size + x0 + px) * 4;
        data[o] = Math.round(((nx / length) * 0.5 + 0.5) * 255);
        data[o + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round(open[i] * 255);
        data[o + 3] = Math.round(density[i] * 255);
      }
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** The mushroom clouds' sprite materials and the atlas they share */
export interface CloudSpriteMaterials {
  /** Lit billows, normally blended: the smoke */
  smoke: ShaderMaterial;
  /** Additive: fire, glow and embers */
  glow: ShaderMaterial;
  atlas: DataTexture;
}

export function createCloudSpriteMaterials(): CloudSpriteMaterials {
  const atlas = billowAtlas();
  const uniforms = () => ({
    uAtlas: new Uniform(atlas),
    uCells: new Uniform(CELLS),
    uFloorFade: new Uniform(FLOOR_FADE),
  });
  const smoke = new ShaderMaterial({
    name: 'mushroom-smoke',
    vertexShader: SPRITE_VERTEX_SHADER,
    fragmentShader: SMOKE_FRAGMENT_SHADER,
    defines: { LIT: '' },
    uniforms: { ...uniforms(), uLit: new Uniform(1) },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
  const glow = new ShaderMaterial({
    name: 'mushroom-glow',
    vertexShader: SPRITE_VERTEX_SHADER,
    fragmentShader: GLOW_FRAGMENT_SHADER,
    uniforms: uniforms(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  return { smoke, glow, atlas };
}

/**
 * Camera-facing quads of the mushroom clouds, one instance per sprite,
 * written per frame. Sized in metres; unlike point sprites never clamped
 * to the GPU's largest point size close up, and drawn in part at the edge
 * of the screen, where a point sprite vanishes with its centre.
 */
export class SpriteBuffer {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly centers: Float32Array;
  private readonly shapes: Float32Array;
  private readonly colors: Float32Array;
  private readonly glows: Float32Array | null;
  private readonly attributes: InstancedBufferAttribute[] = [];
  private readonly gate: DrawGate;
  private drawn = 0;

  /** `lit`: with the fire light from below (aGlow), for the smoke material */
  constructor(
    scene: Scene,
    readonly capacity: number,
    material: ShaderMaterial,
    renderOrder: number,
    name: string,
    lit: boolean,
  ) {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const attribute = (attributeName: string, itemSize: number): Float32Array => {
      const array = new Float32Array(capacity * itemSize);
      const instanced = new InstancedBufferAttribute(array, itemSize).setUsage(DynamicDrawUsage);
      geometry.setAttribute(attributeName, instanced);
      this.attributes.push(instanced);
      return array;
    };
    this.centers = attribute('aCenter', 4);
    this.shapes = attribute('aShape', 4);
    this.colors = attribute('aColor', 3);
    this.glows = lit ? attribute('aGlow', 3) : null;
    geometry.instanceCount = 0;

    this.mesh = unpickable(new Mesh(geometry, material));
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
    this.gate = new DrawGate([this.mesh]);
  }

  /** Sprites drawn in the last frame */
  get count(): number {
    return this.drawn;
  }

  /**
   * Sprite `i`: centre over the ground at height `floor`, `size` metres
   * across, turned by `rotation`, `alpha` at its densest, atlas `frame`,
   * colour.
   */
  put(
    i: number,
    x: number,
    y: number,
    z: number,
    floor: number,
    size: number,
    rotation: number,
    alpha: number,
    frame: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const o = i * 4;
    const centers = this.centers;
    centers[o] = x;
    centers[o + 1] = y;
    centers[o + 2] = z;
    centers[o + 3] = floor;
    const shapes = this.shapes;
    shapes[o] = size;
    shapes[o + 1] = rotation;
    shapes[o + 2] = alpha;
    shapes[o + 3] = frame;
    const c = i * 3;
    this.colors[c] = r;
    this.colors[c + 1] = g;
    this.colors[c + 2] = b;
  }

  /** Fire light from below on sprite `i` (lit buffers only). */
  putGlow(i: number, r: number, g: number, b: number): void {
    const glows = this.glows;
    if (!glows) return;
    const c = i * 3;
    glows[c] = r;
    glows[c + 1] = g;
    glows[c + 2] = b;
  }

  /** Draw the first `count` sprites written this frame; only they go to the GPU. */
  commit(count: number): void {
    if (count > 0) {
      for (const attribute of this.attributes) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, count * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    this.mesh.geometry.instanceCount = count;
    this.gate.setCount(count);
    this.drawn = count;
  }

  /** Remove and free the buffer; the material belongs to the renderer. */
  dispose(scene: Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
