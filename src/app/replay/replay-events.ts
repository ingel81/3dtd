import type { GameEvent } from '../game-engine/game-event-bus';
import type { Enemy } from '../entities/enemy.entity';
import { GameObject } from '../core/game-object';

/**
 * Which events of a wave the replay keeps, and in what form.
 *
 * Kept are the events the effect services turn into something seen or
 * heard: every vfx:*, audio:play, the ability events (markers, clouds,
 * impact sounds and shakes; not the state snapshots and rejections),
 * health:changed (the shake on HQ damage, the HQ health in the replay bar),
 * enemy:split (the bone burst) and hero:level-up (the text over the hero's
 * head, who is the replay's hero then). The replay emits them again on a bus of
 * its own, where its own VFXService, AudioService and ScreenShakeService
 * listen: an effect those services learn is replayed without a change here.
 */
export function isPresentationEvent(type: GameEvent['type']): boolean {
  if (type.startsWith('vfx:')) return true;
  if (type.startsWith('ability:')) return type !== 'ability:state-changed' && type !== 'ability:rejected';
  return type === 'audio:play' || type === 'health:changed' || type === 'enemy:split' || type === 'hero:level-up';
}

/**
 * The event as the replay keeps it, null when it cannot be kept.
 *
 * Emitters build a fresh object per event and no listener changes it, so
 * the object itself is kept, no copy. An event that holds a live entity
 * (Enemy, Tower, Projectile) would show that entity as it is at playback,
 * not as it was: enemy:split keeps a stub with the dead enemy's place and
 * its type's config (static), the only fields VFXService reads; any other
 * such event is dropped.
 */
export function presentationEvent(event: GameEvent): GameEvent | null {
  if (event.type === 'enemy:split') {
    const { enemy } = event;
    const stub = {
      position: { lat: enemy.position.lat, lon: enemy.position.lon },
      transform: { terrainHeight: enemy.transform.terrainHeight },
      heightOffset: enemy.heightOffset,
      typeConfig: enemy.typeConfig,
    } as unknown as Enemy;
    return { type: 'enemy:split', enemy: stub, children: [] };
  }
  return holdsEntity(event) ? null : event;
}

function holdsEntity(event: GameEvent): boolean {
  const fields = event as unknown as Record<string, unknown>;
  for (const key in fields) {
    if (fields[key] instanceof GameObject) return true;
  }
  return false;
}
