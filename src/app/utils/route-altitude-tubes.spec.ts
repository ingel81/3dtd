import { describe, it, expect } from 'vitest';
import { InstancedMesh, Vector3, type ShaderMaterial } from 'three';
import { buildRouteAltitudeTubes } from './route-altitude-tubes';
import type { GlobalRouteGrid } from './global-route-grid';
import { DISPLAY_OUTPUT_GLSL } from '../three-engine/renderers/display-output';

/** One short route at height 0, no sampled cells. */
function grid(): GlobalRouteGrid {
  return {
    getCoordinateSync: () => ({
      geoToLocalSimple: (lat: number, lon: number, height: number) => new Vector3(lon * 1e5, height, -lat * 1e5),
    }),
    getCachedRoutes: () => [[{ lat: 0, lon: 0, height: 0 }, { lat: 0, lon: 0.001, height: 0 }]],
    getCellAt: () => undefined,
    estimateTerrainY: () => 0,
  } as unknown as GlobalRouteGrid;
}

describe('buildRouteAltitudeTubes', () => {
  it('writes the tube colour for the target', () => {
    const mesh = buildRouteAltitudeTubes(grid()).children.find((c): c is InstancedMesh => c instanceof InstancedMesh)!;
    const shader = (mesh.material as ShaderMaterial).fragmentShader;
    expect(shader).toContain(DISPLAY_OUTPUT_GLSL);
    expect(shader).toContain('gl_FragColor = displayOutput(vec4(uColor, opacity));');
  });
});
