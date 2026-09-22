/**
 * Druck-Regler — geschlossener Kreis auf den HP-Anteil, den eine Welle kostet.
 *
 * Er korrigiert die Kill-Schätzung von `survivableCount` über einen
 * Multiplikator, genau wie sein Vorgänger. Neu ist, worauf er regelt.
 *
 * WARUM NICHT MEHR AUF DIE LECK-QUOTE, gemessen über 360 Könner-Läufe
 * (docs/DRAMA_CONTROLLER_PLAN.md):
 *
 * 1. **Die Leck-Quote hat bei kleinen Wellen keine Auflösung.** Das Zielband
 *    war 8 bis 16 %. Bei sieben gespawnten Gegnern sind nur 0 %, 14 % und
 *    29 % darstellbar. Der Regler fuhr sich selbst in den Bereich, in dem er
 *    nicht mehr messen konnte, und sah dort abwechselnd "viel zu wenig" und
 *    "viel zu viel".
 *
 * 2. **Die Anfangswellen trieben ihn in die Sättigung.** Die Wellen 1 bis 3
 *    lecken 71, 37 und 10 %, weil der Spieler noch keine Türme hat. Nach zwei
 *    Wellen stand der Multiplikator auf dem unteren Anschlag und blieb dort:
 *    über alle Wellen klebte er zu 34,6 % an 0,5.
 *
 * 3. **Ein Mittelwert über vier Wellen ist gegen Ausreißer wehrlos.** Die
 *    Kampagne pinnt Luftwellen auf W7, W8, W12, W16 und W21; gegen eine
 *    Abwehr ohne Luftziel lecken sie stark. Der Regler las das als "zu
 *    schwer" und schrumpfte danach auch jede Bodenwelle.
 *
 * Ergebnis war ein Oszillator statt eines Reglers: zwölf Wellen am Stück ohne
 * HP-Verlust, dann ein Überschwingen auf 365 Gegner und eine Wand, an der
 * 75 % der Läufe starben.
 *
 * WARUM DER DRUCK DIE RICHTIGE GRÖSSE IST:
 *
 * - Er misst, was Spannung ausmacht. Der Spieler erlebt sinkende HP, keine
 *   Leck-Quote.
 * - Er löst auch bei fünf Gegnern auf, weil jeder Gegnertyp anderen
 *   Leck-Schaden macht. Die Leck-Quote ist dort eine Stufenfunktion.
 * - **Er überlebt Heilung.** Der Bezug ist der HP-Stand zu Wellenbeginn, nicht
 *   das Startmaximum und nicht der kumulierte Schaden. Heilt der Spieler
 *   künftig über Pickups oder Käufe, steigt der Nenner, die Welle darf absolut
 *   mehr kosten, und der relative Druck bleibt gleich. Geheilte HP sind damit
 *   echter Fortschritt in Form überlebter Wellen, ohne dass die Kurve
 *   verflacht. Ein Regler auf den Restbestand oder auf `damagePercent` (gegen
 *   `startHealth`) würde in dem Moment brechen, in dem Heilung existiert.
 *
 * Zustand ist pro Lauf: {@link reset} bei einem neuen Spiel. Ließ man ihn
 * stehen, wurde der Multiplikator zur Ratsche, und frische Läufe öffneten
 * gegen Wellen, die für eine längst abgebaute Verteidigung bemessen waren.
 */

import { directorParams } from './director-params';

/**
 * Wellen, die der Regler gar nicht erst ansieht.
 *
 * Sie messen einen Spieler ohne Türme, nicht seine Verteidigung. Das ist der
 * Anti-Windup: genau diese Wellen haben den Vorgänger in den Anschlag
 * getrieben.
 */
export const PRESSURE_WARMUP_WAVES = 4;

/**
 * Gewicht der neuesten Welle im geglätteten Druck.
 *
 * Ein exponentiell gewichteter Mittelwert statt eines Fensters. Das Fenster
 * über acht Wellen war zu träge: Wird die Verteidigung ab Welle 14 stark,
 * braucht ein gleitendes Mittel vier Wellen, bis es das merkt, und gemessen
 * standen dann neun Wellen am Stück ohne HP-Verlust im Lauf. Der EWMA
 * gewichtet die letzte Welle sofort mit 35 % und behält trotzdem ein
 * Gedächtnis von rund drei Wellen, also die Glättung gegen einzelne
 * Ausreißer (docs/DRAMA_CONTROLLER_PLAN.md).
 */
export const PRESSURE_SMOOTHING = 0.35;

/**
 * Messwerte, ab denen der Regler eingreift.
 *
 * Drei Wellen sind eine grobe, aber rechtzeitige Aussage. Wartete er länger,
 * griffe er bei einem Lauf, der um Welle 16 endet, erst nach der halben
 * Lebenszeit ein.
 */
export const PRESSURE_MIN_SAMPLES = 3;

/**
 * Lauflänge, auf die der Regler zielt, und die HP, die dort noch übrig sein
 * sollen. Zusammen ergeben sie den Zieldruck; die gewünschte Lauflänge ist
 * damit ein Design-Parameter und kein Ergebnis von Tuning.
 */
export const TARGET_RUN_WAVES = 80;
export const TARGET_RESIDUAL_HP = 0.05;

/**
 * Anteil der HP, den eine Welle im Mittel kosten soll.
 *
 * Kostet jede Welle den Anteil p, sind nach N Wellen noch (1-p)^N übrig.
 * Nach TARGET_RESIDUAL_HP aufgelöst sind das 3,67 % bei 80 Wellen.
 */
export const BASE_PRESSURE = 1 - Math.pow(TARGET_RESIDUAL_HP, 1 / TARGET_RUN_WAVES);

/**
 * Form der Kurve über den Lauf: die Aufbauphase ist milder, das Endspiel
 * härter. Der Mittelwert bleibt 1, also bleibt die Lauflänge erhalten.
 */
export const PRESSURE_SHAPE_START = 0.5;
export const PRESSURE_SHAPE_END = 1.5;

/** Proportionalverstärkung auf den logarithmischen Fehler, je Welle. */
export const PRESSURE_GAIN = 0.5;

/**
 * Größter Schritt je Welle, als Betrag des Log-Fehlers. 0,7 entspricht
 * höchstens ×1,42 oder ÷1,42 pro Welle.
 */
export const PRESSURE_MAX_STEP = 0.7;

/**
 * Untergrenze der Messung, damit `ln(target / 0)` nicht divergiert. Eine
 * Welle, die gar nichts kostet, liest sich als "kostete 0,2 % der HP".
 */
export const PRESSURE_FLOOR = 0.002;

/** Toleranzband um den Sollwert, als Faktor nach unten und oben. */
export const PRESSURE_BAND_LO = 0.5;
export const PRESSURE_BAND_HI = 1.5;

export const PRESSURE_MULT_MIN = 0.5;
export const PRESSURE_MULT_MAX = 20;

/**
 * Der Anteil der HP, den eine Welle kosten soll.
 *
 * Eine Funktion der Wellennummer, keine Konstante: dieselbe Zahl steuert den
 * Sollwert des Reglers und den Leck-Spielraum im Überlebbarkeits-Deckel
 * (`survivableCount`). Vorher waren das zwei Zahlen, die gegeneinander
 * arbeiteten — der Deckel rechnete mit festen 6 %, der Regler zielte auf ein
 * Leck-Band, das damit nichts zu tun hatte.
 */
export function targetPressure(waveNumber: number): number {
  const ramp = Math.max(0, Math.min(1, waveNumber / TARGET_RUN_WAVES));
  const shape = PRESSURE_SHAPE_START + (PRESSURE_SHAPE_END - PRESSURE_SHAPE_START) * ramp;
  return BASE_PRESSURE * shape;
}

/**
 * Der Anteil des HP-Bestands, den eine Welle gekostet hat.
 *
 * `hpAtStart` ist der Stand zu Wellenbeginn, nicht das Startmaximum: das ist
 * die Stelle, an der der Regler heilungsfest wird.
 *
 * null, wenn die Welle keine Aussage trägt (kein HP-Stand, kein Gegner).
 * null ist nicht 0: eine Welle ohne Daten als "kostete nichts" zu buchen
 * treibt den Regler auf Beweise, die es nicht gibt.
 */
export function wavePressure(
  hpLost: number,
  hpAtStart: number,
  enemiesSpawned: number,
): number | null {
  if (!Number.isFinite(hpLost) || !Number.isFinite(hpAtStart)) return null;
  if (hpAtStart <= 0 || enemiesSpawned <= 0) return null;
  return Math.max(0, Math.min(1, hpLost / hpAtStart));
}

/** Was der Regler mit der letzten Welle gemacht hat. */
export type PressureStep = 'warming-up' | 'opened' | 'closed' | 'held';

/** Lesender Blick auf den Regler, für den Decision-Explainer. */
export interface PressureStatus {
  multiplier: number;
  /** Wie viele Wellen der geglättete Wert schon gesehen hat. */
  samples: number;
  /** Mittlerer Druck über das Fenster, oder null solange es nicht voll ist. */
  meanPressure: number | null;
  /** Sollwert der zuletzt verarbeiteten Welle. */
  target: number | null;
  lastStep: PressureStep;
}

/**
 * Warum überhaupt geglättet und nicht auf die letzte Welle geregelt:
 *
 * Der Druck ist bimodal. Eine Welle kostet fast nichts, wenn die Abwehr zum
 * Template passt, und 20 bis 30 %, wenn nicht. Auf den Einzelwert zu regeln
 * hieße, bei jeder gepinnten Luftwelle den ganzen Lauf umzustellen.
 *
 * Warum ein Mittel und kein Median: Der Median war der erste Versuch und war
 * zu robust. Er traf verlässlich die harmlose Mitte und meldete "im Band",
 * während der Lauf im Schnitt 12 % je Welle verlor und nach 22 Wellen vorbei
 * war. Die Lauflänge hängt am Erwartungswert, denn nach N Wellen sind
 * (1-p)^N der HP übrig, also ist der Erwartungswert die Größe, die geregelt
 * werden muss.
 */

export class PressureController {
  /** Geglätteter Druck, null bevor die erste Welle gezählt hat. */
  private smoothed: number | null = null;
  private sampleCount = 0;
  private multiplier = 1;
  private lastStep: PressureStep = 'warming-up';
  private lastTarget: number | null = null;

  /** Korrekturfaktor für die Kill-Schätzung in `survivableCount`. */
  get pressureMultiplier(): number {
    return this.multiplier;
  }

  get status(): PressureStatus {
    const ready = this.sampleCount >= PRESSURE_MIN_SAMPLES;
    return {
      multiplier: this.multiplier,
      samples: this.sampleCount,
      meanPressure: ready ? this.smoothed : null,
      target: this.lastTarget,
      lastStep: this.lastStep,
    };
  }

  /** Zustand des Laufs verwerfen. Gehört an den Start eines neuen Spiels. */
  reset(): void {
    this.smoothed = null;
    this.sampleCount = 0;
    this.multiplier = 1;
    this.lastStep = 'warming-up';
    this.lastTarget = null;
  }

  /**
   * Eine abgeschlossene Welle in den Regler falten.
   *
   * @param pressure   Anteil des HP-Bestands, den die Welle gekostet hat, oder
   *                   null, wenn die Welle keine Aussage trägt.
   * @param waveNumber Nummer der Welle, die gerade endete. Sie bestimmt den
   *                   Sollwert und ob der Warmup noch läuft.
   * @param capBinding Hat der Überlebbarkeits-Deckel die Größe dieser Welle
   *                   bestimmt? Wenn nicht, hatte der Multiplikator keine
   *                   Wirkung, und weiter zu öffnen wäre Integrieren gegen
   *                   eine Sättigung (Anti-Windup, siehe unten).
   */
  recordWave(pressure: number | null, waveNumber: number, capBinding = true): number {
    const params = directorParams();
    const target = targetPressure(waveNumber) * params.pressureTargetScale;
    this.lastTarget = target;

    // Die Aufbauwellen messen einen Spieler ohne Türme. Sie kommen nicht
    // einmal ins Fenster, sonst ziehen ihre Verluste den Schnitt über Wellen
    // hinweg nach oben.
    if (waveNumber <= PRESSURE_WARMUP_WAVES) {
      this.lastStep = 'warming-up';
      return this.multiplier;
    }

    // Eine *billige* Welle, deren Größe der Deckel nicht bestimmt hat, ist
    // kein Messwert für seine Einstellung: Sie kam aus der Template-Spanne,
    // der Multiplikator hat sie nicht freigegeben, und dass sie nichts
    // kostete, sagt nichts darüber, ob er zu niedrig steht. Gemessen war das
    // der Grund, warum der Regler die toten Wellen nicht auffüllte — die
    // wenigen sehr großen Wellen aus der Template-Spanne hielten den
    // geglätteten Druck oben, während die Wellen, die er wirklich steuerte,
    // gar nichts kosteten (docs/DRAMA_CONTROLLER_PLAN.md, Runde 9).
    //
    // Eine *teure* zählt dagegen immer, auch ohne bindenden Deckel. Sonst
    // könnte ein Lauf an Wellen sterben, die der Regler nie zu sehen bekommt,
    // und Schließen wirkt auch dann: Es senkt den Deckel, bis er wieder
    // bindet. Die Asymmetrie ist Absicht, die Kosten eines Fehlers sind es
    // auch — zu leicht ist langweilig, zu schwer beendet den Lauf.
    const dangerous = pressure !== null && pressure > target;
    if ((capBinding || dangerous) && pressure !== null && Number.isFinite(pressure)) {
      const value = Math.max(0, Math.min(1, pressure));
      this.smoothed = this.smoothed === null
        ? value
        : PRESSURE_SMOOTHING * value + (1 - PRESSURE_SMOOTHING) * this.smoothed;
      this.sampleCount++;
    }

    if (this.smoothed === null || this.sampleCount < PRESSURE_MIN_SAMPLES) {
      this.lastStep = 'warming-up';
      return this.multiplier;
    }

    const measured = this.smoothed;

    if (measured >= target * PRESSURE_BAND_LO && measured <= target * PRESSURE_BAND_HI) {
      // Im Band kostet die Welle etwas und der Spieler lebt: Zielzustand.
      this.lastStep = 'held';
      return this.multiplier;
    }

    // Logarithmischer Fehler, damit "halb so viel" und "doppelt so viel"
    // gleich schwer wiegen. Der relative Fehler des Vorgängers war nach oben
    // auf +1 begrenzt und nach unten unbegrenzt, also einseitig hart.
    const error = Math.log(target / Math.max(measured, PRESSURE_FLOOR));

    // Anti-Windup. Band der Deckel nicht, war die Welle schon kleiner als er
    // erlaubt hätte: Der Multiplikator hat sie nicht begrenzt, also ist der zu
    // geringe Druck nicht sein Verschulden und weiter zu öffnen wirkungslos.
    // Gemessen lief er so über sechs Wellen von ×1,04 auf ×8,6 und schickte
    // dann 673 Gegner in eine Welle. Schließen bleibt erlaubt: Dafür ist der
    // Deckel immer zuständig.
    if (!capBinding && error > 0) {
      this.lastStep = 'held';
      return this.multiplier;
    }

    const clamped = Math.max(-PRESSURE_MAX_STEP, Math.min(PRESSURE_MAX_STEP, error));
    const step = Math.exp(params.pressureGain * clamped);
    this.multiplier = Math.max(
      PRESSURE_MULT_MIN,
      Math.min(PRESSURE_MULT_MAX, this.multiplier * step),
    );
    this.lastStep = measured < target ? 'opened' : 'closed';
    return this.multiplier;
  }
}
