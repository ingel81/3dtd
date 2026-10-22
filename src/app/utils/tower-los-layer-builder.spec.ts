import { describe, it, expect, afterEach } from 'vitest';
import { InstancedBufferAttribute, Matrix4, ShaderMaterial, Vector3, WebGLCubeRenderTarget } from 'three';
import { TowerLosLayer, TowerLosLayerBuilder, losLayerCapacity, visibleLosLayers } from './tower-los-layer-builder';
import { getAirTargetY, RouteCell } from './route-cell';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';

function cell(x: number, z: number, terrainHeight: number): RouteCell {
  return { x, z, terrainHeight } as unknown as RouteCell;
}

const cubemap = new WebGLCubeRenderTarget(4);
let layer: TowerLosLayer | null = null;

function build(canTargetGround: boolean, canTargetAir: boolean, cells = [cell(0, 0, 10), cell(2, 0, 12)], capacity?: number) {
  layer = TowerLosLayerBuilder.build({
    cells,
    towerTip: new Vector3(0, 20, 0),
    groundRange: 30,
    airRange: 40,
    canTargetGround,
    canTargetAir,
    cubemap,
    cubemapFarDistance: 40,
    gridCellSize: 2,
    capacity,
  });
  return layer!;
}

const uniforms = (m: TowerLosLayer['groundMesh']) => (m.material as ShaderMaterial).uniforms;

describe('visibleLosLayers', () => {
  it('applies the filter to mixed towers', () => {
    expect(visibleLosLayers('both', true, true)).toEqual({ ground: true, air: true });
    expect(visibleLosLayers('ground', true, true)).toEqual({ ground: true, air: false });
    expect(visibleLosLayers('air', true, true)).toEqual({ ground: false, air: true });
  });

  it('shows a pure tower its only layer whatever the filter says', () => {
    for (const mode of ['both', 'ground', 'air'] as const) {
      expect(visibleLosLayers(mode, true, false)).toEqual({ ground: true, air: false });
      expect(visibleLosLayers(mode, false, true)).toEqual({ ground: false, air: true });
    }
  });
});

describe('TowerLosLayerBuilder', () => {
  afterEach(() => {
    layer?.dispose();
    layer = null;
  });

  it('returns null without cells', () => {
    expect(build(true, true, [])).toBeNull();
  });

  it('colours each layer with its own covered colour, not an aggregate', () => {
    const l = build(true, true);
    const g = uniforms(l.groundMesh);
    const a = uniforms(l.airMesh);
    const s = LOS_VIZ_CONFIG.states;

    expect(g['uColorCovered'].value.getHex()).toBe(s.ground.color.getHex());
    expect(a['uColorCovered'].value.getHex()).toBe(s.air.color.getHex());
    expect(g['uColorBlocked'].value.getHex()).toBe(s.blocked.color.getHex());
    expect(a['uColorBlocked'].value.getHex()).toBe(s.blocked.color.getHex());
    // Der Playtest-Befund: Ground und Air sahen identisch aus
    expect(g['uColorCovered'].value.getHex()).not.toBe(a['uColorCovered'].value.getHex());
  });

  it('keeps ground, air and blocked pairwise distinct in the palette', () => {
    const s = LOS_VIZ_CONFIG.states;
    const hexes = new Set([s.ground.color.getHex(), s.air.color.getHex(), s.blocked.color.getHex()]);
    expect(hexes.size).toBe(3);
  });

  it('uses each layer range and applies the air alpha scale', () => {
    const l = build(true, true);
    const s = LOS_VIZ_CONFIG.states;
    const scale = LOS_VIZ_CONFIG.airCells.alphaScale;
    expect(uniforms(l.groundMesh)['uRange'].value).toBe(30);
    expect(uniforms(l.airMesh)['uRange'].value).toBe(40);
    expect(uniforms(l.groundMesh)['uAlphaCovered'].value).toBeCloseTo(s.ground.alpha);
    expect(uniforms(l.airMesh)['uAlphaCovered'].value).toBeCloseTo(s.air.alpha * scale);
    expect(uniforms(l.airMesh)['uAlphaBlocked'].value).toBeCloseTo(s.blocked.alpha * scale);
  });

  it('samples ground LOS on the ground plate and air LOS on the air plate', () => {
    const cells = [cell(0, 0, 10), cell(2, 0, 12)];
    const l = build(true, true, cells);
    const groundY = l.groundMesh.geometry.getAttribute('aSampleY') as InstancedBufferAttribute;
    const airY = l.airMesh.geometry.getAttribute('aSampleY') as InstancedBufferAttribute;
    cells.forEach((c, i) => {
      expect(groundY.getX(i)).toBeCloseTo(c.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset);
      expect(airY.getX(i)).toBeCloseTo(getAirTargetY(c));
    });
  });

  it('stands plates and samples where the enemies stand, a crater under the cell included', () => {
    const cells = [cell(0, 0, 10), cell(2, 0, 12)];
    const pit = new Map([[cells[1], 4]]);
    layer = TowerLosLayerBuilder.build({
      cells, towerTip: new Vector3(0, 20, 0), groundRange: 30, airRange: 40,
      canTargetGround: true, canTargetAir: true, cubemap, cubemapFarDistance: 40, gridCellSize: 2,
      standY: (c) => pit.get(c) ?? c.terrainHeight,
    });
    const l = layer!;
    const groundY = l.groundMesh.geometry.getAttribute('aSampleY') as InstancedBufferAttribute;
    const plate = new Matrix4();
    l.groundMesh.getMatrixAt(1, plate);
    expect(new Vector3().setFromMatrixPosition(plate).y).toBeCloseTo(4 + LOS_VIZ_CONFIG.cellYOffset);
    expect(groundY.getX(1)).toBeCloseTo(4 + LOS_VIZ_CONFIG.groundSampleYOffset);
    expect(groundY.getX(0)).toBeCloseTo(10 + LOS_VIZ_CONFIG.groundSampleYOffset);

    // The crater deepens: the same cells set again stand lower
    pit.set(cells[1], 1);
    l.setCells(cells);
    l.groundMesh.getMatrixAt(1, plate);
    expect(new Vector3().setFromMatrixPosition(plate).y).toBeCloseTo(1 + LOS_VIZ_CONFIG.cellYOffset);
  });

  it('shows both layers for a mixed tower and follows the filter', () => {
    const l = build(true, true);
    expect([l.groundMesh.visible, l.airMesh.visible]).toEqual([true, true]);
    l.setFilterMode('ground');
    expect([l.groundMesh.visible, l.airMesh.visible]).toEqual([true, false]);
    l.setFilterMode('air');
    expect([l.groundMesh.visible, l.airMesh.visible]).toEqual([false, true]);
  });

  it('shows only the ground layer for a pure ground tower in every filter mode', () => {
    const l = build(true, false);
    for (const mode of ['both', 'ground', 'air'] as const) {
      l.setFilterMode(mode);
      expect([l.groundMesh.visible, l.airMesh.visible]).toEqual([true, false]);
    }
  });

  it('shows only the air layer for a pure air tower in every filter mode', () => {
    const l = build(false, true);
    for (const mode of ['both', 'ground', 'air'] as const) {
      l.setFilterMode(mode);
      expect([l.groundMesh.visible, l.airMesh.visible]).toEqual([false, true]);
    }
  });

  it('keeps logdepthbuf and colour-space chunks in the cell shader', () => {
    const m = build(true, true).groundMesh.material as ShaderMaterial;
    expect(m.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(m.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(m.fragmentShader).toContain('#include <colorspace_fragment>');
  });

  it('sets other cells into the same meshes and materials, uploading only those', () => {
    const l = build(true, true, [cell(0, 0, 10)], 8);
    const { groundMesh, airMesh } = l;
    const groundMaterial = groundMesh.material;
    const moved = [cell(4, 6, 20), cell(6, 6, 21), cell(8, 6, 22)];

    l.setCells(moved);

    expect(l.groundMesh).toBe(groundMesh);
    expect(groundMesh.material).toBe(groundMaterial);
    expect(l.cells).toBe(moved);
    expect([groundMesh.count, airMesh.count]).toEqual([3, 3]);
    const groundY = groundMesh.geometry.getAttribute('aSampleY') as InstancedBufferAttribute;
    const airY = airMesh.geometry.getAttribute('aSampleY') as InstancedBufferAttribute;
    moved.forEach((c, i) => {
      const at = new Matrix4();
      groundMesh.getMatrixAt(i, at);
      const position = new Vector3().setFromMatrixPosition(at);
      expect([position.x, position.z]).toEqual([c.x, c.z]);
      expect(position.y).toBeCloseTo(c.terrainHeight + LOS_VIZ_CONFIG.cellYOffset);
      expect(groundY.getX(i)).toBeCloseTo(c.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset);
      expect(airY.getX(i)).toBeCloseTo(getAirTargetY(c));
    });
    expect(groundMesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 3 * 16 }]);
    expect(airY.updateRanges).toEqual([{ start: 0, count: 3 }]);
  });

  it('holds as many cells as its capacity and refuses more', () => {
    const l = build(true, true, [cell(0, 0, 10)], 2);
    expect(l.groundMesh.instanceMatrix.count).toBe(2);
    expect(() => l.setCells([cell(0, 0, 1), cell(2, 0, 1), cell(4, 0, 1)])).toThrow(RangeError);
  });

  it('sizes the capacity of a range for the grid slots in the box around its reach', () => {
    // 30 m at 2 m cells: 30 slots across plus the cells the reach cuts at both ends
    expect(losLayerCapacity(30, 2)).toBeGreaterThanOrEqual(32 * 32);
    expect(losLayerCapacity(30, 2)).toBeLessThan(40 * 40);
  });

  it('gives the warm-up both meshes of one layer, shown', () => {
    const meshes = TowerLosLayerBuilder.warmUpObjects(cubemap);
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m.visible && m.count === 1)).toBe(true);
    const [ground, air] = meshes.map((m) => m.material as ShaderMaterial);
    // The same shaders as every layer's: one program for all of them
    const l = build(true, true);
    expect(ground.fragmentShader).toBe((l.groundMesh.material as ShaderMaterial).fragmentShader);
    expect(air.vertexShader).toBe((l.airMesh.material as ShaderMaterial).vertexShader);
    for (const m of meshes) {
      m.geometry.dispose();
      (m.material as ShaderMaterial).dispose();
    }
  });
});
