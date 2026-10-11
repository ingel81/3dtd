import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { MapObject } from '../../../world/custom-map/map-document';
import { tagName, type ObjectAssetEntry } from '../../catalog/asset-catalog';
import { ObjectsCommand } from '../../model/editor-document';
import { duplicateObjects } from '../../ops/object-ops';
import type { GizmoMode, ObjectMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';

const MODES: { id: ObjectMode; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'W E R' },
  { id: 'place', label: 'Place', key: '' },
  { id: 'scatter', label: 'Scatter', key: '' },
  { id: 'erase', label: 'Erase', key: '' },
];

const SNAPS = [0, 1, 2, 4, 8];

/**
 * Objects: mode, the palette (categories, search, pictures), scatter
 * settings, grid snap, and the selected objects' values and flags.
 */
@Component({
  selector: 'app-object-panel',
  standalone: true,
  imports: [BrushPanelComponent, RangeRowComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  templateUrl: './object-panel.component.html',
  styleUrl: './object-panel.component.scss',
})
export class ObjectPanelComponent {
  readonly session = inject(EditorSession);
  readonly modes = MODES;
  readonly snaps = SNAPS;
  readonly thumb = (a: ObjectAssetEntry) => this.session.objectPicture(a);
  readonly search = signal('');
  readonly category = signal<string>('All');
  /** Biome tag the palette shows, '' for all */
  readonly biome = signal('');
  readonly biomes = computed(() => this.session.catalog().biomes());
  readonly tagName = tagName;

  readonly s = computed(() => (this.session.settingsRev(), structuredClone(this.session.settings.objects)));
  readonly categories = computed(() => ['All', ...this.session.catalog().categories()]);
  readonly assets = computed(() => {
    const q = this.search().trim().toLowerCase();
    const cat = this.category();
    const biome = this.biome();
    return this.session
      .catalog()
      .catalog.objects.filter(
        (o) =>
          !o.internal &&
          (cat === 'All' || o.category === cat) &&
          (!biome || !!o.tags?.includes(biome)) &&
          (!q || o.name.toLowerCase().includes(q) || o.id.includes(q) || !!o.tags?.some((t) => t.startsWith(q))),
      );
  });
  readonly selected = computed<MapObject[]>(() => {
    this.session.docRev();
    const sel = this.session.selection();
    const doc = this.session.doc;
    if (sel?.kind !== 'objects' || !doc) return [];
    const ids = new Set(sel.ids);
    return doc.objects.filter((o) => ids.has(o.id));
  });
  readonly single = computed(() => (this.selected().length === 1 ? this.selected()[0] : null));

  setMode(mode: ObjectMode): void {
    this.session.patchSettings((s) => (s.objects.mode = mode));
  }

  setGizmo(g: GizmoMode): void {
    this.session.patchSettings((s) => {
      s.objects.mode = 'select';
      s.objects.gizmo = g;
    });
  }

  chooseAsset(a: ObjectAssetEntry): void {
    this.session.patchSettings((s) => {
      const o = s.objects;
      if (o.mode === 'scatter') {
        const set = new Set(o.scatter.assets);
        if (set.has(a.id)) set.delete(a.id);
        else set.add(a.id);
        o.scatter.assets = [...set];
        o.asset = a.id;
      } else {
        o.asset = a.id;
        if (o.mode === 'select' || o.mode === 'erase') o.mode = 'place';
      }
    });
  }

  isChosen(a: ObjectAssetEntry): boolean {
    const s = this.s();
    return s.mode === 'scatter' ? s.scatter.assets.includes(a.id) : s.asset === a.id;
  }

  setScatter(key: 'density' | 'scaleMin' | 'scaleMax' | 'minDistance', value: number): void {
    this.session.patchSettings((s) => {
      s.objects.scatter[key] = value;
      if (key === 'scaleMin' && s.objects.scatter.scaleMax < value) s.objects.scatter.scaleMax = value;
      if (key === 'scaleMax' && s.objects.scatter.scaleMin > value) s.objects.scatter.scaleMin = value;
    });
  }

  setScatterFlag(key: 'randomRotation' | 'sinkOnSlope', on: boolean): void {
    this.session.patchSettings((s) => (s.objects.scatter[key] = on));
  }

  setSpace(space: 'global' | 'local'): void {
    this.session.patchSettings((s) => (s.objects.space = space));
  }

  dropToGround(): void {
    this.change('Drop to the ground', (o) => ({ ...o, z: 0 }));
  }

  setSnap(step: number): void {
    this.session.patchSettings((s) => (s.objects.snap = step));
  }

  setRandomRotation(on: boolean): void {
    this.session.patchSettings((s) => (s.objects.randomRotation = on));
  }

  /** Change the selected objects' values as one step */
  change(label: string, update: (o: MapObject) => MapObject): void {
    const editor = this.session.editor;
    const ids = this.selected().map((o) => o.id);
    if (!editor || !ids.length) return;
    this.session.execute(ObjectsCommand.change(label, editor.doc, ids, update));
  }

  setNumber(key: 'x' | 'y' | 'z' | 'scale', e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v) || (key === 'scale' && v <= 0)) return;
    this.change(key === 'scale' ? 'Scale' : 'Move', (o) => ({ ...o, [key]: v }));
  }

  setRotation(e: Event): void {
    const deg = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(deg)) this.change('Turn', (o) => ({ ...o, rotation: Math.round(((deg * Math.PI) / 180) * 1000) / 1000 }));
  }

  /** Flag override: inherit the catalogue (null), on, off */
  flag(key: 'blocksLos' | 'blocksBuild'): 'auto' | 'on' | 'off' {
    const list = this.selected();
    if (!list.length) return 'auto';
    const v = list[0][key];
    if (!list.every((o) => o[key] === v)) return 'auto';
    return v === undefined ? 'auto' : v ? 'on' : 'off';
  }

  setFlag(key: 'blocksLos' | 'blocksBuild', value: 'auto' | 'on' | 'off'): void {
    this.change(key === 'blocksLos' ? 'Blocks sight' : 'Blocks building', (o) => {
      const next = { ...o };
      if (value === 'auto') delete next[key];
      else next[key] = value === 'on';
      return next;
    });
  }

  catalogFlag(key: 'blocksLos' | 'blocksBuild'): string {
    const o = this.single() ?? this.selected()[0];
    if (!o) return '';
    return this.session.catalog().object(o.asset)[key] ? 'yes' : 'no';
  }

  remove(): void {
    const editor = this.session.editor;
    const ids = this.selected().map((o) => o.id);
    if (!editor || !ids.length) return;
    this.session.execute(ObjectsCommand.remove(ids.length === 1 ? 'Delete object' : `Delete ${ids.length} objects`, editor.doc, ids));
    editor.select(null);
  }

  duplicate(): void {
    const editor = this.session.editor;
    const ids = this.selected().map((o) => o.id);
    if (!editor || !ids.length) return;
    const step = Math.max(2, this.s().snap || 4);
    const copies = duplicateObjects(editor.doc, ids, { x: step, y: -step });
    this.session.execute(ObjectsCommand.add('Duplicate', editor.doc, copies));
    editor.select({ kind: 'objects', ids: copies.map((o) => o.id) });
  }

  name(asset: string): string {
    return this.session.catalog().object(asset).name;
  }

  deg(rad: number): number {
    return Math.round((rad * 180) / Math.PI);
  }

  readonly value = (e: Event) => (e.target as HTMLInputElement).value;
}
