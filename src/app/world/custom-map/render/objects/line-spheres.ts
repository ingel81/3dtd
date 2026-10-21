/**
 * The bounding sphere of each line of the map's objects (asset-catalog.ts
 * linePiece: walls and structures sharing a group): its pieces draw while
 * the whole line is above the pixel limit (object-layer.ts applyLevels), so
 * a track or a wall does not break off in the distance where its 4 m pieces
 * get small. A line's sphere is worked out again only after one of its
 * pieces came, went or moved, from its pieces' own spheres.
 */
export class LineSpheres {
  private readonly members = new Map<string, Set<string>>();
  private readonly lineOf = new Map<string, string>();
  private readonly stale = new Set<string>();
  private readonly piece = new Float32Array(4);

  /** Object `id` is a piece of line `line`, or of none (null); its line looks at its sphere again either way */
  set(id: string, line: string | null): void {
    const was = this.lineOf.get(id);
    if (was !== undefined) this.stale.add(was);
    if (was === line) return;
    if (was !== undefined) this.leave(id, was);
    if (line === null) return;
    this.lineOf.set(id, line);
    let set = this.members.get(line);
    if (!set) this.members.set(line, (set = new Set()));
    set.add(id);
    this.stale.add(line);
  }

  /** Object `id` is gone */
  remove(id: string): void {
    const was = this.lineOf.get(id);
    if (was !== undefined) this.leave(id, was);
  }

  /** Every line and piece forgotten */
  clear(): void {
    this.members.clear();
    this.lineOf.clear();
    this.stale.clear();
  }

  /** Lines waiting for their sphere */
  get due(): boolean {
    return this.stale.size > 0;
  }

  /**
   * The spheres of the lines that changed: `sphereOf` reads a piece's
   * sphere (centre and radius) into `out`, false for a piece not built yet;
   * `write` hands each piece of such a line the line's sphere
   */
  refresh(sphereOf: (id: string, out: Float32Array) => boolean, write: (id: string, x: number, y: number, z: number, r: number) => void): void {
    const p = this.piece;
    for (const line of this.stale) {
      const ids = this.members.get(line);
      if (!ids) continue;
      // The middle of the box round the pieces' spheres, the radius that holds them all
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (const id of ids) {
        if (!sphereOf(id, p)) continue;
        x0 = Math.min(x0, p[0] - p[3]);
        x1 = Math.max(x1, p[0] + p[3]);
        y0 = Math.min(y0, p[1] - p[3]);
        y1 = Math.max(y1, p[1] + p[3]);
        z0 = Math.min(z0, p[2] - p[3]);
        z1 = Math.max(z1, p[2] + p[3]);
      }
      if (x0 === Infinity) continue;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const cz = (z0 + z1) / 2;
      let r = 0;
      for (const id of ids) {
        if (!sphereOf(id, p)) continue;
        const dx = p[0] - cx;
        const dy = p[1] - cy;
        const dz = p[2] - cz;
        r = Math.max(r, Math.sqrt(dx * dx + dy * dy + dz * dz) + p[3]);
      }
      for (const id of ids) write(id, cx, cy, cz, r);
    }
    this.stale.clear();
  }

  private leave(id: string, line: string): void {
    this.lineOf.delete(id);
    const set = this.members.get(line);
    set?.delete(id);
    if (set && !set.size) {
      this.members.delete(line);
      this.stale.delete(line);
    } else this.stale.add(line);
  }
}
