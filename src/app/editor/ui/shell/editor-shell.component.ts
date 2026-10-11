import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  untracked,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { DocChange } from '../../model/editor-document';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent, type TdIconName } from '../../../components/icon/icon.component';
import { SYMMETRY_MODES, type SymmetryMode } from '../../ops/symmetry';
import { LANDSCAPE_MODES, TOOLS, type ToolId } from '../../tools/tool';
import { BIOMES } from '../../ops/landscape/biomes';
import { CommandPaletteComponent } from './command-palette.component';
import type { EditorCommand } from './commands';
import { KEY_ACTIONS, actionFor, bindable, loadKeymap, rebind, saveKeymap, type Keymap } from './keymap';
import { LEVEL_GUIDE } from './level-guide';
import { TOUR_STEPS, markTourDone, tourAdvance, tourPending, type TourEvent } from './tour';
import { ContextHintComponent, type HintAction } from '../../../components/context-hint/context-hint.component';
import { EditorSession } from '../editor-session.service';
import { CheckPanelComponent } from '../panels/check-panel.component';
import { EnvironmentPanelComponent } from '../panels/environment-panel.component';
import { LandscapePanelComponent } from '../panels/landscape-panel.component';
import { MapPanelComponent } from '../panels/map-panel.component';
import { MarkerPanelComponent } from '../panels/marker-panel.component';
import { StampPanelComponent } from '../panels/stamp-panel.component';
import { GameplayPanelComponent } from '../panels/gameplay-panel.component';
import { MeasurePanelComponent } from '../panels/measure-panel.component';
import { MinimapComponent } from '../panels/minimap.component';
import { ObjectPanelComponent } from '../panels/object-panel.component';
import { OutlinerComponent } from '../panels/outliner.component';
import { PaintPanelComponent } from '../panels/paint-panel.component';
import { PathPanelComponent } from '../panels/path-panel.component';
import { StatusBarComponent } from '../panels/status-bar.component';
import { TerrainPanelComponent } from '../panels/terrain-panel.component';
import { WaterPanelComponent } from '../panels/water-panel.component';

export const TOOL_ICON: Record<ToolId, TdIconName> = {
  landscape: 'terrain',
  stamp: 'copy',
  gameplay: 'coin',
  measure: 'route',
  terrain: 'sliders',
  paint: 'edit',
  water: 'splash',
  objects: 'build',
  paths: 'route',
  markers: 'portal',
  environment: 'bulb',
  settings: 'cog',
};

/**
 * The editor around the 3D view: top bar (map, history, save, file,
 * check, test), tool column, the tool's options and the outliner on the
 * right, minimap and check over the view, status bar at the foot. Keys:
 * 1 to 9 and 0 tools, Ctrl+Z / Ctrl+Y history, Ctrl+S save; the rest goes to the
 * view and the tool.
 */
@Component({
  selector: 'app-editor-shell',
  standalone: true,
  imports: [
    TdIconComponent,
    MatTooltipModule,
    LandscapePanelComponent,
    TerrainPanelComponent,
    PaintPanelComponent,
    WaterPanelComponent,
    ObjectPanelComponent,
    PathPanelComponent,
    MarkerPanelComponent,
    StampPanelComponent,
    GameplayPanelComponent,
    MeasurePanelComponent,
    EnvironmentPanelComponent,
    MapPanelComponent,
    OutlinerComponent,
    MinimapComponent,
    CheckPanelComponent,
    StatusBarComponent,
    CommandPaletteComponent,
    ContextHintComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor-shell.component.html',
  styleUrl: './editor-shell.component.scss',
  host: {
    '(document:keydown)': 'onKeyDown($event)',
    '(document:keyup)': 'onKeyUp($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class EditorShellComponent implements OnDestroy {
  readonly session = inject(EditorSession);
  readonly closed = output<void>();
  readonly tools = TOOLS;
  readonly icons = TOOL_ICON;
  readonly fileMenu = signal(false);
  readonly help = signal(false);
  readonly helpView = signal<'keys' | 'guide'>('keys');
  readonly guide = LEVEL_GUIDE;
  /** The command palette's list while it is open */
  readonly palette = signal<readonly EditorCommand[] | null>(null);
  /** The keys of the rebindable actions, and the action waiting for its new key */
  readonly keymap = signal<Keymap>(loadKeymap());
  readonly capturing = signal<string | null>(null);
  readonly keyActions = KEY_ACTIONS;
  /** The tour's step, null when it does not run */
  readonly tourStep = signal<number | null>(null);
  /** Whether the trial wave walks (the button shows it pressed) */
  readonly trialOn = signal(false);
  /** Panels made so far: the current tool's at once, the others one by one when the page is idle */
  readonly mounted = signal<ReadonlySet<ToolId>>(new Set<ToolId>());
  readonly tour = computed(() => {
    const k = this.tourStep();
    return k === null ? null : { step: TOUR_STEPS[k], counter: `${k + 1}/${TOUR_STEPS.length}`, last: k === TOUR_STEPS.length - 1 };
  });
  readonly tourActions = computed<HintAction[]>(() => [
    ...(this.tourStep() ? [{ id: 'back', label: 'Back' }] : []),
    { id: 'next', label: this.tour()?.last ? 'Done' : 'Next' },
    { id: 'skip', label: 'Skip the tour' },
  ]);
  /** Where the step's element sits on the screen, for the ring around it */
  readonly tourRing = signal<{ left: number; top: number; width: number; height: number } | null>(null);
  readonly shortcuts = SHORTCUTS;
  readonly symmetryModes = SYMMETRY_MODES;
  readonly symmetry = computed(() => (this.session.settingsRev(), this.session.settings.symmetry));
  readonly symmetryHint = computed(() => {
    const doc = (this.session.docRev(), this.session.doc);
    const m = SYMMETRY_MODES.find((s) => s.id === this.symmetry())!;
    const square = !doc || doc.terrain.grid.columns === doc.terrain.grid.rows;
    return m.id === 'rot4' && !square ? 'Turn 4 needs a square map: this one turns by 180 degrees' : `${m.hint} (M cycles)`;
  });
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  readonly title = computed(() => this.session.meta()?.name ?? '');
  readonly toolLabel = computed(() => TOOLS.find((t) => t.id === this.session.tool())?.label ?? '');
  readonly issueCount = computed(() => this.session.issues()?.filter((i) => i.severity === 'error').length ?? 0);
  readonly saveLine = computed(() => {
    if (this.session.origin() !== 'own') return 'Read only';
    if (this.session.saving()) return 'Saving';
    return this.session.dirty() ? 'Unsaved changes' : 'Saved';
  });

  constructor() {
    afterNextRender(() => {
      this.session.attachViewport(this.canvas().nativeElement);
      this.canvas().nativeElement.focus();
      if (tourPending()) this.startTour();
    });
    effect(() => {
      const tool = this.session.tool();
      untracked(() => {
        if (!this.mounted().has(tool)) this.mounted.set(new Set([...this.mounted(), tool]));
      });
    });
    afterNextRender(() => this.mountIdlePanels());
    // A change of the map may finish the step the tour is on
    effect(() => {
      const last = this.session.lastChange();
      if (last) untracked(() => this.tourEvent('change', last.change));
    });
  }

  private destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;
    this.session.detachViewport();
  }

  setSymmetry(mode: SymmetryMode): void {
    this.session.patchSettings((s) => (s.symmetry = mode));
    this.session.flash(mode === 'none' ? 'Symmetry off' : `Symmetry: ${SYMMETRY_MODES.find((m) => m.id === mode)!.label}`);
  }

  pick(id: ToolId): void {
    this.session.selectTool(id);
  }

  /** Makes the other panels in idle moments, one at a time, so the first switch to them is quick too */
  private mountIdlePanels(): void {
    const idle = (fn: () => void) =>
      'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 200);
    const next = () => {
      const missing = this.tools.find((t) => !this.mounted().has(t.id));
      if (!missing || this.destroyed) return;
      this.mounted.set(new Set([...this.mounted(), missing.id]));
      idle(next);
    };
    idle(next);
  }

  openGuide(): void {
    this.palette.set(null);
    this.helpView.set('guide');
    this.help.set(true);
  }

  guideTool(id: ToolId): void {
    this.help.set(false);
    this.pick(id);
  }

  startTour(): void {
    this.help.set(false);
    this.palette.set(null);
    this.showTourStep(0);
  }

  onTourAction(id: string): void {
    const k = this.tourStep();
    if (k === null) return;
    if (id === 'skip') return this.endTour();
    if (id === 'back') return this.showTourStep(Math.max(0, k - 1));
    if (k >= TOUR_STEPS.length - 1) return this.endTour();
    this.showTourStep(k + 1);
  }

  /** Something the tour may wait for happened */
  tourEvent(event: TourEvent, change: DocChange | null = null): void {
    const k = this.tourStep();
    if (k === null) return;
    const next = tourAdvance(k, event, change);
    if (next === k) return;
    if (next >= TOUR_STEPS.length) this.endTour();
    else this.showTourStep(next);
  }

  private showTourStep(k: number): void {
    const step = TOUR_STEPS[k];
    this.tourStep.set(k);
    if (step.tool) this.pick(step.tool);
    // The ring around the step's element, once the page shows it
    requestAnimationFrame(() => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      const r = el?.getBoundingClientRect();
      this.tourRing.set(r ? { left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 } : null);
    });
  }

  private endTour(): void {
    this.tourStep.set(null);
    this.tourRing.set(null);
    markTourDone();
  }

  trial(): void {
    this.session.viewport?.toggleTrial();
    const on = !!this.session.viewport?.trialRunning;
    this.trialOn.set(on);
    if (on) this.tourEvent('trial');
  }

  testPlay(): void {
    void this.session.testPlay();
    this.tourEvent('test');
  }

  async check(): Promise<void> {
    this.tourEvent('check');
    const issues = this.session.runCheck();
    this.session.flash(issues.length ? `${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to look at` : 'The map checks out');
  }

  onKeyDown(e: KeyboardEvent): void {
    const waiting = this.capturing();
    if (waiting) {
      if (e.key === 'Escape') return this.handled(e, () => this.capturing.set(null));
      if (e.ctrlKey || e.metaKey || e.altKey || !bindable(e.key)) return;
      return this.handled(e, () => {
        const next = rebind(this.keymap(), waiting, e.key.toLowerCase());
        this.keymap.set(next);
        saveKeymap(next);
        this.capturing.set(null);
      });
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') return this.handled(e, () => this.togglePalette());
    if (this.palette()) return;
    if (this.help() && e.key === 'Escape') return this.handled(e, () => this.help.set(false));
    if (typing(e)) {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    const s = this.session;
    // While the right button turns the view, W A S D Q E fly instead of choosing tools
    if (s.viewport?.flying && s.viewport.key(e)) return this.handled(e, () => undefined);
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z' && !e.shiftKey) return this.handled(e, () => s.undo());
    if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) return this.handled(e, () => s.redo());
    if (ctrl && k === 's') return this.handled(e, () => void s.save(true));
    // Ctrl+G groups objects; the browser must not open its find bar for it, whatever the tool
    if (ctrl && k === 'g') {
      e.preventDefault();
      s.viewport?.key(e);
      s.refresh();
      return;
    }
    // Camera views: Alt or Ctrl with a digit keeps the view (Ctrl only where the browser leaves it), Shift with a digit shows it
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const slot = Number(digit[1]) - 1;
      if (e.altKey || ctrl) return this.handled(e, () => s.saveBookmark(slot));
      if (e.shiftKey) return this.handled(e, () => s.showBookmark(slot));
    }
    // Ctrl+V from any tool places the last copy
    if (ctrl && k === 'v' && s.tool() !== 'stamp' && s.settings.stamp.current) {
      return this.handled(e, () => {
        this.pick('stamp');
        s.patchSettings((st) => (st.stamp.mode = 'paste'));
      });
    }
    if (!ctrl && !e.altKey) {
      if (e.key === '?') return this.handled(e, () => this.help.update((v) => !v));
      const action = e.shiftKey ? null : actionFor(this.keymap(), e.key);
      if (action && this.runAction(action)) return this.handled(e, () => undefined);
    }
    if (s.viewport?.key(e)) {
      e.preventDefault();
      s.refresh();
    }
  }

  /** Runs a rebindable action; false when it does not apply now (the key then goes on to the view) */
  private runAction(id: string): boolean {
    const s = this.session;
    const vp = s.viewport;
    if (id.startsWith('tool:')) {
      this.pick(id.slice(5) as ToolId);
      return true;
    }
    switch (id) {
      case 'map:check':
        void this.check();
        return true;
      case 'map:symmetry': {
        const i = SYMMETRY_MODES.findIndex((m) => m.id === s.settings.symmetry);
        this.setSymmetry(SYMMETRY_MODES[(i + 1) % SYMMETRY_MODES.length].id);
        return true;
      }
      case 'view:frame':
        vp?.focusSelection();
        return !!vp;
      case 'view:top':
        vp?.controller.setTopDown(!vp.controller.isTopDown);
        return !!vp;
      case 'view:game':
        vp?.toggleGameView();
        return !!vp;
      case 'map:trial':
        this.trial();
        return !!vp;
    }
    return false;
  }

  /** The key an action has now, for the help */
  keyOf(id: string): string {
    return this.keymap()[id]?.toUpperCase() ?? '';
  }

  resetKeys(): void {
    const map = loadKeymap(null);
    this.keymap.set(map);
    saveKeymap(map);
  }

  togglePalette(): void {
    this.palette.set(this.palette() ? null : this.buildCommands());
  }

  closePalette(): void {
    this.palette.set(null);
    this.session.viewport?.canvas.focus({ preventScroll: true });
  }

  /** Everything the palette offers, built when it opens: tools, brushes, view, map, objects on the map, markers */
  private buildCommands(): EditorCommand[] {
    const s = this.session;
    const vp = s.viewport;
    const out: EditorCommand[] = [];
    const add = (group: string, label: string, run: () => void, keys?: string) => out.push({ id: `${group}:${label}`, group, label, keys, run });
    add('Edit', 'Undo', () => s.undo(), 'Ctrl+Z');
    add('Edit', 'Redo', () => s.redo(), 'Ctrl+Y');
    add('Map', 'Save', () => void s.save(true), 'Ctrl+S');
    add('Map', 'Check the map', () => void this.check(), this.keyOf('map:check'));
    add('Map', 'Test the map in the game', () => void s.testPlay());
    add('Map', 'Download the map file', () => s.downloadFile());
    add('Map', 'Download a picture of the map', () => void s.downloadPng());
    for (const t of TOOLS) add('Tools', t.label, () => this.pick(t.id), this.keyOf(`tool:${t.id}`));
    for (const m of LANDSCAPE_MODES) {
      add('Landscape', m.label, () => {
        this.pick('landscape');
        s.patchSettings((st) => (st.landscape.mode = m.id));
      });
    }
    for (const b of BIOMES) {
      add('Biome', b.label, () => {
        this.pick('landscape');
        s.patchSettings((st) => {
          st.landscape.mode = 'biome';
          st.landscape.biome = b.id;
        });
      });
    }
    if (vp) {
      add('View', 'Frame the map', () => vp.frameMap());
      add('View', 'Frame the selection', () => vp.focusSelection(), this.keyOf('view:frame'));
      add('View', 'Top view on or off', () => vp.controller.setTopDown(!vp.controller.isTopDown), this.keyOf('view:top'));
      add('View', 'Game view on or off', () => vp.toggleGameView(), this.keyOf('view:game'));
      add('Map', 'Trial wave: enemies walk the routes', () => this.trial(), this.keyOf('map:trial'));
    }
    add('View', 'Height lines on or off', () => s.patchSettings((st) => (st.view.contours = !st.view.contours)));
    add('View', 'Grid on or off', () => s.patchSettings((st) => (st.view.grid = !st.view.grid)));
    for (const m of SYMMETRY_MODES) add('Symmetry', m.label, () => this.setSymmetry(m.id), 'M');
    add('Editor', 'Keys', () => this.help.set(true), '?');
    add('Editor', 'Tour: the editor in seven steps', () => this.startTour());
    add('Editor', 'How to build a good level', () => this.openGuide());
    const doc = s.doc;
    if (doc && vp) {
      add('Go to', 'HQ', () => vp.focusOn(doc.hq));
      for (const sp of doc.spawns) add('Go to', `Spawn ${sp.name}`, () => vp.focusOn(sp));
      // Every asset on the map: select all of its objects and frame them
      const byAsset = new Map<string, string[]>();
      for (const o of doc.objects) {
        const list = byAsset.get(o.asset);
        if (list) list.push(o.id);
        else byAsset.set(o.asset, [o.id]);
      }
      const catalog = s.catalog();
      const groups = new Map<string, string[]>();
      for (const o of doc.objects) if (o.group) groups.set(o.group, [...(groups.get(o.group) ?? []), o.id]);
      for (const [group, ids] of groups) {
        add('Select', `Group ${group} (${ids.length})`, () => {
          this.pick('objects');
          s.patchSettings((st) => (st.objects.mode = 'select'));
          s.editor?.select({ kind: 'objects', ids });
          vp.focusSelection();
        });
      }
      for (const category of catalog.categories()) {
        const hidden = s.settings.view.hidden?.includes(category);
        add('View', `${hidden ? 'Show' : 'Hide'} ${category.toLowerCase()}`, () =>
          s.patchSettings((st) => {
            const set = new Set(st.view.hidden ?? []);
            if (set.has(category)) set.delete(category);
            else set.add(category);
            st.view.hidden = [...set];
          }),
        );
      }
      for (const [asset, ids] of byAsset) {
        add('Select', `${catalog.object(asset).name} (${ids.length})`, () => {
          this.pick('objects');
          s.patchSettings((st) => (st.objects.mode = 'select'));
          s.editor?.select({ kind: 'objects', ids });
          vp.focusSelection();
        });
      }
    }
    return out;
  }

  onKeyUp(e: KeyboardEvent): void {
    this.session.viewport?.keyUp(e);
  }

  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.session.dirty() && this.session.origin() === 'own') {
      void this.session.save(false);
      e.preventDefault();
    }
  }

  async leave(): Promise<void> {
    this.closed.emit();
  }

  toggleFile(): void {
    this.fileMenu.update((v) => !v);
  }

  fileAction(action: 'download' | 'png' | 'frame' | 'top'): void {
    this.fileMenu.set(false);
    const s = this.session;
    switch (action) {
      case 'download':
        s.downloadFile();
        return;
      case 'png':
        void s.downloadPng();
        return;
      case 'frame':
        s.viewport?.frameMap();
        return;
      case 'top':
        s.viewport?.controller.setTopDown(!s.viewport.controller.isTopDown);
        return;
    }
  }

  private handled(e: KeyboardEvent, fn: () => void): void {
    e.preventDefault();
    fn();
  }
}

/** The keys of the editor, grouped, for the help (?) */
export const SHORTCUTS: readonly { group: string; keys: readonly [string, string][] }[] = [
  {
    group: 'Everywhere',
    keys: [
      ['1 to 9, 0, G, D', 'Tools'],
      ['Ctrl+Z, Ctrl+Y', 'Undo, redo'],
      ['Ctrl+S', 'Save with a new picture'],
      ['V', 'Check the map'],
      ['M', 'Symmetry: off, mirror X, Y, both, turn 2, turn 4'],
      ['Esc', 'Drop what is half done, clear the selection'],
      ['Ctrl+K', 'Commands: tools, biomes, views, objects by name'],
      ['?', 'This help (the single keys below can be changed)'],
    ],
  },
  {
    group: 'View',
    keys: [
      ['Right drag', 'Turn the view'],
      ['Right held + W A S D', 'Fly; Q E lower, raise; Shift faster'],
      ['C', 'Game view: where the game starts, and back'],
      ['P', 'Trial wave: the enemies walk the routes at their speed'],
      ['Middle drag, Shift+right drag', 'Pan'],
      ['Wheel', 'Zoom to the pointer'],
      ['Arrow keys', 'Pan'],
      ['F', 'Frame the selection or the map'],
      ['T', 'Top view on or off'],
      ['Alt+1 to 9', 'Keep the current view'],
      ['Shift+1 to 9', 'Show a kept view'],
    ],
  },
  {
    group: 'Brushes',
    keys: [
      ['[ ]', 'Smaller, larger'],
      ['{ }', 'Weaker, stronger'],
      ['Shift', 'Reverse (lower, erase, thin out)'],
      ['Ctrl click', 'Pick the height (Level, Terrace)'],
    ],
  },
  {
    group: 'Objects, roads, spawns',
    keys: [
      ['W E R', 'Move, turn, scale the selection'],
      ['L', 'Arrows along the map or the object'],
      ['Alt drag', 'Lasso selection'],
      ['End', 'Drop the selection onto the ground'],
      ['Ctrl+G, Ctrl+Shift+G', 'Group, ungroup (Ctrl click picks one member)'],
      ['Del', 'Delete the selection'],
      ['Ctrl+D', 'Duplicate objects'],
      ['Ctrl+A', 'Select all objects'],
      ['Alt', 'Place without snapping'],
      ['S X J', 'Smooth, straighten, join roads'],
      ['Enter, right click', 'End a road'],
      ['Q, H', 'Spawn or HQ mode'],
    ],
  },
  {
    group: 'Copy and stamps',
    keys: [
      ['Ctrl+C', 'Copy the rectangle'],
      ['Ctrl+V', 'Place the copy'],
      ['R, Shift+R', 'Turn by 90 degrees'],
      [', .', 'Turn by 15 degrees'],
    ],
  },
];

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return !['range', 'checkbox', 'radio', 'button', 'color'].includes(type);
}
