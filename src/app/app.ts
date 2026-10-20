import { Component, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WorldChoiceService } from './world/world-choice.service';
import { GameStore } from './store/game.store';
import { UIStore } from './store/ui.store';
import { mayLeaveForOpenedMap } from './world/opened-map-leave';
import { injectT } from './i18n/i18n.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
  styles: [`:host { display: block; width: 100vw; height: 100vh; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  constructor() {
    // A map double-clicked in the desktop app plays, wherever the page is (game or editor), in this
    // window (WorldSession). In a run it asks first (the editor asks through its own unsaved-changes
    // question, desktop/src/main.js); a coop room's map is the host's to pick
    const mayLeave = mayLeaveForOpenedMap(inject(GameStore), inject(UIStore), (question) => window.confirm(question), injectT());
    inject(DestroyRef).onDestroy(inject(WorldChoiceService).playOpenedMaps(mayLeave));
  }
}
