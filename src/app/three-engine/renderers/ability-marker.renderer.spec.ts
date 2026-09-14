import { describe, it, expect } from 'vitest';
import { BufferGeometry, Group, Material, Mesh, Scene, Vector3 } from 'three';
import { AbilityMarkerRenderer } from './ability-marker.renderer';

const CENTER = new Vector3(10, 5, -10);
/** A beam's stretch: 30 m along -z, then 20 m along +x */
const PATH = [new Vector3(10, 5, -10), new Vector3(10, 5, -40), new Vector3(30, 6, -40)];

/** The path bands in the scene: meshes of their own geometry, not in a marker group */
function bands(scene: Scene): Mesh<BufferGeometry>[] {
  return scene.children.filter((c): c is Mesh<BufferGeometry> => c instanceof Mesh && !(c instanceof Group));
}

describe('AbilityMarkerRenderer path bands', () => {
  it('lays a band as wide as the beam along a strike path and takes it with the marker', () => {
    const scene = new Scene();
    const markers = new AbilityMarkerRenderer(scene);
    markers.showStrike(1, CENTER, 5, 1000, PATH);
    const [band] = bands(scene);
    expect(band.visible).toBe(true);
    expect(band.geometry.drawRange.count).toBe((PATH.length - 1) * 6);

    // The first point's two edges, 5 m either side of the path, lifted off the ground
    const position = band.geometry.getAttribute('position');
    const a = new Vector3().fromBufferAttribute(position, 0);
    const b = new Vector3().fromBufferAttribute(position, 1);
    expect(a.distanceTo(b)).toBeCloseTo(10);
    expect(a.y).toBeGreaterThan(5);

    markers.removeStrike(1);
    expect(bands(scene)).toEqual([]);
  });

  it('draws no band for a strike without a path', () => {
    const scene = new Scene();
    const markers = new AbilityMarkerRenderer(scene);
    markers.showStrike(1, CENTER, 25, 1500);
    expect(bands(scene)).toEqual([]);
  });

  it('shows the aim band with a beam, hides it without one and with the ring', () => {
    const scene = new Scene();
    const markers = new AbilityMarkerRenderer(scene);
    markers.showAim(CENTER, 5, true, PATH);
    const [band] = bands(scene);
    expect(band.visible).toBe(true);

    markers.showAim(CENTER, 5, true);
    expect(band.visible).toBe(false);
    markers.showAim(CENTER, 5, true, PATH);
    markers.hideAim();
    expect(band.visible).toBe(false);
    markers.dispose();
  });

  it('takes the aim band out of the scene and frees it on dispose', () => {
    const scene = new Scene();
    const markers = new AbilityMarkerRenderer(scene);
    markers.showAim(CENTER, 5, true, PATH);
    const [band] = bands(scene);
    let geometryFreed = false;
    let materialFreed = false;
    band.geometry.addEventListener('dispose', () => { geometryFreed = true; });
    (band.material as Material).addEventListener('dispose', () => { materialFreed = true; });

    markers.dispose();
    expect(scene.children).toEqual([]);
    expect(geometryFreed).toBe(true);
    expect(materialFreed).toBe(true);
  });
});
