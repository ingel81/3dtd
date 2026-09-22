/**
 * Wave Templates — what a wave can be made of.
 *
 * Each template defines the CHARACTER of a wave (enemy mix, campaign gate,
 * capability requirement, spawn pattern) plus RANGES for 4 dynamic parameters:
 * count, spawn_delay_ms, hp_mult, variation.
 *
 * Shared by every wave source: the templates are the game's content, not one
 * source's rule. How a source turns ranges into numbers lives with it
 * (`sources/adaptive/wave-sizing.ts`), which is why the survivability cap and
 * the DPS ramp are no longer here (docs/WAVE_SOURCE_PLAN.md, section 4).
 *
 * Slots 0-21 are active, slots 22-31 are free for new templates. New
 * templates are appended, so existing slots keep their index.
 */

export type TemplateSpawnPattern = 'interleaved' | 'sequential' | 'clustered' | null;
export type TemplateCapability = 'antiAir' | 'antiEthereal' | null;
export type NumberRange = readonly [number, number];

export interface Template {
  id: string;
  name: string;
  description: string;
  enemies: readonly (readonly [string, number])[];
  countRange: NumberRange;
  spawnDelayRange: NumberRange;
  hpMultRange: NumberRange;
  variationRange: NumberRange;
  minWave: number;
  spawnPattern: TemplateSpawnPattern;
  requires: TemplateCapability;
  bossOnly: boolean;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'zombie_horde',
    name: 'Zombie Horde',
    description: 'Unarmored zombies. Starts gentle, ends as a mega-swarm.',
    // zombie-v2 stays a garnish rather than half the horde: at the top of the
    // count range (2000) it is measurably more expensive to render than the
    // classic zombie, and this template is the mega-swarm slot.
    enemies: [['zombie', 0.9], ['zombie-v2', 0.1]],
    countRange: [20, 2000],
    spawnDelayRange: [15, 400],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.05, 0.40],
    minWave: 1,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'rat_tide',
    name: 'Rat Tide',
    description: 'A flood of rats, anywhere from 100 to 5000.',
    enemies: [['rat', 1.0]],
    countRange: [100, 5000],
    spawnDelayRange: [10, 200],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.05, 0.30],
    minWave: 8,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'penguin_rush',
    name: 'Penguin Rush',
    description: 'Fast penguins, with rats filling the gaps.',
    enemies: [['penguin', 0.9], ['rat', 0.1]],
    countRange: [30, 500],
    spawnDelayRange: [10, 300],
    hpMultRange: [0.5, 4.0],
    variationRange: [0.05, 0.35],
    minWave: 5,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'light_mix',
    name: 'Light Mix',
    description: 'Wallsmashers and spiders.',
    enemies: [['wallsmasher', 0.5], ['spider', 0.5]],
    countRange: [30, 400],
    spawnDelayRange: [30, 500],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.05, 0.40],
    minWave: 4,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'spider_swarm',
    name: 'Spider Swarm',
    description: 'A flood of spiders.',
    enemies: [['spider', 1.0]],
    countRange: [50, 800],
    spawnDelayRange: [20, 350],
    hpMultRange: [0.5, 4.0],
    variationRange: [0.05, 0.35],
    minWave: 8,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'wallsmasher_crew',
    name: 'Wallsmasher Crew',
    description: 'Wallsmashers only. All health, no tricks.',
    enemies: [['wallsmasher', 1.0]],
    countRange: [15, 200],
    spawnDelayRange: [50, 600],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.10, 0.40],
    minWave: 6,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'bat_swarm',
    name: 'Bat Swarm',
    description: 'Bat swarm. Needs anti-air.',
    enemies: [['bat', 1.0]],
    countRange: [30, 600],
    spawnDelayRange: [15, 300],
    hpMultRange: [0.5, 4.0],
    variationRange: [0.05, 0.30],
    minWave: 7,
    spawnPattern: null,
    requires: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'hornet_strike',
    name: 'Hornet Strike',
    description: 'Hornets and bats. Needs anti-air.',
    enemies: [['hornet', 0.7], ['bat', 0.3]],
    countRange: [20, 300],
    spawnDelayRange: [30, 400],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.10, 0.40],
    minWave: 9,
    spawnPattern: 'interleaved',
    requires: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'tank_column',
    name: 'Tank Column',
    description: 'Tanks and zombie soldiers.',
    enemies: [['tank', 0.6], ['zombie-soldier', 0.4]],
    countRange: [10, 150],
    spawnDelayRange: [80, 800],
    hpMultRange: [0.5, 8.0],
    variationRange: [0.10, 0.35],
    minWave: 10,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'bear_pack',
    name: 'Bear Pack',
    description: 'A pack of bears.',
    enemies: [['bear', 1.0]],
    countRange: [8, 120],
    spawnDelayRange: [60, 600],
    hpMultRange: [0.5, 7.0],
    variationRange: [0.10, 0.35],
    minWave: 12,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'mech_army',
    name: 'Mech Army',
    description: 'Mechs only. A late-game stress test.',
    enemies: [['mech', 1.0]],
    countRange: [5, 100],
    // Untere Grenze von 100 auf 450 ms (2026-09-22): Mechs sind große Modelle
    // und liefen bei 100 ms praktisch ineinander. Bei 3 m/s sind 450 ms rund
    // anderthalb Meter Abstand.
    spawnDelayRange: [450, 1200],
    hpMultRange: [0.5, 10.0],
    variationRange: [0.10, 0.40],
    minWave: 20,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'dragon_elite',
    name: 'Dragon Elite',
    description: 'Dragons and hornets. Needs anti-air.',
    enemies: [['dragon', 0.6], ['hornet', 0.4]],
    countRange: [5, 100],
    spawnDelayRange: [80, 800],
    hpMultRange: [0.5, 8.0],
    variationRange: [0.10, 0.40],
    minWave: 15,
    spawnPattern: 'interleaved',
    requires: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'mammoth_siege',
    name: 'Mammoth Siege',
    description: 'Mammoths and wallsmashers.',
    enemies: [['mammoth', 0.7], ['wallsmasher', 0.3]],
    countRange: [8, 120],
    spawnDelayRange: [100, 1000],
    hpMultRange: [0.5, 10.0],
    variationRange: [0.10, 0.40],
    minWave: 14,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'ghost_surge',
    name: 'Ghost Surge',
    description: 'Ghosts and wraiths. Needs magic or ice.',
    enemies: [['ghost', 0.8], ['wraith', 0.2]],
    countRange: [20, 350],
    spawnDelayRange: [30, 400],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.10, 0.40],
    minWave: 12,
    spawnPattern: 'interleaved',
    requires: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'wraith_storm',
    name: 'Wraith Storm',
    description: 'Wraiths only. Needs magic or ice.',
    enemies: [['wraith', 1.0]],
    countRange: [15, 300],
    spawnDelayRange: [20, 350],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.05, 0.35],
    minWave: 18,
    spawnPattern: null,
    requires: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'chaos_wave',
    name: 'Chaos Wave',
    description: 'A chaotic four-type mix. Needs anti-air.',
    enemies: [['zombie', 0.3], ['tank', 0.3], ['hornet', 0.2], ['bear', 0.2]],
    countRange: [25, 500],
    spawnDelayRange: [40, 500],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.15, 0.50],
    minWave: 15,
    spawnPattern: 'interleaved',
    requires: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'armor_gauntlet',
    name: 'Armor Gauntlet',
    description: 'All four armor types at once.',
    enemies: [['rat', 0.25], ['tank', 0.25], ['mammoth', 0.25], ['ghost', 0.25]],
    countRange: [30, 600],
    spawnDelayRange: [40, 500],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.15, 0.45],
    minWave: 20,
    spawnPattern: 'interleaved',
    requires: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'boss_herbert',
    name: 'Boss: Herbert',
    description: 'Herbert, with support waves.',
    // Kein Horden-Template mehr (2026-09-22). Bei 3,34 % Herbert auf bis zu
    // hundert Gegner kamen drei Bosse und siebenundneunzig Begleiter — eine
    // Horde mit Boss-Etikett. Jetzt höchstens zwanzig Gegner, davon ein
    // Viertel Herberts, und die Schwierigkeit wächst über die HP statt über
    // die Menge: Die HP-Spanne reicht dafür bis ×20, und welchen Wert der
    // Regler daraus nimmt, entscheidet er selbst.
    enemies: [['herbert', 0.25], ['tank', 0.375], ['zombie', 0.375]],
    countRange: [6, 20],
    spawnDelayRange: [400, 1800],
    hpMultRange: [0.5, 20.0],
    variationRange: [0.10, 0.30],
    minWave: 20,
    spawnPattern: 'clustered',
    requires: null,
    bossOnly: true,
  },
  {
    // Stone Golem squad — fortified, slow, very tough. Campaign slot W15.
    // minWave matches mammoth_siege (14): both are fortified DPS checks, and
    // the campaign reaches this template one wave later.
    id: 'golem_squad',
    name: 'Golem Squad',
    description: 'Stone golems. Slow and fortified, a straight damage check.',
    enemies: [['stone-golem', 1.0]],
    countRange: [5, 60],
    // Untere Grenze von 200 auf 600 ms (2026-09-22): Der Stone Golem ist das
    // größte Bodenmodell im Spiel und stand bei 200 ms und 2,5 m/s einen
    // halben Meter hinter seinem Vordermann.
    spawnDelayRange: [600, 1800],
    hpMultRange: [0.8, 6.0],
    variationRange: [0.10, 0.30],
    minWave: 14,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    // Post-campaign boss (W35, W40, ...): stone golems with a mammoth escort.
    // Fortified, so the wave asks whether the player has siege or magic.
    id: 'boss_golem',
    name: 'Boss: Stone Golem',
    description: 'Stone golems with a mammoth escort.',
    enemies: [['stone-golem', 0.3], ['mammoth', 0.7]],
    countRange: [8, 80],
    // Wie beim Golem Squad: große Modelle brauchen Luft zwischen sich.
    spawnDelayRange: [600, 1800],
    hpMultRange: [0.8, 6.0],
    variationRange: [0.10, 0.30],
    minWave: 31,
    spawnPattern: 'clustered',
    requires: null,
    bossOnly: true,
  },
  {
    // Post-campaign air boss: dragons (heavy) inside a hornet swarm (light),
    // one answer from rocket or lightning, the other from gatling or ice.
    id: 'boss_dragon',
    name: 'Boss: Dragon Flight',
    description: 'Dragons with a hornet swarm. Needs anti-air.',
    enemies: [['dragon', 0.5], ['hornet', 0.5]],
    countRange: [8, 80],
    spawnDelayRange: [100, 1000],
    hpMultRange: [0.8, 6.0],
    variationRange: [0.10, 0.30],
    minWave: 31,
    spawnPattern: 'clustered',
    requires: 'antiAir',
    bossOnly: true,
  },
  {
    // Skeletons: unarmored like the zombie, a quarter of its HP and faster,
    // a swarm between rat_tide (5 HP) and zombie_horde. Campaign slot W19,
    // the mega-swarm checkpoint that used to run rat_tide a second time.
    // A kill splits each into two minions: 20 + 2 × 6 = 32 HP and three
    // bodies per skeleton. The range is the pre-split [40, 1500] divided by
    // that 1.6, so a wave brings the HP it did before; its top is 2820
    // bodies, 3.3 Mio. VAT vertices against the swarm budget of 5 Mio.
    id: 'skeleton_swarm',
    name: 'Skeleton Swarm',
    description: 'A rattling swarm of skeletons.',
    enemies: [['skeleton', 1.0]],
    countRange: [25, 940],
    spawnDelayRange: [15, 300],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.05, 0.35],
    minWave: 6,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
];

/** Number of currently defined templates — slots beyond this are reserved. */
export const NUM_ACTIVE_TEMPLATES = TEMPLATES.length;

/** Template cooldown: template blocked for N waves after use. */
export const TEMPLATE_COOLDOWN_WAVES = 2;

/** Global wave-duration safety cap (count × spawn_delay ≤ 3 min). */
export const MAX_WAVE_DURATION_MS = 180_000;
export const MIN_SPAWN_DELAY_MS = 5;

export function getTemplate(idx: number): Template | null {
  if (idx < 0 || idx >= NUM_ACTIVE_TEMPLATES) return null;
  return TEMPLATES[idx];
}


/**
 * The templates the director may pick for a wave, as ascending indices.
 *
 * Inside the campaign the list collapses to the single pinned template. Past
 * it the designer's rules apply: `minWave`, the `requires` capability, the
 * reuse cooldown and the boss cadence. On a boss wave only boss templates that
 * pass those rules are candidates; on every other wave they are excluded.
 * Merely allowing a boss on boss waves left it tied with a dozen other
 * templates, and the stalest-template rule picked it in 0.7 of ten intended
 * boss waves between W31 and W130.
 *
 * `forcedTemplateId` and `bossWave` come from the campaign (templateForWave,
 * isBossWave). They are passed in rather than imported so this module stays
 * free of a dependency on the campaign config, which already imports TEMPLATES
 * from here.
 */
export function candidateTemplates(
  currentWave: number,
  hasAntiAir: boolean,
  hasAntiEthereal: boolean,
  recentTemplateIndices: readonly number[],
  forcedTemplateId: string | null = null,
  bossWave = false,
): TemplateCandidates {
  const picked = new Set<number>();
  const lacks = (t: Template): TemplateCapability => {
    if (t.requires === 'antiAir' && !hasAntiAir) return 'antiAir';
    if (t.requires === 'antiEthereal' && !hasAntiEthereal) return 'antiEthereal';
    return null;
  };
  const reason: CandidateReason = {
    rule: bossWave ? 'boss' : 'free',
    bossUnavailable: false,
    cooldownWaived: false,
    heldBack: { antiAir: [], antiEthereal: [] },
    pinnedLacks: null,
  };
  const sorted = (): number[] => [...picked].sort((a, b) => a - b);

  if (forcedTemplateId) {
    const forcedIdx = TEMPLATES.findIndex((t) => t.id === forcedTemplateId);
    if (forcedIdx >= 0) {
      // The pin bypasses the capability requirement on purpose; the
      // survivability cap is what keeps such a wave survivable.
      return {
        indices: [forcedIdx],
        reason: { ...reason, rule: 'campaign', pinnedLacks: lacks(TEMPLATES[forcedIdx]) },
      };
    }
    // An unknown campaign id is a config bug; fall through to free choice
    // rather than returning an empty list.
  }

  const recent = new Set(recentTemplateIndices.slice(-TEMPLATE_COOLDOWN_WAVES));
  /** Designer rules, and the boss rule: boss templates on boss waves only. */
  const eligible = (i: number, boss: boolean): boolean => {
    const t = TEMPLATES[i];
    if (t.bossOnly !== boss) return false;
    if (currentWave < t.minWave) return false;
    return lacks(t) === null;
  };
  const fill = (boss: boolean, respectCooldown: boolean, firstOnly: boolean): void => {
    for (let i = 0; i < NUM_ACTIVE_TEMPLATES; i++) {
      if (!eligible(i, boss) || (respectCooldown && recent.has(i))) continue;
      picked.add(i);
      if (firstOnly) return;
    }
  };

  fill(bossWave, true, false);

  // Fallbacks, in order: a boss wave is still a boss wave when every boss
  // template is on cooldown; a boss wave no boss template can serve (minWave,
  // capabilities) becomes a normal wave; the cooldown must never be able to
  // starve the list; and an empty list would leave the director nothing to
  // ship.
  if (picked.size === 0 && bossWave) {
    fill(true, false, true);
    reason.cooldownWaived = picked.size > 0;
  }
  if (picked.size === 0 && bossWave) {
    reason.rule = 'free';
    reason.bossUnavailable = true;
    fill(false, true, false);
  }
  if (picked.size === 0) {
    reason.cooldownWaived = true;
    fill(false, false, true);
  }
  if (picked.size === 0) picked.add(0);

  // Only templates the other rules would have let through: minWave and the
  // boss rule already exclude the rest, and listing those would be noise.
  const boss = reason.rule === 'boss';
  for (let i = 0; i < NUM_ACTIVE_TEMPLATES; i++) {
    const t = TEMPLATES[i];
    if (t.bossOnly !== boss || currentWave < t.minWave) continue;
    const missing = lacks(t);
    if (missing) reason.heldBack[missing].push(i);
  }

  return { indices: sorted(), reason };
}

/**
 * Why a wave's candidate list looks the way it does, for the decision
 * explainer.
 *
 * Carried as data rather than rebuilt from the list afterwards: a list with
 * one entry looks the same whether the campaign pinned it, the boss rule
 * collapsed it or the requirements left nothing else, and those are different
 * answers to "why this wave".
 */
export interface CandidateReason {
  /** campaign: pinned to one template; boss: boss templates only; free: open choice. */
  rule: 'campaign' | 'boss' | 'free';
  /** A boss wave no boss template could serve, run as a normal wave instead. */
  bossUnavailable: boolean;
  /** Every eligible template had just run, so the reuse cooldown was waived. */
  cooldownWaived: boolean;
  /** Templates held back only because the defense lacks the capability they need. */
  heldBack: { antiAir: number[]; antiEthereal: number[] };
  /** Capability the pinned campaign template needs and the defense lacks. */
  pinnedLacks: TemplateCapability;
}

/** The templates a wave may use, and why. */
export interface TemplateCandidates {
  /** Template indices, ascending. Never empty. */
  indices: number[];
  reason: CandidateReason;
}
