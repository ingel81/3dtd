import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, effect, inject, signal } from '@angular/core';
import { MapBrowserComponent } from './browser/map-browser.component';
import { EditorSession } from './editor-session.service';
import { EditorShellComponent } from './shell/editor-shell.component';
import { AgentBandComponent } from './agent/agent-band.component';
import { MAP_EDITOR_WINDOW } from '../../world/map-trial';
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
  readonly opened = signal(this.session.editor !== null);
  readonly problem = signal<string | null>(null);

  constructor() {
    // The game's chip names the map open here, saved or not
    effect(() => {
      const meta = this.session.meta();
      this.screens.draft.set(meta ? { mapId: meta.id, name: meta.name, unsaved: this.session.dirty() } : null);
    });
  }

  ngOnInit(): void {
    // A name the test tab can call it by to come back (returnToEditor); the test tab keeps its own
    if (!window.name) window.name = MAP_EDITOR_WINDOW;
    // An AI agent opens and leaves maps the way the player does
    this.session.navigator = {
      open: async (id) => {
        await this.open(id);
        return this.session.editor ? null : (this.problem() ?? 'it could not be read');
      },
      close: async () => {
        await this.close();
        return !this.opened();
      },
    };
    this.destroyRef.onDestroy(() => (this.session.navigator = null));
    // Before the game shows: the map is saved, a job under way finishes first; the map stays open here
    this.destroyRef.onDestroy(this.screens.guardEditor(() => this.letGo()));
    const wanted = this.screens.takeEditorMap() ?? (this.session.editor ? null : openMapOfTab());
    if (wanted) void this.open(wanted);
  }

  async open(id: string): Promise<void> {
    const editor = this.session.editor;
    if (editor && this.session.isOpen(id)) {
      keepOpenMap(editor.doc.meta.id);
      this.opened.set(true);
      return;
    }
    // Another map: the open one is saved and closed first
    if (editor) {
      if (!(await this.session.close())) return;
      this.opened.set(false);
      // The shell goes before the next map opens, so the new one builds its own view
      await new Promise((r) => setTimeout(r));
    }
    await this.load(id);
  }

  async close(): Promise<void> {
    if (!(await this.session.close())) return;
    keepOpenMap(null);
    this.opened.set(false);
  }

  /** The editor may go for the game: what changed is saved first; a save that fails keeps the editor */
  private async letGo(): Promise<boolean> {
    const session = this.session;
    if (!session.editor || session.readOnly()) return true;
    if (session.blocked('Leaving the editor')) return false;
    if (session.dirty() || session.saving()) {
      if (!(await session.save(true)) || session.dirty()) {
        session.flash('The map could not be saved; the editor stays open');
        return false;
      }
    }
    return true;
  }

  private async load(id: string): Promise<void> {
    this.problem.set(null);
    try {
      keepOpenMap(await this.session.open(id));
      this.opened.set(true);
    } catch (e) {
      keepOpenMap(null);
      this.problem.set((e as Error).message);
      this.opened.set(false);
    }
  }
}
