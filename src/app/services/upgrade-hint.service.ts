import { Injectable, signal } from '@angular/core';
import type { UpgradeId } from '../configs/tower-types.config';
import type { UpgradeRefusal } from '../utils/player-actions';

/** How long the tower panel shows what the last U press did (ms). */
export const UPGRADE_HINT_MS = 2500;

/** What the last U press did to a tower. */
export interface UpgradeHint {
  towerId: string;
  /** Counts up with every press, so a second U on the same tile flashes it again */
  seq: number;
  /** The track U bought, null when it bought nothing */
  upgradeId: UpgradeId | null;
  /** Why it bought nothing, null when it bought */
  refusal: UpgradeRefusal | null;
}

/**
 * Feedback of the U key in the tower and research panels (HotkeyService
 * writes it): the tile it bought flashes, or a line says why it bought
 * nothing. A click on a tile needs neither, the player is looking at it.
 *
 * Wall clock, like SellConfirmService: it times a UI gesture and has to run
 * out while the game is paused as well.
 */
@Injectable({ providedIn: 'root' })
export class UpgradeHintService {
  /** The last press, null once UPGRADE_HINT_MS have passed. */
  readonly hint = signal<UpgradeHint | null>(null);

  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  bought(towerId: string, upgradeId: UpgradeId): void {
    this.show({ towerId, seq: ++this.seq, upgradeId, refusal: null });
  }

  refused(towerId: string, refusal: UpgradeRefusal): void {
    this.show({ towerId, seq: ++this.seq, upgradeId: null, refusal });
  }

  private show(hint: UpgradeHint): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.hint.set(hint);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.hint.set(null);
    }, UPGRADE_HINT_MS);
  }
}
