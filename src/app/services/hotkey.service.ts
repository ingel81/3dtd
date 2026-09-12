import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { getAllTowerTypes } from '../configs/tower-types.config';
import { stepGameSpeed } from '../configs/game-speed.config';
import { GameStateManager } from '../managers/game-state.manager';
import { GameStore } from '../store/game.store';
import { ResearchStore } from '../store/research.store';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { canPickTowerCard, firstAffordableUpgrade } from '../utils/player-actions';
import { isTypingTarget } from '../utils/keyboard-target';
import { openHotkeyHelpDialog } from '../components/hotkey-help-dialog/hotkey-help-dialog.component';
import { TowerDefenseFacadeService } from './facade/tower-defense-facade.service';
import { HotkeyAction, resolveHotkey } from './hotkey-map';
import { SellConfirmService } from './sell-confirm.service';
import { TowerPlacementService } from './tower-placement.service';

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

  /** BUILD panel order, the number keys follow it */
  private readonly towerTypes = getAllTowerTypes();

  handleKeyDown(event: KeyboardEvent): void {
    if (!this.acceptsKey(event)) return;
    const action = resolveHotkey(event);
    if (action && this.run(action)) {
      event.preventDefault();
    }
  }

  /**
   * A focused button fires its click on the keyup of Space. The keydown
   * already stood for "start the wave", so the button must not act on it too.
   */
  handleKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ' && this.acceptsKey(event)) {
      event.preventDefault();
    }
  }

  private acceptsKey(event: KeyboardEvent): boolean {
    return !event.defaultPrevented
      && !isTypingTarget(event.target)
      // A dialog owns the keyboard; the help dialog closes itself on H and ?
      && this.dialog.openDialogs.length === 0
      && !this.store.loading()
      && !this.store.error();
  }

  /** @returns true when the key did something */
  private run(action: HotkeyAction): boolean {
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
    }
  }

  private selectTower(slot: number): boolean {
    const tower = this.towerTypes[slot];
    if (!tower || this.uiStore.mapPlacementMode()) return false;
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

  private upgrade(): boolean {
    const tower = this.store.selectedTower();
    if (!tower) return false;
    const upgradeId = firstAffordableUpgrade(tower, this.store.credits(), this.researchStore.maxUpgradeTier());
    if (!upgradeId) return false;
    this.facade.upgradeTower(tower, upgradeId);
    return true;
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
   * Esc that build and placement mode left over: close the open quick-actions
   * menu, else drop a pending sale, else deselect the tower.
   */
  private cancel(): boolean {
    if (this.uiStore.openMenu()) {
      this.uiStore.openMenu.set(null);
      return true;
    }
    if (this.sellConfirm.armedTowerId()) {
      this.sellConfirm.disarm();
      return true;
    }
    if (this.store.selectedTower()) {
      this.gameState.towerManager.selectTower(null);
      return true;
    }
    return false;
  }
}
