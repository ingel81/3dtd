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
 * Direction→(face, s, t) folgt der GL-Cubemap-Konvention. Die `py = size -
 * 1 - floor(t*size)` y-Flip-Konvention wurde in einer früheren Migrations-
 * Session gegen den Cell-Shader-Output bit-validiert (match=428,
 * mismatch=0 für Ground).
 */
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
  const dx = sampleX - tipX;
  const dy = sampleY - tipY;
  const dz = sampleZ - tipZ;
  const cellDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (cellDist < 1e-4) return FALLBACK_RESULT;

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

  const size = ctx.cube.width;
  const s = (sc / ma + 1) * 0.5;
  const t = (tc / ma + 1) * 0.5;
  const px = Math.min(size - 1, Math.max(0, Math.floor(s * size)));
  // NB: kein y-flip. Three.js' textureCube auf einem WebGLCubeRenderTarget
  // sampelt direkt mit framebuffer-bottom-up t-Koordinate. Der "py = size-1
  // - floor(t*size)"-Flip aus der v2-Probe war FALSCH und produzierte
  // systematisch divergierende Visibility-Werte zwischen CPU-readPixels
  // und GPU-textureCube (siehe H5 im HANDOVER_ROUTE_GRID_GPU_LOS.md).
  const py = Math.min(size - 1, Math.max(0, Math.floor(t * size)));

  ctx.renderer.readRenderTargetPixels(ctx.cube, px, py, 1, 1, buf, face);

  let packed =
    buf[0] / 255 +
    buf[1] / 65025 +
    buf[2] / 16581375 +
    buf[3] / 4228250625;
  if (packed < ctx.emptyDepthEpsilon) packed = 1.0;

  return {
    cellDist,
    blockerDist: packed * ctx.farDistance,
  };
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
