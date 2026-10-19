import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import type { EnemyTypeConfig, EnemyTypeId } from '../configs/enemy-types.config';
import { SIEGE_LOOKS, type SiegeLook } from '../configs/siege-look.config';
import { TowerLoopSounds } from './tower-loop-sounds';

/** Game seconds the servo hums on after the turret stops, so a turn in small steps is one sound */
const SERVO_LINGER_S = 0.3;

/** A turn into -π..π */
function wrap(angle: number): number {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}

interface Turning {
  yaw: number;
  gameTimeMs: number;
  frame: number;
}

/**
 * The sound of the siege guns' turrets (EnemyTypeConfig.turret, SiegeLook):
 * the servo hums at the enemy while its turret turns faster than
 * `servoFromRadPerS`, measured on the gun table's turn from frame to frame in
 * game time, and lingers a moment after it stops. A loop per gun
 * (TowerLoopSounds), in game time like the towers' machines; the pause holds
 * it with every loop.
 */
export class GunPresenter {
  private readonly turning = new Map<string, Turning>();
  /** One servo per look, registered with the audio on first use */
  private readonly servos = new Map<SiegeLook, TowerLoopSounds>();

  constructor(private readonly audio: () => SpatialAudioManager | null) {}

  /**
   * Gun of enemy `id` turned to `yaw` at game time `gameTimeMs` in presented
   * frame `frame`; `at` where it sounds (local), null while it has no place
   * (dying)
   */
  present(id: string, type: EnemyTypeConfig, yaw: number, at: { x: number; y: number; z: number } | null, gameTimeMs: number, frame: number): void {
    const look = SIEGE_LOOKS[type.id as EnemyTypeId];
    if (!look) return;
    const last = this.turning.get(id);
    let turns = false;
    if (last && gameTimeMs > last.gameTimeMs) {
      const rate = Math.abs(wrap(yaw - last.yaw)) / ((gameTimeMs - last.gameTimeMs) / 1000);
      turns = rate > look.servoFromRadPerS;
    }
    if (!last) this.turning.set(id, { yaw, gameTimeMs, frame });
    else if (gameTimeMs !== last.gameTimeMs) {
      last.yaw = yaw;
      last.gameTimeMs = gameTimeMs;
    }
    if (last) last.frame = frame;
    const servo = this.servo(look);
    if (!servo) return;
    if (turns && at) servo.work(id, at);
    else servo.rest(id);
  }

  /** After a presented frame: the guns not in it (gone) fall silent */
  endFrame(frame: number): void {
    for (const [id, t] of this.turning) {
      if (t.frame === frame) continue;
      this.turning.delete(id);
      for (const servo of this.servos.values()) servo.stop(id);
    }
  }

  /** Every frame in game time: the servos linger and stop */
  advance(gameTimeDeltaMs: number): void {
    for (const servo of this.servos.values()) servo.advance(gameTimeDeltaMs);
  }

  clear(): void {
    this.turning.clear();
    for (const servo of this.servos.values()) servo.clear();
  }

  private servo(look: SiegeLook): TowerLoopSounds | null {
    let servo = this.servos.get(look);
    if (servo) return servo;
    const audio = this.audio();
    if (!audio) return null;
    const s = look.sounds.servo;
    audio.registerSound(s.id, s.url, { volume: s.volume, refDistance: s.refDistance, rolloffFactor: s.rolloffFactor, loop: true });
    servo = new TowerLoopSounds(this.audio, { loop: s.id, linger: SERVO_LINGER_S });
    this.servos.set(look, servo);
    return servo;
  }
}
