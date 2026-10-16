import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Scene,
  SRGBColorSpace,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EARTH_A, directionOf, type LatLon } from './globe-geo';
import type { GlobeMaps } from './globe-textures';
import { ellipsoidGeometry } from './globe-view';

/**
 * The two drawn globes of the stage (docs/WORLDS_NAVIGATION_PLAN.md, 4.3),
 * beside the real earth (GlobeView): OpenStreetMap as a schematic map on
 * the earth's own maps, the maps as a low-poly world in the engine's
 * colours with a small tower for every map. Both live in a frame of radius
 * 1, Z through the north pole like the earth's ECEF; GlobeStage draws them
 * with its one renderer.
 */
export interface StageGlobeScene {
  readonly scene: Scene;
  /** 1 in colour, 0 grey (a world that is locked) */
  setSaturation(value: number): void;
  /** The sun's direction in the globe's frame, and seconds for what drifts */
  update(sun: Vector3, seconds: number): void;
  dispose(): void;
}

// ---- OpenStreetMap ----

/** OSM Carto's colours, which say "map" at a glance: water, land, wood, built-up, roads */
const OSM_COLORS = {
  water: '#aad3df',
  coast: '#86b5c6',
  land: '#f2efe9',
  wood: '#add19e',
  ice: '#f7f9fa',
  sand: '#f5e9c6',
  town: '#e0dfdf',
  road: '#f6b38f',
  border: '#a598b8',
  grid: '#c4d7de',
  night: '#2a3550',
};

const OSM_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vNormal = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const OSM_FRAGMENT = /* glsl */ `
uniform sampler2D dayMap;
uniform sampler2D reliefMap;
uniform sampler2D nightMap;
uniform sampler2D linesMap;
uniform float hasMaps;
uniform float hasLines;
uniform vec3 sunDir;
uniform float saturation;
uniform vec3 cWater;
uniform vec3 cCoast;
uniform vec3 cLand;
uniform vec3 cWood;
uniform vec3 cIce;
uniform vec3 cSand;
uniform vec3 cTown;
uniform vec3 cRoad;
uniform vec3 cGrid;
uniform vec3 cNight;
varying vec2 vUv;
varying vec3 vNormal;

float lineOf(float x, float width) {
  float d = abs(fract(x) - 0.5) * 2.0;
  float w = fwidth(x) * 1.5;
  return 1.0 - smoothstep(1.0 - width - w, 1.0 - width, d);
}

void main() {
  vec3 day = texture2D(dayMap, vUv).rgb;
  // The water mask a little blurred: its texels would show as steps along the coast
  float water = hasMaps > 0.5 ? smoothstep(0.3, 0.7, texture2D(reliefMap, vUv, 1.5).a) : 1.0;
  // Towns from the city lights; their wider area from a coarser mip
  float lightsHere = dot(texture2D(nightMap, vUv).rgb, vec3(0.333)) * hasMaps;
  float lightsArea = dot(texture2D(nightMap, vUv, 3.0).rgb, vec3(0.333)) * hasMaps;
  float town = smoothstep(0.12, 0.3, lightsHere);

  // Land by what the day map shows: wood where it is clearly green, sand where it is warm, ice where it is bright
  float green = day.g - max(day.r, day.b);
  float bright = dot(day, vec3(0.333));
  vec3 land = cLand;
  land = mix(land, cSand, smoothstep(0.08, 0.16, day.r - day.b) * (1.0 - smoothstep(0.0, 0.02, green)) * 0.7);
  land = mix(land, cWood, smoothstep(0.004, 0.03, green));
  land = mix(land, cIce, smoothstep(0.4, 0.55, bright));
  land = mix(land, cTown, town);

  // Main roads: a warped net, drawn only where many live
  vec2 g = vUv * vec2(120.0, 60.0);
  g += vec2(sin(vUv.y * 83.0 + vUv.x * 17.0), cos(vUv.x * 59.0 - vUv.y * 11.0)) * 0.3;
  float roads = max(lineOf(g.x, 0.1), lineOf(g.y, 0.1)) * smoothstep(0.06, 0.14, lightsArea);
  land = mix(land, cRoad, roads * 0.9);
  // Borders, dashed as on the map
  vec4 lines = texture2D(linesMap, vUv);
  land = mix(land, lines.rgb, lines.a * hasLines);

  vec3 color = mix(land, cWater, water);
  // The coast as a darker line along the water's edge
  float edge = clamp(fwidth(water) * 2.0, 0.0, 1.0);
  color = mix(color, cCoast, edge);
  // A faint graticule, every 15 degrees, over the sea
  vec2 deg = vUv * vec2(24.0, 12.0);
  float grid = max(lineOf(deg.x, 0.015), lineOf(deg.y, 0.015));
  color = mix(color, cGrid, grid * 0.45 * water);

  // Day and night: the paper darkens, the towns glow
  float ndl = dot(normalize(vNormal), normalize(sunDir));
  float lit = smoothstep(-0.15, 0.25, ndl);
  vec3 dark = mix(cNight, color, 0.3);
  color = mix(dark, color * (0.86 + 0.14 * max(ndl, 0.0)), lit);
  color += vec3(1.0, 0.72, 0.35) * smoothstep(0.05, 0.3, lightsHere) * (1.0 - lit) * 0.6;

  color = mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, saturation);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

/** OpenStreetMap's globe: the earth as a schematic map, water and towns from the menu earth's own maps */
export class OsmGlobe implements StageGlobeScene {
  readonly scene = new Scene();
  private readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private lines: CanvasTexture | null = null;
  private disposed = false;

  constructor(segments: [number, number]) {
    const geometry = ellipsoidGeometry(segments[0], segments[1]);
    geometry.scale(1 / EARTH_A, 1 / EARTH_A, 1 / EARTH_A);
    const color = (hex: string) => ({ value: new Color(hex) });
    this.mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        vertexShader: OSM_VERTEX,
        fragmentShader: OSM_FRAGMENT,
        uniforms: {
          dayMap: { value: null },
          reliefMap: { value: null },
          nightMap: { value: null },
          linesMap: { value: null },
          hasMaps: { value: 0 },
          hasLines: { value: 0 },
          sunDir: { value: new Vector3(1, 0, 0) },
          saturation: { value: 1 },
          cWater: color(OSM_COLORS.water),
          cCoast: color(OSM_COLORS.coast),
          cLand: color(OSM_COLORS.land),
          cWood: color(OSM_COLORS.wood),
          cIce: color(OSM_COLORS.ice),
          cSand: color(OSM_COLORS.sand),
          cTown: color(OSM_COLORS.town),
          cRoad: color(OSM_COLORS.road),
          cGrid: color(OSM_COLORS.grid),
          cNight: color(OSM_COLORS.night),
        },
        toneMapped: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    void osmLinesTexture().then((texture) => {
      if (!texture) return;
      if (this.disposed) {
        texture.dispose();
        return;
      }
      this.lines = texture;
      this.mesh.material.uniforms['linesMap'].value = texture;
      this.mesh.material.uniforms['hasLines'].value = 1;
    });
  }

  /** The earth's maps arrived (GlobeView.surfaceMaps): water, wood and towns come from them */
  setMaps(maps: GlobeMaps | null): void {
    const u = this.mesh.material.uniforms;
    if (u['dayMap'].value === (maps?.day ?? null)) return;
    u['dayMap'].value = maps?.day ?? null;
    u['reliefMap'].value = maps?.relief ?? null;
    u['nightMap'].value = maps?.night ?? null;
    u['hasMaps'].value = maps ? 1 : 0;
  }

  /** Drawn at all: without the maps it would be a blue ball */
  get ready(): boolean {
    return this.mesh.material.uniforms['hasMaps'].value === 1;
  }

  setSaturation(value: number): void {
    this.mesh.material.uniforms['saturation'].value = value;
  }

  update(sun: Vector3): void {
    (this.mesh.material.uniforms['sunDir'].value as Vector3).copy(sun);
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.lines?.dispose();
  }
}

/** Width of the borders' texture; the globe shows a hemisphere of it across a few hundred pixels */
const LINES_WIDTH = 4096;

/**
 * The countries' borders, dashed as on OpenStreetMap's map, drawn once into
 * an equirectangular texture from the world outlines (Natural Earth, loaded
 * as its own chunk). Null where there is no canvas to draw on.
 */
async function osmLinesTexture(): Promise<CanvasTexture | null> {
  if (typeof document === 'undefined') return null;
  const [{ BORDERS, OUTLINE_FACTOR }, { decodePolyline }] = await Promise.all([
    import('../components/world-globe/world-outlines.data'),
    import('../components/world-globe/globe-projection'),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = LINES_WIDTH;
  canvas.height = LINES_WIDTH / 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const x = (lon: number) => ((lon + 180) / 360) * canvas.width;
  const y = (lat: number) => ((90 - lat) / 180) * canvas.height;
  ctx.strokeStyle = OSM_COLORS.border;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.setLineDash([12, 7]);
  for (const line of BORDERS) {
    const points = decodePolyline(line, OUTLINE_FACTOR);
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 2) {
      const lat = points[i];
      const lon = points[i + 1];
      // A line over the date line starts anew on the other side
      if (i === 0 || Math.abs(lon - points[i - 1]) > 180) ctx.moveTo(x(lon), y(lat));
      else ctx.lineTo(x(lon), y(lat));
    }
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// ---- The maps: a low-poly world ----

/** The engine's colours (water-material.ts, the terrain's), a touch brighter to read small */
const MAPS_COLORS = {
  deep: '#1d4a60',
  sea: '#2c6a7c',
  shallow: '#4a9a98',
  sand: '#cdbb8a',
  grass: '#6f9a46',
  meadow: '#86ad52',
  forest: '#3f6332',
  rock: '#8d887e',
  snow: '#e9edf0',
  tree: '#2f5228',
  trunk: '#5a4632',
  cloud: '#f1f3f2',
  cloudShade: '#7d868c',
  tower: '#cfc8b2',
  roof: '#9a4a3a',
  brass: '#c9a44c',
};

/** Height where the land begins and where rock and snow take over (noise units) */
const SEA_LEVEL = 0.53;
const ROCK_LEVEL = 0.7;
const SNOW_LEVEL = 0.77;

/** A deterministic hash in [0, 1) of integer lattice coordinates */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(seed + 1, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** Height of the drawn world at a unit direction: a few octaves of value noise */
export function mapsWorldHeight(dir: Vector3): number {
  let amplitude = 0.5, frequency = 1.6, total = 0, norm = 0;
  for (let octave = 0; octave < 5; octave++) {
    total += amplitude * valueNoise(dir.x * frequency + 11, dir.y * frequency + 7, dir.z * frequency + 3, octave + 4);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.05;
  }
  return total / norm;
}

/** A stable place on land for a map: its id hashed to a spot, stepped on until it is dry */
export function mapsWorldSpot(id: string): LatLon {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  const dir = new Vector3();
  for (let step = 0; step < 400; step++) {
    const lat = (hash3(seed, step, 1, 9) - 0.5) * 120;
    const lon = (hash3(seed, step, 2, 9) - 0.5) * 360;
    directionOf(lat, lon, dir);
    const h = mapsWorldHeight(dir);
    if (h > SEA_LEVEL + 0.02 && h < ROCK_LEVEL) return { lat, lon };
  }
  return { lat: 0, lon: 0 };
}

/** The maps' globe: a low-poly world, a tower for every map, trees and drifting clouds */
export class MapsGlobe implements StageGlobeScene {
  readonly scene = new Scene();
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly saturation = { value: 1 };
  private readonly sun = new DirectionalLight(0xffffff, 2.6);
  private readonly clouds = new Group();
  private readonly towers: InstancedMesh;
  private readonly ring: Mesh;
  private spots: { id: string; at: LatLon }[] = [];
  private picked: string | null = null;

  constructor(detail: number) {
    this.scene.add(new HemisphereLight(0xbfd4e6, 0x1a2430, 0.9), new AmbientLight(0x404a5a, 0.25), this.sun);

    const ground = this.groundGeometry(detail);
    this.scene.add(new Mesh(ground, this.material({ vertexColors: true, flatShading: true })));
    this.scene.add(this.trees(ground));

    const tower = mergeGeometries([
      new CylinderGeometry(0.018, 0.021, 0.05, 6).translate(0, 0.025, 0),
      new ConeGeometry(0.03, 0.04, 6).translate(0, 0.07, 0),
    ]);
    this.geometries.push(tower);
    this.towers = new InstancedMesh(tower, this.material({ flatShading: true }), 64);
    this.towers.count = 0;
    this.scene.add(this.towers);

    const ringGeometry = new TorusGeometry(0.05, 0.008, 6, 24).rotateX(Math.PI / 2);
    this.geometries.push(ringGeometry);
    this.ring = new Mesh(ringGeometry, this.material({ color: MAPS_COLORS.brass, emissive: MAPS_COLORS.brass, emissiveIntensity: 0.35 }));
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.makeClouds();
    this.scene.add(this.clouds);
  }

  /** The maps as towers on the land; `picked` stands taller in a brass ring */
  setMaps(maps: readonly { id: string }[], picked: string | null): void {
    const ids = maps.map((m) => m.id).join('|');
    if (ids !== this.spots.map((s) => s.id).join('|')) {
      this.spots = maps.slice(0, 64).map((m) => ({ id: m.id, at: mapsWorldSpot(m.id) }));
      this.picked = null;
    } else if (picked === this.picked) {
      return;
    }
    this.picked = picked;
    const matrix = new Matrix4();
    const color = new Color();
    this.spots.forEach((spot, i) => {
      const scale = spot.id === picked ? 1.5 : 1;
      this.placeOnGround(spot.at, scale, matrix);
      this.towers.setMatrixAt(i, matrix);
      this.towers.setColorAt(i, color.set(spot.id === picked ? MAPS_COLORS.brass : i % 3 === 0 ? MAPS_COLORS.roof : MAPS_COLORS.tower));
    });
    this.towers.count = this.spots.length;
    this.towers.instanceMatrix.needsUpdate = true;
    if (this.towers.instanceColor) this.towers.instanceColor.needsUpdate = true;
    const spot = this.spots.find((s) => s.id === picked);
    this.ring.visible = !!spot;
    if (spot) {
      this.placeOnGround(spot.at, 1, matrix);
      matrix.decompose(this.ring.position, this.ring.quaternion, this.ring.scale);
    }
  }

  /** Where a map's tower stands, for the globe to turn to it */
  spotOf(id: string): LatLon | null {
    return this.spots.find((s) => s.id === id)?.at ?? null;
  }

  setSaturation(value: number): void {
    this.saturation.value = value;
  }

  update(sun: Vector3, seconds: number): void {
    this.sun.position.copy(sun).multiplyScalar(5);
    this.clouds.rotation.z = seconds * 0.02;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.towers.dispose();
  }

  /** Lambert in the engine's colours, greyed by `saturation`; not tone mapped (the stage's renderer maps the earth's) */
  private material(params: ConstructorParameters<typeof MeshLambertMaterial>[0]): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ ...params, toneMapped: false });
    const saturation = this.saturation;
    material.onBeforeCompile = (shader) => {
      shader.uniforms['saturation'] = saturation;
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float saturation;\nvoid main() {')
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n  gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722))), gl_FragColor.rgb, saturation);',
        );
    };
    this.materials.push(material);
    return material;
  }

  /** An icosphere, each face lifted and coloured by the height noise at its middle: sea, sand, grass, forest, rock, snow */
  private groundGeometry(detail: number): BufferGeometry {
    const ico = new IcosahedronGeometry(1, detail);
    const position = ico.getAttribute('position') as BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const v = new Vector3();
    const heights = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).normalize();
      const h = mapsWorldHeight(v);
      heights[i] = h;
      const lift = h > SEA_LEVEL ? 1 + (h - SEA_LEVEL) * 0.22 : 1;
      position.setXYZ(i, v.x * lift, v.y * lift, v.z * lift);
    }
    const palette = Object.fromEntries(Object.entries(MAPS_COLORS).map(([k, hex]) => [k, new Color(hex)])) as Record<keyof typeof MAPS_COLORS, Color>;
    const c = new Color();
    for (let face = 0; face < position.count; face += 3) {
      const h = (heights[face] + heights[face + 1] + heights[face + 2]) / 3;
      v.fromBufferAttribute(position, face).add(new Vector3().fromBufferAttribute(position, face + 1)).add(new Vector3().fromBufferAttribute(position, face + 2)).normalize();
      const lat = Math.abs(v.z);
      const wiggle = hash3(face, 3, 5, 1);
      if (h < SEA_LEVEL - 0.08) c.copy(palette.deep);
      else if (h < SEA_LEVEL - 0.03) c.copy(palette.sea);
      else if (h < SEA_LEVEL) c.copy(palette.shallow);
      else if (h < SEA_LEVEL + 0.015) c.copy(palette.sand);
      else if (h > SNOW_LEVEL || (lat > 0.88 && h > SEA_LEVEL)) c.copy(palette.snow);
      else if (h > ROCK_LEVEL) c.copy(palette.rock);
      else if (h > 0.61 && wiggle > 0.35) c.copy(palette.forest);
      else c.copy(wiggle > 0.5 ? palette.meadow : palette.grass);
      for (let k = 0; k < 3; k++) c.toArray(colors, (face + k) * 3);
    }
    ico.setAttribute('color', new BufferAttribute(colors, 3));
    ico.computeVertexNormals();
    this.geometries.push(ico);
    return ico;
  }

  /** Small cone trees on the forest faces */
  private trees(ground: BufferGeometry): InstancedMesh {
    const position = ground.getAttribute('position') as BufferAttribute;
    const color = ground.getAttribute('color') as BufferAttribute;
    const forest = new Color(MAPS_COLORS.forest);
    const spots: Vector3[] = [];
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let face = 0; face < position.count && spots.length < 420; face += 3) {
      if (Math.abs(color.getX(face) - forest.r) > 1e-3 || Math.abs(color.getY(face) - forest.g) > 1e-3) continue;
      a.fromBufferAttribute(position, face);
      b.fromBufferAttribute(position, face + 1);
      c.fromBufferAttribute(position, face + 2);
      spots.push(a.clone().add(b).add(c).divideScalar(3));
    }
    const tree = new ConeGeometry(0.011, 0.034, 5).translate(0, 0.017, 0);
    this.geometries.push(tree);
    const mesh = new InstancedMesh(tree, this.material({ color: MAPS_COLORS.tree, flatShading: true }), Math.max(1, spots.length));
    const matrix = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    spots.forEach((spot, i) => {
      const s = 0.8 + hash3(i, 7, 1, 3) * 0.6;
      q.setFromUnitVectors(up, spot.clone().normalize());
      matrix.compose(spot, q, new Vector3(s, s, s));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.count = spots.length;
    return mesh;
  }

  private makeClouds(): void {
    const puff = new IcosahedronGeometry(0.05, 1);
    this.geometries.push(puff);
    // Lit a little from within: clouds in shade read as stones otherwise
    const material = this.material({ color: MAPS_COLORS.cloud, emissive: MAPS_COLORS.cloudShade, flatShading: true, side: DoubleSide });
    const dir = new Vector3();
    for (let i = 0; i < 7; i++) {
      const cloud = new Object3D();
      directionOf((hash3(i, 1, 2, 5) - 0.5) * 110, hash3(i, 2, 3, 5) * 360 - 180, dir);
      cloud.position.copy(dir).multiplyScalar(1.11);
      cloud.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
      for (let k = 0; k < 3; k++) {
        const ball = new Mesh(puff, material);
        ball.position.set((k - 1) * 0.055, (k === 1 ? 0.012 : 0), (hash3(i, k, 4, 5) - 0.5) * 0.02);
        ball.scale.setScalar(k === 1 ? 1.3 : 0.9);
        cloud.add(ball);
      }
      this.clouds.add(cloud);
    }
  }

  private placeOnGround(at: LatLon, scale: number, out: Matrix4): Matrix4 {
    const dir = directionOf(at.lat, at.lon, new Vector3());
    const h = mapsWorldHeight(dir);
    const lift = h > SEA_LEVEL ? 1 + (h - SEA_LEVEL) * 0.22 : 1;
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
    return out.compose(dir.multiplyScalar(lift), q, new Vector3(scale, scale, scale));
  }
}
