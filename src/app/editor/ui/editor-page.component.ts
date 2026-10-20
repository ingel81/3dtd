import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { MapMakeComponent } from './make/map-make.component';
import { EditorSession } from './editor-session.service';
import { EditorShellComponent } from './shell/editor-shell.component';
import { AgentBandComponent } from './agent/agent-band.component';
import { AppScreen, type EditorMake } from '../../world/app-screen.service';
import { WorldsStageService } from '../../worlds/worlds-stage.service';
import type { WorldPick } from '../../worlds/world-rules';

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
    // Without storage a reload goes to the Built Worlds' menu
  }
}

/**
 * The map editor's screen in the window (AppShellComponent): a map in the
 * editor, or the making of one (a new map's form, files read in). The list
 * of maps is the Built Worlds' menu (docs/WORLDS_STATE_PLAN.md): with no map
 * open and nothing to make the editor goes back there, a map closed is
 * picked there. The session comes from the shell and
 * outlives this page: back from the game, the map that was open shows again
 * with its history. The address stays as it is; the map the editor was
 * opened on comes from AppScreen (`/editor?map=` at the start, Edit this
 * map in the game). A reload of the page opens the map this tab had open
 * (sessionStorage), the address does not carry it.
 */
@Component({
  selector: 'app-editor-page',
  standalone: true,
  imports: [MapMakeComponent, EditorShellComponent, AgentBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (opened()) {
      <app-editor-shell (closed)="close()" />
    } @else if (make(); as m) {
      <app-map-make [make]="m" [problem]="problem()" (open)="open($event)" (done)="toMaps(null)" />
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
  /** What the editor was opened to make with no map open: a new one, files read in */
  readonly make = signal<EditorMake | null>(null);
  private readonly stage = inject(WorldsStageService);

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
    // Measurement hook: a page that set `__editorProbe` before loading (Playwright init script) gets the session
    // (e2e/perf/editor-stroke-probe.ts, also in builds without `ng`)
    const g = globalThis as { __editorProbe?: unknown };
    if (g.__editorProbe) g.__editorProbe = this.session;
  }

  ngOnInit(): void {
    // Before the game shows: the map is saved, a job under way finishes first; the map stays open here
    this.destroyRef.onDestroy(this.screens.guardEditor(() => this.letGo()));
    // New map, Import file: the making, the map open before saved and closed first; no map of the tab reopens
    const make = this.screens.takeMake();
    if (make) {
      if (this.session.editor) void this.session.maps.close();
      this.make.set(make);
      return;
    }
    const wanted = this.screens.takeEditorMap() ?? (this.session.editor ? null : openMapOfTab());
    if (wanted) void this.open(wanted);
    else if (!this.session.editor) this.toMaps(null);
  }

  /** Opens the map `id` in place of the open one (saved and closed first); one that will not open says why */
  async open(id: string): Promise<void> {
    this.problem.set(null);
    try {
      await this.session.maps.switchTo(id);
      this.make.set(null);
    } catch (e) {
      if (!this.session.editor) keepOpenMap(null);
      const why = (e as Error).message;
      // Making a map, the page says it; else the Built Worlds' menu, where the map was picked
      if (this.make()) this.problem.set(why);
      else {
        this.stage.notice.set(why);
        this.toMaps(null);
      }
    }
  }

  /** The map closes (saved first), picked in the Built Worlds' menu, which shows */
  async close(): Promise<void> {
    const meta = this.session.state.meta();
    await this.session.maps.close();
    // No map open any more: its chip goes now, before the page does (its effect would not run again)
    this.screens.draft.set(null);
    this.toMaps(meta ? { kind: 'map', id: meta.id, name: meta.name } : null);
  }

  /** Back to the Built Worlds' menu, `pick` picked there */
  toMaps(pick: WorldPick | null): void {
    this.make.set(null);
    this.stage.leaveEditorTo({ pick });
  }

  /** The editor may go for the game: what changed is saved first; a save that fails keeps the editor */
  private async letGo(): Promise<boolean> {
    const session = this.session;
    if (!session.editor || session.maps.readOnly()) return true;
    if (session.blocked(session.t().editor.session.leavingEditor)) return false;
    if (session.saves.dirty() || session.saves.saving()) {
      if (!(await session.saves.save(true)) || session.saves.dirty()) {
        session.notices.flash(session.t().editor.session.leaveUnsaved);
        return false;
      }
    }
    return true;
  }
}
