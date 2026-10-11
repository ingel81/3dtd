import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { EditorSession } from '../editor-session.service';

/**
 * What the map holds: markers, roads, objects by category and asset (a
 * click selects all of one asset; the eye hides a category in the view),
 * object groups, ground layers, water. A search narrows the lists. A click
 * selects and frames.
 */
@Component({
  selector: 'app-editor-outliner',
  standalone: true,
  imports: [TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="td-side-head"><span class="td-side-name">Outline</span></header>
    <div class="td-side-body">
      @if (data(); as d) {
        <input class="td-input is-sm" type="search" placeholder="Find in the map" [value]="query()" (input)="query.set($any($event.target).value)"
               aria-label="Find in the map" data-test="outline-search" />
        @if (d.spawns.length || matches('hq')) {
          <h3 class="td-head">Markers</h3>
          <div class="td-rows">
            @if (matches('hq')) {
              <button class="td-row ol-row" type="button" role="option" [attr.aria-selected]="isSel('hq')" (click)="selectHq()">
                <span>HQ</span><span class="td-muted td-num">{{ d.hq }}</span>
              </button>
            }
            @for (s of d.spawns; track s.id) {
              <button class="td-row ol-row" type="button" role="option" [attr.aria-selected]="isSel('spawn', s.id)" (click)="selectSpawn(s.id)">
                <span class="td-trunc">{{ s.label }}</span><span class="td-muted td-num">{{ s.at }}</span>
              </button>
            }
          </div>
        }
        <h3 class="td-head">Roads <span class="td-note" data-test="roads">{{ d.edges }} roads | {{ d.nodes }} nodes | {{ d.length }} m</span></h3>
        <h3 class="td-head">Objects <span class="td-note">{{ d.objects }}</span></h3>
        @for (c of d.categories; track c.name) {
          <div class="ol-cat">
            <span class="td-trunc ol-cat-name" [class.is-off]="c.hidden">{{ c.name }}</span>
            <span class="td-muted td-num">{{ c.count }}</span>
            <button class="td-tool is-sm" type="button" [attr.aria-pressed]="!c.hidden" [attr.aria-label]="(c.hidden ? 'Show ' : 'Hide ') + c.name"
                    [matTooltip]="c.hidden ? 'Hidden in the view: show' : 'Hide in the view (the map keeps them)'" (click)="toggleCategory(c.name)"
                    [attr.data-hide]="c.name">
              <td-icon [name]="c.hidden ? 'eyeOff' : 'eye'" [size]="14" />
            </button>
          </div>
          <div class="td-rows">
            @for (g of c.assets; track g.asset) {
              <button class="td-row ol-row" type="button" (click)="selectAsset(g.asset)" [disabled]="c.hidden">
                <span class="td-trunc">{{ g.name }}</span><span class="td-muted td-num">{{ g.count }}</span>
              </button>
            }
          </div>
        } @empty {
          <p class="td-note">{{ query() ? 'Nothing matches.' : 'None yet.' }}</p>
        }
        @if (d.groups.length) {
          <h3 class="td-head">Groups <span class="td-note">Ctrl+G</span></h3>
          <div class="td-rows">
            @for (g of d.groups; track g.id) {
              <button class="td-row ol-row" type="button" (click)="selectGroup(g.id)">
                <span class="td-trunc">{{ g.id }}: {{ g.names }}</span><span class="td-muted td-num">{{ g.count }}</span>
              </button>
            }
          </div>
        }
        <h3 class="td-head">Ground</h3>
        <p class="td-note">{{ d.layers }}</p>
        <p class="td-note">{{ d.water }}</p>
      }
    </div>
  `,
  styles: [
    `
      .ol-row {
        min-height: 28px;
      }
      .td-head {
        margin-top: 8px;
      }
      .ol-cat {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
        font-weight: 600;
      }
      .ol-cat-name {
        flex: 1 1 auto;
      }
      .ol-cat-name.is-off {
        opacity: 0.5;
      }
    `,
  ],
})
export class OutlinerComponent {
  private readonly session = inject(EditorSession);
  readonly query = signal('');

  readonly data = computed(() => {
    this.session.docRev();
    this.session.settingsRev();
    const doc = this.session.doc;
    if (!doc) return null;
    const q = this.query().trim().toLowerCase();
    const has = (text: string) => !q || text.toLowerCase().includes(q);
    const catalog = this.session.catalog();
    const hidden = new Set(this.session.settings.view.hidden ?? []);
    const byAsset = new Map<string, number>();
    const groups = new Map<string, { count: number; names: Set<string> }>();
    for (const o of doc.objects) {
      byAsset.set(o.asset, (byAsset.get(o.asset) ?? 0) + 1);
      if (o.group) {
        const g = groups.get(o.group) ?? { count: 0, names: new Set<string>() };
        g.count++;
        g.names.add(catalog.object(o.asset).name);
        groups.set(o.group, g);
      }
    }
    const categories = new Map<string, { name: string; count: number; hidden: boolean; assets: { asset: string; name: string; count: number }[] }>();
    for (const [asset, count] of byAsset) {
      const entry = catalog.object(asset);
      if (!has(entry.name) && !has(entry.category) && !has(asset)) continue;
      const c = categories.get(entry.category) ?? { name: entry.category, count: 0, hidden: hidden.has(entry.category), assets: [] };
      c.count += count;
      c.assets.push({ asset, name: entry.name, count });
      categories.set(entry.category, c);
    }
    for (const c of categories.values()) c.assets.sort((a, b) => b.count - a.count);
    let length = 0;
    for (const e of doc.paths.edges) {
      const a = doc.paths.nodes.find((n) => n.id === e.a);
      const b = doc.paths.nodes.find((n) => n.id === e.b);
      if (!a || !b) continue;
      const pts = [a, ...(e.via ?? []), b];
      for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    }
    const at = (p: { x: number; y: number }) => `${Math.round(p.x)}, ${Math.round(p.y)}`;
    const t = doc.terrain;
    const water = [
      t.water ? `Water at ${t.water.level} m` : 'No main water',
      t.waterBodies?.length ? `${t.waterBodies.length} more ${t.waterBodies.length === 1 ? 'body' : 'bodies'}` : '',
      t.rivers?.length ? `${t.rivers.length} ${t.rivers.length === 1 ? 'river' : 'rivers'}` : '',
    ].filter((w) => w);
    const order = catalog.categories();
    return {
      hq: at(doc.hq),
      spawns: doc.spawns
        .map((s) => ({ id: s.id, label: /spawn/i.test(s.name) ? s.name : `Spawn ${s.name}`, at: at(s) }))
        .filter((s) => has(s.label)),
      edges: doc.paths.edges.length,
      nodes: doc.paths.nodes.length,
      length: Math.round(length),
      objects: doc.objects.length,
      categories: [...categories.values()].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)),
      groups: [...groups]
        .map(([id, g]) => ({ id, count: g.count, names: [...g.names].slice(0, 3).join(', ') }))
        .filter((g) => has(g.id) || has(g.names)),
      layers: t.layers.map((l) => catalog.material(l.material).name).join(', '),
      water: water.join(', '),
    };
  });

  matches(text: string): boolean {
    const q = this.query().trim().toLowerCase();
    return !q || text.includes(q);
  }

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
    this.selectObjects(editor.doc.objects.filter((o) => o.asset === asset).map((o) => o.id));
  }

  selectGroup(group: string): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.selectObjects(editor.doc.objects.filter((o) => o.group === group).map((o) => o.id));
  }

  toggleCategory(name: string): void {
    this.session.patchSettings((s) => {
      const hidden = new Set(s.view.hidden ?? []);
      if (hidden.has(name)) hidden.delete(name);
      else hidden.add(name);
      s.view.hidden = [...hidden];
    });
  }

  private selectObjects(ids: string[]): void {
    this.session.editor?.select({ kind: 'objects', ids });
    this.session.selectTool('objects');
    this.session.patchSettings((s) => (s.objects.mode = 'select'));
    this.session.viewport?.focusSelection();
  }
}
