import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MAP_TRIAL_TONE, mapTrialSummary, type MapTrialResult } from '../../../world/map-trial';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { MapIssue } from '../../../map-ops/validation/map-validation';
import { EditorSession } from '../editor-session.service';
import { patch, PART_TOOL } from '../../tools/tool';
import { TOOL_INFO } from '../../tools/tool-defs';
import { TOWER_SPOT_M2, TYPICAL_TOWER_RANGE } from '../../../map-ops/validation/build-areas';
import { injectT } from '../../../i18n/i18n.service';
import { checkText } from '../../../map-ops/validation/check-text';

/**
 * The result of "Check" over the view: errors first, then warnings; a
 * click selects the thing and frames it. It updates while the map changes.
 */
@Component({
  selector: 'app-editor-check',
  standalone: true,
  imports: [TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-overlay' },
  template: `
    <header class="ck-head td-line-bottom">
      <h2 class="td-section">{{ t().editor.check.title }}</h2>
      <span class="td-note">{{ summary() }}</span>
      <button class="td-close" type="button" [attr.aria-label]="t().editor.check.close" (click)="close()"><td-icon name="close" [size]="12" /></button>
    </header>
    @if (issues().length) {
      <div class="td-rows ck-list" data-test="issues">
        @for (i of issues(); track $index) {
          <button class="td-row ck-row" type="button" role="button" (click)="focus(i)" [attr.data-code]="i.code">
            <td-icon [name]="i.severity === 'error' ? 'warn' : 'info'" [size]="14" [class.td-tone-hurt]="i.severity === 'error'" [class.td-tone-brass]="i.severity === 'warning'" />
            <span class="ck-text">{{ text(i) }}@if (fixLabel(i); as f) {<span class="td-note ck-fix">{{ t().editor.check.fixIn(f) }}</span>}</span>
          </button>
        }
      </div>
    } @else {
      <p class="td-note is-ok ck-ok" data-test="issues-none">{{ t().editor.check.allGood }}</p>
    }
    <p class="td-note ck-room" data-test="build-room-check">{{ t().editor.check.room(room()) }}</p>
    <div class="ck-bot td-line-top">
      @if (bot(); as b) {
        @if (b.result; as r) {
          <p class="td-note ck-text" [class.td-tone-teal]="tone(r) === 'ok'" [class.td-tone-brass]="tone(r) === 'warn'" [class.td-tone-hurt]="tone(r) === 'error'" data-test="bot-result">
            {{ summaryOf(r) }}
          </p>
        } @else {
          <p class="td-note ck-text"><span class="td-spin" aria-hidden="true"></span> {{ t().editor.check.botPlays(b.waves) }}</p>
        }
      }
      <button class="td-btn-secondary td-btn-sm" type="button" (click)="botCheck()" [disabled]="!!bot() && !bot()!.result"
              [matTooltip]="t().editor.check.botTip">
        {{ t().editor.check.botTest }}
      </button>
    </div>
  `,
  styles: [
    `:host { display: block; padding: 8px 12px 10px; }
     .ck-head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; margin-bottom: 6px; }
     .ck-head .td-note { flex: 1 1 auto; }
     .ck-list { max-height: 260px; overflow-y: auto; }
     .ck-row { justify-content: flex-start; gap: 8px; min-height: 30px; padding: 4px 6px; text-align: left; }
     .ck-text { flex: 1 1 auto; white-space: normal; }
     .ck-fix { display: block; }
     .ck-ok { margin: 4px 0 0; }
     .ck-room { margin: 6px 0 0; }
     .ck-bot { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 6px; }`,
  ],
})
export class CheckPanelComponent {
  private readonly session = inject(EditorSession);
  protected readonly t = injectT();
  readonly issues = computed(() => this.session.check.issues() ?? []);
  readonly summary = computed(() => {
    const list = this.issues();
    const says = this.t().editor.check;
    const errors = list.filter((i) => i.severity === 'error').length;
    const warnings = list.length - errors;
    if (!list.length) return says.none;
    return [errors ? says.errors(errors) : '', warnings ? says.warnings(warnings) : '']
      .filter(Boolean)
      .join(' | ');
  });

  /** What an issue says, in the player's language */
  text(issue: MapIssue): string {
    return checkText(this.t(), issue.text);
  }

  readonly bot = this.session.check.botTrial;
  /** The buildable area in reach of any route (map-ops/validation/build-areas.ts) and the lane with the least of it */
  readonly room = computed(() => {
    const a = this.session.check.buildAreas();
    const says = this.t().editor.check;
    if (!a) return says.judging;
    const lanes = a.lanes.filter((l) => l.routed);
    const least = lanes.length > 1 ? lanes.reduce((m, l) => (l.area < m.area ? l : m)) : null;
    const spots = (m2: number) => Math.floor(m2 / TOWER_SPOT_M2);
    const tightest = least ? says.tightest(least.name, spots(least.area)) : '';
    return says.roomLine(Math.round(a.inReach), spots(a.inReach), TYPICAL_TOWER_RANGE, tightest);
  });

  botCheck(): void {
    void this.session.check.botCheck();
  }

  summaryOf(r: MapTrialResult): string {
    return mapTrialSummary(this.t(), r);
  }

  tone(r: MapTrialResult): 'ok' | 'warn' | 'error' {
    return MAP_TRIAL_TONE[r.outcome];
  }

  focus(issue: MapIssue): void {
    const editor = this.session.editor;
    if (!editor || !this.session.view.shown) return;
    const t = issue.target;
    if (t?.kind === 'spawn' && t.id) {
      editor.select({ kind: 'spawn', id: t.id });
      this.session.tools.select('markers');
    } else if (t?.kind === 'hq') {
      editor.select({ kind: 'hq' });
      this.session.tools.select('markers');
    } else if ((t?.kind === 'edge' || t?.kind === 'node') && t.id) {
      editor.select({ kind: t.kind, id: t.id });
      this.session.tools.select('paths');
      patch(this.session.tools.settings.paths, { mode: 'edit' });
    } else if (t?.kind === 'object' && t.id) {
      editor.select({ kind: 'objects', ids: [t.id] });
      this.session.tools.select('objects');
      patch(this.session.tools.settings.objects, { mode: 'select' });
    }
    else if (issue.part) this.session.tools.select(PART_TOOL[issue.part]);
    if (issue.focus) this.session.view.focusOn(issue.focus, 80);
  }

  /** The tool an issue without a thing to select is fixed with, as the toolbar names it */
  fixLabel(issue: MapIssue): string | null {
    const tool = !issue.target && issue.part ? TOOL_INFO.get(PART_TOOL[issue.part]) : undefined;
    return tool ? this.t().editor.toolKey(this.t().editor.tools[tool.id].label, tool.key) : null;
  }

  close(): void {
    this.session.check.issues.set(null);
  }
}
