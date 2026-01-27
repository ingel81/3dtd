/**
 * Decision Explainer
 *
 * Generates human-readable explanations for AI wave decisions.
 * Used for debugging during development and as optional debug overlay in production.
 */

import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveConfig, WaveArchetype, getArchetypeDescription } from './models/wave-config';

export interface DecisionExplanation {
  /** One-line summary */
  summary: string;

  /** Detailed reasoning points */
  reasons: string[];

  /** Key factors that influenced the decision */
  factors: DecisionFactor[];

  /** Confidence level (0-1) */
  confidence: number;

  /** Archetype chosen */
  archetype?: WaveArchetype;
}

export interface DecisionFactor {
  name: string;
  value: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number; // 0-1 importance
}

/**
 * Generate explanation for a wave decision
 */
export function explainWaveDecision(
  state: GameStateSnapshot,
  config: WaveConfig
): DecisionExplanation {
  const factors: DecisionFactor[] = [];
  const reasons: string[] = [];

  // Analyze defense state
  analyzeDefense(state, factors, reasons);

  // Analyze vulnerabilities
  analyzeVulnerabilities(state, config, factors, reasons);

  // Analyze recent history
  analyzeHistory(state, factors, reasons);

  // Generate summary
  const summary = generateSummary(state, config, reasons);

  return {
    summary,
    reasons,
    factors,
    confidence: config.confidence ?? 0.7,
    archetype: config.archetype,
  };
}

/**
 * Analyze defense and add factors
 */
function analyzeDefense(
  state: GameStateSnapshot,
  factors: DecisionFactor[],
  reasons: string[]
): void {
  const { defense } = state;

  // Tower count
  if (defense.towerCount < 3) {
    factors.push({
      name: 'Tower-Anzahl',
      value: `${defense.towerCount} (niedrig)`,
      impact: 'negative',
      weight: 0.8,
    });
    reasons.push('Wenige Tower platziert - Defense noch schwach');
  } else if (defense.towerCount > 10) {
    factors.push({
      name: 'Tower-Anzahl',
      value: `${defense.towerCount} (stark)`,
      impact: 'positive',
      weight: 0.6,
    });
  }

  // DPS
  if (defense.totalDPS > 500) {
    factors.push({
      name: 'Gesamt-DPS',
      value: `${Math.round(defense.totalDPS)}`,
      impact: 'positive',
      weight: 0.7,
    });
    reasons.push('Hoher DPS - Staerkere Gegner noetig');
  } else if (defense.totalDPS < 100) {
    factors.push({
      name: 'Gesamt-DPS',
      value: `${Math.round(defense.totalDPS)} (niedrig)`,
      impact: 'negative',
      weight: 0.7,
    });
  }

  // Path coverage
  if (defense.pathCoverage < 0.5) {
    factors.push({
      name: 'Pfad-Abdeckung',
      value: `${Math.round(defense.pathCoverage * 100)}%`,
      impact: 'negative',
      weight: 0.6,
    });
    reasons.push('Teile des Pfads sind ungeschuetzt');
  }

  // Kill zone
  if (defense.killZoneStrength > 0.5) {
    factors.push({
      name: 'Kill-Zone',
      value: 'Stark',
      impact: 'positive',
      weight: 0.5,
    });
    reasons.push('Starke Kill-Zone erkannt - vermeide Konzentration dort');
  }

  // Tower variety
  if (defense.towerVariety < 0.3) {
    factors.push({
      name: 'Tower-Vielfalt',
      value: 'Einseitig',
      impact: 'neutral',
      weight: 0.4,
    });
    reasons.push('Wenig Tower-Vielfalt - kann ausgenutzt werden');
  }
}

/**
 * Analyze vulnerabilities
 */
function analyzeVulnerabilities(
  state: GameStateSnapshot,
  config: WaveConfig,
  factors: DecisionFactor[],
  reasons: string[]
): void {
  const { vulnerabilities } = state;

  if (vulnerabilities.airDefenseGap) {
    factors.push({
      name: 'Luft-Abwehr',
      value: 'Fehlt!',
      impact: 'negative',
      weight: 0.9,
    });

    // Check if we're exploiting this
    const hasAirEnemies = config.enemies.some((e) => e.type === 'bat');
    if (hasAirEnemies) {
      reasons.push('Keine Anti-Air Tower -> Sende Fluegel-Gegner');
    } else {
      reasons.push('Keine Anti-Air Tower (wird bald ausgenutzt)');
    }
  }

  if (vulnerabilities.splashGap) {
    factors.push({
      name: 'Splash-Damage',
      value: 'Fehlt',
      impact: 'negative',
      weight: 0.7,
    });

    if (config.archetype === 'swarm') {
      reasons.push('Kein Splash-Damage -> Sende Schwarm');
    }
  }

  if (vulnerabilities.slowGap) {
    factors.push({
      name: 'Slow-Effekt',
      value: 'Fehlt',
      impact: 'negative',
      weight: 0.6,
    });

    if (config.archetype === 'rush') {
      reasons.push('Keine Slow-Tower -> Sende schnelle Gegner');
    }
  }

  // Overall vulnerability
  if (vulnerabilities.overallVulnerability > 0.6) {
    factors.push({
      name: 'Gesamt-Verwundbarkeit',
      value: 'Hoch',
      impact: 'negative',
      weight: 0.8,
    });
    reasons.push('Defense hat mehrere Schwachstellen');
  }
}

/**
 * Analyze recent history
 */
function analyzeHistory(
  state: GameStateSnapshot,
  factors: DecisionFactor[],
  reasons: string[]
): void {
  const { recentHistory } = state;

  // Win streak
  if (recentHistory.winStreak >= 3) {
    factors.push({
      name: 'Win-Streak',
      value: `${recentHistory.winStreak} Wellen`,
      impact: 'positive',
      weight: 0.7,
    });
    reasons.push(`${recentHistory.winStreak} Wellen ohne Schaden - erhoehe Schwierigkeit`);
  }

  // Close call streak (mercy system)
  if (recentHistory.closeCallStreak >= 2) {
    factors.push({
      name: 'Close-Calls',
      value: `${recentHistory.closeCallStreak}× knapp`,
      impact: 'negative',
      weight: 0.8,
    });
    reasons.push('Spieler kaempft - gebe leichtere Welle (Mercy)');
  }

  // Recent damage trend
  const damages = recentHistory.damagePerWave;
  if (damages.length >= 3) {
    const recent = damages.slice(-3);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;

    if (avgRecent > 0.3) {
      factors.push({
        name: 'Schadens-Trend',
        value: `${Math.round(avgRecent * 100)}% avg`,
        impact: 'negative',
        weight: 0.6,
      });
    } else if (avgRecent === 0) {
      factors.push({
        name: 'Schadens-Trend',
        value: 'Kein Schaden',
        impact: 'positive',
        weight: 0.6,
      });
    }
  }
}

/**
 * Generate summary sentence
 */
function generateSummary(
  state: GameStateSnapshot,
  config: WaveConfig,
  _reasons: string[]
): string {
  const wave = state.waveNumber;

  // Archetype description
  const archetypeDesc = config.archetype
    ? getArchetypeDescription(config.archetype)
    : 'Gemischte Welle';

  // Count summary
  const totalEnemies = config.totalCount;

  // Build summary
  let summary = `Welle ${wave}: ${archetypeDesc}`;
  summary += ` (${totalEnemies} Gegner)`;

  return summary;
}

/**
 * Format explanation for UI display
 */
export function formatExplanationForUI(explanation: DecisionExplanation): string {
  const lines: string[] = [];

  lines.push(`=== ${explanation.summary} ===`);
  lines.push('');

  if (explanation.archetype) {
    lines.push(`Typ: ${explanation.archetype.toUpperCase()}`);
  }

  lines.push(`Konfidenz: ${Math.round(explanation.confidence * 100)}%`);
  lines.push('');

  if (explanation.reasons.length > 0) {
    lines.push('Gruende:');
    for (const reason of explanation.reasons) {
      lines.push(`  • ${reason}`);
    }
    lines.push('');
  }

  if (explanation.factors.length > 0) {
    lines.push('Faktoren:');
    for (const factor of explanation.factors) {
      const icon =
        factor.impact === 'positive' ? '+' : factor.impact === 'negative' ? '-' : '•';
      lines.push(`  ${icon} ${factor.name}: ${factor.value}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get short explanation (for HUD overlay)
 */
export function getShortExplanation(explanation: DecisionExplanation): string {
  if (explanation.reasons.length === 0) {
    return explanation.summary;
  }

  return `${explanation.summary}\n${explanation.reasons[0]}`;
}
