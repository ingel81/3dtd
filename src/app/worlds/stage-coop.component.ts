import { ChangeDetectionStrategy, Component, inject, isDevMode } from '@angular/core';
import { CoopAppHintComponent } from '../components/main-menu/pages/coop/coop-app-hint.component';
import { CoopWaysComponent } from '../components/main-menu/pages/coop/coop-ways.component';
import { coopAccess } from '../coop/coop-access';
import { readDesktopBridge } from '../core/desktop-bridge';
import { WorldsStageService } from './worlds-stage.service';

/**
 * Coop on the globes (docs/WORLDS_NAVIGATION_PLAN.md, 3.1): the same page as
 * Coop in the game's menu (CoopWaysComponent) without a game behind it. A
 * room is joined with its code, which opens the game on the room as an
 * invite link does; a room is hosted from a world's game. In a browser on
 * the site only the way to the desktop app.
 */
@Component({
  selector: 'app-stage-coop',
  standalone: true,
  imports: [CoopAppHintComponent, CoopWaysComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (access === 'hint') {
      <app-coop-app-hint />
    } @else {
      <app-coop-ways (joinCode)="join($event)" />
    }
  `,
})
export class StageCoopComponent {
  private readonly stage = inject(WorldsStageService);
  readonly access = coopAccess(readDesktopBridge() !== null, typeof location === 'undefined' ? '' : location.hostname, isDevMode());

  /** A code opens the game on the room, as an invite link does (the room's map follows the host); a run held in a wave asks first */
  join(code: string): void {
    this.stage.joinRoom(code);
  }
}
