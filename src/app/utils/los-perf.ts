/**
 * Leichtgewichtiger Profiler für die GPU-LOS-Pipeline.
 *
 * Sammelt pro Phase (Sample) Min/Max/Avg über ein 1-Sekunden-Fenster
 * und loggt einmal pro Sekunde eine Zeile in die Console. Optional kann
 * pro Sample noch ein Counter mitgegeben werden (z.B. Tiles gesehen
 * beim Cube-Render).
 *
 * Default: an. Toggle via `losPerf.enabled = false` oder über
 * `window.losPerfDisable()` (im DevTools-Console-Aufruf).
 *
 * Bewusst minimal — soll selbst keinen messbaren Overhead haben (eine
 * Push pro Sample, alles in primitive Arrays, kein performance.measure
 * für die Aggregate, nur performance.now()).
 */

interface PhaseStats {
  samples: number[];
  counts: number[];
}

class LosPerf {
  /**
   * Default: aus. Im DevTools-Console mit `losPerfEnable()` aktivieren
   * wenn ein FPS-Drop / Hickup im LOS-Pfad debuggt werden soll.
   */
  enabled = false;
  private readonly phases = new Map<string, PhaseStats>();
  private windowStart = performance.now();
  private static readonly WINDOW_MS = 1000;

  /**
   * Eine Sample-Messung in das aktuelle Fenster aufnehmen.
   * @param phase Symbolischer Name (z.B. "cube", "mesh-build")
   * @param ms Dauer in Millisekunden
   * @param count Optionaler Counter (Tiles, Cells, …) für Kontext
   */
  sample(phase: string, ms: number, count = 0): void {
    if (!this.enabled) return;
    let p = this.phases.get(phase);
    if (!p) {
      p = { samples: [], counts: [] };
      this.phases.set(phase, p);
    }
    p.samples.push(ms);
    p.counts.push(count);

    const now = performance.now();
    if (now - this.windowStart >= LosPerf.WINDOW_MS) {
      this.flush();
      this.windowStart = now;
    }
  }

  /** Wrappt eine synchrone Funktion mit timing. */
  measure<T>(phase: string, fn: () => T, countAfter?: (result: T) => number): T {
    if (!this.enabled) return fn();
    const t0 = performance.now();
    const result = fn();
    const dt = performance.now() - t0;
    this.sample(phase, dt, countAfter ? countAfter(result) : 0);
    return result;
  }

  private flush(): void {
    if (this.phases.size === 0) return;
    const parts: string[] = [];
    // Sortierte Ausgabe, lange Phasen zuerst (= dominante Kostenpunkte).
    const entries = [...this.phases.entries()];
    entries.sort((a, b) => avg(b[1].samples) - avg(a[1].samples));
    for (const [phase, stats] of entries) {
      const avgMs = avg(stats.samples);
      const maxMs = Math.max(...stats.samples);
      const n = stats.samples.length;
      const totalMs = sum(stats.samples);
      let suffix = '';
      if (stats.counts.some(c => c > 0)) {
        const avgCount = avg(stats.counts);
        suffix = ` [n=${avgCount.toFixed(0)}]`;
      }
      parts.push(
        `${phase}: avg=${avgMs.toFixed(2)}ms max=${maxMs.toFixed(2)}ms ` +
        `total=${totalMs.toFixed(1)}ms/s calls=${n}${suffix}`
      );
    }
     
    console.log('[LOS-PERF]', parts.join(' | '));
    this.phases.clear();
  }
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function sum(arr: number[]): number {
  let s = 0;
  for (const v of arr) s += v;
  return s;
}

/** Singleton — vom Aufrufer per Import einfach genutzt. */
export const losPerf = new LosPerf();

// Globaler Toggle, damit man im DevTools-Console schnell ab/anschalten kann.
declare global {
  interface Window {
    losPerfDisable: () => void;
    losPerfEnable: () => void;
  }
}
if (typeof window !== 'undefined') {
  window.losPerfDisable = () => { losPerf.enabled = false; };
  window.losPerfEnable = () => { losPerf.enabled = true; };
}
