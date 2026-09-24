import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { downloadRun } from '../../run-log/run-log.export';
import type { StoredRun } from '../../run-log/run-log.store';
import { MAX_RUNS } from '../../run-log/run-log.store';

/**
 * The runs this browser kept, newest first, each one to save as a file.
 *
 * Nothing here leaves the machine: a run is handed to the player, and they
 * decide who gets it (docs/RUN_LOG.md, decision D6).
 */
@Component({
  selector: 'app-runs-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './runs-dialog.component.html',
  styleUrl: './runs-dialog.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class RunsDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<RunsDialogComponent>);
  private readonly runLog = inject(RunLogFacade);

  readonly runs = signal<StoredRun[]>([]);
  readonly loading = signal(true);
  readonly maxRuns = MAX_RUNS;
  /** "Delete all" asks once, in the footer, before it deletes. */
  readonly confirmingClear = signal(false);

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.runs.set(await this.runLog.store.list());
    this.loading.set(false);
  }

  /** Where it was played. DevWorld first: its HQ sits at 0,0 and would read as coordinates. */
  place(run: StoredRun): string {
    if (run.head.map === 'devworld') return 'DevWorld';
    return run.head.location?.name ?? 'Unknown place';
  }

  /** Who played it. */
  who(run: StoredRun): string {
    if (run.head.coop) return `coop: ${run.head.coop.players.join(', ')}`;
    return run.head.player === 'bot' ? `bot ${run.head.botSkill ?? ''}`.trim() : 'you';
  }

  save(run: StoredRun): void {
    downloadRun({ head: run.head, records: run.records });
  }

  async remove(run: StoredRun): Promise<void> {
    await this.runLog.store.remove(run.runId);
    await this.reload();
  }

  async clearAll(): Promise<void> {
    this.confirmingClear.set(false);
    await this.runLog.store.clear();
    await this.reload();
  }

  close(): void {
    this.dialogRef.close();
  }
}
