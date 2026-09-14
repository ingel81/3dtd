import {
  BufferGeometry,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

/**
 * The debug markers ThreeTowerRenderer puts around a tower besides its
 * model: the shoot height and the LOS origin. The range ring is in
 * range-ring.ts.
 */

/** Tip marker: magenta sphere at the tower's shoot position (projectile origin). */
export function createTipMarker(x: number, tipY: number, z: number, visible: boolean): Mesh {
  const tipMarkerGeometry = new SphereGeometry(2, 16, 16);
  const tipMarkerMaterial = new MeshBasicMaterial({
    color: 0xff00ff, // Magenta
    transparent: true,
    opacity: 0.5, // Semi-transparent so tower is visible
    depthTest: false, // Always visible, even inside tower mesh
  });
  const tipMarker = new Mesh(tipMarkerGeometry, tipMarkerMaterial);
  tipMarker.position.set(x, tipY, z);
  tipMarker.renderOrder = 999; // Render on top
  tipMarker.visible = visible;
  return tipMarker;
}

/** LOS ring: cyan circle of `radius` at the shoot height, where LOS raycasts originate. */
export function createLosRing(x: number, tipY: number, z: number, radius: number, visible: boolean): LineLoop {
  const losRingPoints: Vector3[] = [];
  const losRingSegments = 32;
  for (let i = 0; i <= losRingSegments; i++) {
    const angle = (i / losRingSegments) * Math.PI * 2;
    losRingPoints.push(new Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius
    ));
  }
  const losRingGeometry = new BufferGeometry().setFromPoints(losRingPoints);
  const losRingMaterial = new LineBasicMaterial({
    color: 0x00ffff, // Cyan
    depthTest: false,
  });
  const losRing = new LineLoop(losRingGeometry, losRingMaterial);
  losRing.position.set(x, tipY, z);
  losRing.renderOrder = 999;
  losRing.visible = visible;
  return losRing;
}
