import { describe, expect, it } from 'vitest';
import { Matrix4, Scene, ShaderMaterial } from 'three';
import { RouteGridSelectionViz } from './route-grid-selection-viz';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';

/**
 * The cell report frames the cells it has selected: one plate per cell, as
 * large as the cell, drawn over the Route Grid Overlay.
 */
describe('RouteGridSelectionViz', () => {
  /** Where instance `i` stands, to the millimetre (the instance matrices are float32). */
  const positionOf = (viz: RouteGridSelectionViz, i: number) => {
    const m = new Matrix4();
    viz.getMesh().getMatrixAt(i, m);
    return [m.elements[12], m.elements[13], m.elements[14]].map((v) => Math.round(v * 1000) / 1000);
  };

  it('puts a plate on each spot, just above the overlay plates', () => {
    const viz = new RouteGridSelectionViz(2);
    viz.setSpots([{ x: 1, y: 10, z: 3 }, { x: 5, y: 12, z: 7 }]);

    expect(viz.getMesh().count).toBe(2);
    expect(positionOf(viz, 0)).toEqual([1, 10.05, 3]);
    expect(positionOf(viz, 1)).toEqual([5, 12.05, 7]);

    viz.setSpots([]);
    expect(viz.getMesh().count).toBe(0);
  });

  it('covers the whole cell, flat, drawn after the overlay without depth test', () => {
    const viz = new RouteGridSelectionViz(2);
    const mesh = viz.getMesh();
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;

    const extent = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    expect(extent.map((v) => Math.round(v * 1000) / 1000)).toEqual([2, 0, 2]);
    expect(mesh.renderOrder).toBe(5);
    const material = mesh.material as ShaderMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.uniforms['uColor'].value.getHex()).toBe(LOS_VIZ_CONFIG.gridOverlay.selection.color.getHex());
  });

  it('carries the logarithmic depth chunks the tiles need', () => {
    const material = new RouteGridSelectionViz(2).getMesh().material as ShaderMaterial;
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
  });

  it('grows for a selection larger than it holds, in the same scene object', () => {
    const viz = new RouteGridSelectionViz(2);
    const scene = new Scene();
    scene.add(viz.object);
    const spots = Array.from({ length: 70 }, (_, i) => ({ x: i * 2 + 1, y: 0, z: 1 }));

    viz.setSpots(spots);

    expect(viz.getMesh().count).toBe(70);
    expect(positionOf(viz, 69)[0]).toBe(139);
    expect(viz.object.children).toEqual([viz.getMesh()]);
    expect(viz.object.parent).toBe(scene);
  });

  it('leaves the scene on dispose', () => {
    const viz = new RouteGridSelectionViz(2);
    const scene = new Scene();
    scene.add(viz.object);

    viz.dispose();

    expect(scene.children).toEqual([]);
  });
});
