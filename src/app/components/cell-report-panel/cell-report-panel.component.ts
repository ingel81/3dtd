import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CellReportService } from '../../services/debug/cell-report.service';
import { MAX_REPORT_CELLS } from '../../services/debug/cell-report';

/**
 * Panel of the cell report while it is on (CellReportService): how many
 * grid cells are selected, a note, Copy JSON, Clear and Done. Also draws
 * the box of a Shift drag. Takes clicks only on the panel itself.
 */
@Component({
  selector: 'app-cell-report-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cell-report-panel.component.html',
  styleUrl: './cell-report-panel.component.scss',
})
export class CellReportPanelComponent {
  readonly report = inject(CellReportService);
  readonly maxCells = MAX_REPORT_CELLS;

  onNote(event: Event): void {
    this.report.note.set((event.target as HTMLInputElement).value);
  }
}
