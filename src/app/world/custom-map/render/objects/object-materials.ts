import { Color, Vector2, type Material, type MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import { takesCellar } from '../../object-cellar';
import type { HeightTexture } from '../terrain/height-texture';
import { addCellar } from './cellar-shell';
import { objectRadius, pixelDistance, type CatalogObject, type StageTone } from '../asset-catalog';
import { addHeightFog } from '../environment/height-fog';
import { WIND_GLSL, WIND_UNIFORMS, windSwayAtTop } from '../environment/wind';
import { addAtlasVariants } from './atlas-variants';
import { addVertexRoughMetal } from './merge-parts';
import { isCloth } from './cloth';
import { DEFAULT_SPIN, SPIN_GLSL } from './spin';
import { addRotorTurn, DEFAULT_ROTOR, isRotor } from './rotor';
import { addNightWindows, isWindowGlass } from './night-windows';
import { LAMP_LIGHT_UNIFORMS, LAMP_ON_UNIFORM } from '../effects/lamp-light';
import { addLodFade } from './lod-fade';
import { asRuin } from './ruin-damage';

/**
 * The materials the object layer draws its models' parts with (object-layer.ts): a copy of each source material per
 * look, with wind sway, foliage cards, waterfalls, flames, cloth, spinning and rotor parts, weathering, night windows,
 * lamp glass, the LOD fade, height fog, a ruin's damage and a building's cellar in its shader. The per-asset numbers
 * are uniforms, so all of them share a handful of programs.
 */

/** Scratch colour for a detail stage's tone (objectMaterial) */
const STAGE_TONE = new Color();
/** Strongest glow of an object surface (emissive colour times intensity, linear) */
const MAX_EMISSIVE = 0.55;

/**
 * A withered tree (a felled one, WitheredObject) carries this on its
 * instance colour's red: the shaders take it off again and brown its leaves
 * (WITHER_FRAGMENT), its trunk keeps its colour. No program more, no variant
 */
export const WITHER_FLAG = 4;


const WITHER_VERTEX = /* glsl */ `#include <color_vertex>
vWither = 0.0;
#ifdef USE_INSTANCING_COLOR
if (instanceColor.r > ${(WITHER_FLAG - 1).toFixed(1)}) {
  vWither = 1.0;
  vColor.r *= (instanceColor.r - ${WITHER_FLAG.toFixed(1)}) / instanceColor.r;
}
#endif`;

/** Withered leaves: their shade in ochre and brown, a little of their green left, darker where they were dark */
const WITHER_FRAGMENT = /* glsl */ `#include <color_fragment>
if (vWither > 0.5) {
  float leaf = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  vec3 ochre = mix(vec3(0.48, 0.3, 0.12), vec3(0.72, 0.52, 0.22), smoothstep(0.08, 0.35, leaf)) * (0.55 + 1.6 * leaf);
  diffuseColor.rgb = mix(diffuseColor.rgb, ochre, 0.82);
}`;

/** The layer's materials, cached by source and look; card fades follow the quality level's pixel limit */
export class ObjectMaterials {
  private readonly cache = new Map<string, Material>();
  /** Card materials' fade ranges, set again when the pixel limit changes */
  private readonly fades: { range: Vector2; radius: number }[] = [];

  /** `terrain`: the height texture a building's cellar is cut from (ObjectLayerOptions.terrain); `drawPixels` the pixel limit */
  constructor(
    private readonly terrain: () => HeightTexture['uniforms'] | undefined,
    private drawPixels: number,
  ) {}

  /** The quality level's pixel limit: every card's fade range follows */
  setDrawPixels(drawPixels: number): void {
    this.drawPixels = drawPixels;
    for (const f of this.fades) this.setFadeRange(f.range, f.radius);
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    this.fades.length = 0;
  }

  /** A card material's fade: from 0.55 of the distance where an object of `radius` reaches the pixel limit to there */
  private setFadeRange(range: Vector2, radius: number): Vector2 {
    const end = pixelDistance(radius, this.drawPixels);
    return range.set(end * 0.55, end);
  }

  /**
   * The material an object part is drawn with: a copy of the model's,
   * shared by every asset with the same source material and look. Adds
   * wind sway (wind > 0), the foliage card fixes (materials `foliage-*`:
   * authored normals on both sides, fade when edge-on and towards the draw
   * distance), flowing waterfall cards (`foliage-waterfall*`) and flicker
   * for flames (foliage cards that glow). The per-asset numbers are
   * uniforms, so all of them share a handful of shader programs. `tone`
   * multiplies a detail stage's colour (CatalogObject `lod`)
   */
  get(source: Material, entry: CatalogObject, ruin = false, tone?: StageTone): Material {
    const m0 = source as MeshStandardMaterial;
    const card = m0.name.startsWith('foliage-');
    const waterfall = m0.name.startsWith('foliage-waterfall');
    const flame = card && !waterfall && !!m0.emissive && m0.emissive.getHex() !== 0;
    // Banner cloth waves where the map asks for it (cloth.ts, WIND_UNIFORMS.uClothWave)
    const cloth = isCloth(m0);
    // Parts that turn round the model's upright axis: a radar dish, a lighthouse's lens (catalogue `spin`)
    const spin = m0.name.startsWith('spin-');
    // Parts that turn round a hub of their own: a windmill's sails, a water wheel (rotor.ts, catalogue `rotor`)
    const rotor = isRotor(m0);
    const period = rotor ? (entry.rotor ?? DEFAULT_ROTOR) : (entry.spin ?? DEFAULT_SPIN);
    const wind = waterfall ? 0 : entry.wind;
    // Trees bend their crowns apart (in the wind block, before the rest pose)
    const crownWarp = wind > 0 && entry.category === 'tree';
    // Floating objects that are not moored structures rock on the water
    const bob = !!entry.float && entry.category !== 'structure';
    // Several looks in one atlas (a herd of several breeds): only for objects that stay where they are
    const variants = !card && !bob && (entry.variants ?? 1) > 1 ? entry.variants! : 1;
    const key = `${source.uuid}|${entry.grime ? 1 : 0}|${crownWarp ? 1 : 0}|${wind}|${wind > 0 ? entry.height : 0}|${card ? objectRadius(entry) : 0}|${bob ? 1 : 0}|${cloth ? 1 : 0}|${spin || rotor ? period : 0}|${rotor ? 1 : 0}|${variants}|${ruin ? 1 : 0}|${tone ? tone.join(',') : ''}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    // Always an own copy: the library's material is shared (other views, the editor's thumbnails)
    // and is never changed or disposed here. Copies of one source share its textures and programs
    const m = source.clone() as MeshStandardMaterial;
    if (tone) m.color.multiply(STAGE_TONE.setRGB(tone[0], tone[1], tone[2]));
    if (!card && m.emissive) {
      // Glowing surfaces (lava, crystals, windows) stay under a cap: at night a full glow
      // reads as a flat bright disc instead of a lit surface
      const peak = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity;
      if (peak > MAX_EMISSIVE) m.emissiveIntensity *= MAX_EMISSIVE / peak;
    }
    if (!card && wind <= 0 && !bob && !spin && !rotor) {
      if (m.userData['roughMetal']) addVertexRoughMetal(m);
      if (entry.grime && m.aoMap) addGrime(m);
      if (variants > 1) addAtlasVariants(m, variants);
      addWindowGlow(m, source);
      addLodFade(m);
      addHeightFog(m);
      if (ruin) asRuin(m);
      // Last: its move comes first (cellar-shell.ts)
      const terrain = this.terrain();
      if (takesCellar(entry) && terrain) addCellar(m, terrain);
      this.cache.set(key, m);
      return m;
    }
    const local = {
      // Sway at the top in a strong wind, and the height it is measured at (model metres)
      uWindBend: { value: windSwayAtTop(wind, entry.height) },
      uWindHeight: { value: Math.max(entry.height, 0.3) },
      uFadeRange: { value: this.setFadeRange(new Vector2(), objectRadius(entry)) },
      // Seconds a turn of the spinning or rotor parts
      uSpinPeriod: { value: Math.max(0.5, period) },
    };
    if (card) this.fades.push({ range: local.uFadeRange.value, radius: objectRadius(entry) });
    const variant = `${crownWarp ? 't' : ''}${wind > 0 ? 'w' : ''}${card ? 'c' : ''}${waterfall ? 'f' : ''}${flame ? 'l' : ''}${bob ? 'b' : ''}${cloth ? 'k' : ''}${spin ? 's' : ''}${rotor ? 'r' : ''}`;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, WIND_UNIFORMS);
      shader.uniforms['uWindBend'] = local.uWindBend;
      shader.uniforms['uWindHeight'] = local.uWindHeight;
      shader.uniforms['uFadeRange'] = local.uFadeRange;
      shader.uniforms['uSpinPeriod'] = local.uSpinPeriod;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_GLSL}\nuniform float uWindBend;\nuniform float uWindHeight;`);
      // A withered instance (a felled tree, WITHER_FLAG on its colour's red): the flag off its colour, its leaves
      // browned below (card)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWither;')
        .replace('#include <color_vertex>', WITHER_VERTEX);
      if (wind > 0) windSway(shader, crownWarp, card);
      if (bob) bobOnWater(shader);
      if (spin) spinAround(shader);
      if (rotor) addRotorTurn(shader, local.uSpinPeriod);
      if (cloth) clothRipple(shader);
      if (waterfall) waterfallFlow(shader);
      if (card) cardFade(shader, flame);
    };
    m.customProgramCacheKey = () => `custom-map-object-${variant}`;
    if (m.userData['roughMetal']) addVertexRoughMetal(m);
    if (variants > 1) addAtlasVariants(m, variants);
    // Window glass on parts that move lights up at night as well (a ship rocking on the water, a turning part)
    if (!card) addWindowGlow(m, source);
    addLodFade(m);
    addHeightFog(m);
    if (ruin) asRuin(m);
    this.cache.set(key, m);
    return m;
  }
}

/**
 * Weathering baked into a model's occlusion texture (catalogue `grime`,
 * blender_kit.bake_ao): dirt from the ground, streaks under the sills, dirt
 * in the hollows. The occlusion darkens the colour in direct light as well,
 * part way, so the weathering shows in the sun; the tiled surfaces stay
 * sharp, no texture or draw call more
 */
function addGrime(m: Material): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      #ifdef USE_AOMAP
      diffuseColor.rgb *= mix(1.0, texture2D(aoMap, vAoMapUv).r, 0.55);
      #endif`,
    );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}-grime`;
}

/** Window glass glows at night (night-windows.ts): a merged part per vertex, a glass material all over */
function addWindowGlow(m: Material, source: Material): void {
  if (m.userData['nightGlow']) addNightWindows(m, true);
  else if (isWindowGlass(source.name)) addNightWindows(m, false);
  else if (LAMP_GLASS.test(source.name)) addLampGlass(m);
}

/** Glass of a lamp or a lantern (its emissive material): lit as the map's lights are on (EffectLayer, LIGHTS_ON), dark by day */
const LAMP_GLASS = /lamp-glass|lantern-glass/;

function addLampGlass(m: Material): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.uniforms['uLampOn'] = LAMP_LIGHT_UNIFORMS.uLampOn;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LAMP_ON_UNIFORM}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uLampOn;`);
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}-lampglass`;
}

/** Wind sway: trees bend their crowns apart (`crownWarp`), trunk, crown and branches lean and swing with the push, leaf cards flutter; the shadow is read at the rest pose */
function windSway(shader: WebGLProgramParametersWithUniforms, crownWarp: boolean, card: boolean): void {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    /* glsl */ `#include <begin_vertex>
    ${crownWarp ? `{
      // Each crown its own: low bulges up the crown (none on the trunk), their phase from where the tree
      // stands, so one model's trees part in outline, not only in size and turn
      float crownSeed = 0.0;
      #ifdef USE_INSTANCING
      crownSeed = dot(instanceMatrix[3].xz, vec2(0.173, 0.119));
      #endif
      float crownH = clamp(transformed.y / uWindHeight, 0.0, 1.3);
      vec2 bulge = vec2(sin(crownH * 5.2 + crownSeed * 6.1 + transformed.z * 0.35), cos(crownH * 4.3 + crownSeed * 4.7 + transformed.x * 0.35));
      transformed.xz += bulge * 0.05 * uWindHeight * smoothstep(0.3, 0.6, crownH);
    }` : ''}
    // The rest pose, for the shadow lookup below
    vec3 windRest = transformed;
    {
      // The wind's direction in model space: the instance's rotation and scale undone
      vec3 base = vec3(0.0);
      vec3 windDir = vec3(uWindDir.x, 0.0, uWindDir.y);
      #ifdef USE_INSTANCING
      base = instanceMatrix[3].xyz;
      windDir = normalize(transpose(mat3(instanceMatrix)) * windDir);
      #endif
      vec3 acrossDir = normalize(cross(vec3(0.0, 1.0, 0.0), windDir) + vec3(1e-5, 0.0, 0.0));
      float phase = dot(base.xz, vec2(0.071, 0.093));
      // The push at the plant: steady wind, swell and the gust fronts that cross the map (windPush)
      float push = windPush(base.xz);
      float t = uWindTime;
      float hn = clamp(transformed.y / uWindHeight, 0.0, 1.3);
      // A plant swings slower the taller it is (an 8 m tree about once in four seconds), so a wood does not
      // tremble at one quick beat
      float w = 1.6 * sqrt(8.0 / max(uWindHeight, 0.5));
      // Trunk and crown as one: a stiff trunk (bending with the square of the height) leans with the push
      // and swings slowly round that lean, a little across it too
      float sway = sin(t * w + phase) * 0.6 + sin(t * w * 1.63 + phase * 1.7) * 0.22;
      vec3 off = (windDir * (0.75 * push + 0.3 * sway * (0.3 + push)) + acrossDir * sin(t * w * 0.77 + phase * 1.3) * 0.12 * (0.3 + push))
        * uWindBend * 0.4 * hn * hn;
      // Branches: away from the trunk they bend a little more and bob on their own, slowly; each bough
      // moves as one (the phase changes over a few metres, not from vertex to vertex)
      float reach = length(transformed.xz) / uWindHeight;
      float branch = smoothstep(0.06, 0.35, reach) * smoothstep(0.15, 0.5, hn);
      float bp = dot(transformed, vec3(0.37, 0.29, 0.41)) * 2.6 / uWindHeight + phase;
      float beat = sin(t * w * 1.9 + bp) * 0.75 + sin(t * w * 3.1 + bp * 1.4) * 0.25;
      off += (windDir * (0.3 * push + 0.12 * beat * (0.2 + push)) + vec3(0.0, 0.1 * beat * (0.2 + push), 0.0)) * uWindBend * 0.4 * branch;
      ${card ? `// Leaf cards flutter, each card as a whole (the phase over half a metre), quick and small
      vec3 flutter = sin(t * vec3(4.3, 5.1, 3.7) + transformed * 1.3 + phase);
      off += flutter * 0.03 * (0.2 + push) * smoothstep(0.1, 0.4, hn) * min(uWindBend * 4.0, 1.0);` : ''}
      // The player's plant motion: still, calmer or as the wind takes them
      off *= uPlantSway;
      // Bent, not stretched: what moves sideways sinks a little
      off.y -= dot(off.xz, off.xz) / (2.0 * max(transformed.y, 0.5));
      transformed += off;
    }`,
  );
  // The sun's shadow map holds the plants at rest (three's depth material has no sway, and the map is
  // cached over frames): a swaying leaf looked it up where it had moved to and slid in and out of its own
  // crown's shadow, the canopy flickered. It reads the shadow at its rest pose, so the shading rides along
  shader.vertexShader = shader.vertexShader.replace(
    '#include <shadowmap_vertex>',
    /* glsl */ `#ifdef USE_SHADOWMAP
    vec4 windSwayed = worldPosition;
    worldPosition = vec4(windRest, 1.0);
    #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
    #endif
    worldPosition = modelMatrix * worldPosition;
    #endif
    #include <shadowmap_vertex>
    #ifdef USE_SHADOWMAP
    worldPosition = windSwayed;
    #endif`,
  );
}

/** Rocking on the water: a slow heave, roll and pitch, each object with its own phase */
function bobOnWater(shader: WebGLProgramParametersWithUniforms): void {
  // Rocking on the water: a slow heave, roll and pitch, each object with its own phase
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    /* glsl */ `#include <begin_vertex>
    {
      float phase = 0.0;
      #ifdef USE_INSTANCING
      phase = dot(instanceMatrix[3].xz, vec2(0.13, 0.17));
      #endif
      float t = uWindTime;
      float heave = sin(t * 0.9 + phase) * 0.06;
      float roll = sin(t * 0.7 + phase * 1.3) * 0.035;
      float pitch = sin(t * 0.55 + phase * 0.7) * 0.025;
      transformed.y += heave + transformed.x * roll + transformed.z * pitch;
    }`,
  );
}

/** A part turning round the model's upright axis (catalogue `spin`), shape and normals */
function spinAround(shader: WebGLProgramParametersWithUniforms): void {
  // Turning round the model's upright axis, each object at its own angle (spinAngle): the shape and its normals
  const angle = `float spinPhase = 0.0;
      #ifdef USE_INSTANCING
      spinPhase = spinAngle(instanceMatrix[3].xz);
      #endif
      float spinA = uWindTime * 6.2831853 / uSpinPeriod + spinPhase;
      mat2 spinTurn = mat2(cos(spinA), sin(spinA), -sin(spinA), cos(spinA));`;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
uniform float uSpinPeriod;
${SPIN_GLSL}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
${angle}
objectNormal.xz = spinTurn * objectNormal.xz;
}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
{
${angle}
transformed.xz = spinTurn * transformed.xz;
}`);
}

/** Banner cloth ripples down from where it is fastened and blows out with the wind */
function clothRipple(shader: WebGLProgramParametersWithUniforms): void {
  // The cloth ripples down from where it is fastened, more at its free end, and blows out with the wind
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aHang;\nuniform float uClothWave;')
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
    {
      vec3 clothBase = vec3(0.0);
      vec3 clothWind = vec3(uWindDir.x, 0.0, uWindDir.y);
      #ifdef USE_INSTANCING
      clothBase = instanceMatrix[3].xyz;
      clothWind = normalize(transpose(mat3(instanceMatrix)) * clothWind);
      #endif
      float clothPhase = dot(clothBase.xz, vec2(0.071, 0.093));
      float clothPush = windPush(clothBase.xz);
      float ripple = sin(transformed.y * 2.6 - uWindTime * (3.0 + 2.0 * clothPush) + clothPhase) * 0.65
        + sin(transformed.x * 4.0 - uWindTime * 4.6 + clothPhase * 1.7) * 0.35;
      float clothOn = uClothWave * uPlantSway;
      transformed.z += ripple * aHang * (0.05 + 0.2 * clothPush) * clothOn;
      transformed += clothWind * aHang * aHang * 0.35 * clothPush * clothOn;
    }`,
    );
}

/** Water runs down a waterfall card: its texture scrolls */
function waterfallFlow(shader: WebGLProgramParametersWithUniforms): void {
  // Water runs down the card: scroll the texture
  shader.vertexShader = shader.vertexShader.replace(
    '#include <uv_vertex>',
    '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y += uWindTime * 0.6;\n#endif',
  );
}

/** A foliage card: authored normals on both faces, faded edge-on and towards the pixel limit, withered leaves browned; a flame card flickers */
function cardFade(shader: WebGLProgramParametersWithUniforms, flame: boolean): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec2 uFadeRange;\nuniform float uWindTime;\nvarying float vWither;')
    .replace('#include <color_fragment>', WITHER_FRAGMENT)
    // Card normals are authored (bent out of the crown, up for grass); three flips them on
    // back faces of double-sided materials, which turned every card's back black. A geometry
    // without normals draws flat shaded, without vNormal
    .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifndef FLAT_SHADED\nnormal = normalize(vNormal);\n#endif')
    .replace(
      '#include <alphatest_fragment>',
      /* glsl */ `{
      // Cards seen edge-on smear their texture into streaks: fade them out by the flat face normal
      vec3 faceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
      float facing = abs(dot(faceNormal, normalize(vViewPosition)));
      diffuseColor.a *= smoothstep(0.08, 0.3, facing);
      // Fade out towards the draw distance: thin far cards turn into dark lines otherwise
      diffuseColor.a *= 1.0 - smoothstep(uFadeRange.x, uFadeRange.y, length(vViewPosition));
    }
    #include <alphatest_fragment>`,
    );
  if (flame) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 0.75 + 0.18 * sin(uWindTime * 11.0 + vViewPosition.x * 3.0) + 0.1 * sin(uWindTime * 23.0 + vViewPosition.y * 5.0);`,
    );
  }
}
