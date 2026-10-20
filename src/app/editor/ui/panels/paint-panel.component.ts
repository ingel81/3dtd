import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { tagName } from '../../../map-ops/asset-catalog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { MAX_LAYERS } from '../../../map-ops/paint-ops';
import { paintCommands } from '../../ops/ground-commands';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import type { GroundMaterialEntry } from '../../../map-ops/asset-catalog';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';
import { patch } from '../../tools/tool';
import { injectT } from '../../../i18n/i18n.service';

/** What a layer edit says when it has to wait */

/**
 * Ground layers (up to twelve materials, painted in list order), the layer
 * to paint with, auto paint and the cliff material.
 */
@Component({
  selector: 'app-paint-panel',
  standalone: true,
  imports: [BrushPanelComponent, RangeRowComponent, TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  templateUrl: './paint-panel.component.html',
  styleUrl: './paint-panel.component.scss',
})
export class PaintPanelComponent {
  readonly session = inject(EditorSession);
  protected readonly t = injectT();
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('terrain');
  readonly max = MAX_LAYERS;
  readonly thumb = (m: GroundMaterialEntry) => this.session.pictures.materialPicture(m);
  readonly settings = this.session.tools.settings.paint;
  readonly layers = computed(() => {
    this.rev();
    const doc = this.session.doc;
    const catalog = this.session.catalog();
    return (doc?.terrain.layers ?? []).map((l, index) => ({ index, layer: l, material: catalog.material(l.material) }));
  });
  readonly materials = computed(() => this.session.catalog().catalog.materials);
  /** The materials by biome for adding a layer; one may stand in several groups */
  readonly materialGroups = computed(() => {
    const index = this.session.catalog();
    const all = index.catalog.materials;
    const groups = index.biomes().map((b) => ({ name: tagName(this.t(), b), materials: all.filter((m) => m.tags?.includes(b)) }));
    const untagged = all.filter((m) => !m.tags?.length);
    return [...groups.filter((g) => g.materials.length), ...(untagged.length ? [{ name: this.t().editor.ground.other, materials: untagged }] : [])];
  });
  /** The palette for a new layer is open */
  readonly adding = signal(false);
  /** The landscape group the palette shows; the first one until one is picked */
  readonly groupPick = signal<string | null>(null);
  readonly group = computed(() => {
    const groups = this.materialGroups();
    const pick = this.groupPick();
    return groups.some((g) => g.name === pick) ? pick! : (groups[0]?.name ?? '');
  });
  readonly groupMaterials = computed(() => this.materialGroups().find((g) => g.name === this.group())?.materials ?? []);
  readonly cliff = computed(() => {
    this.rev();
    const t = this.session.doc?.terrain;
    return { material: t?.cliffMaterial ?? 'rock', angle: t?.cliffAngle ?? 40 };
  });

  pick(index: number): void {
    patch(this.session.tools.settings.paint, { layer: index });
  }

  setErase(on: boolean): void {
    patch(this.session.tools.settings.paint, { erase: on });
  }

  add(material: string): void {
    const layers = this.session.doc?.terrain.layers;
    if (!layers || layers.length >= MAX_LAYERS) return;
    if (this.session.edit(this.t().editor.ground.changing, (e) => paintCommands.addLayer(e, material))) this.pick(this.session.doc!.terrain.layers.length - 1);
  }

  setMaterial(index: number, material: string): void {
    this.session.edit(this.t().editor.ground.changing, (e) => paintCommands.setMaterial(e, index, material));
  }

  remove(index: number): void {
    if (this.session.edit(this.t().editor.ground.changing, (e) => paintCommands.removeLayer(e, index))) {
      this.pick(Math.max(0, Math.min(this.settings().layer, this.session.doc!.terrain.layers.length - 1)));
    }
  }

  move(index: number, dir: -1 | 1): void {
    const to = index + dir;
    const count = this.session.doc?.terrain.layers.length ?? 0;
    if (to < 0 || to >= count) return;
    if (this.session.edit(this.t().editor.ground.changing, (e) => paintCommands.moveLayer(e, index, to)) && this.settings().layer === index) this.pick(to);
  }

  autoPaint(): void {
    if (this.session.edit(this.t().editor.ground.changing, (e) => paintCommands.autoPaint(e))) this.session.notices.flash(this.t().editor.ground.autoPainted);
  }

  setCliff(material: string, angle: number): void {
    this.session.edit(this.t().editor.ground.changing, (e) => paintCommands.setCliff(e, material, angle));
  }

  readonly selectValue = (e: Event) => (e.target as HTMLSelectElement).value;
}
