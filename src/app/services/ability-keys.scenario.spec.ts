import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';

// inject() hands out the fakes below by class name, as in
// ability-targeting.service.spec.ts; effects are not needed here
const injections: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => injections[token?.name ?? ''],
    effect: () => undefined,
  };
});
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./world/map-placement.service', () => ({ MapPlacementService: class MapPlacementService {} }));

import { AbilityTargetingService } from './ability-targeting.service';
import { RefusalHintService } from './refusal-hint.service';
import { AbilityManager, type AbilityWorld } from '../managers/ability.manager';
import { GameEventBus } from '../game-engine/game-event-bus';
import { resolveHotkey } from './hotkey-map';
import { ABILITIES, type AbilityId } from '../configs/abilities.config';

/**
 * Playtest 510 (docs/archive/REVIEW_FIX_2026-09-14.md), the keys: K, F, E and L go
 * through resolveHotkey to HotkeyService.toggleAbility, which starts the
 * targeting mode and takes the key only when it is on. Here the real
 * AbilityTargetingService asks the real AbilityManager of a new game.
 */
describe('Ability keys before their research, playtest 510 replayed', () => {
  let bus: GameEventBus;
  let abilities: AbilityManager;
  let service: AbilityTargetingService;
  let refusals: RefusalHintService;
  const targeting = signal<AbilityId | null>(null);

  beforeEach(() => {
    bus = new GameEventBus();
    abilities = new AbilityManager(bus, {
      snapToRoute: () => null,
      enemiesInRadius: (_c: unknown, _r: number, out: unknown[]) => out,
      strike: () => 0,
      halt: () => undefined,
      routeSweep: () => null,
      // A missile silo stands: the nuclear strike has its launch site
      launchSite: () => ({ towerId: 'silo', position: { lat: 0, lon: 0, height: 0 } }),
    } as unknown as AbilityWorld);
    // A wave runs: only the missing research can stop the keys
    abilities.setPhaseProvider(() => 'wave');
    targeting.set(null);
    injections['UIStore'] = { buildMode: signal(false), mapPlacementMode: signal(null), abilityTargeting: targeting };
    injections['TowerDefenseStore'] = { waveActive: signal(true), abilities: signal({}) };
    injections['TowerPlacementService'] = { exitBuildMode: vi.fn() };
    injections['MapPlacementService'] = { exitPlacementMode: vi.fn() };
    refusals = new RefusalHintService();
    injections['RefusalHintService'] = refusals;
    service = new AbilityTargetingService();
    service.initialize(
      { abilityMarkers: { hideAim: vi.fn(), showAim: vi.fn() } } as never,
      { abilityManager: abilities } as never,
    );
  });

  const abilityOfKey = (key: string): AbilityId => {
    const action = resolveHotkey(new KeyboardEvent('keydown', { key }));
    expect(action).toMatchObject({ kind: 'ability' });
    return (action as { abilityId: AbilityId }).abilityId;
  };

  it('K, F, E and L arm nothing in a new game, not even during a wave', () => {
    for (const key of ['k', 'f', 'e', 'l']) {
      const id = abilityOfKey(key);
      expect(ABILITIES[id].hotkey.toLowerCase()).toBe(key);
      // What HotkeyService.toggleAbility does; it takes the key only when this armed
      service.start(id);
      expect(service.targeting(), key).toBeNull();
      // Nor does the context hint box say anything: before its research the
      // ability is not the player's yet (RefusalHintService, reason 'locked')
      expect(refusals.refusal(), key).toBeNull();
    }
  });

  it('counter-check: F arms once the Frost Bomb research is done', () => {
    bus.emit({
      type: 'research:completed', playerId: 'local', local: true,
      researchId: 'frost-bomb',
      effects: [{ kind: 'global-perk', perkId: 'frost-bomb', description: '' }],
    });
    service.start(abilityOfKey('f'));
    expect(service.targeting()).toBe('frost-bomb');
  });
});
