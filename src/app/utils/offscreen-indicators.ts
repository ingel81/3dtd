/**
 * Arrows at the edge of the view toward threats the camera does not show:
 * bosses, and enemies on the last stretch of their route. Pure maths over
 * projected points, so the component only projects and draws.
 *
 * Points are clustered by direction into a few sectors around the view
 * centre; each non-empty sector becomes one arrow with a count.
 */

/** Share of its route after which an enemy counts as close to the HQ */
export const NEAR_HQ_PROGRESS = 0.85;

/** Distance of the count label from the arrow, toward the view centre, px */
const LABEL_OFFSET_PX = 20;

/** Rounded, with -0 as 0: the values end up in CSS and in comparisons. */
function round(v: number): number {
  return Math.round(v) || 0;
}

/** Whether an enemy gets an arrow when it is off-screen. */
export function isOffscreenThreat(isBoss: boolean, pathProgress: number): boolean {
  return isBoss || pathProgress >= NEAR_HQ_PROGRESS;
}

export interface OffscreenArrow {
  /** Position in px from the top left of the view */
  x: number;
  y: number;
  /** Where it points, degrees clockwise from "right" (CSS rotate) */
  angle: number;
  /** Offset of the count label from the arrow, px */
  labelX: number;
  labelY: number;
  /** Threats in this direction */
  count: number;
  /** A boss among them */
  boss: boolean;
}

/**
 * Collects projected points per direction sector, then builds the arrows.
 * Fixed arrays, so a scan over thousands of enemies allocates nothing per
 * point. Call begin(), add() per point, build().
 */
export class OffscreenClusterer {
  private readonly count: Int32Array;
  private readonly bosses: Int32Array;
  private readonly sumX: Float64Array;
  private readonly sumY: Float64Array;
  private readonly step: number;
  private halfW = 0;
  private halfH = 0;
  private margin = 0;
  private leftInset = 0;

  constructor(private readonly sectors = 8) {
    this.count = new Int32Array(sectors);
    this.bosses = new Int32Array(sectors);
    this.sumX = new Float64Array(sectors);
    this.sumY = new Float64Array(sectors);
    this.step = (2 * Math.PI) / sectors;
  }

  /**
   * Start a pass for a view of `width` x `height` px, arrows `margin` px
   * inside its edge; on the left `leftInset` px further in (a HUD strip
   * along that edge).
   */
  begin(width: number, height: number, margin: number, leftInset = 0): void {
    this.count.fill(0);
    this.bosses.fill(0);
    this.sumX.fill(0);
    this.sumY.fill(0);
    this.halfW = width / 2;
    this.halfH = height / 2;
    this.margin = margin;
    this.leftInset = leftInset;
  }

  /**
   * One point in normalised device coordinates (x right, y up, -1..1 on
   * screen). A point behind the camera comes in mirrored back, with
   * `behind` set; it counts as off-screen wherever it lands.
   * @returns false when the point is on screen and adds nothing
   */
  add(ndcX: number, ndcY: number, behind: boolean, boss: boolean): boolean {
    if (!behind && ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1) return false;
    // Direction in pixels, so a wide view does not squash the angles
    let dx = ndcX * this.halfW;
    let dy = ndcY * this.halfH;
    let len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      // Straight behind the camera: point down, "turn around"
      dx = 0;
      dy = -1;
      len = 1;
    }
    const ux = dx / len;
    const uy = dy / len;
    const s = ((Math.round(Math.atan2(uy, ux) / this.step) % this.sectors) + this.sectors) % this.sectors;
    this.count[s]++;
    if (boss) this.bosses[s]++;
    this.sumX[s] += ux;
    this.sumY[s] += uy;
    return true;
  }

  /** Arrows of this pass, those with a boss first, then the fuller directions. */
  build(maxArrows: number): OffscreenArrow[] {
    const used: number[] = [];
    for (let s = 0; s < this.sectors; s++) {
      if (this.count[s] > 0) used.push(s);
    }
    used.sort((a, b) =>
      Number(this.bosses[b] > 0) - Number(this.bosses[a] > 0) || this.count[b] - this.count[a]
    );

    const axRight = Math.max(0, this.halfW - this.margin);
    const axLeft = Math.max(0, this.halfW - this.margin - this.leftInset);
    const ay = Math.max(0, this.halfH - this.margin);
    const arrows: OffscreenArrow[] = [];
    for (const s of used.slice(0, maxArrows)) {
      // Mean direction of the sector; opposite points cancel to the sector centre
      let ux = this.sumX[s];
      let uy = this.sumY[s];
      let len = Math.hypot(ux, uy);
      if (len < 1e-6) {
        ux = Math.cos(s * this.step);
        uy = Math.sin(s * this.step);
        len = 1;
      }
      ux /= len;
      uy /= len;
      // Where the ray from the centre leaves the inset rectangle
      const t = Math.min(
        Math.abs(ux) > 1e-6 ? (ux > 0 ? axRight : axLeft) / Math.abs(ux) : Number.POSITIVE_INFINITY,
        Math.abs(uy) > 1e-6 ? ay / Math.abs(uy) : Number.POSITIVE_INFINITY,
      );
      arrows.push({
        x: round(this.halfW + ux * t),
        y: round(this.halfH - uy * t),
        angle: round((Math.atan2(-uy, ux) * 180) / Math.PI),
        labelX: round(-ux * LABEL_OFFSET_PX),
        labelY: round(uy * LABEL_OFFSET_PX),
        count: this.count[s],
        boss: this.bosses[s] > 0,
      });
    }
    return arrows;
  }
}

/** Same arrows, so the view need not change. */
export function sameArrows(a: readonly OffscreenArrow[], b: readonly OffscreenArrow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.x !== q.x || p.y !== q.y || p.angle !== q.angle || p.count !== q.count || p.boss !== q.boss) {
      return false;
    }
  }
  return true;
}
