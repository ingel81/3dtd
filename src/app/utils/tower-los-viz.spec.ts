import { describe, expect, it, vi } from 'vitest';
import { Group, ShaderMaterial, Vector3, WebGLCubeRenderTarget } from 'three';
import { TowerLosViz } from './tower-los-viz';
import type { RouteCell } from './route-cell';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';

/**
 * Selection and build preview share one TowerShadowMapper with the LOS
 * recompute of every other tower. The display has to colour its cells
 * against the cube rendered from its own tower, whoever rendered last.
 */
describe('TowerLosViz', () => {
  /** Stand-in for TowerShadowMapper with its move gate. */
  function makeMapper() {
    const reference = new Vector3();
    let far = 1;
    let rendered = false;
    return {
      update: vi.fn((tip: Vector3, range: number) => {
        if (rendered && reference.distanceTo(tip) <= LOS_VIZ_CONFIG.cubeUpdateMoveThreshold) return false;
        reference.copy(tip);
        far = range;
        rendered = true;
        return true;
      }),
      getRenderTarget: () => cube,
      getReferencePos: () => reference,
      getFarDistance: () => far,
    };
  }

  const cube = new WebGLCubeRenderTarget(4);
  const cells = [
    { x: 0, z: 0, terrainHeight: 0, sample: { stepTop: null } },
    { x: 2, z: 0, terrainHeight: 0, sample: { stepTop: null } },
  ] as unknown as RouteCell[];
  const ownTip = new Vector3(0, 12, 0);

  function build(mapper: ReturnType<typeof makeMapper>): TowerLosViz {
    return new TowerLosViz({
      cells,
      towerTip: ownTip,
      groundRange: 30,
      airRange: 30,
      canTargetGround: true,
      canTargetAir: false,
      gridCellSize: 2,
      shadowMapper: mapper as never,
      blockerGroup: new Group(),
    });
  }

  const tipUniform = (viz: TowerLosViz) =>
    (viz.getLayer()!.groundMesh.material as ShaderMaterial).uniforms['uTowerTip'].value as Vector3;

  it('renders the cube from its own tower again after another tower took it', () => {
    const mapper = makeMapper();
    const viz = build(mapper);
    viz.tick(0);
    expect(mapper.update).toHaveBeenCalledTimes(1);

    // A background recompute of a tower 40 m away renders the shared cube.
    mapper.update(new Vector3(40, 15, 0), 25);
    viz.tick(0.1);

    expect(mapper.update).toHaveBeenCalledTimes(3);
    expect(mapper.getReferencePos()).toEqual(ownTip);
    expect(mapper.getFarDistance()).toBe(30);
    expect(tipUniform(viz)).toEqual(ownTip);
    viz.dispose();
  });

  it('does not render again while the cube is its own', () => {
    const mapper = makeMapper();
    const viz = build(mapper);
    for (let i = 0; i < 10; i++) viz.tick(i * 0.016);
    expect(mapper.update).toHaveBeenCalledTimes(1);
    viz.dispose();
  });

  it('leaves the cube alone once disposed', () => {
    const mapper = makeMapper();
    const viz = build(mapper);
    viz.dispose();
    mapper.update(new Vector3(40, 15, 0), 25);
    viz.tick(0);
    expect(mapper.getReferencePos()).toEqual(new Vector3(40, 15, 0));
  });
});
