import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WAVE_EVENT_LIMITS, type MapGameplay, type MapWaveEvent, type MapWaveEventKind, type MapWeather } from '../../../world/custom-map/map-document';
import { SnapshotCommand } from '../../model/editor-document';
import { waveEventProblems } from '../../validation/wave-event-check';
import { EditorSession } from '../editor-session.service';

const KINDS: { id: MapWaveEventKind; label: string; hint: string }[] = [
  { id: 'message', label: 'Message', hint: 'A text on the screen' },
  { id: 'weather', label: 'Weather', hint: 'Rain, snow, fog or clear sky from then on' },
  { id: 'time', label: 'Time of day', hint: 'The sun moves to this hour' },
  { id: 'portal', label: 'Portal opens', hint: 'A spawn brings enemies only from this wave on' },
  { id: 'objects', label: 'Objects', hint: 'The selected objects appear or go: a gate, a bridge, a wall' },
];

const WEATHERS: { id: MapWeather; label: string }[] = [
  { id: 'clear', label: 'Clear' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'fog', label: 'Fog' },
];

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
    <h3 class="td-section">Wave events <span class="td-note">{{ events().length || 'none' }}</span></h3>
    <p class="td-note">Before a wave, in its build phase: a message, the weather or time of day changing, a portal that opens, objects that appear or go.</p>
    <div class="we-add">
      <select class="td-select is-sm" [value]="kind()" (change)="kind.set($any($event.target).value)" aria-label="Kind of event" data-test="event-kind">
        @for (k of kinds; track k.id) {
          <option [value]="k.id">{{ k.label }}</option>
        }
      </select>
      <button class="td-btn-secondary td-btn-sm" type="button" (click)="add()" [matTooltip]="hintOf(kind())" data-test="add-event">Add event</button>
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
                <span class="td-label">Before wave</span>
                <input class="td-input is-sm" type="number" min="1" [max]="limits.wave" step="1" [value]="e.wave" (change)="setWave(row.index, $event)" data-test="event-wave" />
              </label>
              @switch (e.kind) {
                @case ('message') {
                  <label class="td-field">
                    <span class="td-label">Text</span>
                    <input class="td-input is-sm" type="text" [attr.maxlength]="limits.text" [value]="e.text" (change)="patch(row.index, { text: value($event) })" data-test="event-text" />
                  </label>
                }
                @case ('weather') {
                  <div class="td-seg is-sm" role="radiogroup" aria-label="Weather">
                    @for (w of weathers; track w.id) {
                      <button type="button" role="radio" [attr.aria-checked]="e.weather === w.id" (click)="patch(row.index, { weather: w.id })">{{ w.label }}</button>
                    }
                  </div>
                  <label class="td-field">
                    <span class="td-label">Strength %</span>
                    <input class="td-input is-sm" type="number" min="0" max="100" step="10" [value]="round((e.strength ?? 0.6) * 100)" (change)="patch(row.index, { strength: percent($event) })" />
                  </label>
                }
                @case ('time') {
                  <label class="td-field">
                    <span class="td-label">Hour (6 sunrise, 13 noon, 20 sunset)</span>
                    <input class="td-input is-sm" type="number" min="0" max="24" step="0.5" [value]="e.hour" (change)="patch(row.index, { hour: hour($event) })" />
                  </label>
                }
                @case ('portal') {
                  <label class="td-field">
                    <span class="td-label">Spawn</span>
                    <select class="td-select is-sm" (change)="patch(row.index, { spawn: value($event) })" aria-label="Spawn that opens">
                      @for (s of spawns(); track s.id) {
                        <option [value]="s.id" [selected]="s.id === e.spawn">{{ s.name }}</option>
                      }
                    </select>
                  </label>
                  <p class="td-note">Before this wave the spawn brings no enemies; its lane counts from then on.</p>
                }
                @case ('objects') {
                  <div class="td-seg is-sm" role="radiogroup" aria-label="The objects">
                    <button type="button" role="radio" [attr.aria-checked]="e.show" (click)="patch(row.index, { show: true })">Appear</button>
                    <button type="button" role="radio" [attr.aria-checked]="!e.show" (click)="patch(row.index, { show: false })">Go</button>
                  </div>
                  <p class="td-note">{{ objects(e.ids.length) }}. {{ e.show ? 'They are hidden before this wave.' : 'They stand until this wave.' }}</p>
                  <div class="td-actions is-start">
                    <button class="td-btn-secondary td-btn-sm" type="button" (click)="useSelection(row.index)" [attr.aria-disabled]="!selected().length || null">Use the selection ({{ selected().length }})</button>
                    <button class="td-btn-ghost td-btn-sm" type="button" (click)="selectObjects(e.ids)">Select them</button>
                  </div>
                }
              }
              <div class="td-actions is-end">
                <button class="td-btn-danger td-btn-sm" type="button" (click)="remove(row.index)">Remove event</button>
              </div>
            </div>
          }
        </div>
      } @empty {
        <p class="td-note">No events: the map stays as it is through every wave.</p>
      }
    </div>
    @for (p of problems(); track $index) {
      <p class="td-note is-warn">{{ p.message }}</p>
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
  readonly kinds = KINDS;
  readonly weathers = WEATHERS;
  readonly limits = WAVE_EVENT_LIMITS;
  readonly kind = signal<MapWaveEventKind>('message');
  readonly open = signal<number | null>(null);

  readonly events = computed<MapWaveEvent[]>(() => (this.session.docRev(), structuredClone(this.session.doc?.gameplay?.events ?? [])));
  /** In wave order, each with its place in the list */
  readonly rows = computed(() =>
    this.events()
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.wave - b.event.wave || a.index - b.index),
  );
  readonly spawns = computed(() => (this.session.docRev(), this.session.doc?.spawns ?? []).map((s) => ({ id: s.id, name: s.name })));
  readonly selected = computed<string[]>(() => {
    const sel = this.session.selection();
    return sel?.kind === 'objects' ? sel.ids : [];
  });
  readonly problems = computed(() => {
    this.session.docRev();
    const doc = this.session.doc;
    return doc ? waveEventProblems(doc) : [];
  });

  hintOf(kind: MapWaveEventKind): string {
    return KINDS.find((k) => k.id === kind)!.hint;
  }

  describe(e: MapWaveEvent): string {
    switch (e.kind) {
      case 'message':
        return `Message: ${e.text}`;
      case 'weather':
        return `Weather: ${WEATHERS.find((w) => w.id === e.weather)?.label ?? e.weather}`;
      case 'time':
        return `Time of day: ${e.hour}:00`;
      case 'portal':
        return `Portal opens: ${this.spawns().find((s) => s.id === e.spawn)?.name ?? e.spawn}`;
      case 'objects':
        return `${this.objects(e.ids.length)} ${e.show ? 'appear' : 'go'}`;
    }
  }

  /** One undo step that changes the events; no events, no field */
  private edit(label: string, fn: (events: MapWaveEvent[]) => MapWaveEvent[]): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.session.execute(
      SnapshotCommand.record(editor.doc, label, ['gameplay'], (d) => {
        const g: MapGameplay = { ...(d.gameplay ?? {}) };
        const next = fn(structuredClone(g.events ?? []));
        if (next.length) g.events = next;
        else delete g.events;
        d.gameplay = Object.keys(g).length ? g : undefined;
      }),
    );
  }

  add(): void {
    const kind = this.kind();
    const list = this.events();
    if (list.length >= WAVE_EVENT_LIMITS.events) {
      this.session.flash(`A map has ${WAVE_EVENT_LIMITS.events} wave events at most`);
      return;
    }
    const wave = Math.min(WAVE_EVENT_LIMITS.wave, Math.max(2, ...list.map((e) => e.wave + 1)));
    let event: MapWaveEvent;
    switch (kind) {
      case 'message':
        event = { wave, kind, text: 'Something stirs.' };
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
          this.session.flash('The map has no spawn to open');
          return;
        }
        event = { wave, kind, spawn: spawn.id };
        break;
      }
      case 'objects': {
        const ids = this.selected();
        if (!ids.length) {
          this.session.flash('Select the objects first (Objects tool), then add the event');
          return;
        }
        event = { wave, kind, ids: ids.slice(0, WAVE_EVENT_LIMITS.objects), show: true };
        break;
      }
    }
    this.edit('Add wave event', (events) => [...events, event]);
    this.open.set(list.length);
  }

  patch(index: number, patch: Partial<Record<string, unknown>>): void {
    this.edit('Wave event', (events) => events.map((e, i) => (i === index ? ({ ...e, ...patch } as MapWaveEvent) : e)));
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
    this.session.refresh();
  }

  remove(index: number): void {
    this.edit('Remove wave event', (events) => events.filter((_, i) => i !== index));
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
    return n === 1 ? '1 object' : `${n} objects`;
  }

  round(v: number): number {
    return Math.round(v);
  }
}
