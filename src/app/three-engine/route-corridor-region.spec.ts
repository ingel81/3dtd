import { Box3, Matrix4, Sphere, Vector3 } from 'three';
import { RouteCorridorRegion } from './route-corridor-region';

/** A bounding volume with only a sphere, in the tiles group's frame. */
function sphereVolume(x: number, y: number, z: number, radius: number) {
  return { sphere: new Sphere(new Vector3(x, y, z), radius), obb: null };
}

describe('RouteCorridorRegion', () => {
  // One straight route along local +Z at x = 10, 0 to 200 m.
  const route = [new Vector3(10, 0, 0), new Vector3(10, 0, 200)];
  const identity = new Matrix4();

  it('accepts a tile whose footprint reaches the corridor', () => {
    const region = new RouteCorridorRegion([route], identity, 20, 5);
    // 35 m off the route: radius 20 + half width 20 = 40 m reach.
    expect(region.intersectsTile(sphereVolume(45, 0, 100, 20), {})).toBe(true);
  });

  it('rejects a tile beside the corridor', () => {
    const region = new RouteCorridorRegion([route], identity, 20, 5);
    expect(region.intersectsTile(sphereVolume(60, 0, 100, 5), {})).toBe(false);
  });

  it('rejects a tile past the end of the route', () => {
    const region = new RouteCorridorRegion([route], identity, 20, 5);
    expect(region.intersectsTile(sphereVolume(10, 0, 300, 5), {})).toBe(false);
  });

  it('ignores height, the corridor reaches from valley to rooftop', () => {
    const region = new RouteCorridorRegion([route], identity, 20, 5);
    expect(region.intersectsTile(sphereVolume(10, 900, 100, 1), {})).toBe(true);
    expect(region.intersectsTile(sphereVolume(10, -900, 100, 1), {})).toBe(true);
  });

  it('maps the tiles frame to local space before testing', () => {
    // The tiles group is Z-up and rotated -90 deg about X into our Y-up
    // scene: tileset (x, y, z) lands at local (x, z, -y).
    const toLocal = new Matrix4().makeRotationX(-Math.PI / 2);
    const region = new RouteCorridorRegion([route], toLocal, 20, 5);
    expect(region.intersectsTile(sphereVolume(10, -100, 50, 1), {})).toBe(true);  // local z = 100
    expect(region.intersectsTile(sphereVolume(10, 100, 50, 1), {})).toBe(false);  // local z = -100
  });

  it('falls back to the bounding box when the volume has no sphere', () => {
    const region = new RouteCorridorRegion([route], identity, 20, 5);
    const volume = {
      sphere: null,
      obb: {
        box: new Box3(new Vector3(-5, -5, -5), new Vector3(5, 5, 5)),
        transform: new Matrix4().makeTranslation(10, 0, 100),
      },
    };
    expect(region.intersectsTile(volume, {})).toBe(true);
  });

  it('rejects a volume it cannot place', () => {
    const region = new RouteCorridorRegion([route], identity, 20, 5);
    expect(region.intersectsTile({ sphere: null, obb: null }, {})).toBe(false);
  });

  it('refines while the tile is coarser than its error target', () => {
    const region = new RouteCorridorRegion([route], identity, 20, 5);
    const tiles = { errorTarget: 20 };
    // The renderer refines when the error exceeds its own errorTarget.
    expect(region.calculateError({ geometricError: 8 }, tiles)).toBeGreaterThan(tiles.errorTarget);
    expect(region.calculateError({ geometricError: 4 }, tiles)).toBeLessThan(tiles.errorTarget);
  });
});
