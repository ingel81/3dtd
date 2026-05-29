import { Vector3, WebGLCubeRenderTarget, WebGLRenderer } from 'three';

/**
 * Kontext für einen GPU-Cube-basierten LOS-Resolve-Pass.
 *
 * Wird vom Caller (typisch TowerPlacementService.buildLosResolveContext)
 * zusammen gebaut: erst `shadowMapper.invalidate()` + `shadowMapper.update()`
 * aufrufen, dann die Mapper-Getter (`getRenderTarget`, `getReferencePos`,
 * `getFarDistance`) einsammeln und hier als Context bündeln.
 *
 * Strikt one-shot: nicht über mehrere Tower hinweg cachen — `referencePos`
 * und `farDistance` gelten exakt für den Render der gerade lief.
 */
export interface LosResolveContext {
  readonly cube: WebGLCubeRenderTarget;
  readonly referencePos: Readonly<Vector3>;
  readonly farDistance: number;
  readonly renderer: WebGLRenderer;
  readonly visibilityBias: number;
  readonly emptyDepthEpsilon: number;
}

export interface CubeSampleResult {
  readonly cellDist: number;
  readonly blockerDist: number;
}

const FALLBACK_RESULT: CubeSampleResult = { cellDist: 0, blockerDist: 0 };

/**
 * Sampled die Cubemap am Direction-Vektor von `tip` zu `sample` und gibt
 * cell-distance + decoded-blocker-distance zurück. Für Visibility-Tests
 * den Convenience-Wrapper {@link isCubeVisible} nutzen.
 *
 * Direction→(face, s, t) folgt der GL-Cubemap-Konvention. **`py = floor
 * (t*size)` — KEIN y-Flip.** Three.js' `textureCube` auf einem
 * `WebGLCubeRenderTarget` sampelt direkt mit framebuffer-bottom-up t-
 * Koordinate (siehe Lesson 11 + H5-Sackgasse im HANDOVER). Ground-Truth-
 * Verifikation muss über einen unabhängigen GPU-Pfad laufen (1×1-RT-
 * Quad-Shader mit `textureCube`), NICHT über einen zweiten CPU-readPixels-
 * Call.
 */
/** Resolved cube address for a direction: which face + which texel + tip distance. */
interface CubeAddr {
  face: number;
  px: number;
  py: number;
  cellDist: number;
}

/**
 * Direction (tip→sample) → (face, px, py) following the GL-cubemap convention.
 * Shared by the single-readback path and the batched-faces path so the
 * sampling math stays identical (no y-flip — see file header / HANDOVER H5).
 * Returns null for a degenerate (zero-length) direction.
 */
function resolveCubeAddr(
  dx: number,
  dy: number,
  dz: number,
  size: number,
): CubeAddr | null {
  const cellDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (cellDist < 1e-4) return null;

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);

  let face: number;
  let sc: number;
  let tc: number;
  let ma: number;
  if (ax >= ay && ax >= az) {
    face = dx >= 0 ? 0 : 1;
    sc = dx >= 0 ? -dz : dz;
    tc = -dy;
    ma = ax;
  } else if (ay >= az) {
    face = dy >= 0 ? 2 : 3;
    sc = dx;
    tc = dy >= 0 ? dz : -dz;
    ma = ay;
  } else {
    face = dz >= 0 ? 4 : 5;
    sc = dz >= 0 ? dx : -dx;
    tc = -dy;
    ma = az;
  }

  const s = (sc / ma + 1) * 0.5;
  const t = (tc / ma + 1) * 0.5;
  const px = Math.min(size - 1, Math.max(0, Math.floor(s * size)));
  const py = Math.min(size - 1, Math.max(0, Math.floor(t * size)));
  return { face, px, py, cellDist };
}

function packedToResult(
  buf: Uint8Array,
  offset: number,
  cellDist: number,
  ctx: LosResolveContext,
): CubeSampleResult {
  let packed =
    buf[offset] / 255 +
    buf[offset + 1] / 65025 +
    buf[offset + 2] / 16581375 +
    buf[offset + 3] / 4228250625;
  if (packed < ctx.emptyDepthEpsilon) packed = 1.0;
  return { cellDist, blockerDist: packed * ctx.farDistance };
}

export function sampleCubeAtPoint(
  tipX: number,
  tipY: number,
  tipZ: number,
  sampleX: number,
  sampleY: number,
  sampleZ: number,
  ctx: LosResolveContext,
  buf: Uint8Array,
): CubeSampleResult {
  const addr = resolveCubeAddr(sampleX - tipX, sampleY - tipY, sampleZ - tipZ, ctx.cube.width);
  if (!addr) return FALLBACK_RESULT;

  ctx.renderer.readRenderTargetPixels(ctx.cube, addr.px, addr.py, 1, 1, buf, addr.face);
  return packedToResult(buf, 0, addr.cellDist, ctx);
}

/**
 * Holds the 6 cube faces read back to CPU memory in one batch, so per-cell
 * LOS sampling becomes an array index instead of a readRenderTargetPixels
 * GPU stall. Allocate/reuse one per grid (see {@link readCubeFaces}).
 */
export interface CubeFaceCache {
  /** 6 buffers, each size*size*4 bytes (RGBA, framebuffer bottom-up). */
  faces: Uint8Array[];
  /** Face edge length in texels. */
  size: number;
}

/** Allocate a CubeFaceCache for the given face size (size*size*4 per face). */
export function allocCubeFaceCache(size: number): CubeFaceCache {
  const faces: Uint8Array[] = [];
  for (let f = 0; f < 6; f++) faces.push(new Uint8Array(size * size * 4));
  return { faces, size };
}

/**
 * Read all 6 cube faces into the cache in one batch (6 readbacks total) and
 * return it. Reallocates the cache if the cube face size changed. This
 * replaces up to ~1400 individual 1×1 readbacks per tower build (one per
 * sampled cell × ground/air) with a constant 6 — the dominant cost of a build.
 */
export function readCubeFaces(ctx: LosResolveContext, cache: CubeFaceCache | null): CubeFaceCache {
  const size = ctx.cube.width;
  if (!cache || cache.size !== size) {
    cache = allocCubeFaceCache(size);
  }
  for (let f = 0; f < 6; f++) {
    ctx.renderer.readRenderTargetPixels(ctx.cube, 0, 0, size, size, cache.faces[f], f);
  }
  return cache;
}

/** Like {@link sampleCubeAtPoint} but reads from a pre-fetched {@link CubeFaceCache}. */
export function sampleCubeAtPointFromFaces(
  tipX: number,
  tipY: number,
  tipZ: number,
  sampleX: number,
  sampleY: number,
  sampleZ: number,
  ctx: LosResolveContext,
  cache: CubeFaceCache,
): CubeSampleResult {
  const addr = resolveCubeAddr(sampleX - tipX, sampleY - tipY, sampleZ - tipZ, cache.size);
  if (!addr) return FALLBACK_RESULT;
  const offset = (addr.py * cache.size + addr.px) * 4;
  return packedToResult(cache.faces[addr.face], offset, addr.cellDist, ctx);
}

/** Like {@link isCubeVisible} but reads from a pre-fetched {@link CubeFaceCache}. */
export function isCubeVisibleFromFaces(
  tipX: number,
  tipY: number,
  tipZ: number,
  sampleX: number,
  sampleY: number,
  sampleZ: number,
  ctx: LosResolveContext,
  cache: CubeFaceCache,
): boolean {
  const r = sampleCubeAtPointFromFaces(tipX, tipY, tipZ, sampleX, sampleY, sampleZ, ctx, cache);
  if (r.cellDist === 0) return true;
  return r.cellDist < r.blockerDist - ctx.visibilityBias;
}

/**
 * Strict-Predicate: Cell ist sichtbar wenn ihre Distanz zum Tip echt unter
 * der gepackten Blocker-Distanz liegt — minus Visibility-Bias um Float-
 * Genauigkeit an Wand-Kanten abzufedern.
 *
 * Im verglichenen CPU-Pfad hatte `raycaster.far = dist - 0.5` ein
 * spiegelbildliches Bias (Raycast endet 0.5 m **vor** Ziel). Beide Biases
 * sind 0.5 m, zeigen aber in entgegengesetzte Richtungen → Combat wird
 * ~1 m konservativer an Building-Wänden. Bewusste Wahl: "Combat schießt
 * nicht durch Wand".
 */
export function isCubeVisible(
  tipX: number,
  tipY: number,
  tipZ: number,
  sampleX: number,
  sampleY: number,
  sampleZ: number,
  ctx: LosResolveContext,
  buf: Uint8Array,
): boolean {
  const r = sampleCubeAtPoint(tipX, tipY, tipZ, sampleX, sampleY, sampleZ, ctx, buf);
  if (r.cellDist === 0) return true;
  return r.cellDist < r.blockerDist - ctx.visibilityBias;
}
