import { describe, it, expect, afterEach } from 'vitest';
import { InstancedBufferAttribute, ShaderMaterial, Vector3, WebGLCubeRenderTarget } from 'three';
import { TowerLosLayer, TowerLosLayerBuilder, visibleLosLayers } from './tower-los-layer-builder';
import { getAirTargetY, RouteCell } from './route-cell';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';

function cell(x: number, z: number, terrainHeight: number): RouteCell {
  return { x, z, terrainHeight } as unknown as RouteCell;
}

const cubemap = new WebGLCubeRenderTarget(4);
let layer: TowerLosLayer | null = null;

function build(canTargetGround: boolean, canTargetAir: boolean, cells = [cell(0, 0, 10), cell(2, 0, 12)]) {
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
});
