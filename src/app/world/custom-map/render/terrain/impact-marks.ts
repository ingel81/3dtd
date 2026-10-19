import {
  Vector3,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import { SHADER_NOISE } from '../shader-noise';
import { addHeightFog } from '../environment/height-fog';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from './height-texture';
import type { ImpactMark } from '../../custom-map-ground-damage';
import { RUBBLE_COLOURS, RUBBLE_MATERIALS } from '../../rubble-material';

/**
 * Cells of broken plates: x a random tone of the cell, y how near the
 * crack to the next cell (F2 - F1 of the nearest two cell points)
 */
const SHARDS_GLSL = /* glsl */ `
vec3 shards(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float tone = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = vec2(hash12(cell + o), hash12(cell + o + 17.31));
      float d = length(o + h - f);
      if (d < d1) { d2 = d1; d1 = d; tone = hash12(cell + o + 5.7); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3(tone, d2 - d1, d1);
}
`;

/** Marks at most: every crater a run keeps (CRATERS.max) and the rubble of a big city's fallen */
export const MAX_IMPACT_MARKS = 4096;

/**
 * What the fight leaves on the ground, drawn over it (docs/DESTRUCTION_PLAN.md,
 * Z3/Z4): a crater's burnt floor, its churned rim and the soot thrown out in
 * rays; the grit and dust over a fallen structure's heap. The shape comes
 * from the height grid (CustomMapGroundDamage), the look from here: drawn per
 * pixel from noise in the fragment shader, frayed at every rim, so no two
 * marks and no square show. One instanced mesh draped over the ground like
 * the ground decals (ground-decals.ts), one draw call for every mark.
 */
export class ImpactMarks {
  readonly mesh: InstancedMesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly place: InstancedBufferAttribute;
  private readonly look: InstancedBufferAttribute;

  constructor(heights: HeightTexture) {
    // A grid of 8 x 8 cells in the x/z plane, draped per vertex: a crater's bowl shows in the mark too
    const geometry = new PlaneGeometry(1, 1, 8, 8).rotateX(-Math.PI / 2);
    this.place = new InstancedBufferAttribute(new Float32Array(MAX_IMPACT_MARKS * 4), 4);
    this.look = new InstancedBufferAttribute(new Float32Array(MAX_IMPACT_MARKS * 4), 4);
    geometry.setAttribute('aMark', this.place);
    geometry.setAttribute('aMarkLook', this.look);
    const material = new MeshStandardMaterial({ roughness: 0.95, metalness: 0, transparent: true, depthWrite: false });
    material.name = 'custom-map-impact-marks';
    material.polygonOffset = true;
    material.polygonOffsetFactor = -3;
    material.polygonOffsetUnits = -3;
    // Each class's grit and dust (rubble-material.ts), in RUBBLE_MATERIALS order
    const grit = RUBBLE_MATERIALS.map((m) => new Vector3(...RUBBLE_COLOURS[m].grit));
    const dust = RUBBLE_MATERIALS.map((m) => new Vector3(...RUBBLE_COLOURS[m].dust));
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, heights.uniforms, { uRubbleGrit: { value: grit }, uRubbleDust: { value: dust } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_HEIGHT_GLSL}\nattribute vec4 aMark;\nattribute vec4 aMarkLook;\nvarying vec2 vMarkUv;\nvarying vec4 vMarkLook;\nvarying float vMarkSize;`)
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          // Turned and sized in map space, then on the ground (scene x is map -x)
          float mc = cos(aMark.w);
          float ms = sin(aMark.w);
          vec2 local = vec2(position.x * mc - position.z * ms, position.x * ms + position.z * mc) * aMark.z;
          vec2 mapAt = aMark.xy + vec2(-local.x, local.y);
          vec3 transformed = vec3(-mapAt.x, terrainHeightAt(mapAt), mapAt.y);
          transformed.y += 0.06 + length((modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition) * 0.002;
          vMarkUv = position.xz * 2.0;
          vMarkSize = aMark.z;
          vMarkLook = aMarkLook;`,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHADER_NOISE}\nvarying vec2 vMarkUv;\nvarying vec4 vMarkLook;\nvarying float vMarkSize;\nuniform vec3 uRubbleGrit[${RUBBLE_MATERIALS.length}];\nuniform vec3 uRubbleDust[${RUBBLE_MATERIALS.length}];\n${SHARDS_GLSL}`)
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          {
            vec2 uv = vMarkUv;
            // Metres from the middle: the look's grain stays the same on a rocket's crater and the nuke's
            vec2 mm = uv * vMarkSize * 0.5;
            float r = length(uv);
            float seed = vMarkLook.y;
            float strength = clamp(vMarkLook.z, 0.0, 1.0);
            float angle = atan(uv.y, uv.x);
            // The rim the noise allows at this angle: frayed, never a circle
            float fray = (valueNoise(vec2(angle * 2.2, seed) + uv * 1.7) - 0.5);
            int kind = int(vMarkLook.x + 0.5);
            if (kind == 0) {
              // Crater: rim at 0.71 of the mark. Inside a burnt floor, patchy black and dark brown; on the rim
              // churned earth in clods; beyond it soot thrown out in rays that thin with distance
              float rim = 0.71 + fray * 0.12;
              float floorMask = smoothstep(rim, rim - 0.18, r);
              float char = mix(0.75, 1.0, valueNoise(mm * 1.7 + seed)) * floorMask;
              float clods = smoothstep(0.55, 0.75, valueNoise(mm * 3.1 + seed * 3.1)) * smoothstep(rim - 0.25, rim, r) * smoothstep(rim + 0.22, rim + 0.02, r);
              float rays = smoothstep(0.62, 0.9, valueNoise(vec2(angle * (9.0 + vMarkSize * 0.3) + seed, r * 1.3)));
              float thrown = rays * smoothstep(1.0, rim, r) * step(rim - 0.05, r) * 0.8;
              float dust = smoothstep(1.0, 0.55, r) * 0.35;
              vec3 burnt = mix(vec3(0.018, 0.016, 0.014), vec3(0.07, 0.048, 0.03), valueNoise(mm * 0.85 + seed * 1.7));
              vec3 earth = mix(vec3(0.24, 0.17, 0.1), vec3(0.36, 0.27, 0.17), valueNoise(mm * 2.0 + seed));
              vec3 soot = vec3(0.05, 0.045, 0.04);
              float a = max(max(char * 0.97, clods * 0.9), max(thrown, dust * 0.6));
              vec3 colour = char > clods ? burnt : earth;
              colour = mix(colour, soot, thrown * (1.0 - floorMask) * (1.0 - clods));
              diffuseColor = vec4(colour, a * mix(0.75, 1.0, strength));
            } else {
              // Rubble: broken plates and lumps of its class, cracks of shadow between them, crumbs and dust
              // thrown out past the heap's foot
              int m = int(vMarkLook.w + 0.5);
              vec3 grit = uRubbleGrit[m];
              vec3 dustColour = uRubbleDust[m];
              float rim = 0.78 + fray * 0.22;
              float body = smoothstep(rim, rim - 0.22, r);
              vec3 shard = shards(mm * 1.1 + seed);
              float crack = smoothstep(0.02, 0.09, shard.y);
              vec3 colour = grit * (0.72 + shard.x * 0.5);
              // Darker underside where plates lie on each other, a sprinkle of crumbs
              colour = mix(colour, grit * 0.35, (1.0 - crack) * 0.85);
              float crumbs = step(0.86, hash12(floor(mm * 6.0 + seed)));
              colour = mix(colour, dustColour, crumbs * 0.6);
              float dust = smoothstep(1.0, rim - 0.05, r) * (0.55 + 0.45 * valueNoise(uv * 5.0 + seed));
              colour = mix(dustColour * 0.85, colour, body);
              diffuseColor = vec4(colour, max(body * 0.95, dust * 0.55));
            }
            if (diffuseColor.a < 0.01) discard;
          }`,
        );
    };
    material.customProgramCacheKey = () => 'custom-map-impact-marks-4';
    addHeightFog(material);
    this.mesh = new InstancedMesh(geometry, material, MAX_IMPACT_MARKS);
    this.mesh.name = 'custom-map-impact-marks';
    // One mark of no size while there is none: the view's warm-up (withAllShown) builds the program
    // during loading, the first crater links nothing in the game
    this.mesh.count = 1;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    // Over the ground decals and the roads' ribbons
    this.mesh.renderOrder = 2;
    this.mesh.userData['losTransparent'] = true;
    // The instance matrices stay identity: the vertex shader places every mark from aMark
    this.mesh.matrixAutoUpdate = false;
    const identity = new Object3D();
    identity.updateMatrix();
    for (let i = 0; i < MAX_IMPACT_MARKS; i++) this.mesh.setMatrixAt(i, identity.matrix);
  }

  /** Every mark as the ground has it now */
  set(marks: Iterable<ImpactMark>): void {
    let n = 0;
    for (const m of marks) {
      if (n >= MAX_IMPACT_MARKS) break;
      this.place.setXYZW(n, m.x, m.y, m.size, m.rotation);
      this.look.setXYZW(n, m.kind, m.seed, m.strength, m.material);
      n++;
    }
    if (n === 0) this.place.setXYZW(0, 0, 0, 0, 0);
    this.place.needsUpdate = true;
    this.look.needsUpdate = true;
    this.mesh.count = Math.max(1, n);
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
