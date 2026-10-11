import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { tagName } from '../../catalog/asset-catalog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { MAX_LAYERS } from '../../ops/paint-ops';
import { paintCommands } from '../../tools/paint-tool';
import { EditorSession } from '../editor-session.service';
import type { GroundMaterialEntry } from '../../catalog/asset-catalog';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';

/**
 * Ground layers (up to eight materials, painted in list order), the layer
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
  readonly max = MAX_LAYERS;
  readonly thumb = (m: GroundMaterialEntry) => this.session.materialPicture(m);
  readonly settings = computed(() => (this.session.settingsRev(), { ...this.session.settings.paint }));
  readonly layers = computed(() => {
    this.session.docRev();
    const doc = this.session.doc;
    const catalog = this.session.catalog();
    return (doc?.terrain.layers ?? []).map((l, index) => ({ index, layer: l, material: catalog.material(l.material) }));
  });
  readonly materials = computed(() => this.session.catalog().catalog.materials);
  /** The materials by biome for adding a layer; one may stand in several groups */
  readonly materialGroups = computed(() => {
    const index = this.session.catalog();
    const all = index.catalog.materials;
    const groups = index.biomes().map((b) => ({ name: tagName(b), materials: all.filter((m) => m.tags?.includes(b)) }));
    const untagged = all.filter((m) => !m.tags?.length);
    return [...groups.filter((g) => g.materials.length), ...(untagged.length ? [{ name: 'Other', materials: untagged }] : [])];
  });
  readonly cliff = computed(() => {
    this.session.docRev();
    const t = this.session.doc?.terrain;
    return { material: t?.cliffMaterial ?? 'rock', angle: t?.cliffAngle ?? 40 };
  });

  pick(index: number): void {
    this.session.patchSettings((s) => (s.paint.layer = index));
  }

  setErase(on: boolean): void {
    this.session.patchSettings((s) => (s.paint.erase = on));
  }

  add(material: string): void {
    const editor = this.session.editor;
    if (!editor || editor.doc.terrain.layers.length >= MAX_LAYERS) return;
    this.session.execute(paintCommands.addLayer(editor, material));
    this.pick(editor.doc.terrain.layers.length - 1);
  }

  setMaterial(index: number, material: string): void {
    const editor = this.session.editor;
    if (editor) this.session.execute(paintCommands.setMaterial(editor, index, material));
  }

  remove(index: number): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.session.execute(paintCommands.removeLayer(editor, index));
    this.pick(Math.max(0, Math.min(this.settings().layer, editor.doc.terrain.layers.length - 1)));
  }

  move(index: number, dir: -1 | 1): void {
    const editor = this.session.editor;
    if (!editor) return;
    const to = index + dir;
    if (to < 0 || to >= editor.doc.terrain.layers.length) return;
    this.session.execute(paintCommands.moveLayer(editor, index, to));
    if (this.settings().layer === index) this.pick(to);
  }

  autoPaint(): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.session.execute(paintCommands.autoPaint(editor));
    this.session.flash('Painted by slope and height; undo brings back the old paint');
  }

  setCliff(material: string, angle: number): void {
    const editor = this.session.editor;
    if (editor) this.session.execute(paintCommands.setCliff(editor, material, angle));
  }

  readonly selectValue = (e: Event) => (e.target as HTMLSelectElement).value;
}
