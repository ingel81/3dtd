import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  Input,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { BootStep, MissionInfo } from './boot-step.model';
import { FIELD_TIPS, FieldTip } from './field-tips';

@Component({
  selector: 'td-loading-screen',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './loading-screen.component.html',
  styleUrl: './loading-screen.component.scss',
})
export class LoadingScreenComponent implements OnInit, OnDestroy {
  @Input() mission: MissionInfo | null = null;
  @Input() steps: BootStep[] = [];
  @Input() buildVersion = '';
  @Input() tilesVersion = '';
  /** When set, the mission strip switches to "DEV WORLD · seed N". */
  @Input() devWorldSeed: number | null = null;
  @Input() tipRotateMs = 6000;
  /**
   * When true, fade out the dark background layers (faux-map, vignette,
   * radar pulse) so the real 3D-Tiles canvas underneath shows through —
   * the boot panel + field tip stay on top. Wire to engineInit.tilesLoading
   * so the reveal happens the moment first tiles render.
   */
  @Input() tilesReady = false;

  readonly tips: FieldTip[] = FIELD_TIPS;
  currentTipIndex = 0;
  private rotator?: ReturnType<typeof setInterval>;

  private readonly cdr = inject(ChangeDetectorRef);

  ngOnInit(): void {
    this.currentTipIndex = Math.floor(Math.random() * this.tips.length);
    this.startRotator();
  }

  ngOnDestroy(): void {
    this.stopRotator();
  }

  get currentTip(): FieldTip {
    return this.tips[this.currentTipIndex];
  }

  get currentStep(): BootStep | undefined {
    return this.steps.find((s) => s.status === 'current');
  }

  get doneCount(): number {
    return this.steps.filter((s) => s.status === 'done').length;
  }

  get percent(): number {
    if (!this.steps.length) return 0;
    return Math.round((this.doneCount / this.steps.length) * 100);
  }

  prevTip(): void {
    this.currentTipIndex = (this.currentTipIndex - 1 + this.tips.length) % this.tips.length;
    this.restartRotator();
  }

  nextTip(): void {
    this.currentTipIndex = (this.currentTipIndex + 1) % this.tips.length;
    this.restartRotator();
  }

  private startRotator(): void {
    // Timer runs inside Angular's zone so each tick produces a CD cycle —
    // OnPush + markForCheck guarantees only this component re-renders, which
    // is cheap enough during the boot sequence to not worry about overhead.
    this.rotator = setInterval(() => {
      this.currentTipIndex = (this.currentTipIndex + 1) % this.tips.length;
      this.cdr.markForCheck();
    }, this.tipRotateMs);
  }

  private stopRotator(): void {
    if (this.rotator) {
      clearInterval(this.rotator);
      this.rotator = undefined;
    }
  }

  private restartRotator(): void {
    this.stopRotator();
    this.startRotator();
  }
}
