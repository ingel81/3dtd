import { ChangeDetectionStrategy, Component, inject, isDevMode, signal } from '@angular/core';
import { CoopAppHintComponent } from '../components/main-menu/pages/coop/coop-app-hint.component';
import { coopAccess } from '../coop/coop-access';
import { readDesktopBridge } from '../core/desktop-bridge';
import { WorldSession } from '../world/world-session.service';
import { PLAIN_START } from '../world/world-start';

/**
 * Coop on the globes (docs/WORLDS_NAVIGATION_PLAN.md, 3.1): a room is
 * joined with its code, which opens the game on its Coop page as an invite
 * link does (the room's map follows the host). A room is hosted from a
 * world's game: Start, then Coop in its menu. In a browser on the site only
 * the way to the desktop app.
 */
@Component({
  selector: 'app-stage-coop',
  standalone: true,
  imports: [CoopAppHintComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    @if (access === 'hint') {
      <app-coop-app-hint />
    } @else {
      <section class="td-group" aria-labelledby="sc-join">
        <h3 class="td-section" id="sc-join">Join a room</h3>
        <p class="td-note">The code the host gave you. The game opens on its Coop page; the room's map loads there.</p>
        <form class="td-inline" (submit)="join($event)">
          <input class="td-input is-code" type="text" maxlength="12" autocomplete="off" spellcheck="false"
                 aria-label="Room code" placeholder="CODE" [value]="code()" (input)="code.set($any($event.target).value)">
          <button type="submit" class="td-btn-primary" [disabled]="!code().trim()">Join</button>
        </form>
      </section>
      <section class="td-group" aria-labelledby="sc-host">
        <h3 class="td-section" id="sc-host">Host a room</h3>
        <p class="td-note">Pick a world and start a place or a map, then open Coop in its menu (Esc) and host it there.</p>
      </section>
    }
  `,
})
export class StageCoopComponent {
  private readonly session = inject(WorldSession);
  readonly access = coopAccess(readDesktopBridge() !== null, typeof location === 'undefined' ? '' : location.hostname, isDevMode());
  readonly code = signal('');

  join(event: Event): void {
    event.preventDefault();
    const code = this.code().trim().toUpperCase();
    if (!code) return;
    this.session.open({ ...PLAIN_START, room: { code, lane: null } });
  }
}
