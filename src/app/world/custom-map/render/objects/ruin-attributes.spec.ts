import { BoxGeometry, BufferAttribute, Group, InstancedMesh, Mesh, MeshDepthMaterial, MeshStandardMaterial, PlaneGeometry, ShaderChunk, ShaderLib, Texture, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { MASS_ASSET, type MapMass, type MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { MapObjectLayer } from './object-layer';

/**
 * A vertex shader has 16 attribute slots (MAX_VERTEX_ATTRIBS, the least
 * WebGL 2 grants). An object's material gathers them from many patches: the
 * model's own (position, normal, uv, uv1 for the occlusion), a merged part's
 * (vertex colour, roughMetal, nightGlow), instancing (the matrix takes four,
 * the colour one), the level fade, and a ruin's damage. Over 16 the program
 * does not link ("Too many attributes"): an OSM world's houses did, after
 * the collapse variants added a fourth damage vec4 and an anchor (E259).
 *
 * Here every instanced mesh the object layer builds for a worst case (a
 * merged house with a second uv, window glass and grime, tinted; a raised
 * building; the ruins' floors) is counted, intact and ruined, its material
 * and its shadow's: the attributes of its geometry its vertex shader names,
 * plus the instance matrix and colour. Named anywhere counts, even inside an
 * #ifdef, so the count is never under the real one.
 */

/** Slots a ruin's material may take: one under the limit, room for the next patch */
const RUIN_SLOTS = 15;
const MAX_SLOTS = 16;

const entry = (id: string, extra: Partial<CatalogObject> = {}): CatalogObject => ({
  id,
  name: id,
  category: 'building',
  file: `${id}.glb`,
  footprint: 5,
  height: 9,
  blocksLos: true,
  blocksBuild: true,
  scaleRange: [1, 1],
  randomRotation: false,
  wind: 0,
  drawDistance: 3000,
  ...extra,
});

const catalog: AssetCatalog = {
  version: 1,
  materials: [],
  objects: [entry(MASS_ASSET, { file: 'kit.glb' }), entry('house', { box: [0, 0, 4, 3], grime: true })],
};

/** A part of the house: a box with a second uv, in a plain colour over the shared occlusion map */
function part(name: string, colour: number, occlusion: Texture): Mesh {
  const g = new BoxGeometry(8, 9, 6).translate(0, 4.5, 0);
  g.setAttribute('uv1', new BufferAttribute(new Float32Array(g.getAttribute('uv').array), 2));
  const m = new MeshStandardMaterial({ color: colour, roughness: 0.4 + colour / 0xffffff / 2, aoMap: occlusion });
  m.aoMap!.channel = 1;
  m.name = name;
  return new Mesh(g, m);
}

function library(): MapAssetLibrary {
  const occlusion = new Texture();
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: (url) => {
      const root = new Group();
      if (url.includes('kit')) {
        for (const [name, metres] of [['mass-plaster', 3], ['mass-plinth', 2], ['mass-roof-flat', 3]] as const) {
          const material = new MeshStandardMaterial();
          material.name = name;
          root.add(new Mesh(new PlaneGeometry(metres, metres), material));
        }
      } else {
        // Wall, trim and window glass merge into one part: vertex colour, roughMetal, nightGlow
        root.add(part('wall', 0x998877, occlusion), part('trim', 0x554433, occlusion), part('window-glass', 0x223344, occlusion));
      }
      return Promise.resolve(root);
    },
  });
}

/** A shader's source with three's chunks put in */
function resolve(source: string): string {
  return source.replace(/#include <(\w+)>/g, (_, name: string) => resolve(ShaderChunk[name as keyof typeof ShaderChunk] as string));
}

/** The vertex shader `material` compiles to, its patches run on three's own source */
function vertexOf(material: Material): string {
  const lib = (material as MeshDepthMaterial).isMeshDepthMaterial ? ShaderLib.depth : ShaderLib.standard;
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {}, defines: {} };
  material.onBeforeCompile(shader as never, null as never);
  return resolve(shader.vertexShader);
}

/**
 * The attributes three declares ahead of a material's source (WebGLProgram's
 * prefix): counted whenever the geometry has them, since its chunks name
 * some only through defines (an occlusion map's AOMAP_UV is `uv1`)
 */
const PREFIX = new Set(['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'tangent', 'color']);

/**
 * Slots `mesh` takes drawn with `material`: three's attributes of its
 * geometry, the others its vertex shader declares, the instance matrix
 * (four) and colour
 */
function slots(mesh: InstancedMesh, material: Material): { count: number; names: string[] } {
  const source = vertexOf(material);
  const names = Object.keys(mesh.geometry.attributes).filter((name) => PREFIX.has(name) || new RegExp(`attribute\\s+\\w+\\s+${name}\\s*;`).test(source));
  return { count: names.length + 4 + (mesh.instanceColor ? 1 : 0), names };
}

const block: MapMass = { rings: [[-10, -6, 10, -6, 10, 6, -10, 6]], height: 12, floors: 4, roof: 'flat', facade: 'plaster' };

describe('object materials: attribute slots', () => {
  it('keeps every intact and ruined object material and its shadow under the 16 slots, a ruin one under', async () => {
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4) }, 1000, 1000);
    const los = new Group();
    const layer = new MapObjectLayer(field, library(), los, { ruins: true });
    const objects: MapObject[] = [
      { id: 'h1', asset: 'house', x: 0, y: 0, z: 0, rotation: 0, scale: 1, tint: '#d0c0b0' },
      { id: 'h2', asset: 'house', x: 40, y: 0, z: 0, rotation: 0, scale: 1 },
      { id: 'm1', asset: MASS_ASSET, x: 0, y: 60, z: 0, rotation: 0, scale: 1, mass: block },
    ];
    await layer.setObjects(objects);
    layer.setDamage([{ id: 'h1', stage: 2, fallStart: -1e6 }, { id: 'm1', stage: 3, fallStart: -1e6 }]);
    const meshes: InstancedMesh[] = [];
    for (const root of [layer.group, los]) root.traverse((o) => o instanceof InstancedMesh && meshes.push(o));
    const ruins = meshes.filter((m) => m.geometry.getAttribute('aDamage'));
    // The merged house part reads all its extras: the worst case is in
    const house = ruins.find((m) => m.name === 'house-damaged');
    expect(house).toBeDefined();
    expect(Object.keys(house!.geometry.attributes)).toEqual(expect.arrayContaining(['uv1', 'color', 'roughMetal', 'nightGlow', 'lodFade']));
    expect(house!.instanceColor).not.toBeNull();
    expect(ruins.some((m) => m.name === 'ruin-slabs')).toBe(true);
    expect(ruins.some((m) => (m.material as Material).name.startsWith('mass-'))).toBe(true);
    const report: string[] = [];
    for (const mesh of meshes) {
      const ruin = ruins.includes(mesh);
      for (const material of [mesh.material as Material, mesh.customDepthMaterial].filter((m): m is Material => !!m)) {
        const { count, names } = slots(mesh, material);
        report.push(`${mesh.name || (mesh.material as Material).name} ${material.type}: ${count} (${names.join(' ')})`);
        expect(count, report[report.length - 1]).toBeLessThanOrEqual(ruin ? RUIN_SLOTS : MAX_SLOTS);
        if (process.env["SLOTS"]) console.log(report[report.length - 1]);
      }
    }
    // The ruined house: its anchor rides in roughMetal, its dark windows read no nightGlow
    const worst = slots(house!, house!.material as Material);
    expect(worst.names).not.toContain('aDamageAnchor');
    expect(worst.names).not.toContain('nightGlow');
    layer.dispose();
  });
});
