import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent, type TdIconName } from '../../../components/icon/icon.component';
import { SYMMETRY_MODES, type SymmetryMode } from '../../ops/symmetry';
import { TOOLS, type ToolId } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { CheckPanelComponent } from '../panels/check-panel.component';
import { EnvironmentPanelComponent } from '../panels/environment-panel.component';
import { LandscapePanelComponent } from '../panels/landscape-panel.component';
import { MapPanelComponent } from '../panels/map-panel.component';
import { MarkerPanelComponent } from '../panels/marker-panel.component';
import { StampPanelComponent } from '../panels/stamp-panel.component';
import { GameplayPanelComponent } from '../panels/gameplay-panel.component';
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
    EnvironmentPanelComponent,
    MapPanelComponent,
    OutlinerComponent,
    MinimapComponent,
    CheckPanelComponent,
    StatusBarComponent,
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
    if (this.session.origin() === 'shipped') return 'Read only';
    if (this.session.saving()) return 'Saving';
    return this.session.dirty() ? 'Unsaved changes' : 'Saved';
  });

  constructor() {
    afterNextRender(() => {
      this.session.attachViewport(this.canvas().nativeElement);
      this.canvas().nativeElement.focus();
    });
  }

  ngOnDestroy(): void {
    this.session.detachViewport();
  }

  setSymmetry(mode: SymmetryMode): void {
    this.session.patchSettings((s) => (s.symmetry = mode));
    this.session.flash(mode === 'none' ? 'Symmetry off' : `Symmetry: ${SYMMETRY_MODES.find((m) => m.id === mode)!.label}`);
  }

  pick(id: ToolId): void {
    this.session.selectTool(id);
  }

  async check(): Promise<void> {
    const issues = this.session.runCheck();
    this.session.flash(issues.length ? `${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to look at` : 'The map checks out');
  }

  onKeyDown(e: KeyboardEvent): void {
    if (typing(e)) {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    const s = this.session;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z' && !e.shiftKey) return this.handled(e, () => s.undo());
    if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) return this.handled(e, () => s.redo());
    if (ctrl && k === 's') return this.handled(e, () => void s.save(true));
    // Ctrl+V from any tool places the last copy
    if (ctrl && k === 'v' && s.tool() !== 'stamp' && s.settings.stamp.current) {
      return this.handled(e, () => {
        this.pick('stamp');
        s.patchSettings((st) => (st.stamp.mode = 'paste'));
      });
    }
    if (!ctrl && !e.altKey) {
      const tool = TOOLS.find((t) => t.key === e.key);
      if (tool) return this.handled(e, () => this.pick(tool.id));
      if (k === 'v' && !e.shiftKey && s.tool() !== 'objects') return this.handled(e, () => void this.check());
      if (k === 'm' && !e.shiftKey) {
        const i = SYMMETRY_MODES.findIndex((m) => m.id === s.settings.symmetry);
        return this.handled(e, () => this.setSymmetry(SYMMETRY_MODES[(i + 1) % SYMMETRY_MODES.length].id));
      }
    }
    if (s.viewport?.key(e)) {
      e.preventDefault();
      s.refresh();
    }
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

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return !['range', 'checkbox', 'radio', 'button', 'color'].includes(type);
}
