import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

// Only their DI tokens are needed, as in hotkey.service.spec.ts
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('../components/hotkey-help-dialog/open-hotkey-help-dialog', () => ({ openHotkeyHelpDialog: vi.fn() }));
vi.mock('./facade/tower-defense-facade.service', () => ({
  TowerDefenseFacadeService: class TowerDefenseFacadeService {},
}));
vi.mock('../managers/game-state.manager', () => ({ GameStateManager: class GameStateManager {} }));
vi.mock('./tower-placement.service', () => ({ TowerPlacementService: class TowerPlacementService {} }));
vi.mock('./camera-control.service', () => ({ CameraControlService: class CameraControlService {} }));
vi.mock('./world/intro-camera-flight.service', () => ({
  IntroCameraFlightService: class IntroCameraFlightService {},
}));
vi.mock('./ability-targeting.service', () => ({ AbilityTargetingService: class AbilityTargetingService {} }));
vi.mock('./photo-mode.service', () => ({ PhotoModeService: class PhotoModeService {} }));
vi.mock('./hero-control.service', () => ({ HeroControlService: class HeroControlService {} }));
vi.mock('./replay.service', () => ({ ReplayService: class ReplayService {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { HotkeyService } from './hotkey.service';
import { TowerDefenseFacadeService } from './facade/tower-defense-facade.service';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { GameStore } from '../store/game.store';
import { UIStore } from '../store/ui.store';
import { ResearchStore } from '../store/research.store';
import { TowerPlacementService } from './tower-placement.service';
import { SellConfirmService } from './sell-confirm.service';
import { CameraControlService } from './camera-control.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { AbilityTargetingService } from './ability-targeting.service';
import { PhotoModeService } from './photo-mode.service';
import { HeroControlService } from './hero-control.service';
import { ReplayService } from './replay.service';
import { UPGRADE_HINT_MS, UpgradeHintService } from './upgrade-hint.service';
import { GameEventBus } from '../game-engine/game-event-bus';
import { ResearchManager } from '../managers/research.manager';
import { CreditsLedger } from '../managers/game-state/credits-ledger';
import { TowerLifecycle } from '../managers/game-state/tower-lifecycle';
import { GameCommandsHandler } from '../managers/game-commands.handler';
import { Tower } from '../entities/tower.entity';
import { upgradeKeyView } from '../components/game-sidebar/tower-panel/tower-stats';
import type { TowerTypeId, UpgradeId } from '../configs/tower-types.config';

const POSITION = { lat: 48.7, lon: 9.1, height: 300 };
/** Colours of the text over the tower (hotkey.service.ts UPGRADE_KEY_TEXT) */
const GOLD = '#D9BC68';
const ORANGE = '#C96A3A';

/**
 * Playtest 518, 519 and 520 (docs/REVIEW_FIX_2026-09-14.md) replayed: U
 * through HotkeyService on real towers, the purchase through the facade's
 * command into GameCommandsHandler and TowerLifecycle with the real credits
 * and research tier, the panel line through upgradeKeyView as the tower and
 * research panels read it.
 */
describe('U on the selected tower, playtest 518, 519 and 520 replayed', () => {
  let service: HotkeyService;
  let bus: GameEventBus;
  let research: ResearchManager;
  let ledger: CreditsLedger;
  let lifecycle: TowerLifecycle;
  let towers: Tower[];
  let upgradeHint: UpgradeHintService;
  let spawnFloatingText: ReturnType<typeof vi.fn>;
  let facade: {
    upgradeTower: (tower: Tower, upgradeId: UpgradeId) => boolean;
    startWave: () => void;
    sellSelectedTower: () => void;
  };
  const selectedTower = signal<Tower | null>(null);

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new GameEventBus();
    research = new ResearchManager(bus);
    ledger = new CreditsLedger(bus);
    towers = [];
    selectedTower.set(null);
    // A range track also refreshes the tower's LOS and guard heading (recomputeRangeAfterUpgrade)
    lifecycle = new TowerLifecycle(
      { getAll: () => towers, refreshGuardHeading: vi.fn() } as never,
      research,
      { phase: () => 'setup' } as never,
      {} as never,
      { recomputeTowerLOS: vi.fn() } as never,
      { turnToGuardHeading: vi.fn() } as never,
      {} as never,
      ledger,
      bus,
      () => null,
      () => undefined,
    );
    new GameCommandsHandler(
      { towerManager: { getAll: () => towers }, upgradeTower: (t: Tower, id: UpgradeId) => lifecycle.upgrade(t, id) } as never,
      bus,
    );
    // GameLoopFacadeService.upgradeTower: checks the credits and the last level, then the
    // command, synchronous on the bus
    facade = {
      upgradeTower: vi.fn((tower: Tower, upgradeId: UpgradeId) => {
        if (ledger.credits() < tower.getNextUpgradeCost(upgradeId) || !tower.canUpgrade(upgradeId)) return false;
        bus.emit({ type: 'command:upgrade-tower', towerId: tower.id, upgradeId });
        return true;
      }),
      startWave: vi.fn(),
      sellSelectedTower: vi.fn(),
    };
    spawnFloatingText = vi.fn();
    upgradeHint = new UpgradeHintService();

    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseFacadeService, useValue: facade },
        {
          provide: GameStateManager,
          useValue: { towerManager: { selectTower: vi.fn() }, tilesEngine: { effects: { spawnFloatingText } } },
        },
        {
          provide: TowerDefenseStore,
          useValue: {
            loading: signal(false),
            error: signal<string | null>(null),
            selectedTower,
            credits: ledger.credits,
            canStartWave: signal(false),
            isGameOver: signal(false),
          },
        },
        { provide: GameStore, useValue: { paused: signal(false), trainingTimescale: signal(1) } },
        {
          provide: UIStore,
          useValue: { openMenu: signal(null), mapPlacementMode: signal(null), buildMode: signal(false), selectedTowerType: signal(null) },
        },
        {
          provide: ResearchStore,
          useValue: {
            centerPlaced: () => research.centerLevel > 0,
            maxUpgradeTier: () => research.getMaxUpgradeTier(),
            isTowerUnlocked: () => true,
          },
        },
        { provide: TowerPlacementService, useValue: {} },
        { provide: SellConfirmService, useValue: new SellConfirmService() },
        { provide: MatDialog, useValue: { open: vi.fn(), openDialogs: [] } },
        { provide: CameraControlService, useValue: {} },
        { provide: IntroCameraFlightService, useValue: { active: signal(false) } },
        { provide: AbilityTargetingService, useValue: {} },
        { provide: PhotoModeService, useValue: { active: signal(false) } },
        { provide: HeroControlService, useValue: {} },
        { provide: ReplayService, useValue: { active: signal(false) } },
        { provide: UpgradeHintService, useValue: upgradeHint },
      ],
    });
    service = runInInjectionContext(injector, () => new HotkeyService());
  });

  afterEach(() => vi.useRealTimers());

  const place = (typeId: TowerTypeId) => {
    const tower = new Tower(POSITION, typeId);
    towers.push(tower);
    return tower;
  };
  const pressU = () => {
    const event = new KeyboardEvent('keydown', { key: 'u', cancelable: true });
    service.handleKeyDown(event);
    return event;
  };
  const setCredits = (credits: number) => ledger.add(credits - ledger.credits());
  const levels = (tower: Tower) => tower.typeConfig.upgrades.map((u) => tower.getUpgradeLevel(u.id));
  /** Text and colour of the last text over the tower */
  const lastText = () => {
    const call = spawnFloatingText.mock.calls.at(-1)!;
    return [call[0], call[4].color];
  };
  /** The line over the tiles of the tower's panel */
  const panelLine = (tower: Tower) => upgradeKeyView(upgradeHint.hint(), tower).refusalText;

  it('518: short of the cheapest track U buys nothing, NEED n CREDITS rises, the line stays 2.5 s', () => {
    const archer = place('archer');
    selectedTower.set(archer);
    const tracks = archer.getAvailableUpgrades();
    // The cheapest track, the first of equal ones (upgradeRefusal)
    const cheapest = tracks.reduce((a, b) =>
      (archer.getNextUpgradeCost(b.id) < archer.getNextUpgradeCost(a.id) ? b : a));
    setCredits(archer.getNextUpgradeCost(cheapest.id) - 20);
    const creditsBefore = ledger.credits();

    expect(pressU().defaultPrevented).toBe(true);
    expect(levels(archer).every((level) => level === 0)).toBe(true);
    expect(ledger.credits()).toBe(creditsBefore);
    expect(lastText()).toEqual(['NEED 20 CREDITS', ORANGE]);
    expect(panelLine(archer)).toBe(`Need 20 more credits for ${cheapest.name}`);

    vi.advanceTimersByTime(UPGRADE_HINT_MS - 1);
    expect(panelLine(archer)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(panelLine(archer)).toBeNull();
  });

  it('518: with the credits cheat U raises every track to level 5, then says NEEDS RESEARCH', () => {
    const archer = place('archer');
    selectedTower.set(archer);
    setCredits(100_000);

    for (let i = 0; i < 200; i++) {
      pressU();
      if (upgradeHint.hint()?.refusal) break;
    }
    expect(levels(archer)).toEqual(archer.typeConfig.upgrades.map((u) => Math.min(5, u.maxLevel)));
    expect(research.getMaxUpgradeTier()).toBe(1);
    expect(lastText()).toEqual(['NEEDS RESEARCH', ORANGE]);
    expect(panelLine(archer)).toBe('Research Advanced Weaponry for the next levels');
    // The first press bought the first track, in gold
    expect(spawnFloatingText.mock.calls[0][0]).toBe(`${archer.typeConfig.upgrades[0].name.toUpperCase()} LV 1`);
    expect(spawnFloatingText.mock.calls[0][4].color).toBe(GOLD);
  });

  it('519: after Max Up U says FULLY UPGRADED; a Research Center built later gets RESEARCH WING LV 1, without credits the line', () => {
    const archer = place('archer');
    lifecycle.maxUpgradeAll();
    expect(archer.getAvailableUpgrades()).toEqual([]);
    selectedTower.set(archer);
    pressU();
    expect(lastText()).toEqual(['FULLY UPGRADED', ORANGE]);
    expect(panelLine(archer)).toBe('Fully upgraded');

    const center = place('research-center');
    research.onCenterPlaced();
    selectedTower.set(center);
    setCredits(10_000);
    pressU();
    expect(center.getUpgradeLevel('research-slots')).toBe(1);
    expect(research.maxSlots).toBe(2);
    expect(lastText()).toEqual(['RESEARCH WING LV 1', GOLD]);
    // SidebarResearchPanelComponent.keyView: the Research Wing tile flashes
    expect(upgradeKeyView(upgradeHint.hint(), center).flashId).toBe('research-slots');

    setCredits(0);
    pressU();
    const cost = center.getNextUpgradeCost('research-slots');
    expect(lastText()).toEqual([`NEED ${cost} CREDITS`, ORANGE]);
    expect(panelLine(center)).toBe(`Need ${cost} more credits for Research Wing`);
  });

  it('520: U with nothing selected does nothing; a click on a tile buys as before and raises no text', () => {
    const archer = place('archer');
    setCredits(10_000);
    expect(pressU().defaultPrevented).toBe(false);
    expect(levels(archer).every((level) => level === 0)).toBe(true);

    // The tile: TowerPanel.onUpgradeTower, its output, TowerDefenseFacadeService.upgradeTower
    selectedTower.set(archer);
    const track = archer.typeConfig.upgrades[0].id;
    expect(facade.upgradeTower(archer, track)).toBe(true);
    expect(archer.getUpgradeLevel(track)).toBe(1);
    expect(spawnFloatingText).not.toHaveBeenCalled();
    expect(upgradeHint.hint()).toBeNull();
  });
});
