/**
 * Shared primitives for street-network A* pathfinding.
 *
 * Used by OsmStreetService, DevStreetProvider and the pathfinding web worker
 * so all three run the identical geometry. Framework-free (no Angular, no DOM)
 * so it can also be bundled into the worker chunk.
 */

/**
 * MinHeap for A* pathfinding - O(log n) insert/extract
 */
export class MinHeap<T> {
  private heap: { item: T; priority: number }[] = [];

  get size(): number { return this.heap.length; }

  push(item: T, priority: number): void {
    this.heap.push({ item, priority });
    this._bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].item;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].priority >= this.heap[parent].priority) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  private _sinkDown(i: number): void {
    const len = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < len && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

/**
 * Calculate distance between two coordinates in meters (Haversine formula).
 *
 * Deliberately kept separate from the `haversineDistance` in `geo-utils.ts`:
 * that version factors out `DEG_TO_RAD = Math.PI / 180` as a constant, while
 * this one multiplies by `Math.PI` before dividing by `180` inline. Both are
 * mathematically the same formula, but float multiplication is not
 * associative, so the two can differ in the last bit. For A* here that could
 * flip which node wins on a distance tie, so the exact expression stays as is.
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Perpendicular distance from a point to a line segment, in meters.
 */
export function distanceToSegment(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  // Scale longitude by cos(latitude) to get approximately equal-distance units
  const midLat = (aLat + bLat) * 0.5;
  const lonScale = Math.cos((midLat * Math.PI) / 180);

  const dxSeg = (bLon - aLon) * lonScale;
  const dySeg = bLat - aLat;
  const lengthSq = dxSeg * dxSeg + dySeg * dySeg;

  if (lengthSq === 0) {
    return haversineDistance(pLat, pLon, aLat, aLon);
  }

  const dxPoint = (pLon - aLon) * lonScale;
  const dyPoint = pLat - aLat;

  // Parameter t represents position along segment (0 = at A, 1 = at B)
  let t = (dxPoint * dxSeg + dyPoint * dySeg) / lengthSq;
  t = Math.max(0, Math.min(1, t)); // Clamp to segment

  // Interpolate in original coordinates for haversine
  const closestLat = aLat + t * (bLat - aLat);
  const closestLon = aLon + t * (bLon - aLon);

  return haversineDistance(pLat, pLon, closestLat, closestLon);
}
