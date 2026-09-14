import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { getAllTowerTypes } from '../configs/tower-types.config';
import { stepGameSpeed } from '../configs/game-speed.config';
import { GameStateManager } from '../managers/game-state.manager';
import { GameStore } from '../store/game.store';
import { ResearchStore } from '../store/research.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { canPickTowerCard, firstAffordableUpgrade, upgradeRefusal, type UpgradeRefusal } from '../utils/player-actions';
import { ownsKey } from '../utils/keyboard-target';
import type { Tower } from '../entities/tower.entity';
import { openHotkeyHelpDialog } from '../components/hotkey-help-dialog/open-hotkey-help-dialog';
import { CameraControlService } from './camera-control.service';
import { TowerDefenseFacadeService } from './facade/tower-defense-facade.service';
import { IntroCameraFlightService } from './world/intro-camera-flight.service';
import { HotkeyAction, resolveHotkey } from './hotkey-map';
import { AbilityTargetingService } from './ability-targeting.service';
import type { AbilityId } from '../configs/abilities.config';
import { SellConfirmService } from './sell-confirm.service';
import { TowerPlacementService } from './tower-placement.service';
import { PhotoModeService } from './photo-mode.service';
import { HeroControlService } from './hero-control.service';
import { ReplayService } from './replay.service';
import { UpgradeHintService } from './upgrade-hint.service';

/**
 * Text rising over the tower after U: --td-gold-light for what it bought,
 * --td-warn-orange when it bought nothing. Starts `lift` metres above the
 * tower's shoot height.
 */
const UPGRADE_KEY_TEXT = {
  bought: '#D9BC68',
  refused: '#C96A3A',
  durationMs: 1600,
  floatSpeed: 1.3,
  scale: 0.8,
  lift: 3,
} as const;

/** The short reason over the tower when U bought nothing; the panel line says more. */
function refusalLabel(refusal: UpgradeRefusal): string {
  switch (refusal.kind) {
    case 'credits': return `NEED ${refusal.missing} CREDITS`;
    case 'tier': return 'NEEDS RESEARCH';
    case 'maxed': return 'FULLY UPGRADED';
  }
}

/**
 * Runs the game hotkeys (see hotkey-map.ts). The component hands it every key
 * after InputHandlerService, which owns the camera keys, build and placement
 * mode and the debug keys; a key that one handled arrives with
 * `defaultPrevented` and stays there.
 *
 * Each action takes the path of its button and checks what the button checks,
 * so a key can do nothing a click could not. Provided by the game component,
 * because the facade it drives is.
 */
@Injectable()
export class HotkeyService {
  private readonly facade = inject(TowerDefenseFacadeService);
  private readonly gameState = inject(GameStateManager);
  private readonly store = inject(TowerDefenseStore);
  private readonly gameStore = inject(GameStore);
  private readonly uiStore = inject(UIStore);
  private readonly researchStore = inject(ResearchStore);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly sellConfirm = inject(SellConfirmService);
  private readonly dialog = inject(MatDialog);
  private readonly cameraControl = inject(CameraControlService);
  private readonly introFlight = inject(IntroCameraFlightService);
  private readonly abilityTargeting = inject(AbilityTargetingService);
  private readonly photoMode = inject(PhotoModeService);
  private readonly heroControl = inject(HeroControlService);
  private readonly replay = inject(ReplayService);
  private readonly upgradeHint = inject(UpgradeHintService);

  /** BUILD panel order, the number keys follow it */
  private readonly towerTypes = getAllTowerTypes();

  /** Spawn point N flew to last, -1 before the first press */
  private spawnIndex = -1;

  /** The Space press that is down started the wave (handleKeyUp) */
  private spaceStartedWave = false;

  handleKeyDown(event: KeyboardEvent): void {
    // Held Space repeats its keydown; the first one decides
    if (event.key === ' ' && !event.repeat) this.spaceStartedWave = false;
    if (!this.acceptsKey(event)) return;
    const action = resolveHotkey(event);
    if (action && this.run(action)) {
      event.preventDefault();
      if (action.kind === 'start-wave') this.spaceStartedWave = true;
    }
  }

  /**
   * A focused button fires its click on the keyup of Space. When the keydown
   * started the wave, the button must not act on it too (an upgrade bought
   * by accident). Any other Space press clicks the focused button as usual.
   */
  handleKeyUp(event: KeyboardEvent): void {
    if (event.key !== ' ' || !this.spaceStartedWave) return;
    this.spaceStartedWave = false;
    event.preventDefault();
  }

  private acceptsKey(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
      && !ownsKey(event.target, event.key)
      // A dialog owns the keyboard; the help dialog closes itself on H and ?
      && this.dialog.openDialogs.length === 0
      && !this.store.loading()
      && !this.store.error();
  }

  /** @returns true when the key did something */
  private run(action: HotkeyAction): boolean {
    if (this.replay.active()) return this.runInReplay(action);
    switch (action.kind) {
      case 'select-tower': return this.selectTower(action.slot);
      case 'upgrade': return this.upgrade();
      case 'sell': return this.sell();
      case 'start-wave': return this.startWave();
      case 'pause': return this.togglePause();
      case 'speed': return this.stepSpeed(action.step);
      case 'help':
        openHotkeyHelpDialog(this.dialog);
        return true;
      case 'cancel': return this.cancel();
      case 'ability': return this.toggleAbility(action.abilityId);
      case 'hero': return this.heroControl.summon();
      case 'hero-ammo': return this.heroControl.cycleAmmo();
      case 'camera-hq': return this.focusHq();
      case 'camera-spawn': return this.focusNextSpawn();
      case 'photo-mode':
        this.photoMode.toggle();
        return true;
    }
  }

  /**
   * During the replay the game keys drive the replay: Space and P pause and
   * play it, + and - change its speed, Esc leaves it. The camera keys and
   * the help stay; building, selling, upgrading, abilities and photo mode
   * wait until the replay is over.
   */
  private runInReplay(action: HotkeyAction): boolean {
    switch (action.kind) {
      case 'start-wave':
      case 'pause':
        this.replay.togglePlay();
        return true;
      case 'speed':
        this.replay.stepSpeed(action.step);
        return true;
      case 'cancel':
        this.replay.exit();
        return true;
      case 'help':
        openHotkeyHelpDialog(this.dialog);
        return true;
      case 'camera-hq': return this.focusHq();
      case 'camera-spawn': return this.focusNextSpawn();
      default: return false;
    }
  }

  /**
   * Like the ability's button: arms the targeting mode when it can fire (a
   * wave runs, a charge is there), a second press leaves the mode.
   */
  private toggleAbility(id: AbilityId): boolean {
    // Photo mode hides the ability button; an aiming reticle would end up in the picture
    if (this.photoMode.active()) return false;
    if (this.abilityTargeting.targeting() === id) {
      this.abilityTargeting.cancel();
      return true;
    }
    this.abilityTargeting.start(id);
    return this.abilityTargeting.targeting() === id;
  }

  /**
   * G: select the hero like a click on him; pressed again while he is
   * selected, the camera flies to him.
   */
  /** The intro flight owns the camera while it plays. */
  private focusHq(): boolean {
    if (this.introFlight.active()) return false;
    const hq = this.store.baseCoords();
    return this.cameraControl.focusGeo(hq.lat, hq.lon);
  }

  private focusNextSpawn(): boolean {
    const spawns = this.store.spawnPoints();
    if (this.introFlight.active() || spawns.length === 0) return false;
    this.spawnIndex = (this.spawnIndex + 1) % spawns.length;
    const spawn = spawns[this.spawnIndex];
    return this.cameraControl.focusGeo(spawn.lat, spawn.lon);
  }

  private selectTower(slot: number): boolean {
    const tower = this.towerTypes[slot];
    // Photo mode hides the build panel; a build preview would end up in the picture
    if (!tower || this.uiStore.mapPlacementMode() || this.photoMode.active()) return false;
    const pickable = canPickTowerCard(tower, {
      credits: this.store.credits(),
      gameOver: this.store.isGameOver(),
      researchCenterPlaced: this.researchStore.centerPlaced(),
      isUnlocked: (id) => this.researchStore.isTowerUnlocked(id),
    });
    if (!pickable) return false;
    // Already building this one: keep the preview where it is
    if (this.uiStore.buildMode() && this.uiStore.selectedTowerType() === tower.id) return true;
    this.towerPlacement.selectTowerType(tower.id);
    return true;
  }

  /**
   * U answers on the map, where the player is looking when using the key:
   * the track and its new level rise over the tower and its tile flashes, or
   * the reason it bought nothing rises there and shows in the tower's panel
   * (UpgradeHintService).
   */
  private upgrade(): boolean {
    const tower = this.store.selectedTower();
    if (!tower) return false;
    const credits = this.store.credits();
    const maxTier = this.researchStore.maxUpgradeTier();
    const upgradeId = firstAffordableUpgrade(tower, credits, maxTier);
    if (!upgradeId) {
      const refusal = upgradeRefusal(tower, credits, maxTier);
      if (!refusal) return false;
      this.upgradeHint.refused(tower.id, refusal);
      this.floatOverTower(tower, refusalLabel(refusal), UPGRADE_KEY_TEXT.refused);
      return true;
    }
    if (!this.facade.upgradeTower(tower, upgradeId)) return false;
    this.upgradeHint.bought(tower.id, upgradeId);
    const name = tower.typeConfig.upgrades.find((u) => u.id === upgradeId)?.name ?? upgradeId;
    // The command ran synchronously on the bus, the level is the new one
    this.floatOverTower(tower, `${name.toUpperCase()} LV ${tower.getUpgradeLevel(upgradeId)}`, UPGRADE_KEY_TEXT.bought);
    return true;
  }

  private floatOverTower(tower: Tower, text: string, color: string): void {
    const effects = this.gameState.tilesEngine?.effects;
    if (!effects) return;
    const { lat, lon, height = 0 } = tower.position;
    const top = height + Math.max(tower.typeConfig.shootHeight, 0) + UPGRADE_KEY_TEXT.lift;
    effects.spawnFloatingText(text, lat, lon, top, {
      color,
      duration: UPGRADE_KEY_TEXT.durationMs,
      floatSpeed: UPGRADE_KEY_TEXT.floatSpeed,
      scale: UPGRADE_KEY_TEXT.scale,
    });
  }

  /** Delete arms the sale like the first click on Sell, a second press sells. */
  private sell(): boolean {
    const tower = this.store.selectedTower();
    if (!tower || tower.getSellValue() <= 0) return false;
    if (this.sellConfirm.request(tower.id)) {
      this.facade.sellSelectedTower();
    }
    return true;
  }

  private startWave(): boolean {
    if (!this.store.canStartWave()) return false;
    this.facade.startWave();
    return true;
  }

  private togglePause(): boolean {
    if (this.store.isGameOver()) return false;
    this.gameStore.paused.update((p) => !p);
    return true;
  }

  private stepSpeed(step: 1 | -1): boolean {
    if (this.store.isGameOver()) return false;
    this.gameStore.trainingTimescale.set(stepGameSpeed(this.gameStore.trainingTimescale(), step));
    return true;
  }

  /**
   * Esc that build and placement mode left over: leave photo mode, else close
   * the open quick-actions menu, else drop a pending sale, else let the hero
   * go, else deselect the tower.
   */
  private cancel(): boolean {
    if (this.photoMode.active()) {
      this.photoMode.exit();
      return true;
    }
    if (this.uiStore.openMenu()) {
      this.uiStore.openMenu.set(null);
      return true;
    }
    if (this.sellConfirm.armedTowerId()) {
      this.sellConfirm.disarm();
      return true;
    }
    if (this.heroControl.selected()) {
      this.heroControl.deselect();
      return true;
    }
    if (this.store.selectedTower()) {
      this.gameState.towerManager.selectTower(null);
      return true;
    }
    return false;
  }
}
