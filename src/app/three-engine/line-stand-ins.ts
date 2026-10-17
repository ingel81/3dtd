import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { clipLineMaterial, type PortalClipUniforms } from './renderers/portal-clip';

/**
 * Lines as the game draws them, for the loading warm-up's stand-ins: every
 * kind of LineMaterial program (dashed or not, width in pixels or in world
 * units, clipped at the portals or not). The route animation of a game's
 * start and the spawn rings come after the load; their lines linked their
 * programs then, and again for another output on a later quality switch.
 */
export function lineStandIns(portalClip: PortalClipUniforms): Line2[] {
  const geometry = new LineGeometry();
  geometry.setPositions([0, 0, 0, 1, 0, 0]);
  const lines: Line2[] = [];
  for (const dashed of [false, true]) {
    for (const worldUnits of [false, true]) {
      for (const clipped of [false, true]) {
        const material = new LineMaterial({ dashed, worldUnits, transparent: true, depthWrite: false });
        if (clipped) clipLineMaterial(material, portalClip);
        const line = new Line2(geometry, material);
        line.computeLineDistances();
        line.name = 'warm-up line';
        lines.push(line);
      }
    }
  }
  return lines;
}
