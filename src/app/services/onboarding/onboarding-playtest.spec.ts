/**
 * The first-run tips through the playtest steps 502 to 507 of
 * docs/archive/REVIEW_FIX_2026-09-14.md, checked here instead of by hand. Research,
 * abilities and the hero are the real managers on the bus, so the research
 * center, the Research Wing and the research cheat send what the game
 * sends. Towers, waves, the strike and the hire go out in the shape their
 * managers emit them (TowerManager, TowerLifecycle, WaveManager,
 * AbilityManager, HeroManager). Credits do not matter to the tips, so the
 * credit cheat of the playtest has no step here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { ResearchManager } from '../../managers/research.manager';
import { AbilityManager, AbilityWorld } from '../../managers/ability.manager';
import { HeroManager, HeroWorld } from '../../managers/hero.manager';
import { RESEARCH_TREE } from '../../configs/research/research-tree.config';
import { heroStatus } from '../../configs/hero.config';
import { OnboardingService } from './onboarding.service';
import { ONBOARDING_KEY } from './onboarding';

const AT = { lat: 0, lon: 0 };
const tower = (id: string) => ({ id: `t-${id}`, typeConfig: { id } }) as never;
const FIRST_RESEARCH = Object.values(RESEARCH_TREE).find((r) => r.prerequisites.length === 0)!.id;

/** A game on its own bus: the managers the tips hear from, the rest as events */
class Game {
  readonly bus = new GameEventBus();
  readonly research = new ResearchManager(this.bus);
  readonly abilities = new AbilityManager(this.bus, {} as AbilityWorld);
  readonly hero = new HeroManager(this.bus, {} as HeroWorld);

  /** TowerLifecycle.placeTower: tower:placed, then the research center reports to research */
  place(id: string): void {
    this.bus.emit({ type: 'tower:placed', tower: tower(id), position: AT, cost: 0 });
    if (id === 'research-center') this.research.onCenterPlaced();
  }

  /** TowerLifecycle.upgrade: the Research Wing adds a slot first, then tower:upgraded */
  upgrade(id: string): void {
    if (id === 'research-center') this.research.upgradeCenter();
    this.bus.emit({ type: 'tower:upgraded', tower: tower(id), level: 1, cost: 0 });
  }

  startWave(wave: number): void {
    this.bus.emit({ type: 'wave:started', wave, enemyCount: 5 });
  }

  completeWave(wave: number): void {
    this.bus.emit({ type: 'wave:completed', wave, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
  }

  startResearch(): void {
    this.research.startResearch(FIRST_RESEARCH);
  }

  /** Debug window "Research": every research done, abilities and hero unlock from it */
  researchCheat(): void {
    this.research.completeAllResearch();
  }

  useAbility(): void {
    this.bus.emit({
      type: 'ability:used', abilityId: 'nuclear-strike', strikeId: 1, target: AT, radiusM: 25, warningMs: 1500,
    });
  }

  hireHero(): void {
    this.bus.emit({ type: 'hero:state-changed', hero: heroStatus(true, true, 0, 'standard', 'hold') });
  }

  /** GameStateManager.reset: the managers start over, then game:reset */
  newGame(): void {
    this.research.reset();
    this.abilities.reset();
    this.hero.reset();
    this.bus.emit({ type: 'game:reset' });
  }
}

/** 502 to 505 in one game, one move per player action */
const WALK: readonly ((g: Game) => void)[] = [
  (g) => g.place('archer'),
  (g) => g.startWave(1),
  (g) => g.completeWave(1),
  (g) => g.upgrade('archer'),
  (g) => g.startWave(2),
  (g) => g.completeWave(2),
  (g) => g.startWave(3),
  (g) => g.completeWave(3),
  (g) => g.place('research-center'),
  (g) => g.startResearch(),
  (g) => g.researchCheat(),
  (g) => g.startWave(4),
  (g) => g.useAbility(),
  (g) => g.hireHero(),
];

describe('first-run tips, playtest 502 to 507', () => {
  let game: Game;
  let service: OnboardingService;

  /** The tip on screen as the box shows it, e.g. "Upgrade a tower 3/7" */
  const label = (): string | null => {
    const tip = service.tip();
    return tip && `${tip.title} ${tip.index}/${tip.total}`;
  };

  const connectNew = (): void => {
    service?.disconnect();
    game = new Game();
    service = new OnboardingService();
    service.connect(game.bus);
  };

  beforeEach(() => {
    localStorage.clear();
    connectNew();
  });

  it('502 to 505: the tips along one game', () => {
    const seen = [label()];
    for (const move of WALK) {
      move(game);
      seen.push(label());
    }
    expect(seen).toEqual([
      'Build a tower 1/7',
      'Start the first wave 2/7',
      null, // wave 1 runs
      'Upgrade a tower 3/7',
      null, // upgraded, wave 3 not done
      null, // wave 2 runs
      null, // wave 2 done, the center tip waits for wave 3
      null, // wave 3 runs
      'Build a research center 4/7',
      'Start a research 5/7',
      null, // no ability researched yet
      'Use an ability 6/7',
      'Use an ability 6/7', // wave 4 runs
      'Hire the Mercenary 7/7',
      null, // hired: the tips are over
    ]);
    expect(service.state().done).toBe(true);
  });

  it('505: the research cheat shows the four ability keys, the strike the hero keys', () => {
    WALK.slice(0, 10).forEach((move) => move(game));
    expect(label()).toBeNull();

    game.researchCheat();
    expect(label()).toBe('Use an ability 6/7');
    expect(service.tip()!.keys).toEqual([
      { key: 'K', description: 'Nuclear Strike' },
      { key: 'F', description: 'Frost Bomb' },
      { key: 'E', description: 'EMP' },
      { key: 'L', description: 'Orbital Laser' },
    ]);

    game.startWave(4);
    game.useAbility();
    expect(label()).toBe('Hire the Mercenary 7/7');
    expect(service.tip()!.keys.map((k) => k.key)).toEqual(['G', 'V']);

    game.hireHero();
    expect(label()).toBeNull();
  });

  it('505: "Start a research" still up at the cheat stays until Skip', () => {
    WALK.slice(0, 9).forEach((move) => move(game));
    expect(label()).toBe('Start a research 5/7');
    game.researchCheat();
    expect(label()).toBe('Start a research 5/7');
    service.skip();
    expect(label()).toBe('Use an ability 6/7');
  });

  it('505: Tips after a game that did every step shows the whole round', () => {
    WALK.forEach((move) => move(game));
    expect(label()).toBeNull();
    service.restart();
    expect(label()).toBe('Build a tower 1/7');
  });

  it('505: Tips after a game that skipped "Start a research" shows that one', () => {
    WALK.slice(0, 9).forEach((move) => move(game));
    service.skip();
    WALK.slice(10).forEach((move) => move(game));
    expect(label()).toBeNull();
    service.restart();
    expect(label()).toBe('Start a research 5/7');
  });

  it.each([
    [8, 'Build a research center 4/7'],
    [10, null],
    [11, 'Use an ability 6/7'],
  ])('505 finding: Tips after %i moves shows %s, not the first tip', (moves, expected) => {
    WALK.slice(0, moves).forEach((move) => move(game));
    service.restart();
    expect(label()).toBe(expected);
  });

  it('505 finding: reload, new game and a new connect keep the done steps', () => {
    WALK.slice(0, 4).forEach((move) => move(game));
    expect(label()).toBeNull();

    // Restart after game over and a location change end in game:reset
    game.newGame();
    expect(label()).toBeNull();

    // Reload: a new service reads td_onboarding_v2, the engine connects it
    connectNew();
    expect(service.state().completed).toEqual(['build-tower', 'start-wave', 'upgrade-tower']);
    expect(label()).toBeNull();
    game.completeWave(1);
    expect(label()).toBeNull();
    game.completeWave(2);
    expect(label()).toBeNull();
    game.completeWave(3);
    expect(label()).toBe('Build a research center 4/7');

    // Engine set up again: connect() on the same service
    service.connect(game.bus);
    expect(service.state().completed).toEqual(['build-tower', 'start-wave', 'upgrade-tower']);
  });

  it('506: a research center built in wave 1, the Research Wing is no tower upgrade', () => {
    const seen: (string | null)[] = [];
    const look = () => {
      seen.push(label());
      return label();
    };

    expect(look()).toBe('Build a tower 1/7');
    game.place('archer');
    expect(look()).toBe('Start the first wave 2/7');
    game.startWave(1);
    expect(look()).toBeNull();
    game.place('research-center');
    expect(look()).toBe('Start a research 5/7');
    game.completeWave(1);
    expect(look()).toBe('Upgrade a tower 3/7');
    game.upgrade('research-center');
    expect(game.research.centerLevel).toBe(2);
    expect(look()).toBe('Upgrade a tower 3/7');
    game.upgrade('archer');
    expect(look()).toBe('Start a research 5/7');
    game.startWave(2);
    expect(look()).toBe('Start a research 5/7');
    game.completeWave(2);
    expect(look()).toBe('Start a research 5/7');
    game.startWave(3);
    game.completeWave(3);
    expect(look()).toBe('Start a research 5/7');

    expect(seen).not.toContain('Build a research center 4/7');
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('507: Hide tips at %i/7, no tip afterwards', (index) => {
    let next = 0;
    while (service.tip()?.index !== index) WALK[next++](game);
    service.hide();
    expect(label()).toBeNull();

    // The rest of this game, a whole new one, then a reload with another
    WALK.slice(next).forEach((move) => {
      move(game);
      expect(label()).toBeNull();
    });
    game.newGame();
    WALK.forEach((move) => {
      move(game);
      expect(label()).toBeNull();
    });
    connectNew();
    WALK.forEach((move) => {
      move(game);
      expect(label()).toBeNull();
    });
    expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY)!).done).toBe(true);
  });
});
