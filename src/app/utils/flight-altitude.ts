/**
 * Höhenprofil der Intro-Kamerafahrt als reine Funktionen (IntroCameraFlightService).
 *
 * Ein Säulen-Sample liest die feinste LOD, die an der Stelle gerade geladen ist
 * (`selectColumnSample`). Bei kaltem Cache sind das entlang der Route oft nur grobe
 * Vorfahren-Tiles. Deren vereinfachte Geometrie kann weit neben der echten
 * Oberfläche liegen, bei großen Kacheln als flache Sehne unter der Erdkrümmung; im
 * Playtest flog die Kamera bei -3154 m. Grobe Samples gelten hier deshalb nur als
 * vorläufig: Sie werden erneut gesampelt, bis feinere Tiles da sind, und als Boden
 * zählen sie nie allein.
 */

/** Ein Eintrag je Stützstelle der Flugbahn, Szenen-Y. NaN = noch kein Treffer. */
export interface FlightProfile {
  /** Oberkante: Dächer, Baumkronen, eingefaltete Marker. */
  top: Float32Array;
  /** Boden. */
  ground: Float32Array;
  /** Geometric error des Tiles, aus dem das Sample stammt (m). */
  error: Float32Array;
}

export function createFlightProfile(count: number): FlightProfile {
  return {
    top: new Float32Array(count).fill(NaN),
    ground: new Float32Array(count).fill(NaN),
    error: new Float32Array(count).fill(NaN),
  };
}

/** Leert alle Stützstellen, Größe bleibt. */
export function clearFlightProfile(p: FlightProfile): void {
  p.top.fill(NaN);
  p.ground.fill(NaN);
  p.error.fill(NaN);
}

/** Sample vorhanden und aus einem Tile mit höchstens `maxError` Metern Fehler. */
export function isReliable(p: FlightProfile, i: number, maxError: number): boolean {
  return !Number.isNaN(p.ground[i]) && p.error[i] <= maxError;
}

/** Anzahl verlässlicher Stützstellen (Fortschritt fürs Debug und den Boot-Gate). */
export function countReliable(p: FlightProfile, maxError: number): number {
  let n = 0;
  for (let i = 0; i < p.ground.length; i++) {
    if (isReliable(p, i, maxError)) n++;
  }
  return n;
}

/**
 * Boden an Stützstelle `centre`. Nie null und nie allein aus einem groben Sample.
 *
 * 1. Verlässliches Sample innerhalb ±`span`, das nächste zuerst: dieses.
 * 2. Sonst das Maximum aus dem nächsten verlässlichen Sample irgendwo auf dem Profil,
 *    dem nächsten vorläufigen Sample innerhalb ±`span` und `fallback` (Routenhöhe).
 *    Das Maximum, weil jeder dieser Werte zu tief sein kann (Talsohle weit weg, grobe
 *    Sehne), aber eine zu hohe Kamera nur unschön ist, eine zu tiefe steckt im Boden.
 */
export function safeGround(
  p: FlightProfile,
  centre: number,
  span: number,
  maxError: number,
  fallback: number,
): number {
  const n = p.ground.length;
  let provisional = NaN;

  for (let d = 0; d <= span; d++) {
    for (const i of d === 0 ? [centre] : [centre - d, centre + d]) {
      if (i < 0 || i >= n || Number.isNaN(p.ground[i])) continue;
      if (p.error[i] <= maxError) return p.ground[i];
      if (Number.isNaN(provisional)) provisional = p.ground[i];
    }
  }

  let ground = fallback;
  if (!Number.isNaN(provisional) && provisional > ground) ground = provisional;

  for (let d = span + 1; d < n; d++) {
    const lo = centre - d;
    const hi = centre + d;
    if (lo < 0 && hi >= n) break;
    if (lo >= 0 && isReliable(p, lo, maxError)) return Math.max(ground, p.ground[lo]);
    if (hi < n && isReliable(p, hi, maxError)) return Math.max(ground, p.ground[hi]);
  }
  return ground;
}

/** Höchste Oberkante in [from, to], -Infinity ohne Samples. Zu tiefe Werte stören ein Maximum nicht. */
export function skylineMax(p: FlightProfile, from: number, to: number): number {
  let max = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(p.top.length - 1, to); i++) {
    const v = p.top[i];
    if (!Number.isNaN(v) && v > max) max = v;
  }
  return max;
}

/**
 * Nächste Kamerahöhe: zum Ziel mit begrenzter Steig- und Sinkrate, aber nie unter
 * `floor`. Die Untergrenze greift sofort, auch wenn ein spät verfeinertes Sample
 * den Boden anhebt; mit plausiblem Rückfallwert sind solche Sprünge klein.
 */
export function stepAltitude(
  current: number,
  desired: number,
  floor: number,
  dt: number,
  maxClimbRate: number,
  maxDescendRate: number,
): number {
  const delta = Math.min(Math.max(desired - current, -maxDescendRate * dt), maxClimbRate * dt);
  return Math.max(current + delta, floor);
}

/**
 * Stützstellen in [from, to], die dieses Frame gesampelt werden: ohne Treffer oder
 * nur vorläufig, höchstens `budget`, reihum ab `cursor`. Reihum, weil Stellen ohne
 * Treffer (Wasser, Lücke) oder dauerhaft grobe sonst jedes Frame das Budget
 * belegen und die dahinter nie drankommen.
 *
 * @param out wird geleert und mit den Indizes gefüllt
 * @returns Cursor für den nächsten Aufruf
 */
export function pickSamples(
  p: FlightProfile,
  from: number,
  to: number,
  budget: number,
  cursor: number,
  maxError: number,
  out: number[],
): number {
  out.length = 0;
  const lo = Math.max(0, from);
  const hi = Math.min(p.ground.length - 1, to);
  const count = hi - lo + 1;
  if (count <= 0 || budget <= 0) return cursor;

  const start = cursor >= lo && cursor <= hi ? cursor : lo;
  let next = cursor;
  for (let k = 0; k < count && out.length < budget; k++) {
    const i = lo + ((start - lo + k) % count);
    if (!isReliable(p, i, maxError)) {
      out.push(i);
      next = i + 1;
    }
  }
  return next;
}
