/**
 * Konfiguration für die GPU-Cubemap-basierte LOS-Visualisierung.
 *
 * Single source of truth für alle Magic-Numbers aus dem Handover-Plan
 * (siehe docs/HANDOVER_ROUTE_GRID_GPU_LOS.md). Werte hier ändern statt
 * im Code patchen.
 */

import { Color } from 'three';

/**
 * Visual appearance pro Cell-State — Farbe + Alpha. Wird sowohl im
 * Cell-Shader (uColor* + uAlpha* Uniforms) als auch in der UI-Legend
 * gerendert.
 */
export interface StateAppearance {
  color: Color;
  alpha: number;
}

export const LOS_VIZ_CONFIG = {
  /**
   * Cubemap-Auflösung (pro Face). 512² → ~6 MB VRAM pro Mapper,
   * 5.7 px/° Sample-Dichte. Reicht für photorealistische 3DTiles-Meshes.
   */
  cubeSize: 512,

  /**
   * Mindestbewegung des Tower-Tips bevor die Cubemap neu gerendert wird.
   * Verhindert Verschwendung bei Sub-Pixel-Cursor-Wiggle im Build-Preview.
   */
  cubeUpdateMoveThreshold: 0.5,

  /**
   * Y-Offset für Air-Sample-Punkt über `cell.terrainHeight`. Festes
   * Modell statt skyline-adaptiv (v2-Decision 2026-05-13).
   */
  airSampleYOffset: 15,

  /**
   * Y-Offset für Ground-Sample-Punkt über `cell.terrainHeight`. Etwas über
   * 0 damit der Strahl nicht im Boden-Mesh startet (Self-Hit).
   */
  groundSampleYOffset: 1.5,

  /**
   * Visibility-Bias: Cell gilt als sichtbar wenn ihre Distanz zum Tower
   * kleiner ist als die Cubemap-Distanz minus Bias. Deckt Sub-Pixel-
   * Mismatch am Range-Rand ab.
   */
  visibilityBiasMeters: 0.5,

  /**
   * Cubemap-Distance unter diesem Wert wird als "leerer Texel" (kein
   * Geometrie-Treffer) interpretiert und auf 1.0 (= farDistance) gesetzt.
   * Schutz gegen Clear-Color-Leaks und Pack-Edge-Cases.
   */
  emptyDepthEpsilon: 0.001,

  /**
   * Universelle Cell-Palette — single source of truth. Eine Farbe = eine
   * Bedeutung über ALLE Modi (per-Tower-Viz, globaler Aggregate-Viz,
   * Legend). Kein Re-Use einer Farbe mit anderer Semantik pro Modus.
   *  - both       — Ground UND Air covered (gold)
   *  - groundOnly — nur Ground covered (grün)
   *  - airOnly    — nur Air covered (blau)
   *  - neither    — (per-Tower only) in Range aber blockiert (rot)
   */
  states: {
    both:       { color: new Color(0.85, 0.72, 0.25), alpha: 0.55 } as StateAppearance,
    groundOnly: { color: new Color(0.35, 0.70, 0.52), alpha: 0.45 } as StateAppearance,
    airOnly:    { color: new Color(0.30, 0.55, 0.95), alpha: 0.45 } as StateAppearance,
    neither:    { color: new Color(0.70, 0.35, 0.35), alpha: 0.25 } as StateAppearance,
  },

  /**
   * Zusätzliche States für das globale Debug-Route-Grid. Werden NICHT
   * vom per-Tower-Viz genutzt:
   *  - `uncovered` für Cells die von KEINEM Tower erreicht werden
   *    (≠ `neither` aus dem per-Tower-Viz, wo rot "in Reichweite aber
   *    blockiert" bedeutet — im Aggregat heißt "kein Tower in Range",
   *    also neutral grau).
   *  - `enemyInCell` / `enemyVisible` für Aggregat-Information über
   *    Enemy-Belegung.
   */
  globalStates: {
    /** Cell von keinem Tower in Range / aktiv abgedeckt. */
    uncovered:     { color: new Color(0.60, 0.60, 0.63), alpha: 0.15 } as StateAppearance,
    /** Enemy in Cell, aber kein Tower sieht ihn. */
    enemyInCell:   { color: new Color(0.55, 0.35, 0.75), alpha: 0.55 } as StateAppearance,
    /** Enemy in Cell + mindestens ein Tower sieht die Cell. */
    enemyVisible:  { color: new Color(0.85, 0.72, 0.25), alpha: 0.65 } as StateAppearance,
  },

  /** Plattendicke der Cell-Mesh (m). 0.02 = kaum sichtbare Höhe. */
  cellHeightMeters: 0.02,

  /** Y-Offset über Boden (m), gegen Z-Fighting. depthTest ist off. */
  cellYOffset: 0.05,

  /** Pulse-Frequenz und -Tiefe des Alphas. */
  pulseSpeed: 2.0,
  pulseDepth: 0.05,

  /**
   * Air-Cells overlay — zweite Plate pro Cell auf
   * `terrainHeight + airSampleYOffset`. Identische Textur zur Ground-
   * Plate; unterscheidbar nur durch die Y-Höhe + die Layer-spezifische
   * Farb-Interpretation (blau = air, grün = ground).
   */
  airCells: {
    /** Alpha-Multiplikator für die Air-Plate. 1.0 = identisch zu Ground. */
    alphaScale: 1.0,
  },

  /**
   * Air-Route-Tube — globaler Debug-Layer der die ENEMY-Routen auf der
   * Air-Flughöhe (= `terrainHeight + airSampleYOffset`) anzeigt. Toggle
   * via QuickActions. Bewusst farblich vom 4-State-Palette getrennt
   * (Magenta) und gestrichelt damit man "Pfad" vs "Wand" sofort sieht.
   */
  airRouteTube: {
    /** Cylinder-Radius (m). */
    radius: 0.55,
    /** Sub-Samples zwischen Waypoints — denser = smoother polyline. */
    samplesPerWaypoint: 4,
    /** Tube-Farbe. */
    color: new Color(1.0, 0.0, 0.67),  // magenta/pink
    /** Streifen-Frequenz entlang der Tube (period per meter). */
    dashFrequency: 0.6,
    /** Anteil "an" pro Streifen-Periode (0.5 = symmetrisch). */
    dashDuty: 0.55,
    /** Render-Opacity bei "an"-Streifen. */
    opacityOn: 0.9,
    /** Render-Opacity bei "aus"-Streifen (>0 für sanfteres Pattern). */
    opacityOff: 0.05,
  },
} as const;
