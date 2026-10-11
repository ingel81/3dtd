import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EditorSession } from '../editor-session.service';

/**
 * What the map holds: markers, roads, objects by asset (a click selects all
 * of one asset), ground layers, water. A click selects and frames.
 */
@Component({
  selector: 'app-editor-outliner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="td-side-head"><span class="td-side-name">Outline</span></header>
    <div class="td-side-body">
      @if (data(); as d) {
        <h3 class="td-head">Markers</h3>
        <div class="td-rows">
          <button class="td-row ol-row" type="button" role="option" [attr.aria-selected]="isSel('hq')" (click)="selectHq()">
            <span>HQ</span><span class="td-muted td-num">{{ d.hq }}</span>
          </button>
          @for (s of d.spawns; track s.id) {
            <button class="td-row ol-row" type="button" role="option" [attr.aria-selected]="isSel('spawn', s.id)" (click)="selectSpawn(s.id)">
              <span class="td-trunc">Spawn {{ s.name }}</span><span class="td-muted td-num">{{ s.at }}</span>
            </button>
          }
        </div>
        <h3 class="td-head">Roads <span class="td-note">{{ d.edges }} roads | {{ d.nodes }} nodes | {{ d.length }} m</span></h3>
        <h3 class="td-head">Objects <span class="td-note">{{ d.objects }}</span></h3>
        <div class="td-rows">
          @for (g of d.groups; track g.asset) {
            <button class="td-row ol-row" type="button" (click)="selectAsset(g.asset)">
              <span class="td-trunc">{{ g.name }}</span><span class="td-muted td-num">{{ g.count }}</span>
            </button>
          } @empty {
            <p class="td-note">None yet.</p>
          }
        </div>
        <h3 class="td-head">Ground</h3>
        <p class="td-note">{{ d.layers }}</p>
        <p class="td-note">{{ d.water }}</p>
      }
    </div>
  `,
  styles: [`.ol-row { min-height: 28px; } .td-head { margin-top: 8px; }`],
})
export class OutlinerComponent {
  private readonly session = inject(EditorSession);

  readonly data = computed(() => {
    this.session.docRev();
    const doc = this.session.doc;
    if (!doc) return null;
    const catalog = this.session.catalog();
    const groups = new Map<string, number>();
    for (const o of doc.objects) groups.set(o.asset, (groups.get(o.asset) ?? 0) + 1);
    let length = 0;
    for (const e of doc.paths.edges) {
      const a = doc.paths.nodes.find((n) => n.id === e.a);
      const b = doc.paths.nodes.find((n) => n.id === e.b);
      if (!a || !b) continue;
      const pts = [a, ...(e.via ?? []), b];
      for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    }
    const at = (p: { x: number; y: number }) => `${Math.round(p.x)}, ${Math.round(p.y)}`;
    return {
      hq: at(doc.hq),
      spawns: doc.spawns.map((s) => ({ id: s.id, name: s.name, at: at(s) })),
      edges: doc.paths.edges.length,
      nodes: doc.paths.nodes.length,
      length: Math.round(length),
      objects: doc.objects.length,
      groups: [...groups].map(([asset, count]) => ({ asset, count, name: catalog.object(asset).name })).sort((a, b) => b.count - a.count),
      layers: doc.terrain.layers.map((l) => catalog.material(l.material).name).join(', '),
      water: doc.terrain.water ? `Water at ${doc.terrain.water.level} m` : 'No water',
    };
  });

  isSel(kind: 'hq' | 'spawn', id?: string): boolean {
    const s = this.session.selection();
    return !!s && s.kind === kind && (kind === 'hq' || (s as { id: string }).id === id);
  }

  selectHq(): void {
    this.session.editor?.select({ kind: 'hq' });
    this.session.viewport?.focusSelection();
  }

  selectSpawn(id: string): void {
    this.session.editor?.select({ kind: 'spawn', id });
    this.session.viewport?.focusSelection();
  }

  selectAsset(asset: string): void {
    const editor = this.session.editor;
    if (!editor) return;
    editor.select({ kind: 'objects', ids: editor.doc.objects.filter((o) => o.asset === asset).map((o) => o.id) });
    this.session.selectTool('objects');
    this.session.patchSettings((s) => (s.objects.mode = 'select'));
    this.session.viewport?.focusSelection();
  }
}
