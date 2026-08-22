/**
 * Column sampling — deciding what a top-down terrain probe actually hit.
 *
 * Kept free of Three.js and of the engine so the decision logic can be unit
 * tested against hand-written hit lists; the raycast itself lives in
 * `ThreeTilesEngine.sampleColumn`.
 */

/** One raycast hit, reduced to what the selection needs. */
export interface ColumnHit {
  /** Local Y of the hit point. */
  y: number;
  /** 3D-Tiles tile depth of the tile the hit belongs to. */
  depth: number;
  /** Geometric error of that tile. */
  geometricError: number;
}

/** The resolved answer for one vertical probe. */
export interface ColumnSample {
  /** Walkable surface: the lowest hit of the finest LOD present. */
  groundY: number;
  /** Highest hit of that same LOD — roofs, decks, canopy. */
  topY: number;
  /** LOD the sample was taken from; drives cache invalidation. */
  tileDepth: number;
  tileGeometricError: number;
}

/**
 * Reduce the hits of one column to a single answer.
 *
 * The important step is the LOD filter. During refinement the renderer keeps
 * a coarse ancestor tile active until all of its children are ready (and the
 * fade plugin keeps out-going tiles around a little longer still), so a
 * single ray genuinely passes through two generations of geometry at once.
 * In photogrammetry the coarse generation is a decimated hull that averages
 * rooftops and street into one lump — in a dense city that lump sits near
 * roof level. Taking the topmost hit therefore returns a roof, which is
 * exactly the "route floating in the air" failure.
 *
 * So: keep only the hits belonging to the finest LOD present, and read
 * ground and top off that generation alone. Within one LOD the geometry is
 * consistent, and the lowest hit is the ground even under a bridge — no
 * anchor, no tolerance band, no guessing.
 *
 * Hits without usable LOD metadata are dropped: they come from bounding-volume
 * approximations before the tile mesh is decoded, and accepting one cements a
 * wrong height that nothing later corrects.
 *
 * Deliberately NOT handled here: a hit that is too low because the mesh has a
 * hole in it. A single column cannot tell that apart from a street running
 * under a tall building — both are "lowest hit sits far below the next one".
 * Distinguishing them needs neighbouring ground, so it belongs to the grid's
 * neighbour-median check, which has that context.
 *
 * @returns null when nothing usable was hit — the caller keeps whatever it had.
 */
export function selectColumnSample(hits: readonly ColumnHit[]): ColumnSample | null {
  let maxDepth = -1;
  for (const h of hits) {
    // depth 0 / infinite error === "no tile info", not "a very coarse tile".
    if (h.depth === 0 || h.geometricError === Infinity) continue;
    if (h.depth > maxDepth) maxDepth = h.depth;
  }
  if (maxDepth < 0) return null;

  let groundY = Infinity;
  let topY = -Infinity;
  let geometricError = Infinity;

  for (const h of hits) {
    if (h.depth !== maxDepth) continue;
    if (h.y > topY) topY = h.y;
    if (h.y < groundY) groundY = h.y;
    if (h.geometricError < geometricError) geometricError = h.geometricError;
  }

  if (groundY === Infinity) return null;

  return { groundY, topY, tileDepth: maxDepth, tileGeometricError: geometricError };
}

/**
 * True if `peek` describes strictly better tile data than a sample already
 * taken — deeper LOD, or the same depth at a lower geometric error.
 *
 * Used to decide whether a cached column is worth re-raycasting after the
 * loaded tile set changed.
 */
export function isBetterLod(
  peek: { depth: number; geometricError: number },
  sample: { tileDepth: number; tileGeometricError: number },
): boolean {
  if (peek.depth > sample.tileDepth) return true;
  return peek.depth === sample.tileDepth && peek.geometricError < sample.tileGeometricError;
}
