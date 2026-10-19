import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { MapLife, MapLifeArea, MapLifeKind } from '../../../world/custom-map/map-document';
import { centroid, DEFAULT_BOAT, LIFE_AREA_DENSITY, LIFE_KIND_INFO, LIFE_KINDS, LIFE_SOUND_REACH, lifeSwitches, outlineArea, shapeLength } from '../../../world/custom-map/map-life';
import { SnapshotCommand } from '../../model/commands/snapshot';
import { patch, type LifeMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { RangeRowComponent } from './range-row.component';
import { AMBIENT_SOUNDS, BIOME_AMBIENCE, WAVE_SOUNDS, type AmbientSoundId, type WaveSoundId } from '../../../world/custom-map/ambience/ambient-sounds';
import { injectT } from '../../../i18n/i18n.service';


/** Effect objects a click places (the Objects tool's Place), for one spot instead of an area */
const SPOTS = [
  'fx-smoke',
  'fx-smoke-column',
  'fx-birds',
  'fx-fireflies',
  'fx-embers',
  'fx-beacon',
  'fx-light-shaft',
  'fx-surf',
] as const;
export type LifeSpot = (typeof SPOTS)[number];

/** Kinds whose particles take a colour, and whose height is the flight height */
const TINTED: ReadonlySet<MapLifeKind> = new Set(['fireflies', 'fog', 'leaves', 'embers', 'sparks']);

/**
 * Life: what the next outline or line holds, the chosen area's settings,
 * the list of the map's areas, single effect spots and the switches of what
 * the map brings by itself. Sliders show the change live and land as one
 * step when let go.
 */
@Component({
  selector: 'app-life-panel',
  standalone: true,
  imports: [RangeRowComponent, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.life.clickDraws">
      @for (m of modes; track m) {
        <button type="button" role="radio" [attr.aria-checked]="settings().mode === m" (click)="setMode(m)" [attr.data-mode]="m">{{ t().editor.life.modes[m] }}</button>
      }
    </div>
    @if (settings().mode !== 'edit') {
      <div class="td-field">
        <span class="td-label" id="lp-kind">{{ t().editor.life.whatLives }}</span>
        <div class="td-seg is-sm lp-kinds" role="radiogroup" aria-labelledby="lp-kind">
          @for (k of kinds; track k) {
            <button type="button" role="radio" [attr.aria-checked]="settings().kind === k" (click)="setKind(k)" [attr.data-kind]="k">
              <span class="td-swatch" [style.--td-mark]="info[k].color"></span>{{ t().editor.life.kinds[k].label }}
            </button>
          }
        </div>
        <p class="td-note">{{ t().editor.life.kinds[settings().kind].about }}.</p>
      </div>
    }
    @if (chosen(); as a) {
      <div class="td-group" data-test="life-chosen">
        <h3 class="td-section">{{ t().editor.life.areaName(t().editor.life.kinds[a.kind].label, a.shape) }} <span class="td-note">{{ sizeOf(a) }}</span></h3>
        <app-editor-range [label]="t().editor.life.density" unit="%" [min]="density.min * 100" [max]="density.max * 100" [step]="10" [value]="(a.density ?? 1) * 100"
                          (changing)="liveArea(a.id, { density: $event / 100 })" (changed)="commitArea(a.id, { density: $event / 100 }, t().editor.life.undoDensity)" />
        @if (a.kind === 'birds') {
          <label class="td-setting">
            <span>{{ t().editor.life.birds }}</span>
            <select class="td-select is-auto" [value]="a.species ?? 'songbirds'" (change)="commitArea(a.id, { species: $any($event.target).value === 'songbirds' ? undefined : $any($event.target).value }, t().editor.life.birds)" [attr.aria-label]="t().editor.life.birds" data-test="life-species">
              @for (b of species; track b) {
                <option [value]="b">{{ t().editor.life.species[b] }}</option>
              }
            </select>
          </label>
          <app-editor-range [label]="t().editor.life.flightHeight" unit="m" [min]="10" [max]="200" [value]="a.height ?? (a.species === 'raptors' ? 80 : a.species === 'bats' ? 14 : 40)"
                            (changing)="liveArea(a.id, { height: $event })" (changed)="commitArea(a.id, { height: $event }, t().editor.life.flightHeight)" />
        }
        @if (tinted.has(a.kind)) {
          <app-editor-range [label]="t().editor.life.height" unit="m" [min]="0" [max]="30" [step]="0.5" [value]="a.height ?? 0"
                            (changing)="liveArea(a.id, { height: $event })" (changed)="commitArea(a.id, { height: $event }, t().editor.life.undoHeight)" />
          <label class="td-setting">
            <span>{{ t().editor.life.colour }}</span>
            <span class="td-inline">
              <input type="color" [value]="a.color ?? info[a.kind].color" (input)="liveArea(a.id, { color: $any($event.target).value })"
                     (change)="commitArea(a.id, { color: $any($event.target).value }, t().editor.life.undoColour)" [attr.aria-label]="t().editor.life.colour" />
              @if (a.color) {
                <button class="td-btn-secondary td-btn-sm" type="button" (click)="commitArea(a.id, { color: undefined }, t().editor.life.undoColour)">{{ t().editor.life.ownColour }}</button>
              }
            </span>
          </label>
        }
        @if (a.kind === 'sound') {
          <label class="td-setting">
            <span>{{ t().editor.life.sound }}</span>
            <select class="td-select is-auto" [value]="a.sound ?? ''" (change)="commitArea(a.id, { sound: $any($event.target).value }, t().editor.life.undoSound)" [attr.aria-label]="t().editor.life.sound" data-test="life-sound">
              @for (o of sounds; track o) {
                <option [value]="o">{{ t().editor.life.sounds[o] }}</option>
              }
            </select>
          </label>
          <app-editor-range [label]="t().editor.life.volume" unit="%" [min]="0" [max]="100" [step]="5" [value]="(a.volume ?? 0.7) * 100"
                            (changing)="liveArea(a.id, { volume: $event / 100 })" (changed)="commitArea(a.id, { volume: $event / 100 }, t().editor.life.undoVolume)" />
          <app-editor-range [label]="t().editor.life.reach" unit="m" [min]="reachRange.min" [max]="reachRange.max" [step]="5" [value]="a.reach ?? reachRange.default"
                            (changing)="liveArea(a.id, { reach: $event })" (changed)="commitArea(a.id, { reach: $event }, t().editor.life.undoReach)" data-test="life-reach" />
          <p class="td-note">{{ t().editor.life.soundNote }}</p>
        }
        @if (a.kind === 'movers') {
          <label class="td-setting">
            <span>{{ t().editor.life.whatMoves }}</span>
            <select class="td-select is-auto" [value]="a.asset ?? ''" (change)="commitArea(a.id, { asset: $any($event.target).value || undefined }, t().editor.life.undoMover)" [attr.aria-label]="t().editor.life.whatMoves" data-test="life-mover">
              <option value="">{{ t().editor.life.pickOne }}</option>
              @for (b of moverAssets(); track b.id) {
                <option [value]="b.id">{{ b.name }}</option>
              }
            </select>
          </label>
          <app-editor-range [label]="t().editor.life.speed" unit="m/s" [min]="0.2" [max]="15" [step]="0.1" [value]="a.speed ?? 1.5"
                            (changing)="liveArea(a.id, { speed: $event })" (changed)="commitArea(a.id, { speed: $event }, t().editor.life.undoSpeed)" />
          <label class="td-setting">
            <span>{{ t().editor.life.hangs }}</span>
            <input class="td-switch" type="checkbox" [checked]="a.height !== undefined" (change)="commitArea(a.id, { height: $any($event.target).checked ? 20 : undefined }, t().editor.life.undoHangs)" [attr.aria-label]="t().editor.life.hangs" />
          </label>
          @if (a.height !== undefined) {
            <app-editor-range [label]="t().editor.life.overGround" unit="m" [min]="1" [max]="150" [value]="a.height"
                              (changing)="liveArea(a.id, { height: $event })" (changed)="commitArea(a.id, { height: $event }, t().editor.life.undoMoverHeight)" />
          }
          <p class="td-note">{{ t().editor.life.moverNote }}</p>
        }
        @if (a.kind === 'boats') {
          <label class="td-setting">
            <span>{{ t().editor.life.boat }}</span>
            <select class="td-select is-auto" (change)="commitArea(a.id, { asset: $any($event.target).value === defaultBoat ? undefined : $any($event.target).value }, t().editor.life.boat)" [attr.aria-label]="t().editor.life.boat" data-test="life-boat">
              @for (b of boatAssets(); track b.id) {
                <option [value]="b.id" [selected]="b.id === (a.asset ?? defaultBoat)">{{ b.name }}</option>
              }
            </select>
          </label>
          <p class="td-note">{{ t().editor.life.boatNote }}</p>
        }
        <label class="td-setting">
          <span>{{ t().editor.life.showsFrom }}</span>
          <select class="td-select is-auto" [value]="a.quality ?? 'medium'" (change)="commitArea(a.id, { quality: $any($event.target).value === 'high' ? 'high' : undefined }, t().editor.life.undoQuality)" [attr.aria-label]="t().editor.life.showsFrom">
            <option value="medium">{{ t().editor.life.medium }}</option>
            <option value="high">{{ t().editor.life.high }}</option>
          </select>
        </label>
        <div class="td-setting">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="show(a)">{{ t().editor.life.show }}</button>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="remove(a)" data-test="life-remove">{{ t().editor.life.remove }}</button>
        </div>
      </div>
    }
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.life.onMap }}</h3>
      <div class="td-rows" role="listbox" [attr.aria-label]="t().editor.life.lifeAreas">
        @for (a of areas(); track a.id) {
          <div class="td-row lp-row" role="option" tabindex="0" [attr.aria-selected]="settings().chosen === a.id" (click)="choose(a.id)" (keydown.enter)="choose(a.id)" [attr.data-area]="a.id">
            <span class="td-swatch" [style.--td-mark]="info[a.kind].color"></span>
            <span class="td-trunc">{{ t().editor.life.areaName(t().editor.life.kinds[a.kind].label, a.shape) }}</span>
            <span class="td-num td-muted">{{ sizeOf(a) }}</span>
            <button class="td-tool is-sm" type="button" [attr.aria-label]="t().editor.life.remove" (click)="$event.stopPropagation(); remove(a)"><td-icon name="trash" [size]="14" /></button>
          </div>
        } @empty {
          <p class="td-note">{{ t().editor.life.noneYet }}</p>
        }
      </div>
    </div>
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.life.oneSpot }}</h3>
      <div class="td-inline lp-spots">
        @for (s of spots; track s) {
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="placeSpot(s)">{{ t().editor.life.spots[s] }}</button>
        }
      </div>
      <p class="td-note">{{ t().editor.life.spotNote }}</p>
    </div>
    @if (switches(); as w) {
      <div class="td-group" data-test="life-switches">
        <h3 class="td-section">{{ t().editor.life.own }}</h3>
        <div class="td-setting">
          <span>{{ t().editor.life.chimney }}</span>
          <input class="td-switch" type="checkbox" [checked]="w.smoke" (change)="setAuto('smoke', $any($event.target).checked)" [attr.aria-label]="t().editor.life.chimney" data-test="auto-smoke" />
        </div>
        <div class="td-setting">
          <span>{{ t().editor.life.firefliesAuto }}</span>
          <input class="td-switch" type="checkbox" [checked]="w.fireflies" (change)="setAuto('fireflies', $any($event.target).checked)" [attr.aria-label]="t().editor.life.fireflies" data-test="auto-fireflies" />
        </div>
        <div class="td-setting">
          <span>{{ t().editor.life.birdsAuto }}</span>
          <input class="td-switch" type="checkbox" [checked]="w.birds" (change)="setAuto('birds', $any($event.target).checked)" [attr.aria-label]="t().editor.life.birds" data-test="auto-birds" />
        </div>
        <div class="td-setting">
          <span>{{ t().editor.life.sparks }}</span>
          <input class="td-switch" type="checkbox" [checked]="w.sparks" (change)="setAuto('sparks', $any($event.target).checked)" [attr.aria-label]="t().editor.life.sparks" data-test="auto-sparks" />
        </div>
        <div class="td-setting">
          <span>{{ t().editor.life.banners }}</span>
          <input class="td-switch" type="checkbox" [checked]="w.flags" (change)="commitLife({ flags: $any($event.target).checked || undefined }, t().editor.life.undoBanners)" [attr.aria-label]="t().editor.life.bannersLabel" data-test="life-flags" />
        </div>
        <app-editor-range [label]="t().editor.life.density" unit="%" [min]="0" [max]="200" [step]="10" [value]="w.density * 100"
                          (changing)="liveLife({ density: $event / 100 })" (changed)="commitLife({ density: $event / 100 }, t().editor.life.undoDensity)" data-test="life-density" />
        <p class="td-note">{{ t().editor.life.densityNote }}</p>
      </div>
    }
    <div class="td-group" data-test="life-sound-group">
      <h3 class="td-section">{{ t().editor.life.sound }}</h3>
        <label class="td-setting">
          <span>{{ t().editor.life.overMap }}</span>
          <select class="td-select is-auto" [value]="life()?.ambience?.sound ?? ''" (change)="setAmbience($any($event.target).value)" [attr.aria-label]="t().editor.life.undoAmbience" data-test="life-ambience">
            <option value="">{{ t().editor.life.none }}</option>
            <option [value]="biomeAmbience">{{ t().editor.life.looksOwn }}</option>
            @for (o of sounds; track o) {
              <option [value]="o">{{ t().editor.life.sounds[o] }}</option>
            }
          </select>
        </label>
        @if (life()?.ambience; as amb) {
          <app-editor-range [label]="t().editor.life.volume" unit="%" [min]="0" [max]="100" [step]="5" [value]="amb.volume * 100"
                            (changing)="liveLife({ ambience: { sound: amb.sound, volume: $event / 100 } })"
                            (changed)="commitLife({ ambience: { sound: amb.sound, volume: $event / 100 } }, t().editor.life.undoAmbVolume)" />
        }
        <label class="td-setting">
          <span>{{ t().editor.life.atWave }}</span>
          <select class="td-select is-auto" [value]="life()?.waveSound?.sound ?? ''" (change)="setWaveSound($any($event.target).value)" [attr.aria-label]="t().editor.life.waveSound" data-test="life-wave-sound">
            <option value="">{{ t().editor.life.none }}</option>
            @for (o of waveSounds; track o) {
              <option [value]="o">{{ t().editor.life.sounds[o] }}</option>
            }
          </select>
        </label>
        @if (life()?.waveSound; as ws) {
          <app-editor-range [label]="t().editor.life.volume" unit="%" [min]="0" [max]="100" [step]="5" [value]="ws.volume * 100"
                            (changing)="liveLife({ waveSound: { ...ws, volume: $event / 100 } })"
                            (changed)="commitLife({ waveSound: { ...ws, volume: $event / 100 } }, t().editor.life.undoWaveVolume)" />
          <label class="td-setting">
            <span>{{ t().editor.life.comesFrom }}</span>
            <select class="td-select is-auto" [value]="ws.area ?? ''" (change)="setWaveSoundArea($any($event.target).value)" [attr.aria-label]="t().editor.life.waveFrom" data-test="life-wave-area">
              <option value="">{{ t().editor.life.everywhere }}</option>
              @for (a of areas(); track a.id) {
                <option [value]="a.id">{{ a.id }}</option>
              }
            </select>
          </label>
          <div class="td-setting">
            <span>{{ t().editor.life.hearOnce }}</span>
            <button class="td-btn-secondary td-btn-sm" type="button" (click)="session.view.playWaveSound()" data-test="life-wave-play">{{ t().editor.life.play }}</button>
          </div>
        }
        <div class="td-setting">
          <span>{{ t().editor.life.hearEditor }}</span>
          <input class="td-switch" type="checkbox" [checked]="settings().hear" (change)="session.view.setAmbience($any($event.target).checked)" [attr.aria-label]="t().editor.life.hearMap" data-test="life-hear" />
        </div>
      <p class="td-note">{{ t().editor.life.soundMapNote }}</p>
    </div>
  `,
  styles: [
    `.lp-kinds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
     .lp-kinds > button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 0; padding: 0 4px; white-space: nowrap; overflow: hidden; }
     .lp-row { justify-content: flex-start; gap: 8px; cursor: pointer; }
     .lp-row .td-trunc { flex: 1 1 auto; min-width: 0; } .lp-spots { flex-wrap: wrap; gap: 6px; }`,
  ],
})
export class LifePanelComponent {
  protected readonly t = injectT();
  readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('life');
  readonly info = LIFE_KIND_INFO;
  readonly kinds = LIFE_KINDS;
  readonly sounds = Object.keys(AMBIENT_SOUNDS) as AmbientSoundId[];
  readonly waveSounds = Object.keys(WAVE_SOUNDS) as WaveSoundId[];
  readonly biomeAmbience = BIOME_AMBIENCE;
  readonly spots = SPOTS;
  readonly tinted = TINTED;
  readonly density = LIFE_AREA_DENSITY;
  readonly reachRange = LIFE_SOUND_REACH;
  readonly modes: LifeMode[] = ['area', 'route', 'edit'];
  readonly settings = this.session.tools.settings.life;
  readonly life = computed(() => (this.rev(), this.session.doc?.life));
  readonly areas = computed(() => this.life()?.areas ?? []);
  readonly chosen = computed(() => {
    const id = this.settings().chosen;
    return this.areas().find((a) => a.id === id) ?? null;
  });
  readonly switches = computed(() => (this.session.doc ? lifeSwitches(this.life()) : null));
  readonly defaultBoat = DEFAULT_BOAT;
  readonly species = ['songbirds', 'gulls', 'crows', 'raptors', 'bats'] as const;
  /** What may move over the ground: the catalogue's props that do not float (vehicles, carts, animals) */
  readonly moverAssets = computed(() => [...this.session.catalog().objects.values()].filter((o) => !o.float && o.footing?.category === 'prop').sort((a, b) => a.name.localeCompare(b.name)));
  /** What floats and may drift: the catalogue's floating props (boats, buoys) */
  readonly boatAssets = computed(() => [...this.session.catalog().objects.values()].filter((o) => o.float && o.footing?.category === 'prop'));
  /** The map's life before a slider started moving */
  private before: MapLife | undefined | null = null;

  sizeOf(a: MapLifeArea): string {
    return a.shape === 'area' ? this.t().editor.life.squareMetres(Math.round(outlineArea(a.points))) : this.t().editor.life.metres(Math.round(shapeLength(a.points, false)));
  }

  setMode(mode: LifeMode): void {
    patch(this.session.tools.settings.life, { mode });
  }

  setKind(kind: MapLifeKind): void {
    patch(this.session.tools.settings.life, { kind });
  }

  choose(id: string): void {
    patch(this.session.tools.settings.life, { chosen: id, point: -1 });
  }

  show(a: MapLifeArea): void {
    const c = centroid(a.points);
    const r = Math.max(...a.points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)), 30);
    this.session.view.focusOn(c, r * 1.2);
  }

  remove(a: MapLifeArea): void {
    this.session.editLife((life) => (life.areas = life.areas?.filter((x) => x.id !== a.id)), this.t().editor.life.removeArea(this.t().editor.life.kinds[a.kind].label));
    if (this.settings().chosen === a.id) patch(this.session.tools.settings.life, { chosen: null });
  }

  placeSpot(asset: LifeSpot): void {
    patch(this.session.tools.settings.objects, { asset, mode: 'place' });
    this.session.tools.select('objects');
  }

  setAmbience(sound: string): void {
    const volume = this.life()?.ambience?.volume ?? 0.6;
    this.commitLife({ ambience: sound ? { sound, volume } : undefined }, sound ? this.t().editor.life.undoAmbience : this.t().editor.life.noAmbience);
  }

  setWaveSound(sound: string): void {
    const now = this.life()?.waveSound;
    this.commitLife({ waveSound: sound ? { ...now, sound, volume: now?.volume ?? 0.8 } : undefined }, sound ? this.t().editor.life.waveSound : this.t().editor.life.noWaveSound);
  }

  setWaveSoundArea(area: string): void {
    const now = this.life()?.waveSound;
    if (!now) return;
    const { area: _old, ...rest } = now;
    this.commitLife({ waveSound: area ? { ...rest, area } : rest }, this.t().editor.life.waveSoundPlace);
  }

  setAuto(key: 'smoke' | 'fireflies' | 'birds' | 'sparks', on: boolean): void {
    this.session.editLife((life) => (life.auto = { ...life.auto, [key]: on }), this.t().editor.life.autoStep(this.t().editor.life.auto[key], on));
  }

  liveArea(id: string, patch: Partial<MapLifeArea>): void {
    this.live((life) => patchArea(life, id, patch));
  }

  commitArea(id: string, patch: Partial<MapLifeArea>, label: string): void {
    this.commit((life) => patchArea(life, id, patch), label);
  }

  liveLife(patch: Partial<MapLife>): void {
    this.live((life) => Object.assign(life, patch));
  }

  commitLife(patch: Partial<MapLife>, label: string): void {
    this.commit((life) => Object.assign(life, patch), label);
  }

  /** A change shown at once, not yet a step */
  private live(change: (life: MapLife) => void): void {
    const editor = this.session.editor;
    if (!editor) return;
    if (this.before === null) this.before = structuredClone(editor.doc.life);
    const life = structuredClone(editor.doc.life ?? {});
    change(life);
    editor.doc.life = life;
    editor.emit({ life: true });
  }

  private commit(change: (life: MapLife) => void, label: string): void {
    const editor = this.session.editor;
    if (!editor) return;
    const before = this.before === null ? structuredClone(editor.doc.life) : this.before;
    this.before = null;
    const life = structuredClone(editor.doc.life ?? {});
    change(life);
    editor.doc.life = life;
    this.session.edit(this.t().editor.life.changing, (e) => e.execute(new SnapshotCommand(label, { life: before }, { life: structuredClone(life) })));
  }
}

/** The area's fields with the patch; an undefined value removes the field */
function patchArea(life: MapLife, id: string, patch: Partial<MapLifeArea>): void {
  const a = life.areas?.find((x) => x.id === id);
  if (!a) return;
  for (const [k, v] of Object.entries(patch) as [keyof MapLifeArea, unknown][]) {
    if (v === undefined) delete a[k];
    else (a as unknown as Record<string, unknown>)[k] = v;
  }
}
