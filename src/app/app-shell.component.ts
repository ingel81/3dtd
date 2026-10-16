import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, EnvironmentInjector, Type, createEnvironmentInjector, effect, inject, signal, untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GameHostComponent } from './game-host.component';
import { AppScreen, type Screen } from './world/app-screen.service';
import { WorldStartService } from './world/world-start';

/** The editor's page and the injector that keeps its session over the game's turns */
interface EditorPart {
  page: Type<unknown>;
  injector: EnvironmentInjector;
}

/**
 * The game and the map editor in one window (docs/WORLDS_NAVIGATION_PLAN.md,
 * phase 4): both routes (`/` and `/editor`) show this shell, the route only
 * says which comes first. From then on AppScreen switches, the address
 * stays. The editor's code loads the first time it shows; its session
 * (EditorSession: the open map, its history, the tools) lives in an injector
 * of its own here, so the map and its undo steps stay while the game shows.
 * Its view, renderer and canvas go with the page.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [GameHostComponent, NgComponentOutlet],
  template: `
    @if (screen() === 'game') {
      <app-game-host />
    } @else if (editor(); as part) {
      <ng-container *ngComponentOutlet="part.page; injector: part.injector" />
    }
  `,
  styles: [`:host { display: block; width: 100%; height: 100%; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly screens = inject(AppScreen);
  protected readonly screen = this.screens.screen;
  protected readonly editor = signal<EditorPart | null>(null);
  private loading = false;

  constructor() {
    const entry = (inject(ActivatedRoute).snapshot.data['screen'] as Screen | undefined) ?? 'game';
    if (entry === 'editor') this.screens.openEditor(inject(WorldStartService).editorMap);
    const parent = inject(EnvironmentInjector);
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => untracked(this.editor)?.injector.destroy());
    effect(() => {
      if (this.screen() !== 'editor' || untracked(this.editor) || this.loading) return;
      this.loading = true;
      void Promise.all([import('./editor/ui/editor-page.component'), import('./editor/ui/editor-session.service')]).then(([page, session]) => {
        if (destroyRef.destroyed) return;
        const injector = createEnvironmentInjector([session.EditorSession], parent, 'EditorSession');
        this.editor.set({ page: page.EditorPageComponent, injector });
      });
    });
  }
}
