import { describe, it, expect, beforeEach } from 'vitest';
import { SimMirror } from './sim-mirror';
import { feed, packet, towerDto } from './testing/mirror-packets';
import { Tower } from '../../../entities/tower.entity';
import { GameObject } from '../../../core/game-object';
import { EF_ACTIVE, TF_MANNED, TF_ON_TARGET } from '../../protocol/packet';
import { createMainEventBus } from '../view-events';
import type { EnemyView } from '../views';
import type { EnemyRef } from '../../protocol/events';

const AT = { lat: 48.1, lon: 11.5, height: 520 };

function ref(num: number, over: Partial<EnemyRef> = {}): EnemyRef {
  return { $e: num, lat: 48.2, lon: 11.6, th: 500, ho: 1, hp: 80, alive: true, type: 'zombie', route: 0, ...over };
}

describe('SimMirror', () => {
  let mirror: SimMirror;

  beforeEach(() => {
    mirror = new SimMirror();
    mirror.setWorld(['north', 'south'], new Map([['north', [AT]], ['south', []]]));
  });

  describe('shadow towers', () => {
    it('match a real tower in upgrade and sell numbers, without moving the id counter', () => {
      const real = new Tower(AT, 'archer');
      real.ownerId = 'p1';
      real.applyUpgrade('damage');
      real.applyUpgrade('damage');
      real.applyUpgrade('speed');
      real.targetingStrategy = 'lowest-hp';
      const counter = GameObject.getIdCounter();

      mirror.applyState(packet({ towerStates: [towerDto(real)] }));

      expect(GameObject.getIdCounter()).toBe(counter);
      const shadow = mirror.tower(real.id)!;
      expect(shadow).not.toBe(real);
      expect(shadow.id).toBe(real.id);
      expect(shadow.ownerId).toBe('p1');
      expect(shadow.targetingStrategy).toBe('lowest-hp');
      for (const id of ['damage', 'speed', 'range'] as const) {
        expect(shadow.getUpgradeLevel(id)).toBe(real.getUpgradeLevel(id));
        expect(shadow.getNextUpgradeCost(id)).toBe(real.getNextUpgradeCost(id));
        expect(shadow.canUpgrade(id)).toBe(real.canUpgrade(id));
      }
      expect(shadow.getSellValue()).toBe(real.getSellValue());
      expect(shadow.getAvailableUpgrades().map((u) => u.id)).toEqual(real.getAvailableUpgrades().map((u) => u.id));
      expect(shadow.combat.damage).toBe(real.combat.damage);
      expect(shadow.combat.fireRate).toBe(real.combat.fireRate);
    });

    it('keeps its object and aim through an upgrade, and the aim object through a lower level', () => {
      const real = new Tower(AT, 'archer');
      mirror.applyState(packet({ towerStates: [towerDto(real)] }));
      const shadow = mirror.tower(real.id)!;
      const aim = shadow.aim;

      real.applyUpgrade('range');
      mirror.applyState(packet({ towerStates: [towerDto(real)] }));
      expect(mirror.tower(real.id)).toBe(shadow);
      expect(shadow.getUpgradeLevel('range')).toBe(1);

      // A replay seeks back before the upgrade
      const before = new Tower(AT, 'archer');
      const dto = { ...towerDto(before), id: real.id };
      mirror.applyState(packet({ towerStates: [dto] }));
      const fresh = mirror.tower(real.id)!;
      expect(fresh.getUpgradeLevel('range')).toBe(0);
      expect(fresh.aim).toBe(aim);
    });

    it('takes aim, kills and flags from the tower table every frame', () => {
      const real = new Tower(AT, 'archer');
      mirror.applyState(packet({ towerStates: [towerDto(real)] }));
      mirror.applyState(packet({ towers: [{ id: real.id, aim: 1.25, pitch: 0.1, kills: 7, damage: 300, flags: TF_MANNED | TF_ON_TARGET }] }));
      const shadow = mirror.tower(real.id)!;
      expect(shadow.aim.current).toBe(1.25);
      expect(shadow.aim.pitch).toBe(0.1);
      expect(shadow.combat.kills).toBe(7);
      expect(shadow.manned).toBe(true);
      expect(mirror.onTargetOf(real.id)).toBe(true);
    });

    it('reports changes and removals; a removed tower is still named by the events of its packet', () => {
      const real = new Tower(AT, 'cannon');
      const changes: string[] = [];
      mirror.onTowerChange((c) => changes.push(`${c.kind}:${c.tower.id}`));
      mirror.applyState(packet({ towerStates: [towerDto(real)] }));
      const sold = packet({ removedTowers: [real.id], events: [{ type: 'tower:sold', payload: { tower: { $t: real.id }, refund: 10 } }] });
      mirror.applyState(sold);
      expect(mirror.towers()).toHaveLength(0);
      const event = mirror.importEvent(sold.events[0]) as { tower: Tower };
      expect(event.tower.id).toBe(real.id);
      mirror.afterFrame(sold);
      expect(mirror.tower(real.id)).toBeNull();
      expect(changes).toEqual([`state:${real.id}`, `removed:${real.id}`]);
    });
  });

  describe('enemy views', () => {
    it('are made from a ref, follow the table and are dropped when gone', () => {
      const bus = createMainEventBus();
      const spawned: EnemyView[] = [];
      bus.on('enemy:spawned', (e) => spawned.push(e.enemy));

      feed(mirror, bus, packet({
        enemies: [{ num: 5, type: 'zombie', lat: 48.2, hp: 80, route: 0 }],
        events: [{ type: 'enemy:spawned', payload: { enemy: ref(5) } }],
      }));
      const view = spawned[0];
      expect(view.id).toBe('enemy-5');
      expect(view.typeConfig.id).toBe('zombie');
      expect(view.movement.routeId).toBe('north');
      expect(view.movement.path).toEqual([AT]);
      expect(mirror.enemy('enemy-5')).toBe(view);

      feed(mirror, bus, packet({ enemies: [{ num: 5, type: 'zombie', lat: 48.3, hp: 40, route: 1, progress: 0.5 }] }));
      expect(view.position.lat).toBe(48.3);
      expect(view.health.hp).toBe(40);
      expect(view.movement.getPathProgress()).toBe(0.5);
      expect(view.movement.routeId).toBe('south');
      expect(mirror.aliveEnemies()).toEqual([view]);

      // Dying: in the table, not alive
      feed(mirror, bus, packet({ enemies: [{ num: 5, type: 'zombie', hp: 0, flags: EF_ACTIVE }] }));
      expect(view.alive).toBe(false);
      expect(mirror.enemies()).toEqual([view]);
      expect(mirror.aliveEnemies()).toEqual([]);

      feed(mirror, bus, packet({}));
      expect(view.active).toBe(false);
      expect(mirror.enemies()).toEqual([]);
      expect(mirror.enemy('enemy-5')).toBeNull();
    });

    it('shows an event the numbers of its moment, and those of the table after the events', () => {
      const bus = createMainEventBus();
      const hp: number[] = [];
      bus.on('enemy:spawned', (e) => hp.push(e.enemy.health.hp));
      mirror.applyState(packet({ enemies: [{ num: 5, type: 'zombie', lat: 48.2, hp: 80, route: 0 }] }));

      // The event was emitted sub-steps before the packet's end
      feed(mirror, bus, packet({
        enemies: [{ num: 5, type: 'zombie', lat: 48.3, hp: 40, route: 1, progress: 0.5 }],
        events: [{ type: 'enemy:spawned', payload: { enemy: ref(5, { lat: 48.25, hp: 60, route: 0, pr: 0.25 }) } }],
      }));

      expect(hp).toEqual([60]);
      const view = mirror.enemy('enemy-5')!;
      expect(view.health.hp).toBe(40);
      expect(view.position.lat).toBe(48.3);
      expect(view.movement.getPathProgress()).toBe(0.5);
      expect(view.movement.routeId).toBe('south');
    });

    it('builds a view from a table row it has no ref for', () => {
      mirror.applyState(packet({ enemies: [{ num: 9, type: 'spider' }] }));
      expect(mirror.enemy('enemy-9')?.typeConfig.id).toBe('spider');
    });

    it('hands an enemy that left with this packet to its events', () => {
      mirror.applyState(packet({ enemies: [{ num: 3, type: 'zombie' }] }));
      const view = mirror.enemy('enemy-3')!;
      const leak = packet({ events: [{ type: 'enemy:reached-base', payload: { enemy: ref(3, { alive: false }), damage: 5 } }] });
      mirror.applyState(leak);
      const event = mirror.importEvent(leak.events[0]) as { enemy: EnemyView; damage: number };
      expect(event.enemy).toBe(view);
      expect(event.damage).toBe(5);
      expect(view.alive).toBe(false);
    });

    it('ties worm segments to their group; the group reads hp from the worm table', () => {
      const p = packet({
        enemies: [{ num: 1, type: 'zombie' }],
        worms: [{ group: 4, head: 1, remaining: 6, size: 6, hp: 500, maxHp: 600 }],
        events: [{ type: 'enemy:spawned', payload: { enemy: ref(1, { worm: { g: 4, slot: 0, head: true } }) } }],
      });
      mirror.applyState(p);
      const event = mirror.importEvent(p.events[0]) as { enemy: EnemyView };
      const group = event.enemy.worm!.group;
      expect(group.num).toBe(4);
      expect(group.hp()).toBe(500);
      expect(group.maxHp).toBe(600);
      expect(group.chains).toBe(1);
      expect(group.type?.id).toBe('zombie');
      expect([...mirror.wormGroups()]).toEqual([group]);
    });

    it('shows the enemies and worms it held as gone when a new run clears it', () => {
      const p = packet({
        enemies: [{ num: 1, type: 'zombie' }, { num: 2, type: 'zombie' }],
        worms: [{ group: 4, head: 1, remaining: 6, size: 6, hp: 500, maxHp: 600 }],
        events: [{ type: 'enemy:spawned', payload: { enemy: ref(1, { worm: { g: 4, slot: 0, head: true } }) } }],
      });
      mirror.applyState(p);
      const group = (mirror.importEvent(p.events[0]) as { enemy: EnemyView }).enemy.worm!.group;
      const boss = mirror.enemy('enemy-2')!;

      mirror.clear();

      // What a holder (the boss bar) reads of them: gone, as a row that went
      expect([boss.alive, boss.active]).toEqual([false, false]);
      expect(group.remaining).toBe(0);
      expect(group.chains).toBe(0);
    });
  });

  describe('importEvent', () => {
    it('turns refs into views anywhere in the payload and leaves other values alone', () => {
      mirror.applyState(packet({}));
      const elapsed = new Map([['a', 1]]);
      const view = mirror.importEvent({
        type: 'enemy:split',
        payload: { enemy: ref(1), children: [ref(2), ref(3)], extra: { at: { x: 1, y: 2, z: 3 }, elapsed } },
        live: true,
        show: true,
      }) as unknown as { type: string; enemy: EnemyView; children: EnemyView[]; extra: { at: object; elapsed: Map<string, number> } };
      expect(view.type).toBe('enemy:split');
      expect(view.enemy.id).toBe('enemy-1');
      expect(view.children.map((c) => c.id)).toEqual(['enemy-2', 'enemy-3']);
      expect(view.extra.at).toEqual({ x: 1, y: 2, z: 3 });
      expect(view.extra.elapsed).toBe(elapsed);
    });

    it('keeps the research, abilities and hero of each player', () => {
      mirror.applyState(packet({ scalars: { players: ['a', 'b'], localPlayerId: 'b', credits: [10, 20], phase: 'wave' } }));
      mirror.importEvent({
        type: 'research:state-changed',
        payload: { activeResearches: [{ researchId: 'x', duration: 10, elapsed: 1, cost: 5 }], completedResearches: new Set(['aa-retrofit']), queuedResearches: [], centerLevel: 1, maxSlots: 2, playerId: 'a', local: false },
        live: true,
        show: true,
      });
      mirror.importEvent({
        type: 'ability:state-changed',
        payload: { abilities: [{ id: 'emp', unlocked: true, charges: 1, maxCharges: 1, wavesUntilCharge: 0, pending: false, launchSite: true }], playerId: 'b', local: true },
        live: true,
        show: true,
      });
      expect(mirror.researchOf('a').getActiveResearches()[0].elapsed).toBe(1);
      expect(mirror.researchOf('a').maxSlots).toBe(2);
      expect(mirror.researchOf('a').airTargetingUnlocked).toBe(true);
      expect(mirror.researchOf('b').airTargetingUnlocked).toBe(false);
      expect(mirror.creditsOf('b')).toBe(20);
      expect(mirror.checkUse('emp')).toBeNull();
      expect(mirror.checkUse('emp', 'a')).toBe('locked');
      expect(mirror.checkUse('frost-bomb')).toBe('locked');
      expect(mirror.heroStatus('a').hired).toBe(false);
      expect(mirror.heroDefenseProfile('a')).toBeNull();
    });
  });

  describe('players', () => {
    it('credits a kill to the tower owner, the hero player, the ability owner, else the first player', () => {
      const real = new Tower(AT, 'archer');
      real.ownerId = 'b';
      mirror.applyState(packet({ scalars: { players: ['a', 'b'] }, towerStates: [towerDto(real)] }));
      expect(mirror.killCreditPlayer({ kind: 'tower', towerId: real.id })).toBe('b');
      expect(mirror.killCreditPlayer({ kind: 'hero', heroId: 'hero:b' })).toBe('b');
      expect(mirror.killCreditPlayer({ kind: 'ability', ownerId: 'b' })).toBe('b');
      expect(mirror.killCreditPlayer({ kind: 'debug' })).toBe('a');
      expect(mirror.killCreditPlayer(null)).toBe('a');
    });

    it('lets the local player select a partner tower to look at, not a partner building', () => {
      const own = new Tower(AT, 'archer');
      own.ownerId = 'a';
      const partner = new Tower(AT, 'archer');
      partner.ownerId = 'b';
      const building = new Tower(AT, 'research-center');
      building.ownerId = 'b';
      mirror.applyState(packet({
        scalars: { players: ['a', 'b'], localPlayerId: 'a', mannedTowers: [own.id, null] },
        towerStates: [towerDto(own), towerDto(partner), towerDto(building)],
      }));
      expect(mirror.selectableTower(own.id)).toBe(own.id);
      expect(mirror.selectableTower(partner.id)).toBe(partner.id);
      expect(mirror.selectableTower(building.id)).toBeNull();
      expect(mirror.mayManage(mirror.tower(partner.id)!)).toBe(false);
      expect(mirror.mannedTower()?.id).toBe(own.id);
      expect(mirror.mannedTower('b')).toBeNull();
    });

    it('resets its random source to the run seed, and again with a new run on the same seed', () => {
      mirror.applyState(packet({ scalars: { seed: 1234 } }));
      expect(mirror.rng.seed).toBe(1234);
      const director = mirror.rng.stream('director');
      const first = director();
      director();
      const reset = packet({ scalars: { seed: 1234 }, events: [{ type: 'game:reset' }] });
      feed(mirror, null, reset);
      expect(director()).toBe(first);
    });

    it('reads each player ability damage', () => {
      mirror.applyState(packet({ scalars: { players: ['a', 'b'], abilityDamage: [5, 7] } }));
      expect(mirror.abilityDamageOf('b')).toBe(7);
      expect(mirror.abilityDamageOf('x')).toBe(0);
    });
  });

  describe('time', () => {
    it('is the time of the event while one is handed on, of the packet otherwise', () => {
      const p = packet({ scalars: { gameTimeMs: 5000, subStep: 300 } });
      mirror.applyState(p);
      expect(mirror.gameTimeMs).toBe(5000);
      mirror.importEvent({ type: 'wave:started', payload: { wave: 1, enemyCount: 3 }, live: true, show: true, t: 4200, step: 252 });
      expect(mirror.gameTimeMs).toBe(4200);
      expect(mirror.subStep).toBe(252);
      mirror.afterFrame(p);
      expect(mirror.gameTimeMs).toBe(5000);
      expect(mirror.subStep).toBe(300);
    });

    it('has the credits, HQ and enemies of the event while one that carries them is handed on', () => {
      const p = packet({ scalars: { players: ['a', 'b'], credits: [300, 90], baseHealth: 400, enemiesAlive: 12 } });
      mirror.applyState(p);
      // The wave ended before a purchase in the same packet: its numbers are the ones before the purchase
      mirror.importEvent({
        type: 'wave:completed', payload: { wave: 3 }, live: true, show: true, t: 4200, step: 252,
        moment: { credits: [350, 90], baseHealth: 410, enemiesAlive: 0 },
      });
      expect(mirror.creditsOf('a')).toBe(350);
      expect(mirror.baseHealth).toBe(410);
      expect(mirror.enemiesAlive).toBe(0);
      // An event without them reads the packet's
      mirror.importEvent({ type: 'tower:placed', payload: {}, live: true, show: true, t: 4300, step: 258 });
      expect(mirror.creditsOf('a')).toBe(300);
      mirror.afterFrame(p);
      expect(mirror.creditsOf('a')).toBe(300);
      expect(mirror.baseHealth).toBe(400);
      expect(mirror.enemiesAlive).toBe(12);
    });

    it('takes the route progress of an enemy from its reference', () => {
      mirror.applyState(packet({}));
      const view = mirror.importEvent({ type: 'enemy:died', payload: { enemy: ref(8, { pr: 0.75, alive: false }) }, live: true, show: true }) as { enemy: EnemyView };
      expect(view.enemy.movement.getPathProgress()).toBe(0.75);
    });
  });
});
