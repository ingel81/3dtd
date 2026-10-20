import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { TOWER_TYPES, type TowerTypeConfig } from './tower-types.config';
import { TOWER_PATHS, towerConfigOf } from './tower-paths.config';

/**
 * Every morph target a shipped model carries is driven by something in the
 * game: a tower's clip (ThreeTowerRenderer plays the first one with
 * `hasAnimations`: the archer's waving flag) or its firing motion's release
 * (the ballista's string, FiringMotion). An undriven one stays at its
 * weight and still costs every draw of the mesh its morph texture and the
 * program variant; the build preview draws its towers at rest
 * (CloneOptions.atRest). Read from the GLB's JSON, the files as served.
 */

interface GlbJson {
  nodes?: { name?: string; mesh?: number }[];
  meshes?: { name?: string; primitives: { targets?: unknown[] }[]; extras?: { targetNames?: string[] } }[];
  animations?: { name?: string; channels: { target: { node?: number; path: string } }[] }[];
}

function glbJson(path: string): GlbJson {
  const bytes = readFileSync(path);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as GlbJson;
}

function* glbs(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'candidates') yield* glbs(path);
    } else if (name.endsWith('.glb')) {
      yield path;
    }
  }
}

/** Every config a tower can run on: each type's, and each path's swap of it */
const CONFIGS: TowerTypeConfig[] = [
  ...Object.values(TOWER_TYPES),
  ...Object.values(TOWER_PATHS).filter((path) => path.swap).map((path) => towerConfigOf(path.towerId, path.id)),
];

/** The morph targets the game drives in `json`, as `<node name>/<target name>` */
function drivenTargets(json: GlbJson, configs: TowerTypeConfig[]): Set<string> {
  const driven = new Set<string>();
  const targetNames = (node: number): string[] => {
    const mesh = json.meshes?.[json.nodes?.[node]?.mesh ?? -1];
    const count = Math.max(0, ...(mesh?.primitives ?? []).map((p) => p.targets?.length ?? 0));
    return Array.from({ length: count }, (_, i) => mesh?.extras?.targetNames?.[i] ?? String(i));
  };
  for (const config of configs) {
    // The renderer's mixer plays the first clip; a weights channel moves every target of its node's mesh
    const clip = config.hasAnimations ? json.animations?.[0] : undefined;
    for (const channel of clip?.channels ?? []) {
      if (channel.target.path !== 'weights' || channel.target.node === undefined) continue;
      const node = json.nodes![channel.target.node].name ?? '';
      for (const target of targetNames(channel.target.node)) driven.add(`${node}/${target}`);
    }
    const release = config.firingMotion?.reload?.release;
    if (release) driven.add(`${release.node}/${release.target}`);
  }
  return driven;
}

/** Every morph target of `json`, as `<node name>/<target name>` */
function morphTargets(json: GlbJson): string[] {
  const out: string[] = [];
  for (const node of json.nodes ?? []) {
    const mesh = json.meshes?.[node.mesh ?? -1];
    const count = Math.max(0, ...(mesh?.primitives ?? []).map((p) => p.targets?.length ?? 0));
    for (let i = 0; i < count; i++) out.push(`${node.name ?? ''}/${mesh?.extras?.targetNames?.[i] ?? i}`);
  }
  return out;
}

describe('morph targets of the shipped models', () => {
  for (const root of ['public/assets/models', 'public/maps/assets']) {
    it(`${root}: each one is driven in the game`, () => {
      const undriven: string[] = [];
      for (const path of glbs(root)) {
        const url = relative('public', path).split(sep).join('/');
        const json = glbJson(path);
        const driven = drivenTargets(json, CONFIGS.filter((config) => config.modelUrl === url));
        for (const target of morphTargets(json)) if (!driven.has(target)) undriven.push(`${url}: ${target}`);
      }
      expect(undriven, 'morph targets nothing drives: drop them from the model (Blender: its shape keys)').toEqual([]);
    });
  }

  it('finds the driven ones: the archer flag waves by its clip, the ballista string slackens on release', () => {
    const archer = glbJson('public/assets/models/towers/archer.glb');
    expect(drivenTargets(archer, [TOWER_TYPES.archer])).toEqual(new Set(['flag/Wave_01', 'flag/Wave_02']));
    expect(drivenTargets(archer, [{ ...TOWER_TYPES.archer, hasAnimations: false }]).size).toBe(0);
    const ballista = CONFIGS.find((config) => config.modelUrl.endsWith('ballista.glb'))!;
    expect(drivenTargets(glbJson(`public/${ballista.modelUrl}`), [ballista])).toEqual(new Set(['weapon/relaxed']));
  });
});
