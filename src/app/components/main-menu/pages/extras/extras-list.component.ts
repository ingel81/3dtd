import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TdIconComponent } from '../../../icon/icon.component';
import { GameStore } from '../../../../store/game.store';
import { UIStore } from '../../../../store/ui.store';
import { COOP } from '../../../../services/coop.token';
import { WhatsNewService } from '../../../../services/onboarding/whats-new.service';
import { RunLogFacade } from '../../../../run-log/run-log.facade';
import { ReplayService } from '../../../../services/replay.service';
import { BenchmarkService } from '../../../../benchmark/benchmark.service';
import { LocationManagementService } from '../../../../services/location/location-management.service';
import { REPLAY_CONFIG } from '../../../../configs/replay.config';
import { LEGAL_URL } from '../../../../utils/public-url';
import { openRunsDialog } from '../../../runs-dialog/open-runs-dialog';
import { openHotkeyHelpDialog } from '../../../hotkey-help-dialog/open-hotkey-help-dialog';
import { openAttributionsDialog } from '../../../attributions-dialog/open-attributions-dialog';
import { openDamageMatrixDialog } from '../../../damage-matrix-dialog/open-damage-matrix-dialog';

export const REPO_URL = 'https://github.com/ingel81/3dtd';

/**
 * The menu's Extras page: replays and runs, the run log, what's new, the
 * keys, damage against armor, the benchmark, attributions, Legal & privacy
 * and the source on GitHub, as plain rows. The dialogs open over the menu
 * and Esc leads back to it; a replay that starts and the benchmark leave
 * the menu. Lines under the list say what came of the last file action.
 */
@Component({
  selector: 'app-extras-list',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './extras-list.component.html',
  styleUrl: './extras-list.component.scss',
})
export class ExtrasListComponent {
  private readonly dialog = inject(MatDialog);
  private readonly store = inject(GameStore);
  private readonly ui = inject(UIStore);
  private readonly whatsNew = inject(WhatsNewService);
  private readonly runLog = inject(RunLogFacade);
  private readonly locationMgmt = inject(LocationManagementService);
  /** The game component's; outside the game none of these */
  private readonly coop = inject(COOP, { optional: true });
  readonly replay = inject(ReplayService, { optional: true });
  private readonly benchmark = inject(BenchmarkService, { optional: true });
  private readonly replayInput = viewChild<ElementRef<HTMLInputElement>>('replayInput');

  /** A replay started from here: the menu makes way for it */
  readonly leave = output<void>();

  readonly legalUrl = LEGAL_URL;
  readonly repoUrl = REPO_URL;

  readonly status = signal<{ text: string; bad: boolean } | null>(null);
  readonly busy = signal(false);
  readonly confirmBenchmark = signal(false);

  private readonly inCoop = computed(() => !!this.coop && (this.coop.inGame() || this.coop.room() !== null));
  /** The benchmark reloads the page: not in coop, where the room would lose the player */
  readonly canBenchmark = computed(() => this.benchmark !== null && !this.inCoop());

  /** A replay file plays on the place loaded, between waves or after game over, not in coop */
  readonly replayOffered = this.replay !== null && REPLAY_CONFIG.offered;
  readonly cannotLoadReplay = computed(() => {
    if (!this.locationMgmt.hq()) return 'Load a place first.';
    if (this.ui.coopMapLocked() || this.inCoop()) return 'Replays are off in a coop game.';
    if (this.store.waveActive()) return 'A replay loads between waves.';
    return null;
  });
  readonly canSaveReplay = computed(() => (this.replay?.recordedWave() ?? null) !== null);

  pickReplay(): void {
    if (this.cannotLoadReplay()) return;
    this.replayInput()?.nativeElement.click();
  }

  async onReplayFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const replay = this.replay;
    if (!file || !replay) return;
    this.status.set(null);
    await replay.loadFile(file);
    // The file brought a replay up: back to the game, where its bar plays it
    if (replay.active()) this.leave.emit();
    else this.status.set({ text: replay.fileProblem() ?? 'The replay did not start.', bad: true });
  }

  async saveReplay(): Promise<void> {
    this.busy.set(true);
    try {
      const saved = (await this.replay?.saveFile()) ?? false;
      this.status.set(saved ? { text: 'Replay saved.', bad: false } : { text: 'No wave to save yet.', bad: true });
    } finally {
      this.busy.set(false);
    }
  }

  exportRunLog(): void {
    this.status.set(this.runLog.export()
      ? { text: 'Run log saved.', bad: false }
      : { text: 'No run to save yet.', bad: true });
  }

  openRuns(): void {
    void openRunsDialog(this.dialog);
  }

  openWhatsNew(): void {
    this.whatsNew.open();
  }

  openKeys(): void {
    void openHotkeyHelpDialog(this.dialog);
  }

  openDamageMatrix(): void {
    void openDamageMatrixDialog(this.dialog);
  }

  openAttributions(): void {
    void openAttributionsDialog(this.dialog);
  }

  /** Reload into the DevWorld and measure (BenchmarkService.start), asked first */
  runBenchmark(): void {
    if (!this.canBenchmark()) return;
    if (!this.confirmBenchmark()) {
      this.confirmBenchmark.set(true);
      return;
    }
    this.benchmark?.start();
  }
}
