import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { selectedEdges, selectedNodes, selectedSpawns } from '../../model/editor-document';
import { describeGround, describePick } from '../../tools/look-tool';
import type { PickResult, ToolId } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';

/** Look: what the click picked, and the tool that edits it */
@Component({
  selector: 'app-look-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-group">
      <h3 class="td-section">Look</h3>
      <p class="td-note">Nothing here changes the map. Click a thing in the view to see what it is; pick a tool on the left to edit. <kbd class="td-kbd">Esc</kbd> comes back here.</p>
    </div>
    <div class="td-group" data-test="look-selected">
      <h3 class="td-section">Selected</h3>
      @if (picked(); as p) {
        <div class="td-kv"><span>What</span><span class="td-trunc">{{ p.what }}</span></div>
        @if (p.count > 1) {
          <div class="td-kv"><span>How many</span><span class="td-num">{{ p.count }}</span></div>
        }
        @if (p.at) {
          <div class="td-kv"><span>Where</span><span class="td-num">{{ p.at }}</span></div>
        }
        <div class="td-actions is-start">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="edit(p.tool)" data-test="look-edit">Edit with {{ p.toolLabel }}</button>
        </div>
      } @else if (ground(); as g) {
        <div class="td-kv"><span>Ground</span><span class="td-trunc">{{ g.what }}</span></div>
        <div class="td-kv"><span>Height</span><span class="td-num">{{ g.height }}</span></div>
        <div class="td-kv"><span>Slope</span><span class="td-num">{{ g.slope }}</span></div>
        <div class="td-kv"><span>Water</span><span>{{ g.water }}</span></div>
        <div class="td-kv"><span>Where</span><span class="td-num">{{ g.at }}</span></div>
        <div class="td-actions is-start">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="edit('paint')" data-test="look-edit">Edit with Paint</button>
        </div>
      } @else {
        <p class="td-note">Nothing yet: click a thing, or the ground for its paint, height and slope.</p>
      }
    </div>
  `,
})
export class LookPanelComponent {
  private readonly session = inject(EditorSession);

  readonly picked = computed(() => {
    this.session.docRev();
    const sel = this.session.selection();
    const editor = this.session.editor;
    if (!sel || !editor) return null;
    const ctx = { editor, catalog: this.session.catalog() };
    const doc = editor.doc;
    const at = (q: { x: number; y: number } | undefined) => (q ? `${Math.round(q.x)} m E, ${Math.round(q.y)} m N` : '');
    let first: PickResult;
    let count = 1;
    let tool: ToolId;
    let toolLabel: string;
    let where: string;
    if (sel.kind === 'objects') {
      if (!sel.ids.length) return null;
      first = { kind: 'object', id: sel.ids[0] };
      count = sel.ids.length;
      [tool, toolLabel] = ['objects', 'Objects'];
      where = at(doc.objects.find((o) => o.id === sel.ids[0]));
    } else if (sel.kind === 'hq') {
      first = { kind: 'hq' };
      [tool, toolLabel] = ['markers', 'Spawns and HQ'];
      where = at(doc.hq);
    } else if (sel.kind === 'spawn' || sel.kind === 'spawns') {
      const ids = selectedSpawns(sel);
      first = { kind: 'spawn', id: ids[0] };
      count = ids.length;
      [tool, toolLabel] = ['markers', 'Spawns and HQ'];
      where = at(doc.spawns.find((s) => s.id === ids[0]));
    } else {
      const nodes = selectedNodes(sel);
      const edges = selectedEdges(sel);
      first = edges.length ? { kind: 'edge', id: edges[0] } : { kind: 'node', id: nodes[0] };
      count = nodes.length + edges.length;
      [tool, toolLabel] = ['paths', 'Roads'];
      where = at(doc.paths.nodes.find((n) => n.id === nodes[0]));
    }
    return { what: describePick(first, ctx), count, at: where, tool, toolLabel };
  });

  /** The ground point a click found nothing on (LookTool), described */
  readonly ground = computed(() => {
    this.session.docRev();
    this.session.settingsRev();
    const at = this.session.settings.look.at;
    const editor = this.session.editor;
    if (!at || !editor || this.session.selection()) return null;
    return { ...describeGround(editor.doc.terrain, at.x, at.y, this.session.catalog()), at: `${Math.round(at.x)} m E, ${Math.round(at.y)} m N` };
  });

  /** Hands the selection to the tool that edits it, in the mode that moves it */
  edit(tool: ToolId): void {
    const s = this.session;
    s.selectTool(tool);
    if (tool === 'objects') s.patchSettings((st) => (st.objects.mode = 'select'));
    if (tool === 'paths') s.patchSettings((st) => (st.paths.mode = 'edit'));
  }
}
