import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../icon/icon.component';
import { GameStore } from '../../../../store/game.store';
import { SAVE_GAME, type LoadResult } from '../../../../services/save-game/save-game.port';
import { loadSlotRows, saveSlotRows } from './slot-rows';

/** What the page asks before it does it, in its own body */
export type SlotConfirm =
  | { kind: 'overwrite'; slotId: string; title: string }
  | { kind: 'load'; slotId: string; title: string }
  | { kind: 'import' }
  | { kind: 'delete'; slotId: string; title: string };

/**
 * The slots of the menu's Save and Load pages (docs/SAVE_LOAD_PLAN.md, from
 * the former game menu): Save lists every manual slot and asks before it
 * overwrites one; Load lists the filled slots, the autosave first, each with
 * a file download and, but for the autosave, Delete, and below Load from a
 * file. A load that ends the run under way asks first. A load works before
 * the first place too: the save's place loads (SAVE_GAME.startPlace) and
 * the load goes on there. A line under the list says what came of the last
 * action.
 */
@Component({
  selector: 'app-save-slots',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './save-slots.component.html',
  styleUrl: './save-slots.component.scss',
})
export class SaveSlotsComponent {
  readonly saves = inject(SAVE_GAME);
  private readonly store = inject(GameStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('importInput');

  readonly mode = input.required<'save' | 'load'>();
  /** A save loaded and nothing left to say: the menu closes */
  readonly loaded = output<void>();

  readonly confirm = signal<SlotConfirm | null>(null);
  /** The last save, load or export said this; a problem is `bad` */
  readonly status = signal<{ text: string; bad: boolean } | null>(null);
  readonly busy = signal(false);

  /** The run has begun: a load ends something */
  private readonly underWay = computed(() => this.store.gameStarted() || this.store.towerCount() > 0);
  /** Loading replaces the run: between waves only, like saving */
  readonly canLoad = computed(() => !this.store.waveActive());
  readonly cannotLoadReason = computed(() => (this.canLoad() ? null : 'Loads between waves.'));

  readonly saveRows = computed(() => saveSlotRows(this.saves.slots()));
  readonly loadRows = computed(() => loadSlotRows(this.saves.slots()));

  constructor() {
    void this.saves.refresh();
  }

  async saveTo(slotId: string, filled: boolean, title: string): Promise<void> {
    if (!this.saves.canSave()) return;
    if (filled && this.confirm()?.kind !== 'overwrite') {
      this.ask({ kind: 'overwrite', slotId, title });
      return;
    }
    this.cancelConfirm();
    await this.run(async () => {
      const result = await this.saves.save(slotId);
      this.status.set(result.ok ? { text: 'Saved.', bad: false } : { text: result.reason, bad: true });
    });
  }

  /** Load a slot; a run under way is asked about first */
  askLoad(slotId: string, title: string): void {
    if (!this.canLoad()) return;
    if (this.underWay()) {
      this.ask({ kind: 'load', slotId, title });
      return;
    }
    void this.loadSlot(slotId);
  }

  async loadSlot(slotId: string): Promise<void> {
    this.cancelConfirm();
    await this.run(async () => this.afterLoad(await this.saves.load(slotId)));
  }

  /** Load from a file: ask about the run under way, then pick the file */
  askImport(): void {
    if (!this.canLoad()) return;
    if (this.underWay() && this.confirm()?.kind !== 'import') {
      this.ask({ kind: 'import' });
      return;
    }
    this.confirm.set(null);
    this.fileInput()?.nativeElement.click();
  }

  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.run(async () => this.afterLoad(await this.saves.importFile(file)));
  }

  /** Loaded: back to the game, unless the save came from another version; then the page says so first */
  private afterLoad(result: LoadResult): void {
    if (!result.ok) this.status.set({ text: result.reason, bad: true });
    else if (result.note) this.status.set({ text: `Loaded. ${result.note}`, bad: false });
    else this.loaded.emit();
  }

  async exportSlot(slotId: string): Promise<void> {
    await this.run(async () => {
      const result = await this.saves.exportFile(slotId);
      if (!result.ok) this.status.set({ text: result.reason, bad: true });
    });
  }

  askDelete(slotId: string, title: string): void {
    this.ask({ kind: 'delete', slotId, title });
  }

  async deleteSlot(slotId: string): Promise<void> {
    this.cancelConfirm();
    await this.run(() => this.saves.deleteSlot(slotId));
  }

  cancelConfirm(): void {
    this.confirm.set(null);
    this.focusFirst();
  }

  private ask(confirm: SlotConfirm): void {
    this.confirm.set(confirm);
    this.focusFirst();
  }

  /** What was clicked went with the question: the focus moves to the first button now shown */
  private focusFirst(): void {
    afterNextRender(() => {
      this.host.nativeElement.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    }, { injector: this.injector });
  }

  /**
   * One save, load, export or delete at a time. Its button is disabled
   * meanwhile, which drops the focus to the page; it goes back to that
   * button afterwards (or to the first one, when the question that started
   * it is gone), so Esc and Tab still reach the menu.
   */
  private async run(work: () => Promise<void>): Promise<void> {
    const before = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);
    this.busy.set(true);
    this.status.set(null);
    try {
      await work();
    } finally {
      this.busy.set(false);
      afterNextRender(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (!lost) return;
        const host = this.host.nativeElement;
        const back = before?.isConnected && host.contains(before) && !(before as HTMLButtonElement).disabled
          ? before
          : host.querySelector<HTMLElement>('button:not([disabled])');
        back?.focus();
      }, { injector: this.injector });
    }
  }
}
