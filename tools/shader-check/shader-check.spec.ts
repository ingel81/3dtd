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
 * glslangValidator compiles both stages and links them (glslang.ts). The
 * sources of the last run stay in the OS temp folder under 3dtd-shader-check.
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

import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  RGBAFormat,
  Texture,
  type Scene,
  type Side,
} from 'three';

import { capturePrograms, GAME_SETUPS, type CapturedProgram } from './capture-renderer';
import { compileProgram, findGlslang, preprocess, unmatchedFragmentInputs } from './glslang';

import { createPlinthMaterial } from '../../src/app/three-engine/renderers/tower-plinth/plinth-material';
import { createPlinthMesh } from '../../src/app/three-engine/renderers/tower-plinth/tower-plinth.renderer';
import { makeModelTransparent, tintPreviewModel } from '../../src/app/services/tower-preview-model';
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
  /** Where the shader lives, below src/app/three-engine/ */
  file: string;
  /** Put the material into the scene as its renderer does */
  build: (scene: Scene) => void;
  /**
   * Code every program of the case must contain: an onBeforeCompile patch,
   * which a chunk renamed in a three update would silently drop
   */
  marks?: string[];
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
    file: 'renderers/tower-plinth/plinth-material.ts',
    build: (scene) => scene.add(createPlinthMesh(2.5, 1.2, createPlinthMaterial())),
    marks: PLINTH_MARKS,
  },
  {
    name: 'tower plinth build preview (see-through, tinted)',
    file: 'renderers/tower-plinth/plinth-material.ts',
    build: (scene) => {
      const mesh = createPlinthMesh(2.5, 1.2, createPlinthMaterial());
      makeModelTransparent(mesh, 0.7);
      tintPreviewModel(mesh, false);
      scene.add(mesh);
    },
    marks: PLINTH_MARKS,
  },
  {
    name: 'veteran badges',
    file: 'renderers/tower-badge/tower-badge-shaders.ts',
    build: (scene) => new TowerBadgeRenderer(scene, () => null),
  },
  {
    name: 'ooze band',
    file: 'renderers/ooze/ooze-band-material.ts',
    // The attributes buildOozeBandGeometry writes
    build: (scene) => scene.add(new Mesh(geometryWith({ position: 3, aSide: 3, aS: 1 }), createOozeBandMaterial())),
  },
  {
    name: 'blood moon mood quad',
    file: 'blood-moon/blood-moon-mood.ts',
    build: (scene) => new BloodMoonMood(scene),
  },
  {
    name: 'searchlight cones',
    file: 'renderers/searchlight/searchlight.renderer.ts',
    // The sync only places lamps, which compiling does not need
    build: (scene) => new SearchlightRenderer(scene, {} as CoordinateSync),
  },
  {
    name: 'VAT enemies (each alpha mode, front and double side)',
    file: 'renderers/instanced-enemy/vat-material.ts',
    build: (scene) => {
      for (const mode of ['opaque', 'mask', 'blend'] as const) {
        for (const side of [FrontSide, DoubleSide]) scene.add(vatPool(mode, side));
      }
    },
  },
  {
    name: 'spawn portal gate and summoning circle',
    file: 'renderers/marker/spawn-portal-gate-material.ts, spawn-portal-glow-material.ts',
    build: (scene) => {
      const overlay = new Group();
      scene.add(overlay);
      new SpawnPortalManager(overlay);
    },
  },
  {
    name: 'HQ markers (diamond, ring, ground glow, label)',
    file: 'renderers/marker/marker-shaders.ts',
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
    file: 'renderers/frost-burst.renderer.ts',
    build: (scene) => new FrostBurstRenderer(scene, particleMaterials()),
  },
  {
    name: 'EMP pulse',
    file: 'renderers/emp-pulse.renderer.ts',
    build: (scene) => new EmpPulseRenderer(scene, particleMaterials()),
  },
  {
    name: 'orbital beam',
    file: 'renderers/orbital-beam.renderer.ts',
    build: (scene) => new OrbitalBeamRenderer(scene, particleMaterials()),
  },
  {
    name: 'mushroom cloud (shape, glow, smoke, blast)',
    file: 'renderers/mushroom-cloud.renderer.ts, mushroom-cloud-*.ts',
    build: (scene) => new MushroomCloudRenderer(scene, particleMaterials()),
  },
];

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

const OUT_DIR = join(tmpdir(), '3dtd-shader-check');
const glslang = findGlslang();

describe('shader compile check', () => {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

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

  describe.each(CASES)('$name', (shaderCase) => {
    const stemBase = shaderCase.name.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '').toLowerCase();

    it('three builds its programs as WebGL2 GLSL with log depth', () => {
      const programs = programsOf(shaderCase);
      expect(programs.length).toBeGreaterThan(0);
      for (const { program } of programs) {
        expect(program.vertex.startsWith('#version 300 es\n')).toBe(true);
        expect(program.fragment.startsWith('#version 300 es\n')).toBe(true);
        expect(program.vertex).not.toContain('#include');
        expect(program.fragment).not.toContain('#include');
        // Over the tiles every material writes logarithmic depth (logdepthbuf chunks)
        expect(program.fragment).toContain('#define USE_LOGARITHMIC_DEPTH_BUFFER');
        expect(program.fragment).toContain('gl_FragDepth');
        for (const mark of shaderCase.marks ?? []) {
          expect(`${program.vertex}\n${program.fragment}`).toContain(mark);
        }
      }
    });

    it.skipIf(!glslang)('compiles and links with glslang (GLSL ES 3.00)', () => {
      const failures: string[] = [];
      programsOf(shaderCase).forEach(({ program, setups }, i) => {
        const stem = `${stemBase}-${i}`;
        const result = compileProgram(glslang!, program.vertex, program.fragment, OUT_DIR, stem);
        if (!result.ok) {
          failures.push(`${program.name} [${setups.join(', ')}] (${stem}.vert/.frag)\n${result.report}`);
          return;
        }
        const missing = unmatchedFragmentInputs(
          preprocess(glslang!, join(OUT_DIR, `${stem}.vert`)),
          preprocess(glslang!, join(OUT_DIR, `${stem}.frag`)),
        );
        if (missing.length > 0) {
          failures.push(`${program.name} [${setups.join(', ')}]: fragment inputs not written by the vertex stage: ${missing.join(', ')}`);
        }
      });
      if (failures.length > 0) {
        writeFileSync(join(OUT_DIR, `${stemBase}.errors.txt`), failures.join('\n\n'));
      }
      expect(failures, `${shaderCase.file}\n\n${failures.join('\n\n')}`).toEqual([]);
    });
  });
});
