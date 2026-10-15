import { type Material, Mesh, PointLight, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { EffectLayer, lightCap, POINT_LIGHTS } from './effect-layer';
import { particleCount } from './particle-field';
import { LAMP_LIGHT_UNIFORMS } from './lamp-light';

const base: Omit<CatalogObject, 'id' | 'name'> = {
  category: 'fx',
  file: '',
  footprint: 1,
  height: 2,
  blocksLos: false,
  blocksBuild: false,
  scaleRange: [1, 1],
  randomRotation: false,
  wind: 0,
  drawDistance: 1000,
};

const catalog: AssetCatalog = {
  version: 1,
  materials: [],
  objects: [
    {
      ...base,
      id: 'torch',
      name: 'Torch',
      effects: [{ kind: 'fire', height: 2 }, { kind: 'embers' }],
      light: { color: '#ff9040', intensity: 1, distance: 10, height: 2.5, flicker: true },
    },
    { ...base, id: 'falls', name: 'Falls', footprint: 3, height: 12, effects: [{ kind: 'waterfall' }] },
    { ...base, id: 'rock', name: 'Rock', category: 'rock' },
    { ...base, id: 'house', name: 'House', category: 'building', footprint: 4, height: 7, effects: [{ kind: 'smoke', at: [2, -1], height: 7, rate: 2 }] },
    { ...base, id: 'fx-smoke', name: 'Smoke', effects: [{ kind: 'smoke', radius: 1, height: 0, rate: 4 }] },
    { ...base, id: 'fx-birds', name: 'Bird flock', effects: [{ kind: 'birds', radius: 45, height: 50, rate: 10 }] },
    { ...base, id: 'fx-fireflies', name: 'Fireflies', effects: [{ kind: 'fireflies', radius: 8, height: 1.5, rate: 6, color: '#e6ff8c' }] },
  ],
};

function flat(): HeightField {
  return new HeightField({ columns: 3, rows: 3, cellSize: 50, heights: new Float32Array(9).fill(4) }, 100, 100);
}

const place = (id: string, asset: string, x: number): MapObject => ({ id, asset, x, y: 0, z: 0, rotation: 0, scale: 1 });

describe('EffectLayer', () => {
  it('bakes its lights onto the land and lets them shine by darkness, not without lights', () => {
    const layer = new EffectLayer(flat());
    layer.set([place('t', 'torch', 10)], catalog);
    expect(LAMP_LIGHT_UNIFORMS.uLampFlicker.value).not.toBeNull();
    layer.setDarkness(1);
    expect(LAMP_LIGHT_UNIFORMS.uLampOn.value).toBe(1);
    layer.setDarkness(0);
    expect(LAMP_LIGHT_UNIFORMS.uLampOn.value).toBe(0);
    layer.set([place('r', 'rock', 10)], catalog);
    layer.setDarkness(1);
    expect(LAMP_LIGHT_UNIFORMS.uLampOn.value).toBe(0);
    layer.dispose();
    expect(LAMP_LIGHT_UNIFORMS.uLampSteady.value).toBeNull();
  });

  it("puts a house's chimney smoke at its chimney, turned with it, and none where smoke is placed over it", () => {
    const smokeOrigins = (objects: MapObject[]): Vector3[] => {
      const layer = new EffectLayer(flat());
      layer.set(objects, catalog);
      const mesh = layer.group.children.find((c): c is Mesh => c instanceof Mesh && c.name === 'custom-map-particles-smoke');
      const origins = mesh?.geometry.getAttribute('aOrigin');
      const out: Vector3[] = [];
      for (let k = 0; k < (origins?.count ?? 0); k++) out.push(new Vector3(origins!.getX(k), origins!.getY(k), origins!.getZ(k)));
      layer.dispose();
      return out;
    };
    // Unturned: the model's x and z, map x running against scene x
    const plain = smokeOrigins([place('h', 'house', 10)]);
    expect(plain.length).toBeGreaterThan(0);
    for (const p of plain) expect([p.x, p.z]).toEqual([-10 + 2, -1]);
    // A half turn takes the chimney to the other side
    const turned = smokeOrigins([{ ...place('h', 'house', 10), rotation: Math.PI }]);
    expect(turned[0].x).toBeCloseTo(-10 - 2, 5);
    expect(turned[0].z).toBeCloseTo(1, 5);
    // Smoke placed by hand over the house stands for its chimney: only that one rises
    const placed = smokeOrigins([place('h', 'house', 10), place('s', 'fx-smoke', 11)]);
    for (const p of placed) expect(p.x).toBeCloseTo(-11, 5);
  });

  it('shows fireflies only in the dark and birds by day, birds only on levels with most particles', () => {
    const layer = new EffectLayer(flat());
    layer.setAmbient({ fireflies: [new Vector3(0, 4, 0)], flocks: [{ center: new Vector3(0, 50, 0), radius: 40, birds: 10, seed: 0.3 }] });
    const flies = () => layer.group.children.find((c) => c.name === 'custom-map-particles-fireflies')!;
    layer.setDarkness(0);
    expect(flies().visible).toBe(false);
    expect(layer.birds.mesh.visible).toBe(true);
    expect(layer.birds.mesh.geometry.instanceCount).toBe(10);
    layer.setDarkness(1);
    expect(flies().visible).toBe(true);
    expect(layer.birds.mesh.visible).toBe(false);
    // Low: a share under 0.7, no birds
    layer.setQuality({ particles: 0.4, pointLights: 2 });
    expect(layer.birds.mesh.geometry.instanceCount).toBe(0);
    layer.dispose();
  });

  it('lets placed flocks and fireflies take the place of the automatic ones, sized by scale and coloured by tint', () => {
    const layer = new EffectLayer(flat());
    layer.setAmbient({ fireflies: [new Vector3(0, 4, 0)], flocks: [{ center: new Vector3(0, 50, 0), radius: 40, birds: 10, seed: 0.3 }] });
    layer.set([{ ...place('b', 'fx-birds', 20), scale: 1.5 }, { ...place('f', 'fx-fireflies', -20), tint: '#ff8040' }], catalog);
    // One placed flock of 15 (10 at scale 1.5), none of the automatic one
    expect(layer.birds.mesh.geometry.instanceCount).toBe(15);
    const flock = layer.birds.mesh.geometry.getAttribute('aFlock');
    expect([flock.getX(0), flock.getY(0), flock.getW(0)]).toEqual([-20, 4 + 75, 67.5]);
    // The placed fireflies in their tint; no automatic field beside them
    const fields = layer.group.children.filter((c) => c.name === 'custom-map-particles-fireflies') as Mesh[];
    expect(fields).toHaveLength(1);
    const color = fields[0].geometry.getAttribute('aColor');
    expect(color.getX(0)).toBeCloseTo(1, 2);
    expect(color.getZ(0)).toBeLessThan(0.3);
    layer.dispose();
  });

  it('holds whole particles for scaled area effects, so smoke over chimneys builds its field', () => {
    // fx-smoke at 0.6 (MapKit.chimney): 24 particles x 0.36 is 8.64, which a field cannot hold
    const layer = new EffectLayer(flat());
    const smoke = [0, 1, 2, 3, 4].map((k) => ({ ...place(`s${k}`, 'fx-smoke', k * 15), scale: 0.6 }));
    expect(() => layer.set(smoke, catalog)).not.toThrow();
    const mesh = layer.group.children.find((c): c is Mesh => c instanceof Mesh && c.name === 'custom-map-particles-smoke');
    expect(mesh?.geometry.getAttribute('aOrigin').count).toBe(5 * Math.round(particleCount('smoke', 4) * 0.36));
    layer.dispose();
  });

  it('builds one particle field per kind, waterfalls with spray, and glows', () => {
    const layer = new EffectLayer(flat());
    const objects = [place('a', 'torch', 0), place('b', 'torch', 10), place('c', 'falls', -20), place('d', 'rock', 5)];
    layer.set(objects, catalog);
    const names = layer.group.children.filter((c) => c instanceof Mesh).map((c) => c.name).sort();
    expect(names).toEqual([
      'custom-map-birds',
      'custom-map-glows',
      'custom-map-particles-embers',
      'custom-map-particles-fire',
      'custom-map-particles-spray',
      'custom-map-waterfalls',
    ]);
    layer.dispose();
  });

  it('lands foam and spray only at the foot of a cascade, on the pool, not at its steps in mid air', () => {
    // A pool 1 m deep everywhere: a step's foot would find it too and float its disc at that level
    const sprayAndDisc = (objects: MapObject[], level: (x: number, y: number) => number = () => 5): { spray: number; disc: number[] } => {
      const layer = new EffectLayer(flat(), level);
      layer.set(objects, catalog);
      const mesh = (name: string) => layer.group.children.find((c): c is Mesh => c instanceof Mesh && c.name === name)!;
      const spray = (mesh('custom-map-particles-spray').geometry as unknown as { instanceCount: number }).instanceCount;
      const geometry = mesh('custom-map-waterfalls').geometry;
      const fall = geometry.getAttribute('aFall');
      const y = geometry.getAttribute('position');
      const disc: number[] = [];
      for (let k = 0; k < fall.count; k++) if (fall.getX(k) === -1) disc.push(y.getY(k));
      layer.dispose();
      return { spray, disc };
    };
    const single = sprayAndDisc([place('low', 'falls', 0)]);
    // The upper fall stands 12 m up; its foot (2.4 m out in front) is the lower fall's lip
    const cascade = sprayAndDisc([{ ...place('up', 'falls', 0), z: 12 }, { ...place('low', 'falls', 0), y: 2.4 }]);
    expect(cascade.spray).toBe(single.spray);
    // One disc of 17 vertices, on the pool's surface
    expect(cascade.disc).toHaveLength(17);
    for (const y of cascade.disc) expect(y).toBeCloseTo(5.04, 3);
    // A river falling away below the foot: spray, but no flat disc standing out of its slope
    expect(sprayAndDisc([place('low', 'falls', 0)], (_x, y) => 5 - y * 0.5).disc).toHaveLength(0);
  });

  it('pours a fall over a steep slope down its face and lands the spray at its foot, not on the river above', () => {
    // Ground falling 2.5 m per metre north (+y, the fall's front) from 40 m down to 20 m; a river's ribbon 1 m over it
    const slope = (y: number) => Math.min(45, Math.max(20, 40 - 2.5 * y));
    const heights = new Float32Array(41 * 41);
    for (let j = 0; j < 41; j++) heights.fill(slope(j - 20), j * 41, j * 41 + 41);
    const field = new HeightField({ columns: 41, rows: 41, cellSize: 1, heights }, 40, 40);
    const ribbon = (_x: number, y: number) => slope(y) + 1;
    const layer = new EffectLayer(field, ribbon);
    // Lip at the top of the slope, foot 12 m down: the plain sheet (2.4 m out) ended 6 m inside the rock
    layer.set([{ ...place('fall', 'falls', 0), z: -12 }], catalog);
    const mesh = (name: string) => layer.group.children.find((c): c is Mesh => c instanceof Mesh && c.name === name)!;
    // Every row over the ribbon (scene z is map y), so neither rock nor river hides it
    const sheet = mesh('custom-map-waterfalls').geometry.getAttribute('position');
    for (let k = 0; k < sheet.count; k++) expect(sheet.getY(k)).toBeGreaterThan(ribbon(0, sheet.getZ(k)) - 0.25);
    const origins = mesh('custom-map-particles-spray').geometry.getAttribute('aOrigin');
    expect(origins.count).toBeGreaterThan(0);
    for (let k = 0; k < origins.count; k++) {
      // On the ribbon where the water lands, about the foot's height, not 7 m up the slope
      expect(origins.getY(k)).toBeGreaterThan(27);
      expect(origins.getY(k)).toBeLessThan(29);
      expect(origins.getZ(k)).toBeGreaterThan(4.5);
    }
    layer.dispose();
  });

  it('frees what a rebuild replaced only after two frames drew the new effects, so their programs stay linked', () => {
    const layer = new EffectLayer(flat());
    layer.set([place('a', 'torch', 0)], catalog);
    // The bird flocks stay: they are set anew, not replaced
    const old = layer.group.children.filter((c): c is Mesh => c instanceof Mesh && c !== layer.birds.mesh);
    let freed = 0;
    for (const m of old) (m.material as Material).addEventListener('dispose', () => freed++);
    layer.set([place('a', 'torch', 0), place('b', 'torch', 10)], catalog);
    // Out of the scene at once, the new effects in their place
    expect(old.every((m) => m.parent === null)).toBe(true);
    expect(layer.group.children.filter((c) => c instanceof Mesh && c !== layer.birds.mesh)).toHaveLength(old.length);
    const focus = new Vector3();
    layer.update(0.016, focus);
    layer.update(0.016, focus);
    expect(freed).toBe(0);
    layer.update(0.016, focus);
    expect(freed).toBe(old.length);
    layer.dispose();
  });

  it('frees what it replaced at once when it goes itself', () => {
    const layer = new EffectLayer(flat());
    layer.set([place('a', 'torch', 0)], catalog);
    let freed = 0;
    for (const m of layer.group.children.filter((c): c is Mesh => c instanceof Mesh && c !== layer.birds.mesh)) (m.material as Material).addEventListener('dispose', () => freed++);
    layer.set([], catalog);
    layer.dispose();
    expect(freed).toBe(3);
  });

  it('lights point lights only in the dark, nearest first, never more than the pool', () => {
    const layer = new EffectLayer(flat());
    const torches = Array.from({ length: 10 }, (_, k) => place(`t${k}`, 'torch', k * 4 - 20));
    layer.set(torches, catalog);
    const lights = layer.group.children.filter((c): c is PointLight => c instanceof PointLight);
    expect(lights.length).toBe(POINT_LIGHTS);

    layer.setDarkness(0);
    layer.update(0.1, new Vector3());
    expect(lights.every((l) => l.intensity === 0)).toBe(true);
    // By day the pool is hidden: hidden lights do not count in three's light setup of every material
    expect(lights.every((l) => !l.visible)).toBe(true);

    layer.setDarkness(1);
    layer.update(0.1, new Vector3(20, 0, 0)); // scene x = -map x: near the torches at map x -20 .. 0
    const lit = lights.filter((l) => l.intensity > 0);
    expect(lit.length).toBe(POINT_LIGHTS);
    expect(Math.max(...lit.map((l) => l.position.x))).toBeLessThanOrEqual(20);
    expect(Math.min(...lit.map((l) => l.position.x))).toBeGreaterThanOrEqual(0);
    // In use, all six count (a changing number would recompile every lit material)
    expect(lights.every((l) => l.visible)).toBe(true);
    layer.dispose();
  });

  it('keeps the pool hidden at night on a map without lights, and picks the nearest without allocating', () => {
    const layer = new EffectLayer(flat());
    layer.set([place('r', 'rock', 0)], catalog);
    const lights = layer.group.children.filter((c): c is PointLight => c instanceof PointLight);
    layer.setDarkness(1);
    layer.update(0.1, new Vector3());
    expect(lights.every((l) => !l.visible)).toBe(true);

    // Lava lights at known spots: the six nearest light up, nearest first
    layer.setLavaLights(Array.from({ length: 10 }, (_, k) => new Vector3(k * 10, 0, 0)));
    layer.update(0.1, new Vector3(31, 0, 0));
    const xs = lights.filter((l) => l.intensity > 0).map((l) => l.position.x);
    expect(xs).toEqual([30, 40, 20, 50, 10, 60]);
    layer.dispose();
  });

  it('caps a low strong light so it does not burn a white disc into the ground under it', () => {
    const pool = { ...base, id: 'pool', name: 'Pool', light: { color: '#ff5a1e', intensity: 1.8, distance: 16, height: 1 } };
    const layer = new EffectLayer(flat());
    layer.set([place('p', 'pool', 0), place('t', 'torch', 2)], { ...catalog, objects: [...catalog.objects, pool] });
    layer.setDarkness(1);
    layer.update(0.1, new Vector3());
    const lights = layer.group.children.filter((c): c is PointLight => c instanceof PointLight && c.intensity > 0);
    const low = lights.find((l) => Math.abs(l.position.y - 5) < 0.01)!;
    expect(low.intensity).toBeCloseTo(lightCap(1));
    // A torch at 2.5 m stays under its cap and keeps its catalogue strength (18, flickering)
    expect(lights.find((l) => Math.abs(l.position.y - 6.5) < 0.01)!.intensity).toBeGreaterThan(15);
    expect(lightCap(0.1)).toBe(lightCap(0.75));
    layer.dispose();
  });

  it('sizes particle counts from rate and life, capped', () => {
    expect(particleCount('fire', 10)).toBe(9);
    expect(particleCount('fire', 10000)).toBe(400);
    expect(particleCount('fog', undefined)).toBeGreaterThanOrEqual(1);
  });
});
