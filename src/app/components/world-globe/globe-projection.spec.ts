import { describe, it, expect } from 'vitest';
import {
  GlobeView,
  MAX_VIEW_LAT,
  PathSink,
  clampZoom,
  decodePolyline,
  dragged,
  graticule,
  lerpCenter,
  nearestPoint,
  placeLabels,
  project,
  toGlobeLines,
  traceLines,
  viewRotation,
  wrapLon,
} from './globe-projection';

const view = (lat = 0, lon = 0): GlobeView => ({ lat, lon, radius: 100, cx: 200, cy: 150 });

/** Records the path calls; the Google polyline encoder as a reference for the lines */
class RecordingSink implements PathSink {
  readonly calls: { op: 'M' | 'L'; x: number; y: number }[] = [];
  moveTo(x: number, y: number): void { this.calls.push({ op: 'M', x, y }); }
  lineTo(x: number, y: number): void { this.calls.push({ op: 'L', x, y }); }
}

function encodeValue(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (n >= 0x20) {
    s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return s + String.fromCharCode(n + 63);
}

/** [lat, lon] degree pairs as a polyline with 10 steps per degree */
function encode(points: [number, number][]): string {
  let lat = 0;
  let lon = 0;
  return points.map(([a, b]) => {
    const qa = Math.round(a * 10);
    const qb = Math.round(b * 10);
    const s = encodeValue(qa - lat) + encodeValue(qb - lon);
    lat = qa;
    lon = qb;
    return s;
  }).join('');
}

describe('globe projection', () => {
  describe('project', () => {
    it('puts the view centre in the middle of the disc, facing the viewer', () => {
      const p = project(48, 9, view(48, 9));
      expect(p.x).toBeCloseTo(200);
      expect(p.y).toBeCloseTo(150);
      expect(p.depth).toBeCloseTo(1);
    });

    it('puts 90 degrees east on the right rim and the north pole on top', () => {
      const east = project(0, 90, view());
      expect(east.x).toBeCloseTo(300);
      expect(east.depth).toBeCloseTo(0);
      const pole = project(90, 0, view());
      expect(pole.y).toBeCloseTo(50);
    });

    it('turns the antipode away from the viewer', () => {
      expect(project(-48, -171, view(48, 9)).depth).toBeCloseTo(-1);
    });

    it('matches the rotation it is given', () => {
      const v = view(30, -60);
      expect(project(10, -50, v, viewRotation(30, -60))).toEqual(project(10, -50, v));
    });
  });

  describe('traceLines', () => {
    const lines = (...ls: [number, number][][]) => toGlobeLines(ls.map(encode), 10);

    it('draws a line on the near side as it is', () => {
      const sink = new RecordingSink();
      traceLines(sink, lines([[0, -10], [0, 0], [0, 10]]), view(), viewRotation(0, 0));
      expect(sink.calls.map((c) => c.op)).toEqual(['M', 'L', 'L']);
      expect(sink.calls[1].x).toBeCloseTo(200);
    });

    it('cuts a line leaving over the horizon on the rim', () => {
      const sink = new RecordingSink();
      traceLines(sink, lines([[0, 80], [0, 100]]), view(), viewRotation(0, 0));
      expect(sink.calls.map((c) => c.op)).toEqual(['M', 'L']);
      const end = sink.calls[1];
      expect(Math.hypot(end.x - 200, end.y - 150)).toBeCloseTo(100);
    });

    it('starts a line coming over the horizon on the rim', () => {
      const sink = new RecordingSink();
      traceLines(sink, lines([[10, -100], [10, -80]]), view(), viewRotation(0, 0));
      expect(sink.calls.map((c) => c.op)).toEqual(['M', 'L']);
      const start = sink.calls[0];
      expect(Math.hypot(start.x - 200, start.y - 150)).toBeCloseTo(100);
      expect(start.x).toBeLessThan(200);
    });

    it('draws nothing of a line on the far side', () => {
      const sink = new RecordingSink();
      traceLines(sink, lines([[0, 170], [0, -170]]), view(), viewRotation(0, 0));
      expect(sink.calls).toEqual([]);
    });

    it('keeps the lines apart: each one starts with a move', () => {
      const sink = new RecordingSink();
      traceLines(sink, lines([[0, 0], [0, 5]], [[10, 0], [10, 5]]), view(), viewRotation(0, 0));
      expect(sink.calls.map((c) => c.op)).toEqual(['M', 'L', 'M', 'L']);
    });

    it('draws the graticule on the near half only', () => {
      const sink = new RecordingSink();
      traceLines(sink, graticule(), view(20, 40), viewRotation(20, 40));
      expect(sink.calls.length).toBeGreaterThan(0);
      for (const c of sink.calls) expect(Math.hypot(c.x - 200, c.y - 150)).toBeLessThanOrEqual(100.001);
    });
  });

  describe('decodePolyline', () => {
    it("reads Google's reference polyline", () => {
      const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 1e5);
      expect(pts).toEqual([38.5, -120.2, 40.7, -120.95, 43.252, -126.453]);
    });

    it('reads 0.1 degree steps, negative deltas included', () => {
      const pts = decodePolyline(encode([[49.1, 9.2], [-33.9, 151.2], [0, -180]]), 10);
      expect(pts.map((v) => Math.round(v * 10) / 10)).toEqual([49.1, 9.2, -33.9, 151.2, 0, -180]);
    });
  });

  describe('dragging and zoom', () => {
    it('turns the globe so the surface follows the pointer', () => {
      const v = view();
      // 100 px radius: one radian per 100 px
      const c = dragged(v, 100 * (Math.PI / 180) * 10, 0);
      expect(c.lon).toBeCloseTo(-10);
      expect(dragged(v, 0, 100 * (Math.PI / 180) * 10).lat).toBeCloseTo(10);
    });

    it(`stops at ${MAX_VIEW_LAT} degrees and wraps the longitude`, () => {
      expect(dragged(view(70, 0), 0, 1000).lat).toBe(MAX_VIEW_LAT);
      expect(dragged(view(0, 175), -100 * (Math.PI / 180) * 10, 0).lon).toBeCloseTo(-175);
      expect(wrapLon(190)).toBe(-170);
      expect(wrapLon(-190)).toBe(170);
    });

    it('clamps the zoom', () => {
      expect(clampZoom(0.2)).toBe(1);
      expect(clampZoom(3)).toBe(3);
      expect(clampZoom(40)).toBe(8);
    });

    it('moves the centre across the antimeridian the short way', () => {
      expect(lerpCenter({ lat: 0, lon: 170 }, { lat: 10, lon: -170 }, 0.5)).toEqual({ lat: 5, lon: -180 });
      expect(lerpCenter({ lat: 0, lon: 170 }, { lat: 10, lon: -170 }, 1).lon).toBeCloseTo(-170);
    });
  });

  it('nearestPoint picks the closest point facing the viewer within reach', () => {
    const pts = [
      { x: 10, y: 10, depth: 0.5 },
      { x: 12, y: 10, depth: -0.2 },
      { x: 15, y: 10, depth: 0.9 },
    ];
    expect(nearestPoint(pts, 12, 10, 8)).toBe(0);
    expect(nearestPoint(pts, 16, 10, 8)).toBe(2);
    expect(nearestPoint(pts, 40, 10, 8)).toBe(-1);
  });

  it('placeLabels skips a label that overlaps one placed before it', () => {
    expect(placeLabels([
      { x: 0, y: 0, w: 20, h: 10 },
      { x: 10, y: 5, w: 20, h: 10 },
      { x: 20, y: 0, w: 20, h: 10 },
    ])).toEqual([true, false, true]);
  });
});
