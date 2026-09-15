/**
 * Boot-Gate der Intro-Kamerafahrt: Der Ladescreen bleibt stehen, bis die Fahrt
 * entlang der Route verlässliche Höhen hat, oder bis ein Timeout abläuft, damit
 * langsame Verbindungen nicht hängen. Das Warten selbst steuert IntroLoadingGate
 * (aus VisualizationFacadeService.checkAllLoaded()); hier stehen Konstanten und
 * Entscheidung.
 *
 * Das Sampling kommt während des Ladescreens voran, obwohl die Kamera dort nur den
 * Spielblick zeigt: Der Routen-Korridor (LoadRegionPlugin, 2,5 m geometricError) lädt
 * feine Tiles unabhängig vom Sichtfeld und ist ab dem Route-Grid-Schritt gesetzt. Der
 * Ladescreen hält vorher für den Korridorbau (CorridorBuild).
 */

/** Anteil verlässlicher Höhen auf der Route, ab dem der Ladescreen schließt. */
export const INTRO_GATE_MIN_READY = 0.9;

/** Spätestens so lange nach dem ersten Tile-Load schließt der Ladescreen trotzdem (ms). */
export const INTRO_GATE_TIMEOUT_MS = 8000;

/** Flugbahn-Samples pro Frame, solange der Gate wartet. */
export const INTRO_GATE_SAMPLES_PER_FRAME = 8;

/**
 * Darf der Ladescreen schließen?
 *
 * @param readiness Anteil verlässlicher Höhen auf der Route, 0..1
 * @param deadlineMs erster Tile-Load + {@link INTRO_GATE_TIMEOUT_MS}
 */
export function flightGateOpen(
  readiness: number,
  nowMs: number,
  deadlineMs: number,
  minReady = INTRO_GATE_MIN_READY,
): boolean {
  return readiness >= minReady || nowMs >= deadlineMs;
}

/** Zeile im Ladescreen, z. B. "63 % of the route". */
export function flightGateMeta(readiness: number): string {
  return `${Math.floor(readiness * 100)} % of the route`;
}
