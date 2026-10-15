import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MapBrowserComponent } from './browser/map-browser.component';
import { EditorSession } from './editor-session.service';
import { EditorShellComponent } from './shell/editor-shell.component';
import { MAP_EDITOR_WINDOW } from '../../world/map-trial';

/**
 * `/editor`: the map browser, or with `?map=<id>` that map in the editor.
 * The id in the address lets a reload reopen the map; the page follows the
 * address, so the browser's Back leaves the map for the list (and Forward
 * opens it again) like the editor's own buttons.
 */
@Component({
  selector: 'app-editor-page',
  standalone: true,
  imports: [MapBrowserComponent, EditorShellComponent],
  providers: [EditorSession],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (opened()) {
      <app-editor-shell (closed)="close()" />
    } @else {
      <app-map-browser [problem]="problem()" (open)="open($event)" />
    }
  `,
  styles: [`:host { display: block; width: 100%; height: 100%; }`],
})
export class EditorPageComponent implements OnInit {
  private readonly session = inject(EditorSession);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly opened = signal(false);
  readonly problem = signal<string | null>(null);
  /** The address change the page is following now; the next waits for it */
  private following: Promise<void> = Promise.resolve();

  ngOnInit(): void {
    // A name the test tab can call it by to come back (returnToEditor); the test tab keeps its own
    if (!window.name) window.name = MAP_EDITOR_WINDOW;
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('map');
      this.following = this.following.then(() => this.follow(id));
    });
  }

  async open(id: string): Promise<void> {
    await this.router.navigate([], { relativeTo: this.route, queryParams: { map: id } });
    await this.following;
  }

  async close(): Promise<void> {
    if (!(await this.session.close())) return;
    this.opened.set(false);
    await this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  /** The address names a map (open it) or none (back to the list) */
  private async follow(id: string | null): Promise<void> {
    if (id) {
      if (this.opened() && this.session.editor?.doc.meta.id === id) return;
      // Another map in the address: the open one is saved and closed first
      if (this.opened()) {
        if (!(await this.session.close())) return;
        this.opened.set(false);
        // The shell goes before the next map opens, so the new one builds its own view
        await new Promise((r) => setTimeout(r));
      }
      await this.load(id);
      return;
    }
    if (!this.opened()) return;
    // Back from a map: it closes like with the editor's own button; a map that cannot be saved stays
    if (await this.session.close()) this.opened.set(false);
    else {
      const current = this.session.editor?.doc.meta.id;
      if (current) await this.router.navigate([], { relativeTo: this.route, queryParams: { map: current } });
    }
  }

  private async load(id: string): Promise<void> {
    this.problem.set(null);
    try {
      const opened = !this.session.editor || this.session.editor.doc.meta.id !== id ? await this.session.open(id) : id;
      this.opened.set(true);
      // A shipped map opened as a copy: the address names the copy, so a reload opens it and not a second copy
      if (opened !== id) await this.router.navigate([], { relativeTo: this.route, queryParams: { map: opened }, replaceUrl: true });
    } catch (e) {
      this.problem.set((e as Error).message);
      this.opened.set(false);
      await this.router.navigate([], { relativeTo: this.route, queryParams: {} });
    }
  }
}
