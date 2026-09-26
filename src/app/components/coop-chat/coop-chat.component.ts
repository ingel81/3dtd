import { Component, ChangeDetectionStrategy, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { CoopService } from '../../services/coop.service';
import { UIStore } from '../../store/ui.store';
import { controlTakesKey, ownsKey, trackFocusOrigin } from '../../utils/keyboard-target';
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
  templateUrl: './coop-chat.component.html',
  styleUrl: './coop-chat.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class CoopChatComponent {
  readonly coop = inject(CoopService);
  private readonly uiStore = inject(UIStore);
  private readonly dialog = inject(MatDialog);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  readonly writing = signal(false);
  /** The player sent a message: the key line under the chat goes */
  readonly sentOnce = signal(false);
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
    // Tab and Enter ask where the focus came from; watch it from the start
    trackFocusOrigin();
    // Re-read the clock while lines are shown, to dim or drop them; none shown, no timer
    effect((onCleanup) => {
      if (this.lines().length === 0) return;
      const timer = setTimeout(() => this.now.set(Date.now()), 5000);
      onCleanup(() => clearTimeout(timer));
    });
    // The field takes the focus as it opens
    effect(() => this.field()?.nativeElement.focus());
  }

  onKey(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === 'escape' && this.coop.pingArmed()) {
      // Taken here: the Esc chain of the HotkeyService would close the dock as well
      event.preventDefault();
      this.coop.cancelPing();
      return;
    }
    if (this.writing() || event.ctrlKey || event.altKey || event.metaKey) return;
    if (ownsKey(event.target, event.key) || this.dialog.openDialogs.length > 0) return;
    // A control reached by keyboard keeps Tab and Enter; inside the dock Tab walks its controls (U5)
    if (controlTakesKey(event.target, event.key) || (key === 'tab' && inDock(event.target))) return;
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
    if (text.trim()) this.sentOnce.set(true);
    this.coop.sendChat(text);
    this.close();
  }

  close(): void {
    this.writing.set(false);
    this.now.set(Date.now());
  }
}

/** The focus is inside the coop dock */
function inDock(target: EventTarget | null): boolean {
  return typeof (target as Element | null)?.closest === 'function' && !!(target as Element).closest('app-coop-dock');
}
