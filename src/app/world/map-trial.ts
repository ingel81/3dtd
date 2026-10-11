/**
 * Map trial
 *
 * The expert bot plays the first waves of a world on its own and says
 * whether it held (`?bot=trial`, `&waves=N`, docs/CUSTOM_MAP_WORLD.md): a
 * custom map is checked for playability without a person, like the DevWorld
 * bot runs but without a bot server, and ends after its waves. The result
 * goes to the page (`window.__mapTrial`), to the page that opened it
 * (postMessage `MAP_TRIAL_MESSAGE`, the editor's later "check map") and into
 * the banner.
 */

import type { EventSubscription, GameEventBus } from '../game-engine/game-event-bus';

/** Waves a trial plays when the link names no number */
export const MAP_TRIAL_WAVES = 10;
/** The most a link may ask for */
export const MAX_MAP_TRIAL_WAVES = 50;
/** A trial without a finished wave for this long (wall clock) is stuck: the enemies never arrive or never die */
export const MAP_TRIAL_STALL_MS = 5 * 60_000;
/** postMessage type of the result */
export const MAP_TRIAL_MESSAGE = '3dtd-map-trial';
/** The timescale a trial plays at (the bot dashboard's) */
export const MAP_TRIAL_SPEED = 75;

/**
 * passed: the waves are held. lost: the HQ fell before. stuck: no wave
 * finished for MAP_TRIAL_STALL_MS.
 */
export type MapTrialOutcome = 'passed' | 'lost' | 'stuck';

export interface MapTrialResult {
  outcome: MapTrialOutcome;
  /** Waves the trial was to play */
  waves: number;
  /** Waves finished, the HQ standing */
  wavesHeld: number;
  hqStart: number;
  hqEnd: number;
  /** HQ health lost per finished wave, in order */
  hpLostByWave: number[];
  towers: number;
  /** Game time the trial took */
  gameTimeMs: number;
}

/** The waves a link asks a trial for, null when it asks for none (`?bot=trial`, `&waves=N`) */
export function mapTrialWaves(search: string): number | null {
  const params = new URLSearchParams(search);
  if (params.get('bot') !== 'trial') return null;
  const asked = Number(params.get('waves'));
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_MAP_TRIAL_WAVES) : MAP_TRIAL_WAVES;
}

/** What the trial reads from the game when it ends */
export interface MapTrialGame {
  hqHealth(): number;
  towers(): number;
  gameTimeMs(): number;
}

/**
 * One trial: counts the finished waves and their HQ losses and ends once
 * the waves are held, the HQ falls or nothing finishes for too long. Ends
 * once; `finish` gets the result.
 */
export class MapTrial {
  private readonly hpLostByWave: number[] = [];
  private readonly subscriptions: EventSubscription[];
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private result: MapTrialResult | null = null;

  constructor(
    private readonly waves: number,
    private readonly hqStart: number,
    private readonly game: MapTrialGame,
    bus: Pick<GameEventBus, 'onLive'>,
    private readonly finish: (result: MapTrialResult) => void,
  ) {
    this.subscriptions = [
      bus.onLive('wave:completed', (e) => this.waveHeld(e.hpLost)),
      bus.onLive('game:over', () => this.end('lost')),
    ];
    this.armStall();
  }

  get done(): boolean {
    return this.result !== null;
  }

  /** Stop without a result (the page goes away) */
  dispose(): void {
    this.disarm();
  }

  private waveHeld(hpLost: number): void {
    if (this.result) return;
    this.hpLostByWave.push(tenths(hpLost));
    if (this.hpLostByWave.length >= this.waves) this.end('passed');
    else this.armStall();
  }

  private end(outcome: MapTrialOutcome): void {
    if (this.result) return;
    this.disarm();
    this.result = {
      outcome,
      waves: this.waves,
      wavesHeld: this.hpLostByWave.length,
      hqStart: this.hqStart,
      hqEnd: outcome === 'lost' ? 0 : tenths(this.game.hqHealth()),
      hpLostByWave: [...this.hpLostByWave],
      towers: this.game.towers(),
      gameTimeMs: Math.round(this.game.gameTimeMs()),
    };
    this.finish(this.result);
  }

  private armStall(): void {
    if (this.stallTimer !== null) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => this.end('stuck'), MAP_TRIAL_STALL_MS);
  }

  private disarm(): void {
    if (this.stallTimer !== null) clearTimeout(this.stallTimer);
    this.stallTimer = null;
    for (const sub of this.subscriptions) sub.dispose();
    this.subscriptions.length = 0;
  }
}

/** HQ health to a tenth: what the run lost, without the float noise of the sums */
const tenths = (hp: number): number => Math.round(hp * 10) / 10;

/** The banner's line for a result */
export function mapTrialSummary(result: MapTrialResult): string {
  const hq = `HQ ${result.hqEnd}/${result.hqStart}, ${result.towers} towers`;
  switch (result.outcome) {
    case 'passed':
      return `Map check passed: ${result.wavesHeld} of ${result.waves} waves held (${hq})`;
    case 'lost':
      return `Map check failed: the HQ fell in wave ${result.wavesHeld + 1} of ${result.waves} (${hq})`;
    case 'stuck':
      return `Map check stuck: no wave finished after wave ${result.wavesHeld} of ${result.waves} (${hq})`;
  }
}
