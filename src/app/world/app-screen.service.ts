import { Injectable, signal } from '@angular/core';
import type { WorldStart } from './world-start';

/** What the window shows: a world's game, or the map editor (docs/WORLDS_NAVIGATION_PLAN.md, 4.2) */
export type Screen = 'game' | 'editor';

/** The map open in the editor, as the game's chip names it (docs/WORLDS_NAVIGATION_PLAN.md, 3.4) */
export interface EditorDraft {
  mapId: string;
  name: string;
  /** Changes not saved yet (the editor saves before the game shows) */
  unsaved: boolean;
}

/**
 * A run that waits as its world's autosave while the editor shows
 * (docs/WORLDS_NAVIGATION_PLAN.md, decision 2): "Back to the run" opens its
 * world again and loads it there.
 */
export interface WaitingRun {
  /** Its world with the autosave to load (WorldStart.resume) */
  order: WorldStart;
  /** "Demo Valley | wave 12", as the chip and the way back name it */
  label: string;
  /** The custom map it plays; null on the real places */
  mapId: string | null;
}

/**
 * The game and the map editor in one window (docs/WORLDS_NAVIGATION_PLAN.md,
 * phase 4): which of the two shows (AppShellComponent), and what the editor
 * opens next. The address names only the entry (`/editor`, `?map=`); from
 * there no switch changes it.
 *
 * The editor and the game exclude each other on the screen: the game goes
 * (engine, worker, canvas) while the editor shows, the editor's view goes
 * while the game shows; the editor's map and its history stay
 * (EditorSession, held by the shell).
 */
@Injectable({ providedIn: 'root' })
export class AppScreen {
  readonly screen = signal<Screen>('game');
  /** The map open in the editor, kept while the game shows; null when the editor has none open */
  readonly draft = signal<EditorDraft | null>(null);
  /** The run the editor came from, waiting as autosave; null without one (WorldSession.backToGame opens it) */
  readonly waitingRun = signal<WaitingRun | null>(null);
  /** The map the editor opens when it shows next, taken once; null: its list, or the map open in it */
  private editorMap: string | null = null;
  /** The editor's own question before it goes (a save, a job under way), see guardEditor */
  private leaveEditor: (() => Promise<boolean>) | null = null;

  /** The editor in this window, on `mapId`; null shows the map open in it, else its list of maps */
  openEditor(mapId: string | null): void {
    this.editorMap = mapId;
    this.screen.set('editor');
  }

  /** The map the editor was opened on, once (the editor page asks when it comes) */
  takeEditorMap(): string | null {
    const id = this.editorMap;
    this.editorMap = null;
    return id;
  }

  /** `leave` answers whether the editor may go now; returns the unsubscribe */
  guardEditor(leave: () => Promise<boolean>): () => void {
    this.leaveEditor = leave;
    return () => {
      if (this.leaveEditor === leave) this.leaveEditor = null;
    };
  }

  /** The game in this window, once the editor let go; false when the editor stays (its save failed) */
  async showGame(): Promise<boolean> {
    if (this.screen() === 'game') return true;
    if (this.leaveEditor && !(await this.leaveEditor())) return false;
    this.screen.set('game');
    return true;
  }
}
