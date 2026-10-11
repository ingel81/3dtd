import { BufferGeometry, Mesh, MeshBasicMaterial, MeshDepthMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { mapToScene } from '../map-coords';
import { TerrainChunks } from './terrain-chunks';

describe('TerrainChunks', () => {
  it('keeps the finest, unmorphed level under a game camera, where units stand on heightAt', () => {
    // 1 km at 2 m cells, a game camera 200 m above the map's centre
    const n = 513;
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n) }, 1024, 1024);
    const chunks = new TerrainChunks(field, new MeshBasicMaterial());
    chunks.group.updateMatrixWorld();
    const eye = mapToScene(0, -120, 200, new Vector3());
    const ground = mapToScene(0, 0, 0, new Vector3());
    chunks.update(eye, ground);
    expect(chunks.morphEye.value.distanceTo(eye)).toBeCloseTo(0);
    expect(chunks.morphFocus.value.distanceTo(ground)).toBeCloseTo(0);
    for (const mesh of chunks.meshes as Mesh<BufferGeometry>[]) {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      // Chunks the game camera's ground reaches (250 m around its focus)
      if (box.distanceToPoint(ground) > 250) continue;
      const morph = mesh.geometry.getAttribute('aMorph');
      // Full detail (2 m between neighbours), and no vertex there is pulled towards the coarser level:
      // the morph band starts beyond 250 m of detail distance (the nearer of camera and focus)
      expect(Math.abs(mesh.geometry.getAttribute('position').getX(1) - mesh.geometry.getAttribute('position').getX(0))).toBeCloseTo(2);
      expect(morph.getY(0)).toBeGreaterThan(250);
      expect(mesh.customDepthMaterial).toBeInstanceOf(MeshDepthMaterial);
    }
  });
});
