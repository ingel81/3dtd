/**
 * The adaptive wave source: the director this game has played since the
 * balancing rebuild. Rules pick the template and four factors, the shared
 * path sizes the wave, and a closed loop on the pressure a wave costs
 * corrects the survivability cap.
 *
 * Everything in this folder belongs to it. What it reads from outside is the
 * state snapshot, the templates and the campaign, all of which are shared
 * with every other source (docs/WAVE_SOURCE_PLAN.md).
 *
 * Why it plans at wave start: its size comes from the defense as it stands
 * when the wave begins, so committing a wave earlier would size it against a
 * defense the player is still building. A source whose waves are written down
 * has no such problem and declares `wave-end` instead.
 *
 * Why rules and no model: measured across a day of A/B runs sharing the same
 * bots, campaign and fairness gate, a trained policy was three times
 * statistically indistinguishable from uniform random sampling, so the ONNX
 * path was removed with the rest of the training stack (BALANCING_PLAN.md,
 * Phase 1a). `director-rules.ts` carries the numbers.
 */

import type {
  PlannedWave,
  WavePeekFacts,
  WavePeekRequest,
  WavePlanRequest,
  WavePlanTiming,
  WaveSource,
  WaveSourceId,
} from '../../wave-source';
import type { WaveResult } from '../../models/wave-result';
import type { GameStateSnapshot } from '../../models/game-state-snapshot';
import { type CandidateReason, type Template } from '../../templates';
import { dpsScaledCountMax } from './wave-sizing';
import {
  isBossWave,
  templateObjectForWave,
  CAMPAIGN_LENGTH,
  BOSS_WAVE_INTERVAL_AFTER_CAMPAIGN,
} from '../../../configs/campaign.config';
import {
  bossVariantForWave,
  bossVariantWave,
  type BossVariant,
} from '../../../configs/boss-variants.config';
import { ENEMY_TYPES, type EnemyTypeId } from '../../../configs/enemy-types.config';
import type { ArmorType } from '../../../configs/combat/combat.types';
import { buildWaveContext } from './wave-context';
import { decideWave, type DirectorDecision, type TieBreak } from './director-rules';
import { PressureController, wavePressure } from './pressure-controller';
import { buildWaveConfig } from './wave-config-builder';
import { capIsBinding } from './decision-explainer';

/** Templates the cooldown remembers. */
const TEMPLATE_HISTORY = 5;

export class AdaptiveWaveSource implements WaveSource {
  readonly id: WaveSourceId = 'adaptive';
  readonly name = 'Adaptive director';
  readonly plansAt: WavePlanTiming = 'wave-start';

  /**
   * The pressure loop. Public because a bot batch's A/B reads its multiplier
   * and the decision explainer prints its status; nothing outside this folder
   * writes to it.
   */
  readonly pressure = new PressureController();

  /** Recently shipped template indices, oldest first (the reuse cooldown). */
  private recentTemplateIndices: number[] = [];

  /**
   * Did the cap bind on the wave planned last?
   *
   * The loop gets it when that wave finishes, as its anti-windup. It lives
   * here rather than in the controller because only the planning path knows
   * what decided the size of the wave in the end.
   */
  private lastCapBinding = true;

  plan(request: WavePlanRequest): PlannedWave {
    const { wave, state, random } = request;
    const context = buildWaveContext(state, this.recentTemplateIndices, wave);
    const decision = decideWave(
      context.candidates,
      wave,
      this.recentTemplateIndices,
      random,
      this.tieBreak(context.headroomByTemplate),
    );
    return this.ship(decision, state, wave, context.candidateReason);
  }

  /**
   * NEXT in the wave panel: what is known about the coming waves.
   *
   * Inside the campaign the template is pinned, so the wave is known; past it
   * a boss wave the rotation owns is known and everything else is not, since
   * this source picks the template when the wave starts. `request.defense`
   * only narrows the count of a known template.
   *
   * Narrowing the candidates past the campaign would need the template history
   * of waves that have not been planned yet, so it is not attempted: a wrong
   * wave in front of the player is worse than an honest "not known yet".
   */
  peek(request: WavePeekRequest): WavePeekFacts[] {
    const facts: WavePeekFacts[] = [];
    for (let wave = request.fromWave; wave < request.fromWave + request.count; wave++) {
      const template = templateObjectForWave(wave);
      if (template) {
        facts.push(templateFacts(wave, template, request.defense.totalDps));
        continue;
      }
      const variant = bossVariantForWave(wave);
      facts.push(variant ? variantFacts(wave, variant) : unknownFacts(wave));
    }
    return facts;
  }

  onWaveResult(result: WaveResult): void {
    // The loop that sizes the next wave has to see every completed wave.
    // null, not 0: a wave that carries no HP reading is no evidence either way.
    const pressure = wavePressure(
      result.outcome.damageToPlayer ?? 0,
      result.outcome.healthAtWaveStart ?? 0,
      result.outcome.enemiesSpawned ?? 0,
    );
    this.pressure.recordWave(pressure, result.waveNumber, this.lastCapBinding);
  }

  /**
   * Per-run state. Letting the multiplier survive into the next game made it
   * a ratchet that opened fresh runs against waves sized for a defense that
   * had already been dismantled: median run length 6 waves against a target
   * of 80.
   */
  reset(): void {
    this.pressure.reset();
    this.lastCapBinding = true;
    this.recentTemplateIndices = [];
  }

  /**
   * The loop's third handle: the choice among equally stale templates.
   *
   * Cap and count factor set how BIG a wave gets. What they cannot do is the
   * spread: a template the defense covers costs nothing even when it is big,
   * and one it does not costs plenty even when it is small. That is where the
   * dead zone comes from, the loop hitting the mean while the run stays jagged
   * (docs/DRAMA_CONTROLLER_PLAN.md, round 12).
   *
   * With the loop on "too easy" the player gets the candidate their defense
   * stands worst against, and the other way round. While it holds, chance
   * decides: in the target state nothing should be nudged.
   */
  private tieBreak(headroom: ReadonlyMap<number, number>): TieBreak | null {
    const step = this.pressure.status.lastStep;
    if (step === 'opened') return { prefer: 'harder', headroom };
    if (step === 'closed') return { prefer: 'easier', headroom };
    return null;
  }

  /**
   * The wave a decision describes. Its template goes into the cooldown
   * history, and past the campaign a boss variant may take its place: the
   * rotation sends bosses the templates do not know (Skarnax, the ooze). That
   * substitution belongs to the source, not to the caller, or "which wave
   * comes next" would be decided in two places.
   */
  private ship(
    decision: DirectorDecision,
    state: GameStateSnapshot,
    wave: number,
    candidateReason: CandidateReason,
  ): PlannedWave {
    const directed = buildWaveConfig(decision, state, candidateReason, this.pressure, wave);
    const sizing = directed.explanation?.sizing;
    this.lastCapBinding = sizing ? capIsBinding(sizing) : true;
    this.recentTemplateIndices.push(directed.templateIdx);
    if (this.recentTemplateIndices.length > TEMPLATE_HISTORY) {
      this.recentTemplateIndices.shift();
    }

    const variant = bossVariantForWave(wave);
    const config = variant
      ? { ...bossVariantWave(variant, directed, wave), templateIdx: directed.templateIdx }
      : directed;

    return {
      wave,
      config,
      explanation: config.explanation ?? null,
      log: {
        // The cap of the wave that ships: a boss variant is not sized by it.
        survivableCount: config.explanation?.sizing?.cap ?? null,
        pressureMultiplier: this.pressure.pressureMultiplier,
        targetPressure: this.pressure.status.target ?? undefined,
      },
    };
  }
}

/** HP each armor type brings, so the UI can answer "weak to". */
function hpByArmorOf(enemies: readonly (readonly [string, number])[]): [ArmorType, number][] {
  const byArmor = new Map<ArmorType, number>();
  for (const [enemyId, share] of enemies) {
    const cfg = ENEMY_TYPES[enemyId as EnemyTypeId];
    if (!cfg) continue;
    byArmor.set(cfg.armorType, (byArmor.get(cfg.armorType) ?? 0) + share * cfg.baseHp);
  }
  return [...byArmor];
}

function hasAir(enemies: readonly (readonly [string, number])[]): boolean {
  return enemies.some(([id]) => ENEMY_TYPES[id as EnemyTypeId]?.isAirUnit === true);
}

function templateFacts(wave: number, template: Template, totalDps: number): WavePeekFacts {
  const hpByArmor = hpByArmorOf(template.enemies);
  const [lo, full] = template.countRange;
  const hi = Math.round(dpsScaledCountMax(template.countRange, totalDps));
  return {
    wave,
    name: template.name,
    known: true,
    boss: template.bossOnly,
    air: hasAir(template.enemies),
    armors: hpByArmor.map(([armor]) => armor),
    hpByArmor,
    // `hi` is what this defense opens up, `max` what the template allows;
    // the UI words the difference.
    count: { lo, hi, max: full },
    enemies: template.enemies,
    note: '',
    description: template.description,
  };
}

/** A boss wave the rotation gives to a variant: known ahead, unlike a pick. */
function variantFacts(wave: number, variant: BossVariant): WavePeekFacts {
  const cfg = ENEMY_TYPES[variant.enemyType];
  const hpByArmor: [ArmorType, number][] = [[cfg.armorType, 1]];
  return {
    wave,
    name: variant.name,
    known: true,
    boss: true,
    air: cfg.isAirUnit === true,
    armors: [cfg.armorType],
    hpByArmor,
    count: null,
    enemies: [[variant.enemyType, 1]],
    note: '',
    description: `${variant.description} `
      + `Past W${CAMPAIGN_LENGTH} some boss waves go to bosses the director does not pick.`,
  };
}

/** Past the campaign: only whether it is a boss wave is known. */
function unknownFacts(wave: number): WavePeekFacts {
  const boss = isBossWave(wave);
  let nextBoss = wave + 1;
  while (!isBossWave(nextBoss)) nextBoss++;
  return {
    wave,
    name: boss ? 'Boss wave' : "Director's pick",
    known: false,
    boss,
    air: false,
    armors: [],
    hpByArmor: [],
    count: null,
    enemies: [],
    note: 'Template picked at wave start',
    description: boss
      ? `From W${CAMPAIGN_LENGTH + 1} every ${BOSS_WAVE_INTERVAL_AFTER_CAMPAIGN}th wave is a boss wave. `
        + 'The director picks which boss when the wave starts.'
      : `Past W${CAMPAIGN_LENGTH} the director picks the template when the wave starts, so its enemies are `
        + `not known yet. Next boss wave: W${nextBoss}.`,
  };
}
