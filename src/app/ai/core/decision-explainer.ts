/**
 * Decision Explainer
 *
 * Generates human-readable explanations for AI wave decisions.
 * Used for debugging during development and as optional debug overlay in production.
 */

import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';

export interface DecisionExplanation {
  /** One-line summary */
  summary: string;

  /** Detailed reasoning points */
  reasons: string[];

  /** Key factors that influenced the decision */
  factors: DecisionFactor[];

  /** Confidence level (0-1) */
  confidence: number;

  /** Phase 5.10 Template metadata (when AI picked a template) */
  templateName?: string;
  templateStrength?: number;
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
    templateName: config.templateName,
    templateStrength: config.templateStrength,
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
      name: 'Tower count',
      value: `${defense.towerCount} (low)`,
      impact: 'negative',
      weight: 0.8,
    });
    reasons.push('Few towers placed, defense still weak');
  } else if (defense.towerCount > 10) {
    factors.push({
      name: 'Tower count',
      value: `${defense.towerCount} (strong)`,
      impact: 'positive',
      weight: 0.6,
    });
  }

  // DPS
  if (defense.totalDPS > 500) {
    factors.push({
      name: 'Total DPS',
      value: `${Math.round(defense.totalDPS)}`,
      impact: 'positive',
      weight: 0.7,
    });
    reasons.push('High DPS, stronger enemies needed');
  } else if (defense.totalDPS < 100) {
    factors.push({
      name: 'Total DPS',
      value: `${Math.round(defense.totalDPS)} (low)`,
      impact: 'negative',
      weight: 0.7,
    });
  }

  // Path coverage
  if (defense.pathCoverage < 0.5) {
    factors.push({
      name: 'Path coverage',
      value: `${Math.round(defense.pathCoverage * 100)}%`,
      impact: 'negative',
      weight: 0.6,
    });
    reasons.push('Parts of the path are unprotected');
  }

  // Kill zone
  if (defense.killZoneStrength > 0.5) {
    factors.push({
      name: 'Kill zone',
      value: 'Strong',
      impact: 'positive',
      weight: 0.5,
    });
    reasons.push('Strong kill zone detected, avoid concentrating there');
  }

  // Tower variety
  if (defense.towerVariety < 0.3) {
    factors.push({
      name: 'Tower variety',
      value: 'One-sided',
      impact: 'neutral',
      weight: 0.4,
    });
    reasons.push('Little tower variety, can be exploited');
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
      name: 'Air defense',
      value: 'Missing!',
      impact: 'negative',
      weight: 0.9,
    });

    // Check if we're exploiting this
    const hasAirEnemies = config.enemies.some((e) => e.type === 'bat');
    if (hasAirEnemies) {
      reasons.push('No anti-air towers -> sending flying enemies');
    } else {
      reasons.push('No anti-air towers (will be exploited soon)');
    }
  }

  if (vulnerabilities.splashGap) {
    factors.push({
      name: 'Splash damage',
      value: 'Missing',
      impact: 'negative',
      weight: 0.7,
    });

    if (config.templateName?.toLowerCase().includes('swarm') || config.templateName?.toLowerCase().includes('tide')) {
      reasons.push('No splash damage -> sending a swarm');
    }
  }

  if (vulnerabilities.slowGap) {
    factors.push({
      name: 'Slow effect',
      value: 'Missing',
      impact: 'negative',
      weight: 0.6,
    });

    if (config.templateName?.toLowerCase().includes('rush')) {
      reasons.push('No slow towers -> sending fast enemies');
    }
  }

  // Overall vulnerability
  if (vulnerabilities.overallVulnerability > 0.6) {
    factors.push({
      name: 'Overall vulnerability',
      value: 'High',
      impact: 'negative',
      weight: 0.8,
    });
    reasons.push('Defense has several weak spots');
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
      name: 'Win streak',
      value: `${recentHistory.winStreak} waves`,
      impact: 'positive',
      weight: 0.7,
    });
    reasons.push(`${recentHistory.winStreak} waves without damage, raising difficulty`);
  }

  // Close call streak (mercy system)
  if (recentHistory.closeCallStreak >= 2) {
    factors.push({
      name: 'Close calls',
      value: `${recentHistory.closeCallStreak}× close`,
      impact: 'negative',
      weight: 0.8,
    });
    reasons.push('Player is struggling, sending an easier wave (mercy)');
  }

  // Recent damage trend
  const damages = recentHistory.damagePerWave;
  if (damages.length >= 3) {
    const recent = damages.slice(-3);
    const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;

    if (avgRecent > 0.3) {
      factors.push({
        name: 'Damage trend',
        value: `${Math.round(avgRecent * 100)}% avg`,
        impact: 'negative',
        weight: 0.6,
      });
    } else if (avgRecent === 0) {
      factors.push({
        name: 'Damage trend',
        value: 'No damage',
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
  const totalEnemies = config.totalCount;
  const templateName = config.templateName ?? 'Template';
  const strengthPart = config.templateStrength !== undefined
    ? ` (strength ${config.templateStrength.toFixed(2)}×)`
    : '';
  return `Wave ${wave}: ${templateName}${strengthPart} · ${totalEnemies} enemies`;
}

/**
 * Format explanation for UI display
 */
export function formatExplanationForUI(explanation: DecisionExplanation): string {
  const lines: string[] = [];

  lines.push(`=== ${explanation.summary} ===`);
  lines.push('');

  if (explanation.templateName) {
    const strength = explanation.templateStrength !== undefined
      ? ` (${explanation.templateStrength.toFixed(2)}×)`
      : '';
    lines.push(`Template: ${explanation.templateName}${strength}`);
  }

  lines.push(`Confidence: ${Math.round(explanation.confidence * 100)}%`);
  lines.push('');

  if (explanation.reasons.length > 0) {
    lines.push('Reasons:');
    for (const reason of explanation.reasons) {
      lines.push(`  • ${reason}`);
    }
    lines.push('');
  }

  if (explanation.factors.length > 0) {
    lines.push('Factors:');
    for (const factor of explanation.factors) {
      const icon =
        factor.impact === 'positive' ? '+' : factor.impact === 'negative' ? '-' : '•';
      lines.push(`  ${icon} ${factor.name}: ${factor.value}`);
    }
  }

  return lines.join('\n');
}
