import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MAX_SIGN_TEXT, type MapObject, type MapSign } from '../../../world/custom-map/map-document';
import { SIGN_ICONS } from '../../../world/custom-map/render/objects/sign-icons';
import { tagName, type ObjectAssetEntry } from '../../../map-ops/asset-catalog';
import { ObjectsCommand } from '../../model/commands/objects';
import { setDown, rockShape, duplicateObjects, variedTint, wallKitOf } from '../../../map-ops/object-ops';
import { patch, type GizmoMode, type ObjectMode, type SettingValues } from '../../tools/tool';

type ObjectToolSettings = SettingValues['objects'];
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { BrushPanelComponent } from './brush-panel.component';
import { PrefabPanelComponent } from './prefab-panel.component';
import { RangeRowComponent } from './range-row.component';
import { injectT } from '../../../i18n/i18n.service';
import { catalogName, categoryWord } from '../../ops/describe';

const MODES: { id: ObjectMode; key: string }[] = [
  { id: 'select', key: 'W E R' },
  { id: 'place', key: '' },
  { id: 'scatter', key: '' },
  { id: 'line', key: '' },
  { id: 'erase', key: '' },
];

const SNAPS = [0, 1, 2, 4, 8];
/** Degrees one turn step of Place takes */
const TURN_STEPS = [5, 15, 45, 90];
/** Palette cards added a frame: a big catalogue fills over a few frames, not every card and its tooltip in one (50 ms) */
const CARDS_PER_FRAME = 40;

/**
 * Objects: mode, the palette (categories, search, pictures), scatter
 * settings, grid snap, and the selected objects' values and flags.
 */
@Component({
  selector: 'app-object-panel',
  standalone: true,
  imports: [BrushPanelComponent, PrefabPanelComponent, RangeRowComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  templateUrl: './object-panel.component.html',
  styleUrl: './object-panel.component.scss',
})
export class ObjectPanelComponent {
  protected readonly t = injectT();
  readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('objects', 'terrain');
  readonly modes = MODES;
  readonly snaps = SNAPS;
  readonly turnSteps = TURN_STEPS;
  readonly thumb = (a: ObjectAssetEntry) => this.session.pictures.objectPicture(a);
  readonly search = signal('');
  /** The category the palette shows; '' for all of them */
  readonly category = signal<string>('');
  /** Biome tag the palette shows, '' for all */
  readonly biome = signal('');
  readonly biomes = computed(() => this.session.catalog().biomes());
  readonly tagName = tagName;

  readonly s = this.session.tools.settings.objects;
  /** The wall kit the chosen asset belongs to: Line mode fits the kit's pieces instead of spacing one asset */
  readonly kit = computed(() => wallKitOf(this.s().asset));
  readonly categories = computed(() => ['', ...this.session.catalog().categories()]);
  readonly categoryWord = categoryWord;
  readonly assets = computed(() => {
    const q = this.search().trim().toLowerCase();
    const cat = this.category();
    const biome = this.biome();
    return this.session
      .catalog()
      .catalog.objects.filter(
        (o) =>
          !o.internal &&
          (!cat || o.category === cat) &&
          (!biome || !!o.tags?.includes(biome)) &&
          (!q || catalogName(this.t(), o).toLowerCase().includes(q) || o.name.toLowerCase().includes(q) || o.id.includes(q) || !!o.tags?.some((t) => t.startsWith(q))),
      );
  });
  /** Cards drawn so far of the assets matching */
  private readonly drawn = signal(CARDS_PER_FRAME);
  readonly shownAssets = computed(() => this.assets().slice(0, this.drawn()));
  readonly selected = computed<MapObject[]>(() => {
    this.rev();
    const sel = this.session.state.selection();
    const doc = this.session.doc;
    if (sel?.kind !== 'objects' || !doc) return [];
    const ids = new Set(sel.ids);
    return doc.objects.filter((o) => ids.has(o.id));
  });
  readonly single = computed(() => (this.selected().length === 1 ? this.selected()[0] : null));

  constructor() {
    // A new filter starts the palette anew and fills it a few cards a frame
    effect((onCleanup) => {
      const total = this.assets().length;
      untracked(() => this.drawn.set(CARDS_PER_FRAME));
      let frame = 0;
      const grow = (): void => {
        const n = untracked(this.drawn) + CARDS_PER_FRAME;
        this.drawn.set(n);
        if (n < total) frame = requestAnimationFrame(grow);
      };
      if (total > CARDS_PER_FRAME) frame = requestAnimationFrame(grow);
      onCleanup(() => cancelAnimationFrame(frame));
    });
  }

  setMode(mode: ObjectMode): void {
    patch(this.session.tools.settings.objects, { mode });
  }

  setGizmo(g: GizmoMode): void {
    patch(this.session.tools.settings.objects, { mode: 'select', gizmo: g });
  }

  chooseAsset(a: ObjectAssetEntry): void {
    const o = this.session.tools.settings.objects();
    if (o.mode === 'scatter') {
      const set = new Set(o.scatter.assets);
      if (set.has(a.id)) set.delete(a.id);
      else set.add(a.id);
      patch(this.session.tools.settings.objects, { scatter: { ...o.scatter, assets: [...set] }, asset: a.id });
    } else {
      patch(this.session.tools.settings.objects, { asset: a.id, mode: o.mode === 'select' || o.mode === 'erase' ? 'place' : o.mode });
    }
  }

  isChosen(a: ObjectAssetEntry): boolean {
    const s = this.s();
    return s.mode === 'scatter' ? s.scatter.assets.includes(a.id) : s.asset === a.id;
  }

  setScatterTint(tint: string | null): void {
    this.setScatterOption({ tint });
  }

  /** The selection's tint when all share one */
  tint(): string | null {
    const list = this.selected();
    const t = list[0]?.tint;
    return t && list.every((o) => o.tint === t) ? t : null;
  }

  setTint(tint: string | null): void {
    this.change(tint ? this.t().editor.objects.undo.tint : this.t().editor.objects.undo.noTint, (o) => {
      const next = { ...o };
      if (tint) next.tint = tint;
      else delete next.tint;
      return next;
    });
  }

  readonly signIcons = Object.keys(SIGN_ICONS);
  readonly maxSignText = MAX_SIGN_TEXT;

  /** Whether every selected object has a sign panel */
  signs(): boolean {
    const list = this.selected();
    const catalog = this.session.catalog();
    return list.length > 0 && list.every((o) => !!catalog.object(o.asset).signs);
  }

  /** The selection's sign when all share one */
  sign(): MapSign {
    const list = this.selected();
    const first = list[0]?.sign ?? {};
    return list.every((o) => o.sign?.text === first.text && o.sign?.icon === first.icon) ? first : {};
  }

  /** Writes the selected signs' word or pictogram; an empty sign is taken away */
  setSign(part: Partial<MapSign>): void {
    this.change('Sign', (o) => {
      const sign: MapSign = { ...o.sign, ...part };
      if (!sign.text) delete sign.text;
      if (!sign.icon) delete sign.icon;
      const next = { ...o };
      if (sign.text || sign.icon) next.sign = sign;
      else delete next.sign;
      return next;
    });
  }

  /** Every selected object a shade of its own around the tint (or around white) */
  randomTint(): void {
    const base = this.tint();
    this.change(this.t().editor.objects.undo.randomTint, (o) => ({ ...o, tint: variedTint(base, 0.6, Math.random)! }));
  }

  setScatter(key: 'density' | 'scaleMin' | 'scaleMax' | 'minDistance' | 'tintVariation', value: number): void {
    const scatter = this.session.tools.settings.objects().scatter;
    this.setScatterOption({
      [key]: value,
      ...(key === 'scaleMin' && scatter.scaleMax < value ? { scaleMax: value } : {}),
      ...(key === 'scaleMax' && scatter.scaleMin > value ? { scaleMin: value } : {}),
    });
  }

  setLine(changes: Partial<ObjectToolSettings['line']>): void {
    patch(this.session.tools.settings.objects, { line: { ...this.session.tools.settings.objects().line, ...changes } });
  }

  private setScatterOption(changes: Partial<ObjectToolSettings['scatter']>): void {
    patch(this.session.tools.settings.objects, { scatter: { ...this.session.tools.settings.objects().scatter, ...changes } });
  }

  setAlign(on: boolean): void {
    patch(this.session.tools.settings.objects, { alignToSlope: on });
  }

  /** Each selected object tilted with the ground under it; a rock lies down on it anew, settled onto its plate */
  alignSelection(): void {
    const t = this.session.doc?.terrain;
    if (!t) return;
    const catalog = this.session.catalog();
    this.change(this.t().editor.objects.undo.align, (o) => {
      const entry = catalog.object(o.asset);
      const rock = rockShape(entry);
      return setDown(t, rock ? { ...o, z: 0 } : o, rock, true, entry.radius);
    });
  }

  upright(): void {
    this.change(this.t().editor.objects.undo.upright, (o) => {
      const next = { ...o };
      delete next.pitch;
      delete next.roll;
      return next;
    });
  }

  setTilt(key: 'pitch' | 'roll', e: Event): void {
    const deg = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(deg)) return;
    const rad = Math.round(((deg * Math.PI) / 180) * 1000) / 1000;
    this.change(this.t().editor.objects.undo.tilt, (o) => {
      const next = { ...o };
      if (rad) next[key] = rad;
      else delete next[key];
      return next;
    });
  }

  setScatterFlag(key: 'randomRotation' | 'sinkOnSlope' | 'alignToSlope', on: boolean): void {
    this.setScatterOption({ [key]: on });
  }

  setSpace(space: 'global' | 'local'): void {
    patch(this.session.tools.settings.objects, { space });
  }

  dropToGround(): void {
    this.change(this.t().editor.objects.undo.drop, (o) => ({ ...o, z: 0 }));
  }

  setSnap(step: number): void {
    patch(this.session.tools.settings.objects, { snap: step });
  }

  setRandomRotation(on: boolean): void {
    patch(this.session.tools.settings.objects, { randomRotation: on });
  }

  placeTurnDegrees(): number {
    return Math.round((this.s().rotation * 180) / Math.PI) % 360;
  }

  /** The turn of the next placed object, degrees counter-clockwise from north */
  setPlaceTurn(e: Event): void {
    const deg = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(deg)) return;
    const turn = (((deg % 360) + 360) % 360) * (Math.PI / 180);
    patch(this.session.tools.settings.objects, { rotation: Math.round(turn * 1000) / 1000 });
  }

  setTurnStep(step: number): void {
    patch(this.session.tools.settings.objects, { turnStep: step });
  }

  setFaceRoad(on: boolean): void {
    patch(this.session.tools.settings.objects, { faceRoad: on });
  }

  /** Change the selected objects' values as one step */
  change(label: string, update: (o: MapObject) => MapObject): void {
    const editor = this.session.editor;
    const ids = this.selected().map((o) => o.id);
    if (!editor || !ids.length) return;
    this.session.edit(this.t().editor.objects.undo.changing, (e) => e.execute(ObjectsCommand.change(label, editor.doc, ids, update)));
  }

  setNumber(key: 'x' | 'y' | 'z' | 'scale', e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v) || (key === 'scale' && v <= 0)) return;
    this.change(key === 'scale' ? this.t().editor.objects.undo.scale : this.t().editor.objects.undo.move, (o) => ({ ...o, [key]: v }));
  }

  setRotation(e: Event): void {
    const deg = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(deg)) this.change(this.t().editor.objects.undo.turn, (o) => ({ ...o, rotation: Math.round(((deg * Math.PI) / 180) * 1000) / 1000 }));
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
    this.change(key === 'blocksLos' ? this.t().editor.objects.undo.blocksSight : this.t().editor.objects.undo.blocksBuilding, (o) => {
      const next = { ...o };
      if (value === 'auto') delete next[key];
      else next[key] = value === 'on';
      return next;
    });
  }

  catalogFlag(key: 'blocksLos' | 'blocksBuild'): string {
    const o = this.single() ?? this.selected()[0];
    if (!o) return '';
    return this.session.catalog().object(o.asset)[key] ? this.t().editor.objects.yesWord : this.t().editor.objects.noWord;
  }

  remove(): void {
    const editor = this.session.editor;
    const ids = this.selected().map((o) => o.id);
    if (!editor || !ids.length) return;
    const says = this.t().editor.objects.undo;
    this.session.edit(says.changing, (e) => e.execute(ObjectsCommand.remove(ids.length === 1 ? says.deleteOne : says.deleteMany(ids.length), editor.doc, ids)));
    editor.select(null);
  }

  duplicate(): void {
    const editor = this.session.editor;
    const ids = this.selected().map((o) => o.id);
    if (!editor || !ids.length) return;
    const step = Math.max(2, this.s().snap || 4);
    const copies = duplicateObjects(editor.doc, ids, { x: step, y: -step }, editor.objectIds);
    this.session.edit(this.t().editor.objects.undo.changing, (e) => e.execute(ObjectsCommand.add(this.t().editor.objects.undo.duplicate, editor.doc, copies)));
    editor.select({ kind: 'objects', ids: copies.map((o) => o.id) });
  }

  name(asset: string): string {
    return catalogName(this.t(), this.session.catalog().object(asset));
  }

  /** An entry's name in the player's words */
  nameOf(entry: ObjectAssetEntry): string {
    return catalogName(this.t(), entry);
  }

  deg(rad: number): number {
    return Math.round((rad * 180) / Math.PI);
  }

  readonly value = (e: Event) => (e.target as HTMLInputElement).value;
}
