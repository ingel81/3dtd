import { Injectable, Injector, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { getAllTowerTypes } from '../configs/tower-types.config';
import { stepGameSpeed } from '../configs/game-speed.config';
import { GameStateManager } from '../managers/game-state.manager';
import { GameStore } from '../store/game.store';
import { ResearchStore } from '../store/research.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { canPickTowerCard } from '../utils/player-actions';
import { ownsKey } from '../utils/keyboard-target';
import { openHotkeyHelpDialog } from '../components/hotkey-help-dialog/open-hotkey-help-dialog';
import { openResearchDialog } from '../components/research-dialog/open-research-dialog';
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
import { TowerControlService } from './tower-control.service';
import { TowerUpgradeService } from './tower-upgrade.service';
import { DebugFacadeService } from './debug/debug-facade.service';
import { uiSound } from './ui-sound';

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
  // The research dialog emits commands through the facade, which lives in this
  // injector rather than in root (openResearchDialog).
  private readonly injector = inject(Injector);
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
  private readonly towerControl = inject(TowerControlService);
  private readonly towerUpgrade = inject(TowerUpgradeService);
  private readonly debugFacade = inject(DebugFacadeService);

  /** BUILD panel order, the number keys follow it */
  private readonly towerTypes = getAllTowerTypes();

  /** Spawn point N flew to last, -1 before the first press */
  private spawnIndex = -1;

  /** The Space press that is down started the wave (handleKeyUp) */
  private spaceStartedWave = false;

  handleKeyDown(event: KeyboardEvent): void {
    if (this.handleAlt(event, true)) return;
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
    if (this.handleAlt(event, false)) return;
    if (event.key !== ' ' || !this.spaceStartedWave) return;
    this.spaceStartedWave = false;
    event.preventDefault();
  }

  /** Losing the window loses the keyup of a held Alt: the bars go back. */
  handleWindowBlur(): void {
    this.debugFacade.setHealthBarsInverted(false);
  }

  /**
   * Alt held turns the health bars round (DebugFacadeService). Taken on
   * keydown and keyup alike: a lone Alt released would otherwise move the
   * focus to the browser's menu bar on Windows, and the next key goes there.
   * @returns true when the key was Alt
   */
  private handleAlt(event: KeyboardEvent, down: boolean): boolean {
    if (event.key !== 'Alt') return false;
    event.preventDefault();
    this.debugFacade.setHealthBarsInverted(down);
    return true;
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
    if (this.towerControl.active()) return this.runInTower(action);
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
      case 'research': return this.openResearch();
      case 'mute':
        this.uiStore.masterMuted.update((muted) => !muted);
        return true;
      case 'tower-control': return this.towerControl.toggle();
    }
  }

  /**
   * In a manned tower (TowerControlService) the game goes on around the
   * player: waves, pause, speed and sound stay. C and Esc get out.
   * Building, selling, upgrading, abilities, the hero, the camera keys,
   * photo mode and the dialogs wait: the view is the tower's aim, and the
   * captured mouse could not click a dialog.
   */
  private runInTower(action: HotkeyAction): boolean {
    switch (action.kind) {
      case 'tower-control':
      case 'cancel':
        this.towerControl.exit();
        return true;
      case 'start-wave': return this.startWave();
      case 'pause': return this.togglePause();
      case 'speed': return this.stepSpeed(action.step);
      case 'mute':
        this.uiStore.masterMuted.update((muted) => !muted);
        return true;
      default: return false;
    }
  }

  /**
   * The research tree, from anywhere. Nothing to research without a Research
   * Center, so the key does nothing until one stands, exactly as the button
   * in the sidebar is only there once it does.
   */
  private openResearch(): boolean {
    if (this.researchStore.centerLevel() === 0) return false;
    openResearchDialog(this.dialog, this.injector);
    return true;
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
   * wave runs, a charge is there, its launch site stands), a second press
   * leaves the mode. When it cannot, the context hint box says why.
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
      placedUnique: this.store.placedUniqueTypes(),
      isUnlocked: (id) => this.researchStore.isTowerUnlocked(id),
    });
    if (!pickable) {
      if (this.store.credits() < tower.cost && this.researchStore.isTowerUnlocked(tower.id)) uiSound.play('noMoney');
      return false;
    }
    // Already building this one: keep the preview where it is
    if (this.uiStore.buildMode() && this.uiStore.selectedTowerType() === tower.id) return true;
    this.towerPlacement.selectTowerType(tower.id);
    return true;
  }

  /** U buys the first upgrade it can and answers over the tower, see TowerUpgradeService. */
  private upgrade(): boolean {
    const tower = this.store.selectedTower();
    return tower !== null && this.towerUpgrade.buyFirst(tower);
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
    this.gameStore.gameSpeed.set(stepGameSpeed(this.gameStore.gameSpeed(), step));
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
    // Last: the coop dock closes, the room stays open (docs/COOP_UI_REWORK_PLAN.md, U5)
    if (this.uiStore.coopDockOpen()) {
      this.uiStore.coopDockOpen.set(false);
      return true;
    }
    return false;
  }
}
