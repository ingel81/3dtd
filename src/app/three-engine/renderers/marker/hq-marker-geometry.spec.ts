import { describe, it, expect } from 'vitest';
import { Box3 } from 'three';
import { createCrystalGeometry, createGroundGeometry, HQ_CRYSTAL_HALF_HEIGHT, HQ_GROUND_LIFT } from './hq-marker-geometry';
import { MARKER_CORE_RADIUS, MARKER_FLOAT_HEIGHT } from '../../../configs/marker-geometry.config';

describe('HQ-Marker-Geometrie', () => {
  it('dreht jede Fläche von Kristall und Kern nach außen (FrontSide)', () => {
    const geom = createCrystalGeometry();
    const pos = geom.getAttribute('position');
    const nrm = geom.getAttribute('normal');
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      expect(cx * nrm.getX(i) + cy * nrm.getY(i) + cz * nrm.getZ(i)).toBeGreaterThan(0);
    }
  });

  it('zeichnet den Kern vor der Hülle und hält die Maße des alten Diamanten', () => {
    const geom = createCrystalGeometry();
    const layer = geom.getAttribute('aLayer');
    const firstShell = Array.from({ length: layer.count }, (_, i) => layer.getX(i)).indexOf(0);
    for (let i = 0; i < layer.count; i++) expect(layer.getX(i)).toBe(i < firstShell ? 1 : 0);

    const box = new Box3().setFromBufferAttribute(geom.getAttribute('position') as never);
    expect(box.max.y).toBeCloseTo(HQ_CRYSTAL_HALF_HEIGHT);
    expect(box.min.y).toBeCloseTo(-HQ_CRYSTAL_HALF_HEIGHT);
    expect(Math.max(box.max.x, box.max.z)).toBeLessThanOrEqual(MARKER_CORE_RADIUS + 1e-6);
  });

  it('lässt die Lichtsäule vom Bodenemblem bis zur unteren Spitze des Kristalls reichen', () => {
    const geom = createGroundGeometry();
    const box = new Box3().setFromBufferAttribute(geom.getAttribute('position') as never);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(MARKER_FLOAT_HEIGHT - HQ_GROUND_LIFT - HQ_CRYSTAL_HALF_HEIGHT);
  });
});
