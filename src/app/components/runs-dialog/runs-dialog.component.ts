import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
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
  imports: [CommonModule, MatDialogModule, MatButtonModule, TdIconComponent],
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

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.runs.set(await this.runLog.store.list());
    this.loading.set(false);
  }

  /** Waves the run reached, and where it was played. */
  subtitle(run: StoredRun): string {
    const where = run.head.location?.name ?? (run.head.map === 'devworld' ? 'DevWorld' : 'a place');
    const who = run.head.player === 'bot' ? `bot ${run.head.botSkill ?? ''}`.trim() : 'you';
    return `${where} · wave ${run.waveReached} · ${who}`;
  }

  save(run: StoredRun): void {
    downloadRun({ head: run.head, records: run.records });
  }

  async remove(run: StoredRun): Promise<void> {
    await this.runLog.store.remove(run.runId);
    await this.reload();
  }

  close(): void {
    this.dialogRef.close();
  }
}
