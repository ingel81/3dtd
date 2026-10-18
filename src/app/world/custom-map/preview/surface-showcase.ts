import { createMapDocument } from '../map-create';
import type { CustomMapDocument, MapPoint, MapSurface, MapSurfaceMarkingKind } from '../map-document';
import { fitMarking, markingPoint } from '../map-surfaces';

/** One surface of the showcase: its material, the marking, the rectangle (middle, long side, sides) */
interface Sample {
  material: string;
  kind?: MapSurfaceMarkingKind;
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
}

/**
 * A flat dev map with a surface of each marking and a few without
 * (`/map-preview?surfaces`, render/surfaces/): football on grass, the courts
 * on hard ground and clay, a multi-sport court, a running track, a car park,
 * a platform, a playground of wood chips with an odd outline, a square of
 * setts round a bed. For the picture of each marking the plan asks for, and
 * for the shader's lines against their real measures.
 */
export function createSurfaceShowcase(): CustomMapDocument {
  const doc = createMapDocument({ id: 'surface-showcase', name: 'Surfaces', width: 400, depth: 400, cellSize: 2, starter: false, baseMaterial: 'grass' });
  const samples: Sample[] = [
    { material: 'grass-lush', kind: 'soccer', x: -80, y: 90, angle: 0, length: 110, width: 72 },
    { material: 'asphalt', kind: 'handball', x: 60, y: 120, angle: 0, length: 44, width: 24 },
    { material: 'concrete', kind: 'basketball', x: 60, y: 80, angle: 0.3, length: 32, width: 19 },
    { material: 'red-earth', kind: 'tennis', x: 120, y: 120, angle: Math.PI / 2, length: 36, width: 18 },
    { material: 'sand', kind: 'volleyball', x: 125, y: 70, angle: 0, length: 26, width: 16 },
    { material: 'asphalt', kind: 'multi', x: 60, y: 30, angle: 0, length: 40, width: 22 },
    { material: 'red-paving', kind: 'track', x: -80, y: -40, angle: 0, length: 170, width: 88 },
    { material: 'asphalt', kind: 'parking', x: 80, y: -50, angle: -0.2, length: 60, width: 34 },
    { material: 'concrete', kind: 'platform', x: 60, y: -120, angle: 0, length: 120, width: 7 },
  ];
  const surfaces: MapSurface[] = samples.map((s, k) => {
    const m = { kind: s.kind ?? 'soccer', x: s.x, y: s.y, angle: s.angle, length: s.length, width: s.width };
    const outer = [markingPoint(m, -s.length / 2, -s.width / 2), markingPoint(m, s.length / 2, -s.width / 2), markingPoint(m, s.length / 2, s.width / 2), markingPoint(m, -s.length / 2, s.width / 2)];
    const surface: MapSurface = { id: `sample-${k + 1}`, material: s.material, outer: outer.map(round) };
    if (s.kind) surface.marking = fitMarking(s.kind, surface.outer) ?? undefined;
    return surface;
  });
  // A playground of wood chips with an odd outline, a square of setts round a bed
  const blob = (cx: number, cy: number, r: number, n: number, wobble: number): MapPoint[] =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (1 + wobble * Math.sin(a * 3 + 1) + wobble * 0.5 * Math.cos(a * 5));
      return round({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    });
  surfaces.push({ id: 'playground', material: 'wood-chips', outer: blob(-150, -130, 18, 24, 0.18) });
  surfaces.push({ id: 'square', material: 'cobblestone', outer: blob(-60, -140, 30, 8, 0.05), holes: [blob(-60, -140, 6, 16, 0)] });
  doc.surfaces = surfaces;
  return doc;
}

const round = (p: MapPoint): MapPoint => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
