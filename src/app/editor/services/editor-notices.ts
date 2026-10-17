/**
 * What the editor tells the player: a line in the status bar that goes
 * after a few seconds (`flash`), and a banner that stays until it is
 * closed (`error`). Every service of the session says things here.
 */
import { signal } from '@angular/core';

/** How long a flashed line stays in the status bar */
const FLASH_MS = 3500;

export class EditorNotices {
  readonly status = signal('');
  readonly error = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  flash(message: string): void {
    this.status.set(message);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.status.set(''), FLASH_MS);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
