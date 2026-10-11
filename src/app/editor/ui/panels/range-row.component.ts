import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * A value to dial: name, slider, number, unit (`td-range-row`). `changing`
 * fires while the slider moves, `changed` once it is let go or the number
 * is typed.
 */
@Component({
  selector: 'app-editor-range',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-range-row' },
  template: `
    <span class="td-trunc" [attr.id]="uid">{{ label() }}</span>
    <input class="td-slider" type="range" [min]="min()" [max]="max()" [step]="step()" [value]="value()"
           [attr.aria-labelledby]="uid" (input)="slide($event)" (change)="commit($event)" />
    <input class="td-input" type="number" [min]="min()" [max]="max()" [step]="step()" [value]="shown()"
           [attr.aria-labelledby]="uid" (change)="commit($event)" />
    <span class="td-muted">{{ unit() }}</span>
  `,
})
export class RangeRowComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly unit = input('');
  readonly changing = output<number>();
  readonly changed = output<number>();
  readonly uid = `er-${Math.random().toString(36).slice(2, 8)}`;

  shown(): number {
    const v = this.value();
    const s = this.step();
    return s >= 1 ? Math.round(v) : Math.round(v * 100) / 100;
  }

  slide(e: Event): void {
    this.changing.emit(this.read(e));
  }

  commit(e: Event): void {
    const v = this.read(e);
    this.changing.emit(v);
    this.changed.emit(v);
  }

  private read(e: Event): number {
    const v = Number((e.target as HTMLInputElement).value);
    return Math.min(this.max(), Math.max(this.min(), Number.isFinite(v) ? v : this.min()));
  }
}
