import { BrowserBack } from '../../../world/browser-back.service';
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
import type { DocChange } from '../../model/doc-change';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NgComponentOutlet } from '@angular/common';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { SYMMETRY_MODES, type SymmetryMode } from '../../ops/symmetry';
import { patch, LANDSCAPE_MODES } from '../../tools/tool';
import { TOOL_DEFS, TOOL_GROUPS, TOOL_INFO, type ToolId } from '../../tools/tool-defs';
import { BIOMES, biomeById } from '../../ops/landscape/biomes';
import { TRIAL_SPEEDS, stepTrialSpeed } from '../../view/trial-runners';
import { CommandPaletteComponent } from './command-palette.component';
import type { EditorCommand } from './commands';
import { TOOL_PANELS } from './tool-panels';
import { EDITOR_ACTIONS, FILE_ACTIONS, runAction, type ActionHost, type EditorAction } from './actions';
import { KEY_ACTIONS, actionFor, bindable, loadKeymap, rebind, saveKeymap, toolKeys, type Keymap } from './keymap';
import { LEVEL_GUIDE } from './level-guide';
import { TOUR_STEPS, markTourDone, tourAdvance, tourPending, tourResumeAt, type TourEvent } from './tour';
import { RovingGroupDirective } from '../../../components/roving-group.directive';
import { ContextHintComponent, type HintAction } from '../../../components/context-hint/context-hint.component';
import { EditorSession } from '../editor-session.service';
import { CheckPanelComponent } from '../panels/check-panel.component';
import { MinimapComponent } from '../panels/minimap.component';
import { OutlinerComponent } from '../panels/outliner.component';
import { HistoryPanelComponent } from '../panels/history-panel.component';
import { StatusBarComponent } from '../panels/status-bar.component';
import { MAX_START_WAVE } from '../../../sim/protocol/run-start';
import { AgentBandComponent } from '../agent/agent-band.component';
import { AgentControlComponent } from '../agent/agent-control.component';
import { WorldPathComponent, type PathAction, type PathChip } from '../../../components/world-path/world-path.component';
import { AppScreen } from '../../../world/app-screen.service';
import { WorldSession } from '../../../world/world-session.service';
import { PLAIN_START } from '../../../world/world-start';
import { WorldsStageService } from '../../../worlds/worlds-stage.service';
import { PanelShown } from '../panels/panel-shown';

const LEGEND_KEY = '3dtd-editor-legend';
const SIDE_KEY = '3dtd-editor-side';
/** Width of the side column in pixels: as it opens, the narrowest and the widest */
const SIDE_DEFAULT = 340;
const SIDE_MIN = 320;
const SIDE_MAX = 680;

function clampSide(w: number): number {
  // The view keeps at least 400 px beside the tool column
  const room = typeof window === 'undefined' ? SIDE_MAX : window.innerWidth - 76 - 400;
  return Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, room, w)));
}

function readSideWidth(): number {
  try {
    const w = Number(localStorage.getItem(SIDE_KEY));
    return w ? clampSide(w) : SIDE_DEFAULT;
  } catch {
    return SIDE_DEFAULT;
  }
}

function readLegend(): boolean {
  try {
    return localStorage.getItem(LEGEND_KEY) !== 'hidden';
  } catch {
    return true;
  }
}


/**
 * The editor around the 3D view: top bar (map, history, save, file,
 * check, test), tool column, the tool's options and the outliner on the
 * right, minimap and check over the view, status bar at the foot. Keys:
 * 1 to 9 and 0 tools, Esc back to Look once nothing is half done,
 * Ctrl+Z / Ctrl+Y history, Ctrl+S save; the rest goes to the view and the tool.
 */
@Component({
  selector: 'app-editor-shell',
  standalone: true,
  imports: [RovingGroupDirective, NgComponentOutlet,
    PanelShown,
    TdIconComponent,
    MatTooltipModule,
    OutlinerComponent,
    HistoryPanelComponent,
    MinimapComponent,
    CheckPanelComponent,
    StatusBarComponent,
    CommandPaletteComponent,
    ContextHintComponent,
    AgentBandComponent,
    AgentControlComponent,
    WorldPathComponent,
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
export class EditorShellComponent implements OnDestroy, ActionHost {
  readonly session = inject(EditorSession);
  private readonly screens = inject(AppScreen);
  private readonly worlds = inject(WorldSession);
  private readonly stage = inject(WorldsStageService);
  /** The run the editor came from, waiting as autosave (AppScreen.waitingRun) */
  private readonly waitingRun = this.screens.waitingRun;
  /** The path's chips, the same as on the globes and over the game: every world's Continue (the run that waits among them) */
  readonly pathChips = computed<readonly PathChip[]>(() => this.stage.pathChips(null, false));
  readonly playHint = computed(() => (this.runOfThisMap() ? 'Back to the run on this map' : 'Play this map'));
  readonly closed = output<void>();
  readonly tools = TOOL_DEFS;
  readonly toolGroups = TOOL_GROUPS;
  readonly panels = TOOL_PANELS;
  readonly fileActions = FILE_ACTIONS;
  /** The legend of mouse and view keys in the corner of the view; hidden once the player closes it */
  readonly legend = signal(readLegend());
  /** Width of the side column, dragged at its inner edge and kept in this browser */
  readonly sideWidth = signal(readSideWidth());
  readonly sideDefault = SIDE_DEFAULT;
  readonly sideMin = SIDE_MIN;
  readonly sideMax = SIDE_MAX;
  /** The grip's drag: where it started and the width then */
  private grip: { x: number; width: number } | null = null;
  /** What the side column shows: the tool's options or the outline of the map */
  readonly sideView = signal<'tool' | 'outline' | 'history'>('tool');
  readonly fileMenu = signal(false);
  readonly help = signal(false);
  readonly helpView = signal<'keys' | 'guide'>('keys');
  readonly guide = LEVEL_GUIDE;
  /** The command palette's list while it is open */
  readonly palette = signal<readonly EditorCommand[] | null>(null);
  /** The single keys inside the tools (W E R …): no action may take them */
  private readonly fixedKeys = toolKeys(Object.values(this.session.tools.all));
  /** The keys of the rebindable actions, and the action waiting for its new key */
  readonly keymap = signal<Keymap>(loadKeymap(undefined, this.fixedKeys));
  readonly capturing = signal<string | null>(null);
  readonly keyActions = KEY_ACTIONS;
  /** The tour's step, null when it does not run */
  readonly tourStep = signal<number | null>(null);
  /** The step a skipped tour can resume at, for the help */
  readonly tourResume = signal<number | null>(tourResumeAt());
  readonly tourLength = TOUR_STEPS.length;
  /** Whether the trial wave walks (the button shows it pressed) */
  readonly trialOn = signal(false);
  /** How fast the trial wave walks; kept for the next trial while the editor is open */
  readonly trialSpeed = signal(1);
  readonly trialSpeeds = TRIAL_SPEEDS;
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
  readonly symmetry = computed(() => this.session.tools.settings.symmetry());
  /** The view shows a still frame (wind, water, particles stand) */
  readonly still = computed(() => this.session.tools.settings.view().still);
  /** Objects in Place: the legend shows how to turn the next object */
  readonly placing = computed(() => this.session.tools.tool() === 'objects' && this.session.tools.settings.objects().mode === 'place');
  private readonly terrainRev = this.session.state.rev('terrain');
  readonly symmetryHint = computed(() => {
    const doc = (this.terrainRev(), this.session.doc);
    const m = SYMMETRY_MODES.find((s) => s.id === this.symmetry())!;
    const square = !doc || doc.terrain.grid.columns === doc.terrain.grid.rows;
    return m.id === 'rot4' && !square ? 'Turn 4 needs a square map: this one turns by 180 degrees' : `${m.hint} (M cycles)`;
  });
  /** Where the page's canvas goes (RendererHost) */
  private readonly canvas = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

  readonly title = computed(() => this.session.state.meta()?.name ?? '');
  readonly toolLabel = computed(() => TOOL_INFO.get(this.session.tools.tool())?.label ?? '');
  readonly issueCount = computed(() => this.session.check.issues()?.filter((i) => i.severity === 'error').length ?? 0);
  readonly saveLine = computed(() => {
    if (this.session.maps.readOnly()) return 'Read only';
    if (this.session.saves.saving()) return 'Saving';
    return this.session.saves.dirty() ? 'Unsaved changes' : 'Saved';
  });

  constructor() {
    afterNextRender(() => {
      this.session.attachViewport(this.canvas().nativeElement);
      this.canvas().nativeElement.querySelector('canvas')?.focus();
      if (tourPending()) this.startTour();
    });
    effect(() => {
      const tool = this.session.tools.tool();
      untracked(() => {
        if (!this.mounted().has(tool)) this.mounted.set(new Set([...this.mounted(), tool]));
      });
    });
    afterNextRender(() => this.mountIdlePanels());
    // The assets a biome or the object palette is about to place get their programs compiled ahead: on a tool
    // switch and on a new choice in the open tool (a biome picked while Landscape is open linked its plants'
    // programs in its first dab, 0.5 s); the warm-up keeps what it built, so a repeat costs nothing
    effect(() => {
      const tool = this.session.tools.tool();
      const catalog = this.session.catalog();
      const st = this.session.tools.settings;
      const landscape = tool === 'landscape' ? st.landscape() : null;
      const objects = tool === 'objects' ? st.objects() : null;
      untracked(() => {
        const vp = this.session.view;
        if (!vp.shown) return;
        const ids: string[] = [];
        if (landscape?.mode === 'biome') ids.push(...biomeById(landscape.biome).objects.flatMap((o) => o.assets));
        if (objects) ids.push(...(objects.asset ? [objects.asset] : []), ...objects.scatter.assets);
        const known = ids.filter((id) => catalog.objects.has(id));
        if (known.length) vp.warmUpAssets(known);
      });
    });
    // A change of the map may finish the step the tour is on
    this.offChange = this.session.state.onDocChange((change) => this.tourEvent('change', change));
  }

  private readonly offChange: () => void;
  /** The browser's Back in the editor: its help closes, else the map goes back to the editor's list (BrowserBack) */
  private readonly offBack = inject(BrowserBack).register(() => {
    if (this.help()) this.help.set(false);
    else void this.leave();
    return true;
  });

  private destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;
    this.offChange();
    this.offBack();
    this.session.detachViewport();
  }

  jobPercent(share: number): number {
    return Math.round(share * 100);
  }

  setSymmetry(mode: SymmetryMode): void {
    this.session.tools.settings.symmetry.set(mode);
    this.session.notices.flash(mode === 'none' ? 'Symmetry off' : `Symmetry: ${SYMMETRY_MODES.find((m) => m.id === mode)!.label}`);
  }

  /** A fresh copy of the changed original, opened in place of the copy (which stays in the list) */
  async freshCopy(): Promise<void> {
    await this.session.maps.freshCopy();
  }

  /** Wind, water and particles stand still in the view, or move again */
  toggleStill(): void {
    const s = this.session;
    patch(s.tools.settings.view, { still: !s.tools.settings.view().still });
    s.notices.flash(s.tools.settings.view().still ? `Still frame: nothing moves (${this.keyOf('view:still')} moves it again)` : 'Wind and water move again');
  }

  setLegend(on: boolean): void {
    this.legend.set(on);
    try {
      localStorage.setItem(LEGEND_KEY, on ? 'shown' : 'hidden');
    } catch {
      // Without storage it shows again on the next visit
    }
  }

  setSideWidth(w: number): void {
    const next = clampSide(w);
    this.sideWidth.set(next);
    try {
      if (next === SIDE_DEFAULT) localStorage.removeItem(SIDE_KEY);
      else localStorage.setItem(SIDE_KEY, String(next));
    } catch {
      // Without storage the column opens at its default width next time
    }
  }

  gripDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-held');
    this.grip = { x: e.clientX, width: this.sideWidth() };
    e.preventDefault();
  }

  gripMove(e: PointerEvent): void {
    // The column sits right: dragging its edge left widens it
    if (this.grip) this.sideWidth.set(clampSide(this.grip.width + this.grip.x - e.clientX));
  }

  gripUp(e: PointerEvent): void {
    if (!this.grip) return;
    (e.currentTarget as HTMLElement).classList.remove('is-held');
    this.grip = null;
    this.setSideWidth(this.sideWidth());
  }

  /** Arrow keys on the focused grip: left widens, right narrows */
  gripKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 64 : 16;
    const by = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
    if (e.key === 'Home') this.setSideWidth(SIDE_DEFAULT);
    else if (by) this.setSideWidth(this.sideWidth() + by);
    else return;
    // The view's own keys (arrows pan) do not get it
    e.preventDefault();
    e.stopPropagation();
  }

  /** Whether a tool's panel is in sight: its tool in hand and the tool tab open */
  panelShown(id: ToolId): boolean {
    return this.sideView() === 'tool' && this.session.tools.tool() === id;
  }

  pick(id: ToolId): void {
    this.session.tools.select(id);
    this.sideView.set('tool');
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

  /** The tour from its start, or from the step it was skipped at */
  startTour(at = 0): void {
    this.help.set(false);
    this.palette.set(null);
    this.showTourStep(Math.min(at, TOUR_STEPS.length - 1));
  }

  onTourAction(id: string): void {
    const k = this.tourStep();
    if (k === null) return;
    if (id === 'skip') return this.endTour(k);
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
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
      const r = el?.getBoundingClientRect();
      this.tourRing.set(r ? { left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 } : null);
    });
  }

  /** Finished, or skipped at step `skippedAt` (the help can resume there) */
  private endTour(skippedAt: number | null = null): void {
    this.tourStep.set(null);
    this.tourRing.set(null);
    markTourDone(undefined, skippedAt);
    this.tourResume.set(tourResumeAt());
  }

  trial(): void {
    const on = this.session.view.toggleTrial(this.trialSpeed());
    this.trialOn.set(on);
    if (on) this.tourEvent('trial');
  }

  /** The trial wave's speed, also while it walks */
  setTrialSpeed(speed: number): void {
    this.trialSpeed.set(speed);
    this.session.view.setTrialSpeed(speed);
    this.session.notices.flash(`Trial wave at ${speed}x`);
  }

  testPlay(): void {
    void this.session.check.testPlay();
    this.tourEvent('test');
  }

  readonly maxStartWave = MAX_START_WAVE;

  /** The wave the next test starts at, 1 to MAX_START_WAVE */
  setTestFromWave(e: Event): void {
    const input = e.target as HTMLInputElement;
    const v = Math.round(Number(input.value));
    const wave = Number.isFinite(v) ? Math.min(MAX_START_WAVE, Math.max(1, v)) : 1;
    this.session.check.testFromWave.set(wave);
    input.value = String(wave);
  }

  async check(): Promise<void> {
    this.tourEvent('check');
    const issues = await this.session.check.runCheck();
    this.session.notices.flash(issues.length ? `${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to look at` : 'The map checks out');
  }

  onKeyDown(e: KeyboardEvent): void {
    const waiting = this.capturing();
    if (waiting) {
      if (e.key === 'Escape') return this.handled(e, () => this.capturing.set(null));
      if (e.ctrlKey || e.metaKey || e.altKey || !bindable(e.key)) return;
      const key = e.key.toLowerCase();
      const fixed = this.fixedKeys.get(key);
      // A tool's own key stays the tool's: say whose it is and wait for another
      if (fixed) return this.handled(e, () => this.session.notices.flash(`${key.toUpperCase()} stays fixed: ${fixed}. Press another key, Esc keeps the old one`));
      return this.handled(e, () => {
        const before = this.keymap();
        const next = rebind(before, waiting, key);
        this.keymap.set(next);
        saveKeymap(next);
        this.capturing.set(null);
        const label = (id: string) => KEY_ACTIONS.find((a) => a.id === id)?.label ?? id;
        const swapped = Object.keys(next).find((id) => id !== waiting && before[id] === key);
        this.session.notices.flash(
          swapped
            ? `${key.toUpperCase()}: ${label(waiting)}; ${label(swapped)} takes ${next[swapped].toUpperCase() || 'no key'}`
            : `${key.toUpperCase()}: ${label(waiting)}`,
        );
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
    if (s.view.flying && s.view.key(e)) return this.handled(e, () => undefined);
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z' && !e.shiftKey) return this.handled(e, () => s.undo());
    if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) return this.handled(e, () => s.redo());
    if (ctrl && k === 's') return this.handled(e, () => void s.saves.save(true));
    // Ctrl+G groups objects; the browser must not open its find bar for it, whatever the tool
    if (ctrl && k === 'g') {
      e.preventDefault();
      s.view.key(e);
      s.state.refresh();
      return;
    }
    // Camera views: Alt or Ctrl with a digit keeps the view (Ctrl only where the browser leaves it), Shift with a digit shows it
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const slot = Number(digit[1]) - 1;
      if (e.altKey || ctrl) return this.handled(e, () => s.view.saveBookmark(slot));
      if (e.shiftKey) return this.handled(e, () => s.view.showBookmark(slot));
    }
    if (ctrl && k === 'v' && s.blocked('Paste')) return this.handled(e, () => undefined);
    // Ctrl+V from any tool places the last copy
    if (ctrl && k === 'v' && s.tools.tool() !== 'stamp' && s.tools.settings.stamp().current) {
      return this.handled(e, () => {
        this.pick('stamp');
        patch(s.tools.settings.stamp, { mode: 'paste' });
      });
    }
    if (!ctrl && !e.altKey) {
      if (e.key === '?') return this.handled(e, () => this.help.update((v) => !v));
      // + and - change the trial wave's speed while it walks, as they change the game's speed
      const step = e.key === '+' || e.key === '=' ? 1 : e.key === '-' ? -1 : 0;
      if (step && this.trialOn()) return this.handled(e, () => this.setTrialSpeed(stepTrialSpeed(this.trialSpeed(), step)));
      const action = e.shiftKey ? null : actionFor(this.keymap(), e.key);
      if (action && runAction(action, this)) return this.handled(e, () => undefined);
    }
    if (s.view.key(e)) {
      e.preventDefault();
      s.state.refresh();
      return;
    }
    // Esc with nothing half done and nothing selected: the hand goes to Look
    if (e.key === 'Escape' && !ctrl && s.tools.tool() !== 'look') this.handled(e, () => this.pick('look'));
  }

  /** The next symmetry mode (M) */
  nextSymmetry(): void {
    const i = SYMMETRY_MODES.findIndex((m) => m.id === this.session.tools.settings.symmetry());
    this.setSymmetry(SYMMETRY_MODES[(i + 1) % SYMMETRY_MODES.length].id);
  }

  showHistory(): void {
    this.sideView.set('history');
  }

  showHelp(): void {
    this.help.set(true);
  }

  /** The key an action has now, for the help */
  keyOf(id: string): string {
    return this.keymap()[id]?.toUpperCase() ?? '';
  }

  /** The keys of a help row: fixed text, or the key an action has now */
  helpKeys(keys: HelpKeys): string {
    if (typeof keys === 'string') return keys;
    if ('action' in keys) return this.keyOf(keys.action) || 'no key';
    // The tools' keys in the toolbar's order
    return TOOL_DEFS.filter((t) => t.id !== 'look')
      .map((t) => this.keyOf(`tool:${t.id}`))
      .filter(Boolean)
      .join(', ');
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
    this.session.view.focusCanvas();
  }

  /** Everything the palette offers, built when it opens: tools, brushes, view, map, objects on the map, markers */
  private buildCommands(): EditorCommand[] {
    const s = this.session;
    const vp = s.view;
    const out: EditorCommand[] = [];
    const add = (group: string, label: string, run: () => void, keys?: string) => out.push({ id: `${group}:${label}`, group, label, keys, run });
    for (const a of EDITOR_ACTIONS) {
      if (!a.enabled || a.enabled(this)) out.push({ id: a.id, group: a.group, label: a.label, keys: a.defaultKey ? this.keyOf(a.id) : a.keys, run: () => a.run(this) });
    }
    for (const m of LANDSCAPE_MODES) {
      add('Landscape', m.label, () => {
        this.pick('landscape');
        patch(s.tools.settings.landscape, { mode: m.id });
      });
    }
    for (const b of BIOMES) {
      add('Biome', b.label, () => {
        this.pick('landscape');
        patch(s.tools.settings.landscape, { mode: 'biome', biome: b.id });
      });
    }
    for (const m of SYMMETRY_MODES) add('Symmetry', m.label, () => this.setSymmetry(m.id), this.keyOf('map:symmetry'));
    const resume = this.tourResume();
    if (resume !== null) add('Editor', `Tour: resume at step ${resume + 1}`, () => this.startTour(resume));
    const doc = s.doc;
    if (doc && vp.shown) {
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
          patch(s.tools.settings.objects, { mode: 'select' });
          s.editor?.select({ kind: 'objects', ids });
          vp.focusSelection();
        });
      }
      for (const category of catalog.categories()) {
        const hidden = s.tools.settings.view().hidden?.includes(category);
        add('View', `${hidden ? 'Show' : 'Hide'} ${category.toLowerCase()}`, () =>
        {
          const set = new Set(s.tools.settings.view().hidden ?? []);
          if (set.has(category)) set.delete(category);
          else set.add(category);
          patch(s.tools.settings.view, { hidden: [...set] });
        },
        );
      }
      for (const [asset, ids] of byAsset) {
        add('Select', `${catalog.object(asset).name} (${ids.length})`, () => {
          this.pick('objects');
          patch(s.tools.settings.objects, { mode: 'select' });
          s.editor?.select({ kind: 'objects', ids });
          vp.focusSelection();
        });
      }
    }
    return out;
  }

  onKeyUp(e: KeyboardEvent): void {
    this.session.view.keyUp(e);
  }

  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.session.saves.dirty() && !this.session.maps.readOnly()) {
      void this.session.saves.save(false);
      e.preventDefault();
    }
  }

  async leave(): Promise<void> {
    this.closed.emit();
  }

  /** The run that waits plays this map (or the map this copy was opened for) */
  private runOfThisMap(): boolean {
    const mapId = this.waitingRun()?.mapId;
    return !!mapId && this.session.maps.isOpen(mapId);
  }

  /**
   * A step of the path: Worlds to the globes (the editor saves first), a chip to its world's Continue (the
   * game shows once the editor saved), Built Worlds to its menu (this map picked), Play back to this map's run or a new run on it
   */
  onPath(action: PathAction): void {
    if (action === 'worlds') {
      void this.screens.showGame().then((shown) => shown && this.stage.leaveGame(null));
    } else if (typeof action === 'object') {
      this.stage.goChip(action.chip);
    } else if (action === 'world') {
      // The Built Worlds' menu, as the step means everywhere (the back button closes the map first), this map picked there
      const id = this.session.doc?.meta.id;
      const pick = id ? { kind: 'map' as const, id, name: this.title() } : null;
      void this.screens.showGame().then((shown) => shown && this.stage.leaveGame({ world: 'maps', pick }));
    } else if (action === 'play') {
      const id = this.session.doc?.meta.id;
      if (this.runOfThisMap()) this.worlds.backToGame();
      else if (id) this.worlds.open({ ...PLAIN_START, world: { kind: 'custom-map', mapId: id, contentHash: '' }, play: true, label: this.title() });
    }
  }

  toggleFile(): void {
    this.fileMenu.update((v) => !v);
  }

  fileAction(action: EditorAction): void {
    this.fileMenu.set(false);
    runAction(action.id, this);
  }

  private handled(e: KeyboardEvent, fn: () => void): void {
    e.preventDefault();
    fn();
  }
}

/** Keys of a help row: fixed text, a rebindable action's key, or the tools' keys (all from the keymap) */
export type HelpKeys = string | { action: string } | { tools: true };

/** The keys of the editor, grouped, for the help (?); the rebindable ones read the keymap, so the help shows the keys in use */
export const SHORTCUTS: readonly { group: string; keys: readonly [HelpKeys, string][] }[] = [
  {
    group: 'Everywhere',
    keys: [
      [{ tools: true }, 'Tools'],
      ['Esc', 'Drop what is half done or the selection, then Look'],
      ['Ctrl+Z, Ctrl+Y', 'Undo, redo'],
      ['Ctrl+S', 'Save with a new picture'],
      [{ action: 'map:check' }, 'Check the map'],
      [{ action: 'map:symmetry' }, 'Symmetry: off, mirror X, Y, both, turn 2, turn 4'],
      ['Ctrl+K', 'Commands: tools, biomes, views, objects by name'],
      ['?', 'This help (the single keys below can be changed)'],
    ],
  },
  {
    group: 'View',
    keys: [
      ['Right drag', 'Turn the view'],
      ['Right held + W A S D', 'Fly; Q E lower, raise; Shift faster'],
      [{ action: 'view:game' }, 'Game view: where the game starts, and back'],
      [{ action: 'map:trial' }, 'Trial wave: the enemies walk the routes at their speed'],
      ['+ -', 'Trial wave faster, slower (1x to 8x)'],
      ['Middle drag, Shift+right drag', 'Pan'],
      ['Wheel', 'Zoom to the pointer'],
      ['Arrow keys', 'Pan'],
      [{ action: 'view:frame' }, 'Frame the selection or the map'],
      [{ action: 'view:top' }, 'Top view on or off'],
      [{ action: 'view:still' }, 'Still frame: wind, water, lava and particles stand still (the view only)'],
      ['Alt+1 to 9', 'Keep the current view'],
      ['Shift+1 to 9', 'Show a kept view'],
    ],
  },
  {
    group: 'Brushes',
    keys: [
      ['[ ]', 'Smaller, larger'],
      ['Ctrl+wheel', 'Brush size in the view'],
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
      ['Ctrl+A', 'Select all objects the view shows'],
      ['Q E, comma period', 'Place: turn the next object by a step (Shift+Q E by 90 degrees)'],
      ['Shift+wheel', 'Place: turn the next object by a step'],
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
