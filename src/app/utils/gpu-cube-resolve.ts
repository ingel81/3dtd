import { Vector3, WebGLCubeRenderTarget } from 'three';

/**
 * Kontext für einen GPU-Cube-basierten LOS-Resolve-Pass.
 *
 * Wird vom Caller (typisch TowerPlacementService.buildLosResolveContext)
 * zusammen gebaut: erst `shadowMapper.invalidate()` + `shadowMapper.update()`
 * aufrufen, dann die Mapper-Getter (`getRenderTarget`, `getReferencePos`,
 * `getFarDistance`) einsammeln, die 6 Faces via `readFacesToCpu()` einmal
 * in die CPU-Buffer holen und alles hier als Context bündeln.
 *
 * Strikt one-shot: nicht über mehrere Tower hinweg cachen — `referencePos`,
 * `farDistance` und `faces` gelten exakt für den Render der gerade lief.
 */
export interface LosResolveContext {
  readonly cube: WebGLCubeRenderTarget;
  readonly referencePos: Readonly<Vector3>;
  readonly farDistance: number;
  /**
   * CPU-Mirror der 6 Cube-Faces (je width² × 4 Bytes), gefüllt vom
   * TowerShadowMapper nach dem Cube-Render. Die Buffer sind persistent
   * auf dem Mapper allokiert — nicht pro Context.
   *
   * **Lazy.** Der Context-Builder hängt hier einen Getter ein, der
   * `readFacesToCpu()` erst beim ersten Zugriff auslöst — eine
   * Registrierung, die gar keine Zelle sampelt (alles gecached oder
   * out-of-range), zahlt die 6 Readbacks damit nicht. Wiederholte
   * Zugriffe sind billig: der Mapper cached per `renderVersion`.
   */
  readonly faces: readonly Uint8Array[];
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
 *
 * Datenquelle ist `ctx.faces` — der CPU-Mirror, den der TowerShadowMapper
 * nach dem Cube-Render mit einem readRenderTargetPixels pro Face gefüllt
 * hat. `readPixels` schreibt framebuffer-bottom-up in den Buffer, also ist
 * `(py * size + px) * 4` byte-identisch mit dem früheren synchronen
 * 1×1-Readback an (px, py) — die Pixel-Math bleibt unverändert.
 */
export function sampleCubeAtPoint(
  tipX: number,
  tipY: number,
  tipZ: number,
  sampleX: number,
  sampleY: number,
  sampleZ: number,
  ctx: LosResolveContext,
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
  // und GPU-textureCube (Regel 12 in docs/LOS_PIPELINE.md).
  const py = Math.min(size - 1, Math.max(0, Math.floor(t * size)));

  return {
    cellDist,
    blockerDist: unpackTexel(ctx.faces[face], (py * size + px) * 4, ctx.emptyDepthEpsilon) * ctx.farDistance,
  };
}

/**
 * Distance of texel `o` (byte offset) as a share of the cube's far, as
 * packDepthToRGBA wrote it; 1 for a texel no geometry reached (below
 * `emptyDepthEpsilon`, the cleared colour).
 */
function unpackTexel(faceBuf: Uint8Array, o: number, emptyDepthEpsilon: number): number {
  const packed =
    faceBuf[o] / 255 +
    faceBuf[o + 1] / 65025 +
    faceBuf[o + 2] / 16581375 +
    faceBuf[o + 3] / 4228250625;
  return packed < emptyDepthEpsilon ? 1.0 : packed;
}

/** What a tower's cube saw from its tip, over all six faces; see cubeCoverage. */
export interface CubeCoverage {
  /** Share of texels with geometry closer than `nearM` to the tip, 0..1 */
  near: number;
  /** Share of texels no geometry reached within the far distance, 0..1 */
  empty: number;
}

/**
 * How much of the cube is taken up close to the tip and how much is empty,
 * for the LOS diagnostics (TowerLosRegistry). A tip inside a mesh, or a mesh
 * right at it, shows as a large `near`: from there every cell reads as
 * blocked. Walks every texel of the six faces, about 1.5 million at 512²;
 * meant for a one-off log, not for a frame.
 */
export function cubeCoverage(ctx: LosResolveContext, nearM: number): CubeCoverage {
  const nearShare = nearM / ctx.farDistance;
  let total = 0;
  let near = 0;
  let empty = 0;
  for (const faceBuf of ctx.faces) {
    for (let o = 0; o < faceBuf.length; o += 4) {
      const depth = unpackTexel(faceBuf, o, ctx.emptyDepthEpsilon);
      total++;
      if (depth >= 1) empty++;
      else if (depth < nearShare) near++;
    }
  }
  return total === 0 ? { near: 0, empty: 0 } : { near: near / total, empty: empty / total };
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
): boolean {
  const r = sampleCubeAtPoint(tipX, tipY, tipZ, sampleX, sampleY, sampleZ, ctx);
  if (r.cellDist === 0) return true;
  return r.cellDist < r.blockerDist - ctx.visibilityBias;
}
