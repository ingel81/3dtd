import { Component, ChangeDetectionStrategy, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { CoopService } from '../../services/coop.service';
import { ownsKey } from '../../utils/keyboard-target';
import { modalDialogCount } from '../coop-dialog/open-coop-dialog';
import { ABILITY_BAR_EDGE_PX, ABILITY_BAR_PX } from '../ability-bar/ability-button';

/** How long a chat line stays once it came, ms */
const LINE_MS = 15_000;
/** Lines shown at most */
const MAX_LINES = 6;

/**
 * The coop chat in the game (docs/COOP_PLAN.md, review R12): the last lines
 * at the bottom left, right of the ability bar, for a while each; Enter opens
 * a line to write, Enter sends it, Esc closes it. The lobby has its chat in
 * the coop panel.
 */
@Component({
  selector: 'app-coop-chat',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.left.px]': 'left',
    '(document:keydown)': 'onKey($event)',
  },
  template: `
    @if (coop.inGame()) {
      <div class="lines" role="log" aria-live="polite" aria-label="Coop chat">
        @for (line of visibleLines(); track line.at) {
          <div class="line" [class.is-me]="line.me"><span class="from">{{ line.name }}</span> {{ line.text }}</div>
        }
      </div>
      @if (writing()) {
        <input #field class="field" type="text" maxlength="200" placeholder="Say something, Enter sends, Esc closes"
               (keydown.enter)="send($any($event.target).value); $event.stopPropagation()"
               (keydown.escape)="close(); $event.stopPropagation()" (blur)="close()" />
      } @else {
        <div class="hint">Enter: chat</div>
      }
    }
  `,
  styles: `
    :host {
      position: absolute;
      bottom: 28px;
      z-index: 6;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 3px;
      max-width: 360px;
      pointer-events: none;
      ${TD_CSS_VARS}
    }
    .lines {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .line {
      padding: 3px 8px;
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-dark);
      font: 500 12px/1.3 var(--td-font-body);
      color: var(--td-text-primary);
    }
    .from {
      font-weight: 700;
      color: var(--td-gold-light);
    }
    .line.is-me .from {
      color: var(--td-teal-light);
    }
    .field {
      pointer-events: auto;
      width: 320px;
      padding: 5px 8px;
      background: var(--td-panel-main);
      border: 1px solid var(--td-gold-dark);
      color: var(--td-text-primary);
      font: 500 12px/1.3 var(--td-font-body);
      outline: none;
    }
    .hint {
      font: 600 9px/1 var(--td-font-mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--td-text-muted);
      opacity: 0.7;
    }
  `,
})
export class CoopChatComponent {
  readonly coop = inject(CoopService);
  private readonly dialog = inject(MatDialog);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly left = ABILITY_BAR_EDGE_PX + ABILITY_BAR_PX.clear;
  readonly writing = signal(false);
  /** When each chat line came here, by its place in CoopService.chat */
  private readonly arrived: number[] = [];
  private readonly now = signal(performance.now());

  readonly visibleLines = computed(() => {
    const now = this.now();
    const lines = this.coop.chat();
    while (this.arrived.length < lines.length) this.arrived.push(performance.now());
    const me = this.coop.playerId();
    return lines
      .map((line, i) => ({ ...line, at: this.arrived[i] ?? 0, me: line.from === me, name: this.coop.nameOf(line.from) }))
      .filter((line) => this.writing() || now - line.at < LINE_MS)
      .slice(-MAX_LINES);
  });

  constructor() {
    // Re-read the clock when a line comes and when the youngest runs out
    effect((onCleanup) => {
      this.coop.chat();
      this.now.set(performance.now());
      const timer = setTimeout(() => this.now.set(performance.now()), LINE_MS + 50);
      onCleanup(() => clearTimeout(timer));
    });
    // The field takes the focus as it opens
    effect(() => this.field()?.nativeElement.focus());
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || this.writing() || !this.coop.inGame()) return;
    if (ownsKey(event.target, event.key) || modalDialogCount(this.dialog) > 0) return;
    event.preventDefault();
    this.writing.set(true);
  }

  send(text: string): void {
    this.coop.sendChat(text);
    this.close();
  }

  close(): void {
    this.writing.set(false);
    this.now.set(performance.now());
  }
}
