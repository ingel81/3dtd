import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  UnsignedByteType,
  Vector2,
} from 'three';
import type { MapWater } from '../../map-document';
import { HEIGHT_FOG_PARS, HEIGHT_FOG_UNIFORMS, heightFogFragment } from '../environment/height-fog';
import { SKY_FUNCTIONS } from '../environment/sky-dome';
import { SHADER_NOISE } from '../shader-noise';
import type { HeightField } from '../height-field';
import { APRON_RINGS, RIVER_REACH, type ApronProfile } from '../terrain/terrain-apron';

/**
 * One body of water (or lava, or ice) of a map: one surface at `water.level`
 * over the grid cells the mask marks wet.
 *
 * Every vertex carries the water depth over the terrain at its grid sample
 * (level minus terrain height), interpolated like the terrain itself, so the
 * shader knows the depth per pixel without a depth texture: clear and
 * light at the shore, foam where it gets shallow, the map's water colour in
 * the deep. Normals come from a tiling wave texture scrolled in two
 * directions; reflections are the sky colours (fresnel) and a sun glint.
 *
 * Lava (`kind: 'lava'`) is opaque and glows: crust plates drift over hot
 * cracks in the body's colour, pulsing, cooling to crust at the shore.
 * Ice is opaque and still: pale, cracked, with a frosty reflection.
 * Only the main body runs on beyond the map's border (pass the apron).
 *
 * Not a line-of-sight blocker (`userData.losTransparent`).
 */
export class WaterSurface {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private static waves: DataTexture | null = null;
  private time = 0;

  constructor(
    private readonly field: HeightField,
    water: MapWater,
    apron: ApronProfile | null,
  ) {
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uWaves: { value: null },
          uTime: { value: 0 },
          uDeep: { value: new Color() },
          uShallow: { value: new Color() },
          uFlow: { value: new Vector2(0.6, 0.25) },
          uLight: { value: 1 },
        },
      ]),
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      defines: { KIND: -1 },
      transparent: true,
      fog: true,
      depthWrite: true,
    });
    material.uniforms['uWaves'].value = WaterSurface.waveTexture();
    // Shared objects (merge above copied them): the height fog follows the environment
    Object.assign(material.uniforms, HEIGHT_FOG_UNIFORMS);
    material.name = 'custom-map-water';
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.name = 'custom-map-water';
    this.mesh.userData['losTransparent'] = true;
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false;
    this.set(water, apron);
  }

  /** Rebuilds the surface for changed water or heights */
  set(water: MapWater, apron: ApronProfile | null): void {
    const m = this.mesh.material;
    const kind = water.kind === 'lava' ? 1 : water.kind === 'ice' ? 2 : 0;
    if (m.defines['KIND'] !== kind) {
      m.defines['KIND'] = kind;
      m.needsUpdate = true;
    }
    const u = m.uniforms;
    const deep = new Color(water.color || '#2d5a5e');
    u['uDeep'].value.copy(deep);
    u['uShallow'].value.copy(deep).lerp(new Color(0x6f9a88), 0.3);
    this.mesh.geometry.dispose();
    this.mesh.geometry = this.buildGeometry(water, apron);
    this.mesh.visible = (this.mesh.geometry.index?.count ?? 0) > 0;
  }

  /**
   * Reflect this sky: the water takes over the sky dome's uniform objects
   * (gradient, sun, clouds), so it reflects the same clouds as they drift.
   * `sunIntensity` dims the water's own colour at night.
   */
  setSky(skyUniforms: ShaderMaterial['uniforms'], sunIntensity: number): void {
    const u = this.mesh.material.uniforms;
    for (const key of ['uZenith', 'uHorizon', 'uSunDir', 'uSunColor', 'uCloudColor', 'uCloudShadow', 'uCover', 'uGlow', 'uSkyTime']) {
      u[key] = skyUniforms[key];
    }
    // The water's own colour is lit like the ground: dim at night, full by day
    u['uLight'].value = Math.min(1.1, Math.max(0.12, (sunIntensity / 3.4) * 0.85 + 0.15));
    this.mesh.material.needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.mesh.material.uniforms['uTime'].value = this.time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }

  private buildGeometry(water: MapWater, apron: ApronProfile | null): BufferGeometry {
    const f = this.field;
    const cols = f.columns;
    const rows = f.rows;
    const mask = water.mask;
    // Vertices of every sample that touches a wet cell
    const vertexOf = new Int32Array(cols * rows).fill(-1);
    const positions: number[] = [];
    const depths: number[] = [];
    const wets: number[] = [];
    const indices: number[] = [];
    const vertex = (i: number, j: number): number => {
      const k = j * cols + i;
      if (vertexOf[k] < 0) {
        vertexOf[k] = positions.length / 3;
        positions.push(-(f.originX + i * f.cellSize), water.level, f.originY + j * f.cellSize);
        depths.push(water.level - f.sample(i, j));
        wets.push(mask[k] / 255);
      }
      return vertexOf[k];
    };
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const k = j * cols + i;
        if (!(mask[k] || mask[k + 1] || mask[k + cols] || mask[k + cols + 1])) continue;
        // Skip cells whose terrain is above the water at every corner
        if (
          f.sample(i, j) > water.level &&
          f.sample(i + 1, j) > water.level &&
          f.sample(i, j + 1) > water.level &&
          f.sample(i + 1, j + 1) > water.level
        ) {
          continue;
        }
        const v00 = vertex(i, j);
        const v10 = vertex(i + 1, j);
        const v01 = vertex(i, j + 1);
        const v11 = vertex(i + 1, j + 1);
        indices.push(v00, v10, v11, v00, v11, v01);
      }
    }
    // Water that reaches the border runs on beyond it over the apron's rings; it ends where the
    // apron's blurred bed rises above the level (negative depth, discarded in the shader)
    const p = apron;
    const rings = APRON_RINGS.filter((d) => d <= RIVER_REACH).length;
    const n = p?.count ?? 0;
    const wetBorder = (k: number): boolean => {
      const [x, y] = p!.position(0, k);
      const i = Math.round((x - f.originX) / f.cellSize);
      const j = Math.round((y - f.originY) / f.cellSize);
      return mask[j * cols + i] > 0 && f.sample(i, j) < water.level;
    };
    const ringVertex = new Map<number, number>();
    const apronVertex = (r: number, k: number): number => {
      const key = r * n + (k % n);
      let v = ringVertex.get(key);
      if (v === undefined) {
        v = positions.length / 3;
        const [x, y] = p!.position(r, k % n);
        positions.push(-x, water.level, y);
        depths.push(water.level - p!.height(r, k % n));
        wets.push(1);
        ringVertex.set(key, v);
      }
      return v;
    };
    for (let k = 0; k < n; k++) {
      if (!wetBorder(k) || !wetBorder((k + 1) % n)) continue;
      for (let r = 0; r < rings - 1; r++) {
        const a = apronVertex(r, k);
        const b = apronVertex(r, k + 1);
        const c = apronVertex(r + 1, k);
        const e = apronVertex(r + 1, k + 1);
        // Both windings; the material draws one side
        indices.push(a, c, b, b, c, e, a, b, c, b, e, c);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('aDepth', new BufferAttribute(new Float32Array(depths), 1));
    g.setAttribute('aWet', new BufferAttribute(new Float32Array(wets), 1));
    g.setIndex(indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /**
   * A tiling normal texture of sums of waves with whole-number frequencies
   * (so it repeats seamlessly), shared by all water surfaces.
   */
  private static waveTexture(): DataTexture {
    if (WaterSurface.waves) return WaterSurface.waves;
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    let seed = 11;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const waves = Array.from({ length: 24 }, (_, n) => {
      const freq = 1 + Math.floor(rnd() * (3 + n));
      const angle = rnd() * Math.PI * 2;
      return {
        kx: Math.round(Math.cos(angle) * freq),
        ky: Math.round(Math.sin(angle) * freq),
        amp: 1 / (1 + n * 0.35),
        phase: rnd() * Math.PI * 2,
      };
    });
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let dx = 0;
        let dy = 0;
        for (const w of waves) {
          const a = ((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.phase;
          const c = Math.cos(a) * w.amp;
          dx += c * w.kx;
          dy += c * w.ky;
        }
        const nx = -dx * 0.02;
        const ny = -dy * 0.02;
        const len = Math.hypot(nx, ny, 1);
        const q = (y * size + x) * 4;
        data[q] = Math.round((nx / len) * 127.5 + 127.5);
        data[q + 1] = Math.round((ny / len) * 127.5 + 127.5);
        data[q + 2] = Math.round((1 / len) * 127.5 + 127.5);
        data[q + 3] = 255;
      }
    }
    const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    t.colorSpace = NoColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    WaterSurface.waves = t;
    return t;
  }
}

const WATER_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute float aDepth;
attribute float aWet;
varying float vDepth;
varying float vWet;
varying vec3 vWorldPos;
void main() {
  vDepth = aDepth;
  vWet = aWet;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const WATER_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uWaves;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec2 uFlow;
${HEIGHT_FOG_PARS}
${SHADER_NOISE}
${SKY_FUNCTIONS}
uniform float uLight;
varying float vDepth;
varying float vWet;
varying vec3 vWorldPos;

vec3 waveNormal(vec2 p) {
  vec3 a = texture2D(uWaves, p / 23.0 + uFlow * uTime * 0.021).xyz * 2.0 - 1.0;
  vec3 b = texture2D(uWaves, p / 9.0 - vec2(uFlow.y, -uFlow.x) * uTime * 0.035).xyz * 2.0 - 1.0;
  vec3 c = texture2D(uWaves, p / 3.1 + uFlow * uTime * 0.09).xyz * 2.0 - 1.0;
  vec3 n = vec3(a.xy * 0.6 + b.xy * 0.45 + c.xy * 0.3, 1.0);
  // Texture x/y lie in the scene's x/z plane
  return normalize(vec3(n.x, n.z, n.y));
}

void main() {
  #include <logdepthbuf_fragment>
  if (vWet < 0.5 || vDepth <= 0.0) discard;
  vec3 v = normalize(cameraPosition - vWorldPos);
#if KIND == 1
  // Lava: crust plates drifting over hot cracks, pulsing, cooling at the shore
  vec2 lp = vWorldPos.xz;
  vec2 drift = uFlow * uTime * 0.12;
  float plates = skyFbm(lp * 0.16 + drift);
  float cracks = smoothstep(0.38, 0.62, skyFbm(lp * 0.42 - drift * 1.6 + 3.0));
  float crust = smoothstep(0.46, 0.66, plates) * (1.0 - cracks * 0.8);
  crust = max(crust, smoothstep(1.0, 0.0, vDepth) * 0.75);
  float pulse = 0.78 + 0.22 * sin(uTime * 1.4 + plates * 11.0);
  vec3 hot = mix(uDeep, vec3(1.0, 0.82, 0.35), cracks * 0.6) * 3.2 * pulse;
  vec3 crustColor = vec3(0.06, 0.035, 0.03) * (0.5 + 0.5 * uLight);
  vec3 color = mix(hot, crustColor, crust);
  // Faint sky sheen on the crust only
  color += skyColor(vec3(0.0, 1.0, 0.0), false) * 0.04 * crust * uLight;
  // Soft rim: the shore line runs through grid triangles, a hard cut would show their steps
  float alpha = smoothstep(0.0, 0.2, vDepth);
#elif KIND == 2
  // Ice: still, pale, cracked, frosted reflection
  vec2 ip = vWorldPos.xz;
  vec3 n = normalize(vec3((valueNoise(ip * 0.3) - 0.5) * 0.06, 1.0, (valueNoise(ip * 0.3 + 7.0) - 0.5) * 0.06));
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = skyColor(vec3(r.x, max(r.y, 0.02), r.z), false);
  // Fine frost grain, thicker towards the shore; coarse noise would read as reflected clouds
  float frost = smoothstep(0.55, 0.9, skyFbm(ip * 1.3)) * 0.45 + smoothstep(0.8, 0.0, vDepth) * 0.5;
  float crack = 1.0 - smoothstep(0.0, 0.012, abs(skyFbm(ip * 0.08 + 5.0) - 0.5));
  vec3 body = mix(mix(vec3(0.2, 0.3, 0.36), uDeep * 0.6, smoothstep(0.3, 4.0, vDepth) * 0.6), vec3(0.55, 0.6, 0.64), frost * 0.55);
  body *= 1.0 - crack * 0.4;
  vec3 color = mix(body * uLight, sky * 0.8, fresnel * 0.6 + 0.04);
  color += uSunColor * pow(max(dot(r, uSunDir), 0.0), 60.0) * 0.5;
  float alpha = smoothstep(0.0, 0.2, vDepth);
#else
  vec3 n = waveNormal(vWorldPos.xz);
  // Calmer right at the shore
  float shore = smoothstep(0.0, 1.2, vDepth);
  n = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.35 + 0.65 * shore));
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  // Reflect the real sky (with clouds); below the horizon reflected rays see the haze
  vec3 sky = skyColor(vec3(r.x, max(r.y, 0.02), r.z), false);
  vec3 body = mix(uShallow, uDeep, smoothstep(0.2, 3.5, vDepth)) * uLight;
  vec3 color = mix(body, sky, fresnel * 0.9 + 0.05);
  // Sun glint
  float spec = pow(max(dot(r, uSunDir), 0.0), 320.0) * 6.0 + pow(max(dot(r, uSunDir), 0.0), 40.0) * 0.25;
  color += uSunColor * spec;
  // Foam where it gets shallow, broken up by the waves
  float foamNoise = texture2D(uWaves, vWorldPos.xz / 2.3 + uTime * 0.03).x;
  float foamBreak = texture2D(uWaves, vWorldPos.xz / 17.0 - uTime * 0.01).y;
  float foam = smoothstep(0.25, 0.0, vDepth) * smoothstep(0.45, 0.75, foamNoise * 0.6 + foamBreak * 0.6 - vDepth);
  color = mix(color, vec3(0.85, 0.88, 0.86) * uLight, foam * 0.6);
  float alpha = mix(0.55, 0.96, smoothstep(0.0, 1.6, vDepth));
  alpha = max(alpha, fresnel);
  alpha = max(alpha, foam * 0.8);
  alpha *= smoothstep(0.0, 0.08, vDepth);
#endif
  gl_FragColor = vec4(color, alpha);
  ${heightFogFragment('vWorldPos')}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
