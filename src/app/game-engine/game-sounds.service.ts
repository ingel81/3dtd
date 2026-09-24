import { GameEventBus, SubscriptionBag } from './game-event-bus';
import { ThreeTilesEngine } from '../three-engine';
import type { SpatialSoundConfig } from '../managers/audio/spatial-audio.manager';
import {
  ABILITY_CAST_SOUNDS,
  BOSS_INTRO_SOUNDS,
  CHEAT_QUIET_MS,
  DEATH_SOUNDS,
  GAME_OVER_STINGER_DELAY_MS,
  GOLEM_FOOTSTEP,
  HIT_SOUND_PROJECTILES,
  HIT_SOUNDS,
  MOMENT_SOUNDS,
  WORLD_SOUNDS,
  type GameSoundSample,
  type GlobalCue,
} from '../configs/game-sounds.config';
import { isBloodMoonWave } from '../configs/blood-moon.config';
import { BACKGROUND_MUSIC, cueLeadMs } from '../configs/background-music.config';
import type { AbilityStatus } from '../configs/abilities.config';
import type { HeroStatus } from '../configs/hero.config';
import type { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';

/**
 * The sounds of game events that are not a tower's shot or an ability's
 * impact (game-sounds.config.ts): in the world an enemy's death, hit, split
 * and heavy steps, a tower's upgrade, an ability's cast, the kill gold and
 * the hero's level; as global cues the moments of a run: a wave's start and
 * end, the blood moon, a finished research, an ability ready again, the
 * hero's hire and ammo, and the game over (the HQ's destruction, then the
 * stinger).
 *
 * Framework-agnostic like AudioService; GameStateManager makes one per
 * engine. The UI cues are uiSound's (services/ui-sound.ts).
 */
export class GameSoundsService {
  private readonly subs = new SubscriptionBag();
  private abilities = new Map<string, AbilityStatus>();
  private hero: HeroStatus | null = null;
  private stingerTimer: ReturnType<typeof setTimeout> | null = null;
  /** Start signal or wave-end horn waiting for the music to fade out, see cue() */
  private cueTimer: ReturnType<typeof setTimeout> | null = null;
  /** The game speed, for the lead before a wave's signals (cueLeadMs) */
  private gameSpeed: () => number = () => 1;
  /** Wall time until which the consequences of a cheat stay silent (CHEAT_QUIET_MS) */
  private quietUntilMs = -Infinity;

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly tilesEngine: ThreeTilesEngine,
  ) {
    this.registerSounds();
    this.setupEventHandlers();
  }

  destroy(): void {
    this.subs.disposeAll();
    this.clearStinger();
    this.clearCue();
  }

  private registerSounds(): void {
    const audio = this.tilesEngine.spatialAudio;
    if (!audio) return;
    const samples: GameSoundSample[] = [
      ...Object.values(DEATH_SOUNDS),
      ...Object.values(HIT_SOUNDS),
      ...Object.values(WORLD_SOUNDS),
      GOLEM_FOOTSTEP.sound,
      ...Object.values(ABILITY_CAST_SOUNDS).filter((s): s is GameSoundSample => s !== null),
    ];
    const registered = new Set<string>();
    for (const sample of samples) {
      if (registered.has(sample.id)) continue;
      registered.add(sample.id);
      audio.registerSound(sample.id, sample.url, spatialConfig(sample));
    }
    for (const cue of [...Object.values(MOMENT_SOUNDS), ...Object.values(BOSS_INTRO_SOUNDS)] as GlobalCue[]) {
      audio.registerSound(cue.id, cue.url, { volume: cue.volume });
    }
  }

  private setupEventHandlers(): void {
    const bus = this.eventBus;

    // The cheat buttons: silent, and so is what follows from them. This
    // service subscribes before GameCommandsHandler, which runs them
    const quiet = () => { this.quietUntilMs = performance.now() + CHEAT_QUIET_MS; };
    for (const cheat of ['debug:kill-all', 'debug:complete-all-research', 'debug:max-upgrade-all-towers',
      'debug:ready-ability', 'debug:ready-hero'] as const) {
      this.subs.add(bus.on(cheat, quiet));
    }

    // Where a tower or the hero kills it; a leak that dies on arrival is silent
    this.subs.add(bus.onShow('enemy:died', ({ enemy, credits, killedBy }) => {
      if (!killedBy) return;
      const sample = this.deathSample(enemy);
      if (sample) this.playAt(sample.id, enemy.position);
      if (credits > 0) this.playAt(WORLD_SOUNDS.coin.id, enemy.position);
    }));
    this.subs.add(bus.onShow('enemy:split', ({ enemy }) => {
      const id = enemy.typeConfig.splitSound;
      if (id) this.playAt(WORLD_SOUNDS[id].id, enemy.position);
    }));
    this.subs.add(bus.onShow('projectile:hit', ({ projectile, target }) => {
      if (!target || !HIT_SOUND_PROJECTILES.has(projectile.typeConfig.id)) return;
      const hit = target.typeConfig.hitSound;
      if (hit) this.playAt(HIT_SOUNDS[hit].id, target.position);
    }));
    this.subs.add(bus.onShow('enemy:footstep', ({ enemy }) => {
      const footstep = enemy.typeConfig.footstep;
      if (footstep) this.playAt(footstep.sound.id, enemy.position, footstep.sound.playbackRate);
    }));
    this.subs.add(bus.onShow('tower:upgraded', ({ tower }) => {
      this.playAt(WORLD_SOUNDS.towerUpgrade.id, tower.position);
    }));
    this.subs.add(bus.onShow('ability:used', ({ abilityId, target }) => {
      const cast = ABILITY_CAST_SOUNDS[abilityId];
      if (cast) this.playAt(cast.id, target);
    }));
    this.subs.add(bus.onShow('hero:level-up', ({ position }) => {
      this.playAt(WORLD_SOUNDS.heroLevelUp.id, position);
    }));

    // Start signal and wave-end horn sound into the quiet, once the music
    // faded out (BACKGROUND_MUSIC.waveStart / waveEnd, leadMs)
    this.subs.add(bus.onShow('wave:started', ({ wave }) => {
      const sound = isBloodMoonWave(wave) ? MOMENT_SOUNDS.bloodMoon : MOMENT_SOUNDS.waveStart;
      this.cue(sound, cueLeadMs(BACKGROUND_MUSIC.waveStart.leadMs, this.gameSpeed()));
    }));
    this.subs.add(bus.onShow('wave:completed', () => {
      this.cue(MOMENT_SOUNDS.waveComplete, cueLeadMs(BACKGROUND_MUSIC.waveEnd.leadMs, this.gameSpeed()));
    }));
    // A restore (replay in, out, a seek) is another moment: a cue waiting for it goes
    this.subs.add(bus.on('sim:restored', () => this.clearCue()));
    this.subs.add(bus.onShow('research:completed', () => this.playGlobal(MOMENT_SOUNDS.researchComplete)));
    this.subs.add(bus.onShow('ability:state-changed', ({ abilities, restored }) => this.onAbilities(abilities, restored)));
    this.subs.add(bus.onShow('hero:state-changed', ({ hero, restored }) => this.onHero(hero, restored)));

    // The HQ goes, then the stinger; the game-over track follows (music)
    this.subs.add(bus.onShow('game:over', () => {
      this.playGlobal(MOMENT_SOUNDS.hqDestroyed);
      this.clearCue();
      this.clearStinger();
      this.stingerTimer = setTimeout(() => {
        this.stingerTimer = null;
        this.playGlobal(MOMENT_SOUNDS.gameOver);
      }, GAME_OVER_STINGER_DELAY_MS);
    }));
    this.subs.add(bus.onShow('game:reset', () => {
      this.clearStinger();
      this.clearCue();
      this.abilities.clear();
      this.hero = null;
    }));
  }

  /**
   * The death sound of `enemy`: a worm segment lost while the worm lives on
   * sounds as a segment, the worm's last one as the boss.
   */
  private deathSample(enemy: Enemy): GameSoundSample | null {
    const worm = enemy.worm;
    if (worm && worm.group.remaining > 0) return WORLD_SOUNDS.wormSegment;
    // A split plays its split sound instead (enemy:split)
    if (enemy.typeConfig.splitSound) return null;
    const id = enemy.typeConfig.deathSound;
    return id ? DEATH_SOUNDS[id] : null;
  }

  /** An ability charged again after it had none: the ready chime. Not for its unlock. */
  private onAbilities(abilities: readonly AbilityStatus[], restored = false): void {
    let ready = false;
    for (const status of abilities) {
      const before = this.abilities.get(status.id);
      if (before?.unlocked && before.charges === 0 && status.charges > 0) ready = true;
      this.abilities.set(status.id, status);
    }
    // A restore (replay in, out, a seek) sets a new baseline, it charges nothing
    if (ready && !restored) this.playGlobal(MOMENT_SOUNDS.abilityReady);
  }

  /** The hero hired, or his ammo changed. */
  private onHero(hero: HeroStatus, restored = false): void {
    const before = this.hero;
    this.hero = hero;
    if (!before || restored) return;
    if (!before.hired && hero.hired) this.playGlobal(MOMENT_SOUNDS.heroHire);
    else if (hero.hired && before.ammo !== hero.ammo) this.playGlobal(MOMENT_SOUNDS.heroAmmo);
  }

  private get quiet(): boolean {
    return performance.now() < this.quietUntilMs;
  }

  /** At `position`, at `playbackRate` (below 1 lower and slower). */
  private playAt(id: string, position: GeoPosition, playbackRate = 1): void {
    if (this.quiet) return;
    const audio = this.tilesEngine.spatialAudio;
    if (!audio) return;
    if (playbackRate === 1) {
      audio.playAtGeo(id, position.lat, position.lon, position.height ?? 0).catch(() => undefined);
      return;
    }
    const local = audio.geoToLocalPosition(position.lat, position.lon, position.height ?? 0);
    if (local) audio.playAt(id, local, 1, playbackRate).catch(() => undefined);
  }

  private playGlobal(cue: GlobalCue): void {
    if (this.quiet) return;
    // A cue can come after a lead (cue()): whatever the audio answers then, it must not throw
    this.tilesEngine.spatialAudio?.playGlobal(cue.id)?.catch(() => undefined);
  }

  /** Where the game speed comes from (GameStateManager), see cueLeadMs. */
  setGameSpeedSource(source: () => number): void {
    this.gameSpeed = source;
  }

  /** Play `sound` after `delayMs`; a later cue replaces one still waiting. */
  private cue(sound: GlobalCue, delayMs: number): void {
    this.clearCue();
    this.cueTimer = setTimeout(() => {
      this.cueTimer = null;
      this.playGlobal(sound);
    }, delayMs);
  }

  private clearCue(): void {
    if (this.cueTimer !== null) clearTimeout(this.cueTimer);
    this.cueTimer = null;
  }

  private clearStinger(): void {
    if (this.stingerTimer !== null) clearTimeout(this.stingerTimer);
    this.stingerTimer = null;
  }
}

/** The spatial settings of a sample; one it leaves unset keeps the manager's default. */
function spatialConfig(sample: GameSoundSample): SpatialSoundConfig {
  const config: SpatialSoundConfig = { volume: sample.volume };
  if (sample.refDistance !== undefined) config.refDistance = sample.refDistance;
  if (sample.rolloffFactor !== undefined) config.rolloffFactor = sample.rolloffFactor;
  if (sample.minIntervalMs !== undefined) config.minIntervalMs = sample.minIntervalMs;
  if (sample.maxInstances !== undefined) config.maxInstances = sample.maxInstances;
  if (sample.priority !== undefined) config.priority = sample.priority;
  if (sample.audibleDistance !== undefined) config.audibleDistance = sample.audibleDistance;
  if (sample.feedback !== undefined) config.feedback = sample.feedback;
  return config;
}
