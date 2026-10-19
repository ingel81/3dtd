import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MAP_WEATHERS, WAVE_EVENT_LIMITS, type MapGameplay, type MapWaveEvent, type MapWaveEventKind } from '../../../world/custom-map/map-document';
import { SnapshotCommand } from '../../model/commands/snapshot';
import { waveEventProblems } from '../../../map-ops/validation/wave-event-check';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { injectT } from '../../../i18n/i18n.service';
import { checkText } from '../../../map-ops/validation/check-text';
import type { WaveEventProblem } from '../../../map-ops/validation/wave-event-check';

/** The kinds of event and the weathers in their order; their words are the dictionary's (i18n `editor.waveEvents`) */
const KINDS: readonly MapWaveEventKind[] = ['message', 'weather', 'time', 'portal', 'objects'];

/**
 * Rules panel, wave events (TODO E170, MapGameplay.events): what happens
 * before which wave, in wave order, each opened to edit. A new objects event
 * takes the objects selected now; "Use the selection" replaces them, "Select"
 * shows them. Problems come from the check (wave-event-check.ts).
 */
@Component({
  selector: 'app-wave-events-panel',
  standalone: true,
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-group' },
  template: `
    <h3 class="td-section">{{ t().editor.waveEvents.title }} <span class="td-note">{{ events().length || t().editor.waveEvents.none }}</span></h3>
    <p class="td-note">{{ t().editor.waveEvents.intro }}</p>
    <div class="we-add">
      <select class="td-select is-sm" [value]="kind()" (change)="kind.set($any($event.target).value)" [attr.aria-label]="t().editor.waveEvents.kindLabel" data-test="event-kind">
        @for (k of kinds; track k) {
          <option [value]="k">{{ t().editor.waveEvents.kinds[k].label }}</option>
        }
      </select>
      <button class="td-btn-secondary td-btn-sm" type="button" (click)="add()" [matTooltip]="t().editor.waveEvents.kinds[kind()].hint" data-test="add-event">{{ t().editor.waveEvents.add }}</button>
    </div>
    <div class="td-rows we-rows">
      @for (row of rows(); track row.index) {
        @let e = row.event;
        <div>
          <button class="td-row we-head" type="button" [attr.aria-expanded]="open() === row.index" (click)="open.set(open() === row.index ? null : row.index)" [attr.data-event]="row.index">
            <span class="td-num we-n">{{ e.wave }}</span>
            <span class="td-trunc">{{ describe(e) }}</span>
          </button>
          @if (open() === row.index) {
            <div class="we-edit td-well">
              <label class="td-field">
                <span class="td-label">{{ t().editor.waveEvents.beforeWave }}</span>
                <input class="td-input is-sm" type="number" min="1" [max]="limits.wave" step="1" [value]="e.wave" (change)="setWave(row.index, $event)" data-test="event-wave" />
              </label>
              @switch (e.kind) {
                @case ('message') {
                  <label class="td-field">
                    <span class="td-label">{{ t().editor.waveEvents.text }}</span>
                    <input class="td-input is-sm" type="text" [attr.maxlength]="limits.text" [value]="e.text" (change)="patch(row.index, { text: value($event) })" data-test="event-text" />
                  </label>
                }
                @case ('weather') {
                  <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.waveEvents.weather">
                    @for (w of weathers; track w) {
                      <button type="button" role="radio" [attr.aria-checked]="e.weather === w" (click)="patch(row.index, { weather: w })">{{ t().editor.waveEvents.weathers[w] }}</button>
                    }
                  </div>
                  <label class="td-field">
                    <span class="td-label">{{ t().editor.waveEvents.strength }}</span>
                    <input class="td-input is-sm" type="number" min="0" max="100" step="10" [value]="round((e.strength ?? 0.6) * 100)" (change)="patch(row.index, { strength: percent($event) })" />
                  </label>
                }
                @case ('time') {
                  <label class="td-field">
                    <span class="td-label">{{ t().editor.waveEvents.hour }}</span>
                    <input class="td-input is-sm" type="number" min="0" max="24" step="0.5" [value]="e.hour" (change)="patch(row.index, { hour: hour($event) })" />
                  </label>
                }
                @case ('portal') {
                  <label class="td-field">
                    <span class="td-label">{{ t().editor.waveEvents.spawn }}</span>
                    <select class="td-select is-sm" (change)="patch(row.index, { spawn: value($event) })" [attr.aria-label]="t().editor.waveEvents.spawnOpens">
                      @for (s of spawns(); track s.id) {
                        <option [value]="s.id" [selected]="s.id === e.spawn">{{ s.name }}</option>
                      }
                    </select>
                  </label>
                  <p class="td-note">{{ t().editor.waveEvents.portalNote }}</p>
                }
                @case ('objects') {
                  <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.waveEvents.theObjects">
                    <button type="button" role="radio" [attr.aria-checked]="e.show" (click)="patch(row.index, { show: true })">{{ t().editor.waveEvents.appear }}</button>
                    <button type="button" role="radio" [attr.aria-checked]="!e.show" (click)="patch(row.index, { show: false })">{{ t().editor.waveEvents.go }}</button>
                  </div>
                  <p class="td-note">{{ objects(e.ids.length) }}. {{ e.show ? t().editor.waveEvents.hiddenBefore : t().editor.waveEvents.standUntil }}</p>
                  <div class="td-actions is-start">
                    <button class="td-btn-secondary td-btn-sm" type="button" (click)="useSelection(row.index)" [attr.aria-disabled]="!selected().length || null">{{ t().editor.waveEvents.useSelection(selected().length) }}</button>
                    <button class="td-btn-ghost td-btn-sm" type="button" (click)="selectObjects(e.ids)">{{ t().editor.waveEvents.selectThem }}</button>
                  </div>
                }
              }
              <div class="td-actions is-end">
                <button class="td-btn-danger td-btn-sm" type="button" (click)="remove(row.index)">{{ t().editor.waveEvents.remove }}</button>
              </div>
            </div>
          }
        </div>
      } @empty {
        <p class="td-note">{{ t().editor.waveEvents.noEvents }}</p>
      }
    </div>
    @for (p of problems(); track $index) {
      <p class="td-note is-warn">{{ problemText(p) }}</p>
    }
  `,
  styles: [
    `.we-add { display: flex; gap: 8px; } .we-add .td-select { flex: 1 1 auto; }
     .we-rows { max-height: 320px; overflow-y: auto; }
     .we-head { justify-content: flex-start; gap: 8px; min-height: 30px; } .we-head .td-trunc { flex: 1 1 auto; }
     .we-n { width: 22px; flex: 0 0 auto; }
     .we-edit { display: flex; flex-direction: column; gap: 8px; padding: 8px; margin-bottom: 8px; }`,
  ],
})
export class WaveEventsPanelComponent {
  private readonly session = inject(EditorSession);
  protected readonly t = injectT();

  /** What a problem of the events says, in the player's language */
  problemText(p: WaveEventProblem): string {
    return checkText(this.t(), p.text);
  }
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('gameplay', 'markers', 'objects');
  readonly kinds = KINDS;
  readonly weathers = MAP_WEATHERS;
  readonly limits = WAVE_EVENT_LIMITS;
  readonly kind = signal<MapWaveEventKind>('message');
  readonly open = signal<number | null>(null);

  readonly events = computed<MapWaveEvent[]>(() => (this.rev(), structuredClone(this.session.doc?.gameplay?.events ?? [])));
  /** In wave order, each with its place in the list */
  readonly rows = computed(() =>
    this.events()
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.wave - b.event.wave || a.index - b.index),
  );
  readonly spawns = computed(() => (this.rev(), this.session.doc?.spawns ?? []).map((s) => ({ id: s.id, name: s.name })));
  readonly selected = computed<string[]>(() => {
    const sel = this.session.state.selection();
    return sel?.kind === 'objects' ? sel.ids : [];
  });
  readonly problems = computed(() => {
    this.rev();
    const doc = this.session.doc;
    return doc ? waveEventProblems(doc) : [];
  });

  describe(e: MapWaveEvent): string {
    const says = this.t().editor.waveEvents;
    switch (e.kind) {
      case 'message':
        return says.describeMessage(e.text);
      case 'weather':
        return says.describeWeather(says.weathers[e.weather] ?? e.weather);
      case 'time':
        return says.describeTime(e.hour);
      case 'portal':
        return says.describePortal(this.spawns().find((s) => s.id === e.spawn)?.name ?? e.spawn);
      case 'objects':
        return says.describeObjects(this.objects(e.ids.length), e.show);
    }
  }

  /** One undo step that changes the events; no events, no field */
  private edit(label: string, fn: (events: MapWaveEvent[]) => MapWaveEvent[]): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.session.edit(this.t().editor.waveEvents.changing, (e) => e.execute(
      SnapshotCommand.record(editor.doc, label, ['gameplay'], (d) => {
        const g: MapGameplay = { ...(d.gameplay ?? {}) };
        const next = fn(structuredClone(g.events ?? []));
        if (next.length) g.events = next;
        else delete g.events;
        d.gameplay = Object.keys(g).length ? g : undefined;
      }),
    ));
  }

  add(): void {
    const kind = this.kind();
    const list = this.events();
    if (list.length >= WAVE_EVENT_LIMITS.events) {
      this.session.notices.flash(this.t().editor.waveEvents.tooMany(WAVE_EVENT_LIMITS.events));
      return;
    }
    const wave = Math.min(WAVE_EVENT_LIMITS.wave, Math.max(2, ...list.map((e) => e.wave + 1)));
    let event: MapWaveEvent;
    switch (kind) {
      case 'message':
        event = { wave, kind, text: this.t().editor.waveEvents.firstText };
        break;
      case 'weather':
        event = { wave, kind, weather: 'rain', strength: 0.6 };
        break;
      case 'time':
        event = { wave, kind, hour: 20 };
        break;
      case 'portal': {
        const spawn = this.session.doc?.spawns.at(-1);
        if (!spawn) {
          this.session.notices.flash(this.t().editor.waveEvents.noSpawn);
          return;
        }
        event = { wave, kind, spawn: spawn.id };
        break;
      }
      case 'objects': {
        const ids = this.selected();
        if (!ids.length) {
          this.session.notices.flash(this.t().editor.waveEvents.selectFirst);
          return;
        }
        event = { wave, kind, ids: ids.slice(0, WAVE_EVENT_LIMITS.objects), show: true };
        break;
      }
    }
    this.edit(this.t().editor.waveEvents.addStep, (events) => [...events, event]);
    this.open.set(list.length);
  }

  patch(index: number, patch: Partial<Record<string, unknown>>): void {
    this.edit(this.t().editor.waveEvents.editStep, (events) => events.map((e, i) => (i === index ? ({ ...e, ...patch } as MapWaveEvent) : e)));
  }

  setWave(index: number, e: Event): void {
    const v = Math.round(Number((e.target as HTMLInputElement).value));
    if (!Number.isFinite(v)) return;
    this.patch(index, { wave: Math.min(WAVE_EVENT_LIMITS.wave, Math.max(1, v)) });
  }

  useSelection(index: number): void {
    const ids = this.selected();
    if (ids.length) this.patch(index, { ids: ids.slice(0, WAVE_EVENT_LIMITS.objects) });
  }

  selectObjects(ids: readonly string[]): void {
    const editor = this.session.editor;
    if (!editor) return;
    const known = new Set(editor.doc.objects.map((o) => o.id));
    editor.select({ kind: 'objects', ids: ids.filter((id) => known.has(id)) });
    this.session.state.refresh();
  }

  remove(index: number): void {
    this.edit(this.t().editor.waveEvents.removeStep, (events) => events.filter((_, i) => i !== index));
    this.open.set(null);
  }

  value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  percent(e: Event): number {
    return Math.min(1, Math.max(0, Number(this.value(e)) / 100 || 0));
  }

  hour(e: Event): number {
    return Math.min(24, Math.max(0, Number(this.value(e)) || 0));
  }

  objects(n: number): string {
    return this.t().editor.waveEvents.objects(n);
  }

  round(v: number): number {
    return Math.round(v);
  }
}
