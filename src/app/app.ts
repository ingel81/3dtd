import { Component, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WorldChoiceService } from './world/world-choice.service';
import { GameStore } from './store/game.store';

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
    // A map double-clicked in the desktop app plays, wherever the page is (game or editor)
    // In a run it asks first (the editor asks through its own unsaved-changes question, desktop/src/main.js)
    const game = inject(GameStore);
    const mayLeave = (name: string) =>
      (game.phase() === 'setup' && game.waveNumber() === 0) || game.isGameOver() || window.confirm(`Leave this game and play ${name}?`);
    inject(DestroyRef).onDestroy(inject(WorldChoiceService).playOpenedMaps(mayLeave));
  }
}
