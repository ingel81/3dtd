import { CatmullRomCurve3, Vector3 } from 'three';

/**
 * Waagrechte Flugbahn der Intro-Kamerafahrt (IntroCameraFlightService).
 *
 * Die Kurve liegt bei y = 0: Bogenlänge, Tangente und die Verlängerung über die
 * Enden hinaus kommen nur aus der Lage der Routenpunkte. Deren Höhen stammen aus
 * den Route-Zellen zum Zeitpunkt des Routenbaus, bei kaltem Cache oft aus groben
 * Tiles, die von Punkt zu Punkt weit springen können. In einer 3D-Kurve verlängert
 * so ein Sprung die Bogenlänge, ohne dass sich die Kamera waagrecht bewegt, kippt
 * die Starttangente (und damit den Standoff vor dem HQ) in die Senkrechte und
 * verzerrt die zentripetale Parametrisierung, sodass die Bahn waagrecht über einen
 * Punkt hinausschießen kann. Die Flughöhe kommt ohnehin aus dem Höhenprofil
 * (flight-altitude.ts); die Routenhöhe dient nur noch als Rückfallwert, siehe
 * `routeYAt`.
 */
export interface FlightPath {
  /** Zentripetale Catmull-Rom-Kurve durch die Routenpunkte, alle bei y = 0. */
  curve: CatmullRomCurve3;
  /** Waagrechte Bogenlänge der Kurve (m). */
  length: number;
  /**
   * Szenen-Y der Routenpunkte bei Bogenlänge `distance`: linear zwischen den
   * Punkten, vor dem Anfang die Anfangs-, hinter dem Ende die Endhöhe.
   */
  routeYAt(distance: number): number;
}

/** @param points Routenpunkte in Szenenkoordinaten, mindestens zwei */
export function buildFlightPath(points: readonly Vector3[]): FlightPath {
  const flat = points.map((p) => new Vector3(p.x, 0, p.z));
  const curve = new CatmullRomCurve3(flat, false, 'centripetal');
  // Die Standardauflösung von 200 ist für eine Straßenroute über mehrere
  // hundert Meter zu grob, getPointAt() läge nicht gleichmäßig.
  curve.arcLengthDivisions = Math.max(200, flat.length * 8);
  const length = curve.getLength();

  // Kumulierte Sehnenlänge je Punkt. Die Kurve ist in Kurven etwas länger als
  // der Polygonzug, deshalb wird die Bogenlänge anteilig umgerechnet.
  const along = new Float64Array(flat.length);
  for (let i = 1; i < flat.length; i++) along[i] = along[i - 1] + flat[i].distanceTo(flat[i - 1]);
  const chord = along[flat.length - 1];
  const ys = points.map((p) => p.y);

  const routeYAt = (distance: number): number => {
    const s = length > 0 ? (distance / length) * chord : 0;
    if (s <= 0) return ys[0];
    if (s >= chord) return ys[ys.length - 1];
    let lo = 0;
    let hi = along.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (along[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = along[hi] - along[lo];
    const t = span > 0 ? (s - along[lo]) / span : 0;
    return ys[lo] + (ys[hi] - ys[lo]) * t;
  };

  return { curve, length, routeYAt };
}
