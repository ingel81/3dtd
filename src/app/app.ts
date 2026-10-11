import { Component, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WorldChoiceService } from './world/world-choice.service';

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
    inject(DestroyRef).onDestroy(inject(WorldChoiceService).playOpenedMaps());
  }
}
