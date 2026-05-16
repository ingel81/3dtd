/**
 * Vorwärts- und Inverse-Math zwischen einem 3D-Direction-Vektor und der
 * (face, px, py)-Koordinate auf einer Cubemap.
 *
 * Verwendet die **identische** Konvention wie {@link sampleCubeAtPoint} in
 * `gpu-cube-resolve.ts` und Three.js' `textureCube` auf einem
 * `WebGLCubeRenderTarget`:
 *   - face-Indizes folgen WebGL-Konvention: 0=POS_X 1=NEG_X 2=POS_Y 3=NEG_Y 4=POS_Z 5=NEG_Z
 *   - py = floor(t * size) — KEIN y-Flip (siehe H5-Diskussion im
 *     HANDOVER_ROUTE_GRID_GPU_LOS.md)
 *
 * Wird vom LOS-Debug-Panel benutzt um Cell-Direction → Canvas-Pixel und
 * Canvas-Hover → Welt-Direction abzubilden.
 */

export interface FacePixel {
  face: number;
  px: number;
  py: number;
  /** Normierte sc/ma- und tc/ma-Position innerhalb des Face (-1..+1). */
  sc: number;
  tc: number;
}

/**
 * Maps a 3D-Direction (von Tip nach Sample, World-Space) auf die Cubemap-
 * Face und Texel-Koordinate. Direction muss != 0 sein; bei Norm == 0 wird
 * face=0, px=py=0 zurückgegeben.
 */
export function directionToFacePixel(
  dx: number,
  dy: number,
  dz: number,
  size: number,
): FacePixel {
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

  if (ma < 1e-12) return { face: 0, px: 0, py: 0, sc: 0, tc: 0 };

  const ncS = sc / ma;
  const ncT = tc / ma;
  const s = (ncS + 1) * 0.5;
  const t = (ncT + 1) * 0.5;
  const px = Math.min(size - 1, Math.max(0, Math.floor(s * size)));
  const py = Math.min(size - 1, Math.max(0, Math.floor(t * size)));

  return { face, px, py, sc: ncS, tc: ncT };
}

/** Einprägsame Face-Labels für die UI. */
export const FACE_LABELS: readonly string[] = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const;

/** Cross-Layout-Position (col,row) je Face im 4×3-Raster. */
export const FACE_CROSS_LAYOUT: ReadonlyArray<{ col: number; row: number }> = [
  { col: 2, row: 1 }, // +X (rechts)
  { col: 0, row: 1 }, // -X (links)
  { col: 1, row: 0 }, // +Y (oben)
  { col: 1, row: 2 }, // -Y (unten)
  { col: 1, row: 1 }, // +Z (vorne)
  { col: 3, row: 1 }, // -Z (hinten)
];
