import { Component, ChangeDetectionStrategy, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { CoopService } from '../../services/coop.service';
import { UIStore } from '../../store/ui.store';
import { ownsKey } from '../../utils/keyboard-target';
import { chatView } from '../coop-ui/chat-view';

/** Lines shown at most */
const MAX_LINES = 6;
/** A line older than this is dimmed, ms */
const FRESH_MS = 15_000;
/** A line older than this goes, unless the player is writing, ms */
const SHOWN_MS = 60_000;

/**
 * The coop chat in the game (docs/COOP_PLAN.md, C8, review R12): the last
 * lines under the squad box on one scrim, older ones dimmed, system lines in
 * mono. Enter opens the composer, Enter sends, Esc closes. The coop keys
 * live here, since the global HotkeyService cannot see the game's
 * CoopService: X arms the map ping (R13), Tab opens and closes the room dock
 * (D42). The lobby has its chat in the dock.
 */
@Component({
  selector: 'app-coop-chat',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKey($event)',
  },
  template: `
    @if (coop.inGame()) {
      @if (lines().length > 0) {
        <div class="log" role="log" aria-live="polite" aria-label="Coop chat">
          @for (line of lines(); track line.id) {
            <div class="line" [class.is-old]="line.old" [class.is-sys]="line.system" [class.is-warn]="line.warn">
              @if (!line.system) { <b [style.color]="line.color">{{ line.name }}</b> }
              <span>{{ line.text }}</span>
            </div>
          }
        </div>
      }
      @if (writing()) {
        <div class="open">
          <span class="to">ALL</span>
          <input #field type="text" maxlength="200" placeholder="Say something" aria-label="Chat message"
                 (keydown.enter)="send($any($event.target).value); $event.stopPropagation()"
                 (keydown.escape)="close(); $event.stopPropagation()" (blur)="close()" />
          <kbd>Enter</kbd><kbd>Esc</kbd>
        </div>
      } @else if (coop.pingArmed()) {
        <div class="armed" role="status">Click the map to mark a place for everyone <kbd>Esc</kbd></div>
      } @else {
        <div class="hint"><kbd>Enter</kbd>chat<i>·</i><kbd>X</kbd>mark<i>·</i><kbd>Tab</kbd>room</div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 6px;
      ${TD_CSS_VARS}
    }
    .log {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 10px 12px;
      background: linear-gradient(90deg, rgba(11, 15, 12, 0.82), rgba(11, 15, 12, 0.55) 80%, transparent);
    }
    .line {
      display: flex;
      gap: 8px;
      font-size: 14px;
      line-height: 1.4;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    }
    .line b {
      flex: 0 0 auto;
      font-weight: 600;
    }
    .line span {
      color: var(--td-text-primary);
      overflow-wrap: anywhere;
    }
    .line.is-old {
      opacity: 0.45;
    }
    .line.is-sys span {
      font-family: var(--td-font-mono);
      font-size: 11.5px;
      color: var(--td-text-muted);
    }
    .line.is-sys.is-warn span {
      color: var(--td-warn-orange);
    }
    .open {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 6px 0 12px;
      pointer-events: auto;
      border: 1px solid var(--td-gold-dark);
      background: color-mix(in srgb, var(--td-panel-shadow) 92%, transparent);
    }
    .to {
      font-family: var(--td-font-mono);
      font-size: 10.5px;
      letter-spacing: 0.14em;
      color: var(--td-gold);
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: none;
      background: none;
      font: 14px var(--td-font-body);
      color: var(--td-text-primary);
    }
    kbd {
      font-family: var(--td-font-mono);
      font-size: 10px;
      padding: 1px 5px;
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
    }
    .hint {
      display: flex;
      align-items: center;
      gap: 6px;
      padding-left: 12px;
      font-family: var(--td-font-mono);
      font-size: 10.5px;
      color: var(--td-text-muted);
    }
    .hint i {
      font-style: normal;
      color: var(--td-text-disabled);
    }
    .armed {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 12px;
      border: 1px solid var(--td-gold-dark);
      background: color-mix(in srgb, var(--td-panel-shadow) 92%, transparent);
      font: 600 13px var(--td-font-body);
      color: var(--td-gold-light);
    }
  `,
})
export class CoopChatComponent {
  readonly coop = inject(CoopService);
  private readonly uiStore = inject(UIStore);
  private readonly dialog = inject(MatDialog);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  readonly writing = signal(false);
  private readonly now = signal(Date.now());

  readonly lines = computed(() => {
    const now = this.now();
    const writing = this.writing();
    const chat = this.coop.chat();
    return chatView(chat, (id) => this.coop.nameOf(id), (id) => this.coop.laneColorOf(id))
      .map((line, i) => ({ ...line, age: now - chat[i].at }))
      .filter((line) => writing || line.age < SHOWN_MS)
      .slice(-MAX_LINES)
      .map((line) => ({ ...line, old: !writing && line.age > FRESH_MS }));
  });

  constructor() {
    // Re-read the clock while lines are left to dim or go
    effect((onCleanup) => {
      if (this.coop.chat().length === 0) return;
      this.now.set(Date.now());
      const timer = setInterval(() => this.now.set(Date.now()), 5000);
      onCleanup(() => clearInterval(timer));
    });
    // The field takes the focus as it opens
    effect(() => this.field()?.nativeElement.focus());
  }

  onKey(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === 'escape' && this.coop.pingArmed()) {
      this.coop.cancelPing();
      return;
    }
    if (this.writing() || event.ctrlKey || event.altKey || event.metaKey) return;
    if (ownsKey(event.target, event.key) || this.dialog.openDialogs.length > 0) return;
    // Tab: the room dock, in the lobby and in the game (D42)
    if (key === 'tab' && !event.shiftKey && (this.coop.room() || this.uiStore.coopDockOpen())) {
      event.preventDefault();
      this.uiStore.coopDockOpen.update((open) => !open);
      return;
    }
    if ((key !== 'enter' && key !== 'x') || !this.coop.inGame()) return;
    event.preventDefault();
    if (key === 'x') this.coop.armPing();
    else this.writing.set(true);
  }

  send(text: string): void {
    this.coop.sendChat(text);
    this.close();
  }

  close(): void {
    this.writing.set(false);
    this.now.set(Date.now());
  }
}
