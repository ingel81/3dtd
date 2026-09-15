import { Vector3 } from 'three';
import type { SpatialAudioManager } from '../audio/spatial-audio.manager';
import type { ThreeTilesEngine } from '../../three-engine';
import { WORM_SOUNDS } from '../../configs/audio.config';
import type { WormGroup } from './worm-group';

/** The crawl loop of one worm */
interface WormLoop {
  handle: string | null;
  /** createLoop is still in flight */
  pending: boolean;
  /** createLoop gave nothing (no buffer): not asked again */
  failed: boolean;
  /** The present() call that last saw its worm */
  seen: number;
}

/**
 * Skarnax's voice, for EnemyManager: one crawl loop per worm (WormGroup,
 * WORM_SOUNDS.crawl) at its head, moved once per render frame
 * (presentFrame). After a split every part walks with a head of its own; the
 * loop sits on the head nearest the listener, so a worm in pieces keeps one
 * voice. The loop stands while the game is paused like every loop
 * (SpatialAudioManager.holdLoops) and waits while out of earshot; its id
 * matches no ENEMY_SOUND_PATTERNS entry, so the enemy budget cannot silence
 * the boss.
 */
export class WormSounds {
  private registeredWith: SpatialAudioManager | null = null;
  private readonly loops = new Map<WormGroup, WormLoop>();
  private pass = 0;
  private readonly listener = new Vector3();
  private readonly head = new Vector3();
  private readonly nearest = new Vector3();

  /**
   * Once per render frame: each worm's loop to its head nearest the
   * listener, the first call for a worm asks for its loop. The loop of a
   * worm no longer in `groups` (beaten, through, removed) ends.
   */
  present(groups: readonly WormGroup[], engine: ThreeTilesEngine): void {
    const audio = engine.spatialAudio ?? null;
    if (audio === null) return;
    const pass = ++this.pass;
    if (groups.length !== 0) {
      this.register(audio);
      audio.getListener().getWorldPosition(this.listener);
      for (const group of groups) {
        if (group.remaining === 0) continue;
        let loop = this.loops.get(group);
        if (loop === undefined) {
          loop = { handle: null, pending: false, failed: false, seen: pass };
          this.loops.set(group, loop);
        }
        loop.seen = pass;
        // No head walks for a moment (it died, the next one leads from the next sub-step): the loop stays put
        if (this.nearestHead(group, engine)) this.follow(group, loop, audio);
      }
    }
    for (const [group, loop] of this.loops) {
      if (loop.seen !== pass) this.stop(group, audio);
    }
  }

  /** Every loop ends (wave end, reset, game over). */
  clear(audio: SpatialAudioManager | null): void {
    for (const group of [...this.loops.keys()]) this.stop(group, audio);
  }

  private register(audio: SpatialAudioManager): void {
    if (this.registeredWith === audio) return;
    this.registeredWith = audio;
    const { id, url, refDistance, rolloffFactor, volume } = WORM_SOUNDS.crawl;
    audio.registerSound(id, url, { refDistance, rolloffFactor, volume, loop: true });
  }

  /** The head of `group` nearest the listener into `nearest`, local; false while none walks. */
  private nearestHead(group: WormGroup, engine: ThreeTilesEngine): boolean {
    const originHeight = engine.sync.getOrigin()?.height ?? 0;
    const { x, y, z } = this.listener;
    let best = Infinity;
    for (const chain of group.chains) {
      const enemy = group.segments[chain.first];
      if (!enemy?.alive) continue;
      const head = engine.sync.geoToLocalSimpleInto(enemy.position.lat, enemy.position.lon, 0, this.head);
      head.y = enemy.transform.terrainHeight + enemy.heightOffset + WORM_SOUNDS.crawl.liftM - originHeight;
      const d = (head.x - x) ** 2 + (head.y - y) ** 2 + (head.z - z) ** 2;
      if (d < best) {
        best = d;
        this.nearest.set(head.x, head.y, head.z);
      }
    }
    return best < Infinity;
  }

  private follow(group: WormGroup, loop: WormLoop, audio: SpatialAudioManager): void {
    if (loop.handle !== null) {
      audio.updateLoopPosition(loop.handle, this.nearest);
      return;
    }
    if (loop.pending || loop.failed) return;
    loop.pending = true;
    // createLoop copies the position before it awaits
    void audio.createLoop(WORM_SOUNDS.crawl.id, this.nearest, { randomStart: true }).then((handle) => {
      loop.pending = false;
      // The worm went while the loop was loading
      if (this.loops.get(group) !== loop) {
        if (handle !== null) audio.stopLoop(handle);
        return;
      }
      if (handle === null) loop.failed = true;
      else loop.handle = handle;
    });
  }

  private stop(group: WormGroup, audio: SpatialAudioManager | null): void {
    const loop = this.loops.get(group);
    if (loop === undefined) return;
    this.loops.delete(group);
    if (loop.handle !== null) audio?.stopLoop(loop.handle);
  }
}
