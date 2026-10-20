import type { HashSink } from '../simulator/state-hash';

/**
 * The gun of an enemy that fires at structures (EnemyTypeConfig.siege), as
 * simulation state on the Enemy (Enemy.gun): where its turret points, what
 * it aims at, how long until it may fire, and the shell in flight. Stepped
 * by EnemySiege (managers/enemy-siege.ts) once per sub-step in game time;
 * the main thread only shows it (the packet's gun table, the shot's ops).
 *
 * Plain fields only: a wave snapshot takes them as they are (plainFields),
 * the state hash reads them (hashInto). A shell flies with its gun: one at a
 * time, the reload is longer than any flight.
 */
export class EnemyGun {
  /** Turn of the turret from the body's forward, rad, -π to π; positive as a heading (Transform.rotation) */
  yaw = 0;
  /** Tilt of the guns, rad, muzzle up positive */
  pitch = 0;
  /** Game ms until it may fire */
  cooldownMs: number;
  /** Game ms until it looks for a structure again while it has none */
  searchMs = 0;
  /** The structure it aims at (run rules' order), -1 for none */
  target = -1;
  /** Game ms until the shell in flight lands, -1 while none flies */
  shellMs = -1;
  /** Where the shell lands, map metres */
  shellX = 0;
  shellY = 0;
  /** Its height over the gun's ground there, m: where the show puts the blast */
  shellHeight = 0;
  /** The structure it was fired at, for the show (the debris of its material) */
  shellTarget = -1;
  /** Shots fired */
  shots = 0;
  /**
   * The side of its way it keeps to (EnemySiegeConfig.sideHoldMs), as the
   * sign of the turret's turn to it (yaw), 0 none yet: a crab's front faces
   * it. Game ms since it came to that side
   */
  side = 0;
  sideMs = 0;

  constructor(firstShotMs: number) {
    this.cooldownMs = firstShotMs;
  }

  hashInto(sink: HashSink): void {
    sink.num(this.yaw);
    sink.num(this.pitch);
    sink.num(this.cooldownMs);
    sink.num(this.searchMs);
    sink.num(this.target);
    sink.num(this.shellMs);
    sink.num(this.shellX);
    sink.num(this.shellY);
    sink.num(this.shots);
    sink.num(this.side);
    sink.num(this.sideMs);
  }
}
