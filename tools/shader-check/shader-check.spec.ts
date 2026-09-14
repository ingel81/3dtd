/**
 * Shader compile check: the final GLSL of the game's custom materials,
 * compiled and linked by a real GLSL front end, without a browser.
 *
 * Run on demand:
 *   npm run shader-check
 *
 * Like the generators in tools/ it also runs with `npm test`. Every case
 * builds a material the way its renderer does, three's WebGLRenderer turns
 * it into the program WebGL2 would get (capture-renderer.ts: onBeforeCompile,
 * chunks, prefix, instancing, fog, log depth, output colour space), and
 * glslangValidator compiles both stages and links them (glslang.ts). Each
 * run writes the sources to a folder of its own in the OS temp folder
 * (3dtd-shader-check-*), kept when a compile fails; the failure names it.
 *
 * glslangValidator is not a project dependency: GLSLANG_VALIDATOR names it,
 * else it is taken from the PATH (docs/ARCHITECTURE.md, Shader-Compile-Check).
 * Without it the compile tests are skipped: `npm run shader-check` (verbose
 * reporter) prints why and where to get it, `npm test` only counts them as
 * skipped. The GLSL is still generated, so a broken onBeforeCompile or an
 * unknown #include fails either way.
 *
 * A new custom material gets a case in CASES, built as in its renderer.
 */

import { afterAll, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FloatType,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  WebGLCubeRenderTarget,
  type Scene,
  type Side,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { capturePrograms, GAME_SETUPS, type CapturedProgram } from './capture-renderer';
import { compileProgram, findGlslang, preprocess, unmatchedFragmentInputs } from './glslang';

import { createPlinthMaterial } from '../../src/app/three-engine/renderers/tower-plinth/plinth-material';
import { createPlinthMesh } from '../../src/app/three-engine/renderers/tower-plinth/tower-plinth.renderer';
import { makeModelTransparent, tintPreviewModel } from '../../src/app/services/tower-preview-model';
import { RangeRingKit } from '../../src/app/three-engine/renderers/range-ring';
import { TowerBadgeRenderer } from '../../src/app/three-engine/renderers/tower-badge/tower-badge.renderer';
import { createOozeBandMaterial } from '../../src/app/three-engine/renderers/ooze/ooze-band-material';
import { BloodMoonMood } from '../../src/app/three-engine/blood-moon/blood-moon-mood';
import { SearchlightRenderer } from '../../src/app/three-engine/renderers/searchlight/searchlight.renderer';
import type { CoordinateSync } from '../../src/app/three-engine/renderers/index';
import {
  createVATBloodMoonUniforms,
  createVATMaterial,
} from '../../src/app/three-engine/renderers/instanced-enemy/vat-material';
import type { VATData } from '../../src/app/three-engine/renderers/instanced-enemy/vat-baker';
import type { VATAlphaMode } from '../../src/app/three-engine/renderers/instanced-enemy/vat-surface';
import { SpawnPortalManager } from '../../src/app/three-engine/renderers/marker/spawn-portal.manager';
import { SpawnDistanceRings } from '../../src/app/three-engine/renderers/spawn-distance-rings';
import {
  createDiamondMaterial,
  createGroundGlowMaterial,
  createLabelMaterial,
  createRingMaterial,
} from '../../src/app/three-engine/renderers/marker/marker-shaders';
import {
  createParticleShaderMaterials,
  type ParticleShaderMaterials,
} from '../../src/app/three-engine/renderers/particle-shaders';
import { FrostBurstRenderer } from '../../src/app/three-engine/renderers/frost-burst.renderer';
import { EmpPulseRenderer } from '../../src/app/three-engine/renderers/emp-pulse.renderer';
import { OrbitalBeamRenderer } from '../../src/app/three-engine/renderers/orbital-beam.renderer';
import { MushroomCloudRenderer } from '../../src/app/three-engine/renderers/mushroom-cloud.renderer';
import { HealthBarInstanceManager } from '../../src/app/three-engine/renderers/instanced-enemy/health-bar-instance.manager';
import { GroundDecals } from '../../src/app/three-engine/renderers/ground-decals';
import { FloatingTextInstanceManager } from '../../src/app/three-engine/renderers/floating-text/floating-text-instance.manager';
import { LightningBoltRenderer } from '../../src/app/three-engine/renderers/lightning-bolt.renderer';
import { ThreeProjectileRenderer } from '../../src/app/three-engine/renderers/three-projectile.renderer';
import { TrailStreakRenderer } from '../../src/app/three-engine/renderers/trail-streak.renderer';
import { ThreeTentacleRenderer } from '../../src/app/three-engine/renderers/three-tentacle.renderer';
import { TowerShadowMapper } from '../../src/app/three-engine/tower-shadow-mapper';
import { createColorGradingPass } from '../../src/app/three-engine/post-processing/color-grading';
import { guardBloomHighPass } from '../../src/app/three-engine/post-processing/bloom-guard';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { buildRouteAltitudeTubes } from '../../src/app/utils/route-altitude-tubes';
import type { GlobalRouteGrid } from '../../src/app/utils/global-route-grid';
import { RouteGridAggregateViz } from '../../src/app/utils/route-grid-aggregate-viz';
import { TowerLosLayerBuilder } from '../../src/app/utils/tower-los-layer-builder';
import type { RouteCell } from '../../src/app/utils/route-cell';
import { DevTerrainProvider } from '../../src/app/devworld/dev-terrain.provider';
import type { DevWorldService } from '../../src/app/devworld/devworld.service';

/**
 * The trail pools' particle materials (ParticlePoolManager), which the
 * ability effects draw their sparks, shards and smoke with. The atlases only
 * feed uniforms, stand-ins do for the shader.
 */
function particleMaterials(): ParticleShaderMaterials {
  return createParticleShaderMaterials(new Texture(), new Texture(), 4, 4);
}

interface ShaderCase {
  name: string;
  /** Where the shader lives, below src/app/ */
  file: string;
  /** Put the material into the scene as its renderer does */
  build: (scene: Scene) => void;
  /**
   * Code every program of the case must contain: an onBeforeCompile patch,
   * which a chunk renamed in a three update would silently drop
   */
  marks?: string[];
  /** Why the material draws without logarithmic depth; unset, it must write it */
  withoutLogDepth?: string;
}

/**
 * Run `build` without a 2D canvas context, which jsdom does not have: the
 * canvas textures stay blank, the shaders do not read them at compile time.
 */
function withoutCanvas2d(build: () => void): void {
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  try {
    build();
  } finally {
    getContext.mockRestore();
  }
}

/** A sampled ground cell at the origin: one instance of the route grid overlay or a LOS layer. */
function routeCell(): RouteCell {
  return {
    key: 1, x: 0, z: 0, axisX: 0, axisZ: 0, terrainHeight: 0, surface: 'ground', tunnelSpan: null,
    routeAnchorY: 0, sample: { clamped: false } as RouteCell['sample'], heightSampled: true,
    enemies: new Set(), towerVisibility: new Map(), airVisibility: new Map(),
  };
}

/** A geometry with these attributes, `count` vertices of zeros. */
function geometryWith(attributes: Record<string, number>, count = 3): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [name, size] of Object.entries(attributes)) {
    geometry.setAttribute(name, new Float32BufferAttribute(new Float32Array(count * size), size));
  }
  return geometry;
}

/**
 * An enemy pool as EnemyInstanceManager builds it: an InstancedMesh over the
 * VAT geometry (vat-surface.ts attributes) with the per-instance frame and
 * tint. The bake itself is a stub, the shader only sees its uniforms.
 */
function vatPool(mode: VATAlphaMode, side: Side): InstancedMesh {
  const geometry = geometryWith({
    position: 3, normal: 3, uv: 2, aVertexIndex: 1, aVertexColor: 3, aVertexAlpha: 1, aUseMap: 1,
  });
  const vatData = {
    positionTexture: new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType),
    encoding: { type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1], halfFloatError: 0 },
    totalFrames: 1,
    rowsPerFrame: 1,
    texWidth: 1,
    geometry,
    diffuseMap: new Texture(),
    isUnlit: false,
    alpha: { mode, cutoff: mode === 'mask' ? 0.5 : 0 },
    side,
  } as unknown as VATData;
  const material = createVATMaterial(vatData, { bloodMoon: createVATBloodMoonUniforms() });
  const mesh = new InstancedMesh(geometry, material, 4);
  geometry.setAttribute('aAnimFrame', new InstancedBufferAttribute(new Float32Array(4), 1));
  geometry.setAttribute('aTintColor', new InstancedBufferAttribute(new Float32Array(12), 3));
  return mesh;
}

/** The plinth patch (plinth-material.ts), one line after each chunk it hooks onto */
const PLINTH_MARKS = [
  'vPlinthWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
  'diffuseColor.rgb *= plinthAlbedo;',
  'roughnessFactor = plinthRoughness;',
  'normal = plinthPerturbNormal( - vViewPosition, normal, plinthRelief, faceDirection );',
];

const CASES: ShaderCase[] = [
  {
    name: 'tower plinth (MeshStandardMaterial + onBeforeCompile)',
    file: 'three-engine/renderers/tower-plinth/plinth-material.ts',
    build: (scene) => scene.add(createPlinthMesh(2.5, 1.2, createPlinthMaterial())),
    marks: PLINTH_MARKS,
  },
  {
    name: 'tower plinth build preview (see-through, tinted)',
    file: 'three-engine/renderers/tower-plinth/plinth-material.ts',
    build: (scene) => {
      const mesh = createPlinthMesh(2.5, 1.2, createPlinthMaterial());
      makeModelTransparent(mesh, 0.7);
      tintPreviewModel(mesh, false);
      scene.add(mesh);
    },
    marks: PLINTH_MARKS,
  },
  {
    name: 'tower range ring (stencil marks and paint)',
    file: 'three-engine/renderers/range-ring.ts',
    // compile() draws only what is visible; the three passes share one program
    build: (scene) => {
      const ring = new RangeRingKit().create();
      ring.visible = true;
      scene.add(ring);
    },
  },
  {
    name: 'veteran badges',
    file: 'three-engine/renderers/tower-badge/tower-badge-shaders.ts',
    build: (scene) => new TowerBadgeRenderer(scene, () => null),
  },
  {
    name: 'ooze band',
    file: 'three-engine/renderers/ooze/ooze-band-material.ts',
    // The attributes buildOozeBandGeometry writes
    build: (scene) => scene.add(new Mesh(geometryWith({ position: 3, aSide: 3, aS: 1 }), createOozeBandMaterial())),
  },
  {
    name: 'blood moon mood quad',
    file: 'three-engine/blood-moon/blood-moon-mood.ts',
    build: (scene) => new BloodMoonMood(scene),
  },
  {
    name: 'searchlight cones',
    file: 'three-engine/renderers/searchlight/searchlight.renderer.ts',
    // The sync only places lamps and the aim only turns beams, which compiling does not need
    build: (scene) => new SearchlightRenderer(scene, {} as CoordinateSync, { aimHeading: () => null }),
  },
  {
    name: 'VAT enemies (each alpha mode, front and double side)',
    file: 'three-engine/renderers/instanced-enemy/vat-material.ts',
    build: (scene) => {
      for (const mode of ['opaque', 'mask', 'blend'] as const) {
        for (const side of [FrontSide, DoubleSide]) scene.add(vatPool(mode, side));
      }
    },
  },
  {
    name: 'spawn portal gate and summoning circle',
    file: 'three-engine/renderers/marker/spawn-portal-gate-material.ts, spawn-portal-glow-material.ts',
    build: (scene) => {
      const overlay = new Group();
      scene.add(overlay);
      new SpawnPortalManager(overlay);
    },
  },
  {
    name: 'spawn distance rings (halo and dashed line, LineMaterial)',
    file: 'three-engine/renderers/spawn-distance-rings.ts',
    // three's LineMaterial, as MapPlacementService shows the rings while a spawn is placed
    build: (scene) => {
      const ground = {
        sync: { geoToLocalSimple: (lat: number, lon: number, height: number) => new Vector3(lon * 1e5, height, -lat * 1e5) },
        getTerrainHeightAtGeo: () => 0,
      };
      scene.add(new SpawnDistanceRings(ground, { lat: 0, lon: 0 }, [{ radiusM: 200, color: 0xc96a3a }], new Vector2(800, 600)).group);
    },
  },
  {
    name: 'HQ markers (diamond, ring, ground glow, label)',
    file: 'three-engine/renderers/marker/marker-shaders.ts',
    // InstancedMeshes, as MarkerInstanceManager and MarkerLabelManager build them
    build: (scene) => {
      for (const material of [
        createDiamondMaterial(), createRingMaterial(), createGroundGlowMaterial(), createLabelMaterial(new Texture()),
      ]) {
        scene.add(new InstancedMesh(geometryWith({ position: 3, normal: 3, uv: 2 }), material, 4));
      }
    },
  },
  // The ability effects, each built as ThreeTilesEngine builds it
  {
    name: 'frost burst',
    file: 'three-engine/renderers/frost-burst.renderer.ts',
    build: (scene) => new FrostBurstRenderer(scene, particleMaterials()),
  },
  {
    name: 'EMP pulse',
    file: 'three-engine/renderers/emp-pulse.renderer.ts',
    build: (scene) => new EmpPulseRenderer(scene, particleMaterials()),
  },
  {
    name: 'orbital beam',
    file: 'three-engine/renderers/orbital-beam.renderer.ts',
    build: (scene) => new OrbitalBeamRenderer(scene, particleMaterials()),
  },
  {
    name: 'mushroom cloud (shape, glow, smoke, blast)',
    file: 'three-engine/renderers/mushroom-cloud.renderer.ts, mushroom-cloud-*.ts',
    build: (scene) => new MushroomCloudRenderer(scene, particleMaterials()),
  },
  // Enemies, projectiles and effects on the tiles
  {
    name: 'health bars (background and foreground pass)',
    file: 'three-engine/renderers/instanced-enemy/health-bar-instance.manager.ts',
    build: (scene) => new HealthBarInstanceManager(scene),
  },
  {
    name: 'ground decals (blood, ice, scorch)',
    file: 'three-engine/renderers/decal-shaders.ts',
    build: (scene) => new GroundDecals(scene),
  },
  {
    name: 'floating text',
    file: 'three-engine/renderers/floating-text/floating-text-material.ts',
    build: (scene) => withoutCanvas2d(() => new FloatingTextInstanceManager(scene, {} as CoordinateSync)),
  },
  {
    name: 'lightning bolts',
    file: 'three-engine/renderers/lightning-bolt.renderer.ts',
    build: (scene) => withoutCanvas2d(() => new LightningBoltRenderer(scene)),
  },
  {
    name: 'projectiles (orb shader for magic, ice, poison, chaos)',
    file: 'three-engine/renderers/three-projectile.renderer.ts',
    build: (scene) => {
      // The arrow comes from a GLB with its own built-in material: not loaded here
      const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(() => undefined));
      try {
        new ThreeProjectileRenderer(scene, {} as CoordinateSync);
      } finally {
        load.mockRestore();
      }
    },
  },
  {
    name: 'projectile trails',
    file: 'three-engine/renderers/trail-streak.renderer.ts',
    build: (scene) => new TrailStreakRenderer(scene),
  },
  {
    name: 'tentacles',
    file: 'three-engine/renderers/three-tentacle.renderer.ts',
    build: (scene) => new ThreeTentacleRenderer(scene).create('tower', new Vector3()),
  },
  {
    name: 'DevWorld terrain',
    file: 'devworld/dev-terrain.provider.ts',
    build: (scene) => {
      // createGridMaterial is private and reads nothing of the provider
      const provider = new DevTerrainProvider({} as DevWorldService) as unknown as { createGridMaterial(): ShaderMaterial };
      scene.add(new Mesh(geometryWith({ position: 3, normal: 3 }), provider.createGridMaterial()));
    },
  },
  // Line of sight: the cube render and its overlays
  {
    name: 'LOS cube distance material (tile meshes, instanced meshes)',
    file: 'three-engine/tower-shadow-mapper.ts',
    // TowerShadowMapper swaps it onto every mesh of the blocker group for the cube render
    build: (scene) => {
      const mapper = new TowerShadowMapper({} as WebGLRenderer, scene) as unknown as { distanceMaterial: ShaderMaterial };
      scene.add(new Mesh(geometryWith({ position: 3 }), mapper.distanceMaterial));
      scene.add(new InstancedMesh(geometryWith({ position: 3 }), mapper.distanceMaterial, 4));
    },
  },
  {
    name: 'LOS cube face debug quad',
    file: 'three-engine/tower-shadow-mapper.ts',
    build: (scene) => {
      const mapper = new TowerShadowMapper({} as WebGLRenderer, scene) as unknown as {
        ensureDebugResources(size: number): void;
        debugFaceQuad: Mesh;
      };
      // jsdom has no ImageData, which only holds the panel's read-back pixels
      vi.stubGlobal('ImageData', class {
        constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
      });
      try {
        mapper.ensureDebugResources(4);
      } finally {
        vi.unstubAllGlobals();
      }
      scene.add(mapper.debugFaceQuad);
    },
    withoutLogDepth: 'LOS debug panel only: a quad in clip space into its own target, no depth test or write',
  },
  {
    name: 'tower LOS layers (ground and air)',
    file: 'utils/tower-los-layer-builder.ts',
    build: (scene) => {
      const layer = TowerLosLayerBuilder.build({
        cells: [routeCell()], towerTip: new Vector3(0, 10, 0), groundRange: 30, airRange: 40,
        canTargetGround: true, canTargetAir: true, cubemap: new WebGLCubeRenderTarget(4),
        cubemapFarDistance: 40, gridCellSize: 4,
      })!;
      scene.add(layer.groundMesh, layer.airMesh);
    },
  },
  {
    name: 'route grid overlay (ground and air layer)',
    file: 'utils/route-grid-aggregate-viz.ts',
    build: (scene) => {
      const viz = new RouteGridAggregateViz(new Map([[1, routeCell()]]), 4, (cell) => cell.terrainHeight);
      scene.add(viz.createVisualization(), viz.createAirVisualization());
    },
  },
  {
    name: 'air route tubes',
    file: 'utils/route-altitude-tubes.ts',
    build: (scene) => {
      const grid = {
        getCoordinateSync: () => ({
          geoToLocalSimple: (lat: number, lon: number, height: number) => new Vector3(lon * 1e5, height, -lat * 1e5),
        }),
        getCachedRoutes: () => [[{ lat: 0, lon: 0, height: 0 }, { lat: 0, lon: 0.001, height: 0 }]],
        getCellAt: () => undefined,
        estimateTerrainY: () => 0,
      } as unknown as GlobalRouteGrid;
      scene.add(buildRouteAltitudeTubes(grid));
    },
    withoutLogDepth: 'debug overlay drawn over everything: no depth test, no depth write',
  },
  {
    name: 'colour grading pass',
    file: 'three-engine/post-processing/color-grading.ts',
    // The composer draws it on a full-screen quad, the same program
    build: (scene) => scene.add(new Mesh(new PlaneGeometry(2, 2), createColorGradingPass().pass.material)),
    withoutLogDepth: 'full-screen pass of the composer: reads the frame, depth plays no part',
  },
  {
    name: 'bloom high pass (guarded against NaN and infinite pixels)',
    file: 'three-engine/post-processing/bloom-guard.ts',
    build: (scene) => {
      const bloom = new UnrealBloomPass(new Vector2(64, 64), 0.3, 0.4, 0.85);
      guardBloomHighPass(bloom);
      scene.add(new Mesh(new PlaneGeometry(2, 2), bloom.materialHighPassFilter));
    },
    marks: ['nonFinite( texel.rgb )'],
    withoutLogDepth: 'full-screen pass of the composer: reads the frame, depth plays no part',
  },
];

/**
 * What a program lacks for logarithmic depth, empty when it has it. three's
 * prefix defines USE_LOGARITHMIC_DEPTH_BUFFER and maps gl_FragDepthEXT to
 * gl_FragDepth for every ShaderMaterial, with the chunks or without, so only
 * the writes of logdepthbuf_vertex and logdepthbuf_fragment tell.
 */
function logDepthGaps(program: CapturedProgram): string[] {
  const gaps: string[] = [];
  if (!/\bvFragDepth\s*=/.test(program.vertex)) gaps.push('vertex stage writes no vFragDepth (logdepthbuf_vertex)');
  if (!/\bgl_FragDepth\s*=/.test(program.fragment)) gaps.push('fragment stage writes no gl_FragDepth (logdepthbuf_fragment)');
  return gaps;
}

/** The distinct programs of a case over all game setups, with the setups that gave each. */
function programsOf(shaderCase: ShaderCase): { program: CapturedProgram; setups: string[] }[] {
  const bySource = new Map<string, { program: CapturedProgram; setups: string[] }>();
  for (const setup of GAME_SETUPS) {
    for (const program of capturePrograms(shaderCase.build, setup)) {
      const key = `${program.vertex}\0${program.fragment}`;
      const entry = bySource.get(key) ?? { program, setups: [] };
      entry.setups.push(setup.name);
      bySource.set(key, entry);
    }
  }
  return [...bySource.values()];
}

const glslang = findGlslang();

describe('shader compile check', () => {
  // A folder of its own per run, so runs side by side (one per worktree)
  // neither delete nor overwrite each other's sources. Removed after the
  // run unless a compile test did not get through.
  const outDir = mkdtempSync(join(tmpdir(), '3dtd-shader-check-'));
  let compilesStarted = 0;
  let compilesPassed = 0;
  afterAll(() => {
    if (compilesPassed === compilesStarted) rmSync(outDir, { recursive: true, force: true });
  });

  // In a test: vitest shows what a test logs, not what the module logs while it loads
  it('finds glslangValidator, or says where to get it', () => {
    if (glslang) return;
    const fromEnv = process.env['GLSLANG_VALIDATOR'];
    console.warn(
      '[shader-check] glslangValidator not found, compile tests skipped' +
      (fromEnv ? ` (GLSLANG_VALIDATOR=${fromEnv} does not run). ` : '. ') +
      'Get it from https://github.com/KhronosGroup/glslang/releases and set GLSLANG_VALIDATOR ' +
      'to its path or put it on the PATH, see docs/ARCHITECTURE.md (Shader-Compile-Check).',
    );
  });

  describe('the log depth check', () => {
    /** A ShaderMaterial on a plain mesh, with the logdepthbuf chunks or without */
    const programOf = (chunks: boolean): CapturedProgram => {
      const include = (chunk: string) => (chunks ? `#include <${chunk}>` : '');
      const material = new ShaderMaterial({
        vertexShader: `${include('common')}\n${include('logdepthbuf_pars_vertex')}
          void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            ${include('logdepthbuf_vertex')}
          }`,
        fragmentShader: `${include('logdepthbuf_pars_fragment')}
          void main() {
            ${include('logdepthbuf_fragment')}
            gl_FragColor = vec4(1.0);
          }`,
      });
      const [program] = capturePrograms((scene) => scene.add(new Mesh(geometryWith({ position: 3 }), material)), GAME_SETUPS[0]);
      return program;
    };

    it('fails a ShaderMaterial without the logdepthbuf chunks, though three defines log depth for it', () => {
      const program = programOf(false);
      expect(program.fragment).toContain('#define USE_LOGARITHMIC_DEPTH_BUFFER');
      expect(logDepthGaps(program)).toHaveLength(2);
    });

    it('passes the same material with them', () => {
      expect(logDepthGaps(programOf(true))).toEqual([]);
    });
  });

  describe.each(CASES)('$name', (shaderCase) => {
    const stemBase = shaderCase.name.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '').toLowerCase();

    it(`three builds its programs as WebGL2 GLSL${shaderCase.withoutLogDepth ? '' : ' with log depth'}`, () => {
      const programs = programsOf(shaderCase);
      expect(programs.length).toBeGreaterThan(0);
      for (const { program } of programs) {
        expect(program.vertex.startsWith('#version 300 es\n')).toBe(true);
        expect(program.fragment.startsWith('#version 300 es\n')).toBe(true);
        expect(program.vertex).not.toContain('#include');
        expect(program.fragment).not.toContain('#include');
        // Over the tiles every material writes logarithmic depth (logdepthbuf chunks)
        if (!shaderCase.withoutLogDepth) expect(logDepthGaps(program), program.name).toEqual([]);
        for (const mark of shaderCase.marks ?? []) {
          expect(`${program.vertex}\n${program.fragment}`).toContain(mark);
        }
      }
    });

    it.skipIf(!glslang)('compiles and links with glslang (GLSL ES 3.00)', () => {
      compilesStarted++;
      const failures: string[] = [];
      programsOf(shaderCase).forEach(({ program, setups }, i) => {
        const stem = join(outDir, `${stemBase}-${i}`);
        const result = compileProgram(glslang!, program.vertex, program.fragment, outDir, `${stemBase}-${i}`);
        if (!result.ok) {
          failures.push(`${program.name} [${setups.join(', ')}] (${stem}.vert/.frag)\n${result.report}`);
          return;
        }
        const missing = unmatchedFragmentInputs(preprocess(glslang!, `${stem}.vert`), preprocess(glslang!, `${stem}.frag`));
        if (missing.length > 0) {
          failures.push(`${program.name} [${setups.join(', ')}] (${stem}.vert/.frag): fragment inputs not written by the vertex stage: ${missing.join(', ')}`);
        }
      });
      if (failures.length > 0) {
        writeFileSync(join(outDir, `${stemBase}.errors.txt`), failures.join('\n\n'));
      }
      expect(failures, `${shaderCase.file}\n\n${failures.join('\n\n')}`).toEqual([]);
      compilesPassed++;
    });
  });
});
