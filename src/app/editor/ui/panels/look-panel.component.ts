import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { selectedEdges, selectedNodes, selectedSpawns } from '../../model/editor-document';
import { describeGround, describePick } from '../../ops/describe';
import type { PickResult } from '../../model/editor-document';
import { patch } from '../../tools/tool';
import type { ToolId } from '../../tools/tool-defs';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { injectT } from '../../../i18n/i18n.service';

/** Look: what the click picked, and the tool that edits it */
@Component({
  selector: 'app-look-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    @let w = t().editor.look;
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.tools.look.label }}</h3>
      <p class="td-note">{{ w.aboutBefore }} <kbd class="td-kbd">Esc</kbd> {{ w.aboutAfter }}</p>
    </div>
    <div class="td-group" data-test="look-selected">
      <h3 class="td-section">{{ w.selected }}</h3>
      @if (picked(); as p) {
        <div class="td-kv"><span>{{ w.what }}</span><span class="td-trunc">{{ p.what }}</span></div>
        @if (p.count > 1) {
          <div class="td-kv"><span>{{ w.howMany }}</span><span class="td-num">{{ p.count }}</span></div>
        }
        @if (p.at) {
          <div class="td-kv"><span>{{ w.where }}</span><span class="td-num">{{ p.at }}</span></div>
        }
        <div class="td-actions is-start">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="edit(p.tool)" data-test="look-edit">{{ w.editWith(t().editor.tools[p.tool].label) }}</button>
        </div>
      } @else if (ground(); as g) {
        <div class="td-kv"><span>{{ w.ground }}</span><span class="td-trunc">{{ g.what }}</span></div>
        <div class="td-kv"><span>{{ w.height }}</span><span class="td-num">{{ g.height }}</span></div>
        <div class="td-kv"><span>{{ w.slope }}</span><span class="td-num">{{ g.slope }}</span></div>
        <div class="td-kv"><span>{{ w.water }}</span><span>{{ g.water }}</span></div>
        <div class="td-kv"><span>{{ w.where }}</span><span class="td-num">{{ g.at }}</span></div>
        <div class="td-actions is-start">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="edit('paint')" data-test="look-edit">{{ w.editWith(t().editor.tools.paint.label) }}</button>
        </div>
      } @else {
        <p class="td-note">{{ w.nothingYet }}</p>
      }
    </div>
  `,
})
export class LookPanelComponent {
  private readonly session = inject(EditorSession);
  protected readonly t = injectT();
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('objects', 'markers', 'paths', 'terrain', 'water');

  readonly picked = computed(() => {
    this.rev();
    const sel = this.session.state.selection();
    const editor = this.session.editor;
    if (!sel || !editor) return null;
    const doc = editor.doc;
    const at = (q: { x: number; y: number } | undefined) => (q ? this.t().editor.look.at(Math.round(q.x), Math.round(q.y)) : '');
    let first: PickResult;
    let count = 1;
    let tool: ToolId;
    let where: string;
    if (sel.kind === 'objects') {
      if (!sel.ids.length) return null;
      first = { kind: 'object', id: sel.ids[0] };
      count = sel.ids.length;
      tool = 'objects';
      where = at(doc.objects.find((o) => o.id === sel.ids[0]));
    } else if (sel.kind === 'hq') {
      first = { kind: 'hq' };
      tool = 'markers';
      where = at(doc.hq);
    } else if (sel.kind === 'spawn' || sel.kind === 'spawns') {
      const ids = selectedSpawns(sel);
      first = { kind: 'spawn', id: ids[0] };
      count = ids.length;
      tool = 'markers';
      where = at(doc.spawns.find((s) => s.id === ids[0]));
    } else {
      const nodes = selectedNodes(sel);
      const edges = selectedEdges(sel);
      first = edges.length ? { kind: 'edge', id: edges[0] } : { kind: 'node', id: nodes[0] };
      count = nodes.length + edges.length;
      tool = 'paths';
      where = at(doc.paths.nodes.find((n) => n.id === nodes[0]));
    }
    return { what: describePick(first, doc, this.session.catalog(), this.t()), count, at: where, tool };
  });

  /** The ground point a click found nothing on (LookTool), described */
  readonly ground = computed(() => {
    this.rev();
    const at = this.session.tools.settings.look().at;
    const editor = this.session.editor;
    if (!at || !editor || this.session.state.selection()) return null;
    return { ...describeGround(editor.doc.terrain, at.x, at.y, this.session.catalog(), this.t()), at: this.t().editor.look.at(Math.round(at.x), Math.round(at.y)) };
  });

  /** Hands the selection to the tool that edits it, in the mode that moves it */
  edit(tool: ToolId): void {
    const s = this.session;
    s.tools.select(tool);
    if (tool === 'objects') patch(s.tools.settings.objects, { mode: 'select' });
    if (tool === 'paths') patch(s.tools.settings.paths, { mode: 'edit' });
  }
}
