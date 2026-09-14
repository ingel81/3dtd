import { Injectable, signal } from '@angular/core';
import type { UpgradeId } from '../configs/tower-types.config';
import type { UpgradeRefusal } from '../utils/player-actions';

/** How long the tower panel shows what the last U press or tile click did (ms). */
export const UPGRADE_HINT_MS = 2500;

/** What the last U press or tile click did to a tower. */
export interface UpgradeHint {
  towerId: string;
  /** Counts up with every purchase, so a second one on the same tile flashes it again */
  seq: number;
  /** The track bought, null when nothing was */
  upgradeId: UpgradeId | null;
  /** Why nothing was bought, null when it was */
  refusal: UpgradeRefusal | null;
}

/**
 * Feedback of an upgrade purchase in the tower and research panels, from U
 * or a click on a tile (TowerUpgradeService writes it): the tile it bought
 * flashes, or a line says why it bought nothing.
 *
 * Wall clock, like SellConfirmService: it times a UI gesture and has to run
 * out while the game is paused as well.
 */
@Injectable({ providedIn: 'root' })
export class UpgradeHintService {
  /** The last purchase or refusal, null once UPGRADE_HINT_MS have passed. */
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
