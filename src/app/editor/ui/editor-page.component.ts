import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MapBrowserComponent } from './browser/map-browser.component';
import { EditorSession } from './editor-session.service';
import { EditorShellComponent } from './shell/editor-shell.component';

/**
 * `/editor`: the map browser, or with `?map=<id>` that map in the editor.
 * The id in the address lets a reload reopen the map.
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
  readonly opened = signal(false);
  readonly problem = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.queryParamMap.get('map');
    if (id) void this.load(id);
  }

  async open(id: string): Promise<void> {
    await this.router.navigate([], { relativeTo: this.route, queryParams: { map: id } });
    await this.load(id);
  }

  async close(): Promise<void> {
    if (!(await this.session.close())) return;
    this.opened.set(false);
    await this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  private async load(id: string): Promise<void> {
    this.problem.set(null);
    try {
      if (!this.session.editor || this.session.editor.doc.meta.id !== id) await this.session.open(id);
      this.opened.set(true);
    } catch (e) {
      this.problem.set((e as Error).message);
      this.opened.set(false);
      await this.router.navigate([], { relativeTo: this.route, queryParams: {} });
    }
  }
}
