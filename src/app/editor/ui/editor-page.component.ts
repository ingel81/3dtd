import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { MapBrowserComponent } from './browser/map-browser.component';
import { EditorSession } from './editor-session.service';
import { EditorShellComponent } from './shell/editor-shell.component';
import { AgentBandComponent } from './agent/agent-band.component';
import { AppScreen } from '../../world/app-screen.service';

/** sessionStorage: the map open in this tab's editor, so a reload of the page opens it again */
const OPEN_MAP_KEY = '3dtd-editor-map';

function openMapOfTab(): string | null {
  try {
    return sessionStorage.getItem(OPEN_MAP_KEY);
  } catch {
    return null;
  }
}

function keepOpenMap(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(OPEN_MAP_KEY, id);
    else sessionStorage.removeItem(OPEN_MAP_KEY);
  } catch {
    // Without storage a reload shows the list
  }
}

/**
 * The map editor's screen in the window (AppShellComponent): the map
 * browser, or a map in the editor. The session comes from the shell and
 * outlives this page: back from the game, the map that was open shows again
 * with its history. The address stays as it is; the map the editor was
 * opened on comes from AppScreen (`/editor?map=` at the start, Edit this
 * map in the game). A reload of the page opens the map this tab had open
 * (sessionStorage), the address does not carry it.
 */
@Component({
  selector: 'app-editor-page',
  standalone: true,
  imports: [MapBrowserComponent, EditorShellComponent, AgentBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (opened()) {
      <app-editor-shell (closed)="close()" />
    } @else {
      <app-map-browser [problem]="problem()" (open)="open($event)" />
      <app-agent-band />
    }
  `,
  styles: [`:host { position: relative; display: block; width: 100%; height: 100%; }`],
})
export class EditorPageComponent implements OnInit {
  private readonly session = inject(EditorSession);
  private readonly screens = inject(AppScreen);
  private readonly destroyRef = inject(DestroyRef);
  /** A map is open: the editor shows (MapLifecycle.openMap is the one source of it) */
  readonly opened = computed(() => this.session.maps.openMap() !== null);
  readonly problem = signal<string | null>(null);

  constructor() {
    // The game's chip names the map open here, saved or not. A reload opens it again under its id now: a
    // shipped or coop map's first save with a change makes it an own copy with an id of its own
    effect(() => {
      const meta = this.session.state.meta();
      this.screens.draft.set(meta ? { mapId: meta.id, name: meta.name, unsaved: this.session.saves.dirty() } : null);
    });
    // The tab's map follows what is open; a map closed (by the player or an agent) is not opened by a reload
    let was: string | null = null;
    effect(() => {
      const id = this.session.maps.openMap();
      if (id) keepOpenMap(id);
      else if (was) keepOpenMap(null);
      was = id;
    });
  }

  ngOnInit(): void {
    // Before the game shows: the map is saved, a job under way finishes first; the map stays open here
    this.destroyRef.onDestroy(this.screens.guardEditor(() => this.letGo()));
    const wanted = this.screens.takeEditorMap() ?? (this.session.editor ? null : openMapOfTab());
    if (wanted) void this.open(wanted);
  }

  /** Opens the map `id` in place of the open one (saved and closed first) */
  async open(id: string): Promise<void> {
    this.problem.set(null);
    try {
      await this.session.maps.switchTo(id);
    } catch (e) {
      if (!this.session.editor) keepOpenMap(null);
      this.problem.set((e as Error).message);
    }
  }

  async close(): Promise<void> {
    await this.session.maps.close();
  }

  /** The editor may go for the game: what changed is saved first; a save that fails keeps the editor */
  private async letGo(): Promise<boolean> {
    const session = this.session;
    if (!session.editor || session.maps.readOnly()) return true;
    if (session.blocked('Leaving the editor')) return false;
    if (session.saves.dirty() || session.saves.saving()) {
      if (!(await session.saves.save(true)) || session.saves.dirty()) {
        session.notices.flash('The map could not be saved; the editor stays open');
        return false;
      }
    }
    return true;
  }
}
