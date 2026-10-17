/**
 * The overlay's layers that read the ground for the person editing: the
 * brush ring, height lines, the metre grid, where towers may stand and the
 * symmetry's axes. The view and the session set them from the settings.
 */
import { BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, Group, Line, LineBasicMaterial, LineSegments, type LineLoop, Mesh, MeshBasicMaterial, NearestFilter } from 'three';
import { TD_THEME } from '../../../styles/td-theme';
import type { MapPoint } from '../../../world/custom-map/map-document';
import { BuildCell, type BuildAreas } from '../../../map-ops/validation/build-areas';
import type { Contours } from '../../ops/contours';
import type { SymmetryMode } from '../../ops/symmetry';
import { clearGroup, drape, ring, type GroundHeight, type OverlayLayer } from './draping';

/** The brush ring draped on the ground, with an inner ring where the falloff starts */
export class BrushLayer implements OverlayLayer {
  readonly outer: LineLoop;
  readonly inner: LineLoop;

  constructor(private readonly height: GroundHeight) {
    this.outer = ring(TD_THEME.brassLight, 0.95);
    this.inner = ring(TD_THEME.brass, 0.55);
    this.clear();
  }

  /** The ring at a map point; radius 0 hides it */
  set(center: MapPoint | null, radius: number, falloff: number): void {
    if (!center || radius <= 0) {
      this.clear();
      return;
    }
    drape(this.outer, center, radius, this.height);
    const inner = radius * (1 - falloff);
    this.inner.visible = inner > 0.5 && falloff > 0.02;
    if (this.inner.visible) drape(this.inner, center, inner, this.height);
  }

  clear(): void {
    this.outer.visible = false;
    this.inner.visible = false;
  }

  dispose(): void {
    this.outer.geometry.dispose();
    this.inner.geometry.dispose();
  }
}

/** Height lines (segments from contourLines) lifted a little off the ground */
export class ContourLayer implements OverlayLayer {
  readonly group = new Group();
  private readonly minor = new LineBasicMaterial({ color: TD_THEME.knobLight, transparent: true, opacity: 0.35 });
  private readonly major = new LineBasicMaterial({ color: TD_THEME.brassLight, transparent: true, opacity: 0.7 });

  /** null hides them */
  set(lines: Contours | null): void {
    this.clear();
    if (!lines) return;
    for (const [data, material] of [
      [lines.minor, this.minor],
      [lines.major, this.major],
    ] as const) {
      if (!data.length) continue;
      const pos = new Float32Array(data.length);
      for (let k = 0; k < data.length; k += 3) {
        pos[k] = -data[k];
        pos[k + 1] = data[k + 2] + 0.3;
        pos[k + 2] = data[k + 1];
      }
      const seg = new LineSegments(new BufferGeometry(), material);
      seg.geometry.setAttribute('position', new BufferAttribute(pos, 3));
      seg.frustumCulled = false;
      seg.renderOrder = 7;
      this.group.add(seg);
    }
  }

  clear(): void {
    clearGroup(this.group);
  }

  dispose(): void {
    this.clear();
  }
}

/** A metre grid draped on the ground */
export class GridLayer implements OverlayLayer {
  readonly group = new Group();
  private readonly material = new LineBasicMaterial({ color: TD_THEME.frameLight, transparent: true, opacity: 0.45 });

  constructor(private readonly height: GroundHeight) {}

  /** Lines every `spacing` metres, sampled every `sampleStep`; 0 hides it */
  set(spacing: number, width: number, depth: number, sampleStep: number): void {
    this.clear();
    if (spacing <= 0) return;
    const pos: number[] = [];
    const add = (ax: number, ay: number, bx: number, by: number) => {
      pos.push(-ax, this.height(ax, ay) + 0.35, ay, -bx, this.height(bx, by) + 0.35, by);
    };
    const hw = width / 2;
    const hd = depth / 2;
    const step = Math.max(1, sampleStep);
    for (let x = Math.ceil(-hw / spacing) * spacing; x <= hw; x += spacing) {
      for (let y = -hd; y < hd; y += step) add(x, y, x, Math.min(hd, y + step));
    }
    for (let y = Math.ceil(-hd / spacing) * spacing; y <= hd; y += spacing) {
      for (let x = -hw; x < hw; x += step) add(x, y, Math.min(hw, x + step), y);
    }
    const seg = new LineSegments(new BufferGeometry(), this.material);
    seg.geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    seg.frustumCulled = false;
    seg.renderOrder = 7;
    this.group.add(seg);
  }

  clear(): void {
    clearGroup(this.group);
  }

  dispose(): void {
    this.clear();
  }
}

/**
 * Where a tower may stand (map-ops/validation/build-areas.ts): a sheet
 * draped on the ground, a texel per cell, strong green in reach of a route,
 * pale green out of reach, red where something rules a tower out
 */
export class BuildAreaLayer implements OverlayLayer {
  readonly group = new Group();

  constructor(private readonly height: GroundHeight) {}

  /** null hides it */
  set(areas: BuildAreas | null): void {
    this.clear();
    if (!areas) return;
    const { columns, rows, cell, x0, y0 } = areas;
    const texels = new Uint8Array(columns * rows * 4);
    for (let k = 0; k < areas.kind.length; k++) texels.set(BUILD_COLORS[areas.kind[k]] ?? BUILD_COLORS[BuildCell.Outside], k * 4);
    const texture = new DataTexture(texels, columns, rows);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.needsUpdate = true;
    // A vertex every cell corner, at most 256 along a side: the sheet follows the ground, the texels stay sharp
    const step = Math.max(1, Math.ceil(Math.max(columns, rows) / 256));
    const vx = Math.ceil(columns / step) + 1;
    const vy = Math.ceil(rows / step) + 1;
    const pos = new Float32Array(vx * vy * 3);
    const uv = new Float32Array(vx * vy * 2);
    for (let j = 0; j < vy; j++) {
      for (let i = 0; i < vx; i++) {
        const u = Math.min(columns, i * step);
        const v = Math.min(rows, j * step);
        const x = x0 + u * cell;
        const y = y0 + v * cell;
        const k = j * vx + i;
        pos.set([-x, this.height(x, y) + 0.4, y], k * 3);
        uv.set([u / columns, v / rows], k * 2);
      }
    }
    const index: number[] = [];
    for (let j = 0; j + 1 < vy; j++) {
      for (let i = 0; i + 1 < vx; i++) {
        const a = j * vx + i;
        index.push(a, a + vx, a + 1, a + 1, a + vx, a + vx + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    geometry.setIndex(index);
    const sheet = new Mesh(geometry, new MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide,
    }));
    sheet.frustumCulled = false;
    sheet.renderOrder = 6;
    this.group.add(sheet);
  }

  clear(): void {
    for (const child of this.group.children) ((child as Mesh).material as MeshBasicMaterial).map?.dispose();
    clearGroup(this.group);
  }

  dispose(): void {
    this.clear();
  }
}

/** The symmetry's axes, draped on the ground */
export class GuideLayer implements OverlayLayer {
  readonly group = new Group();
  private readonly material = new LineBasicMaterial({ color: TD_THEME.tealLight, depthTest: false, transparent: true, opacity: 0.55 });

  constructor(private readonly height: GroundHeight) {}

  /** Guide lines for a symmetry mode across a map of this size */
  set(mode: SymmetryMode, width: number, depth: number): void {
    this.clear();
    if (mode === 'none') return;
    const hw = width / 2;
    const hd = depth / 2;
    const lines: [MapPoint, MapPoint][] = [];
    if (mode === 'x' || mode === 'xy' || mode === 'rot2' || mode === 'rot4') lines.push([{ x: 0, y: -hd }, { x: 0, y: hd }]);
    if (mode === 'y' || mode === 'xy' || mode === 'rot2' || mode === 'rot4') lines.push([{ x: -hw, y: 0 }, { x: hw, y: 0 }]);
    if (mode === 'rot4') {
      const m = Math.min(hw, hd);
      lines.push([{ x: -m, y: -m }, { x: m, y: m }], [{ x: -m, y: m }, { x: m, y: -m }]);
    }
    for (const [a, b] of lines) {
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
      const pos = new Float32Array((steps + 1) * 3);
      for (let k = 0; k <= steps; k++) {
        const x = a.x + ((b.x - a.x) * k) / steps;
        const y = a.y + ((b.y - a.y) * k) / steps;
        pos.set([-x, this.height(x, y) + 0.8, y], k * 3);
      }
      const line = new Line(new BufferGeometry(), this.material);
      line.geometry.setAttribute('position', new BufferAttribute(pos, 3));
      line.renderOrder = 8;
      line.frustumCulled = false;
      this.group.add(line);
    }
  }

  clear(): void {
    clearGroup(this.group);
  }

  dispose(): void {
    this.clear();
  }
}

/** RGBA of each BuildCell on the sheet: the game's build preview speaks green and red too */
const BUILD_COLORS: Record<number, readonly number[]> = (() => {
  const rgba = (hex: string, alpha: number) => {
    const c = new Color(hex);
    return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), alpha];
  };
  const blocked = rgba(TD_THEME.dangerEdge, 150);
  return {
    [BuildCell.Outside]: [0, 0, 0, 0],
    [BuildCell.InReach]: rgba(TD_THEME.greenDark, 150),
    [BuildCell.OutOfReach]: rgba(TD_THEME.green, 60),
    [BuildCell.Water]: blocked,
    [BuildCell.Object]: blocked,
    [BuildCell.Steep]: blocked,
    [BuildCell.Route]: rgba(TD_THEME.dangerEdge, 70),
    [BuildCell.Marker]: blocked,
  };
})();
