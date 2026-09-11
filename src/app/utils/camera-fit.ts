import { DEG_TO_RAD } from './geo-utils';

/** Ergebnis von {@link fitGroundBox}. */
export interface GroundBoxFit {
  /** Abstand Kamera zu Blickziel entlang der Blickachse (m). */
  distance: number;
  /**
   * Verschiebung des Blickziels gegenüber der Boxmitte entlang der Tiefenachse (m),
   * negativ = zur Kamera hin. Die nahe Kante erscheint durch die Perspektive größer
   * als die ferne; mit dem Ziel auf der Boxmitte bliebe oben Rand verschenkt.
   */
  targetOffset: number;
}

/**
 * Kameraabstand, mit dem eine flache Bodenbox das Bild bis auf `edgeMargin` füllt.
 *
 * Die Box liegt auf dem Boden, `halfWidth` quer zur Blickrichtung, `halfDepth`
 * entlang. Die Kamera schaut entlang der Tiefenachse, um `pitchDeg` unter die
 * Horizontale geneigt (90° = senkrecht nach unten), auf das Blickziel
 * `Boxmitte + targetOffset`. `edgeMargin` ist der Rand je Seite als Anteil der
 * Bildbreite bzw. -höhe, die Box endet also bei NDC ±(1 - 2 · edgeMargin).
 *
 * Kamerakoordinaten eines Bodenpunkts mit Tiefe z relativ zum Ziel (s = sin, c = cos
 * der Neigung, d = Abstand): Bildhöhe z · s, Tiefe d + z · c.
 *
 * - Vertikal: Die nahe Kante liegt am unteren, die ferne am oberen Rand, beide
 *   gleich weit von der Mitte. Das legt Abstand und Zielverschiebung fest.
 * - Horizontal: Die nahe Kante hat die kleinste Tiefe und ist damit am breitesten;
 *   ihre Tiefe muss mindestens `halfWidth / (limit · tan(hFov/2))` sein.
 *
 * Es gilt die größere der beiden Distanzen, das Ziel wird für sie so verschoben,
 * dass nahe und ferne Kante symmetrisch um die Bildmitte liegen. In der nicht
 * bindenden Richtung bleibt entsprechend mehr Rand. Hoch- und Querformat laufen
 * über `aspect` durch dieselbe Rechnung.
 *
 * @param vFovDeg Vertikales FOV der Kamera (PerspectiveCamera.fov)
 * @param aspect Bildbreite / Bildhöhe
 * @throws RangeError wenn die Neigung so flach ist, dass die ferne Kante nie unter
 *   den oberen Rand kommt (obere Bildkante am oder über dem Horizont)
 */
export function fitGroundBox(
  halfWidth: number,
  halfDepth: number,
  vFovDeg: number,
  aspect: number,
  pitchDeg: number,
  edgeMargin: number,
): GroundBoxFit {
  const limit = 1 - 2 * edgeMargin;
  const tanHalfV = Math.tan((vFovDeg * DEG_TO_RAD) / 2);
  const kV = limit * tanHalfV;
  const kH = limit * aspect * tanHalfV;
  const s = Math.sin(pitchDeg * DEG_TO_RAD);
  const c = Math.cos(pitchDeg * DEG_TO_RAD);

  if (s <= kV * c) {
    throw new RangeError(`fitGroundBox: pitch ${pitchDeg}° is too flat for a ${vFovDeg}° vertical FOV`);
  }

  // Vertikal bindend: nahe Kante bei -limit, ferne bei +limit
  const byDepth = (halfDepth * (s * s - kV * kV * c * c)) / (kV * s);

  // Horizontal bindend: Tiefe der nahen Kante gleich nearDepth, Ziel symmetrisch verschoben
  const nearDepth = halfWidth / kH;
  const byWidth = nearDepth + (c * halfDepth * nearDepth) / (nearDepth + c * halfDepth);

  const distance = Math.max(byDepth, byWidth);

  // Symmetrie oben/unten: c·δ² - d·δ - c·halfDepth² = 0, die negative Wurzel,
  // umgestellt, damit sie bei c → 0 (senkrecht) nicht ausgelöscht wird.
  const cz = c * halfDepth;
  const targetOffset = (-2 * cz * halfDepth) / (distance + Math.sqrt(distance * distance + 4 * cz * cz));

  return { distance, targetOffset };
}
