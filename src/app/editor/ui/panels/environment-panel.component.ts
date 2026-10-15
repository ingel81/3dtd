import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { MapBiome, MapEnvironment, MapWeather, MapWind } from '../../../world/custom-map/map-document';
import { chooseSkyImage, SKY_IMAGES } from '../../../world/custom-map/render/environment/sky-images';
import { windOf } from '../../../world/custom-map/render/environment/wind';
import { SnapshotCommand } from '../../model/editor-document';
import { EditorSession } from '../editor-session.service';
import { RangeRowComponent } from './range-row.component';

const WEATHERS: { id: MapWeather; label: string }[] = [
  { id: 'clear', label: 'Clear' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'fog', label: 'Fog' },
];

/** Lowest sun (degrees) timeOfDay calls day; under it the land takes dusk light and the map's lights come on */
const DAY_SUN = 15;

/**
 * A time of day as sun and sky, a summer day: the sun rises in the east at
 * 6, stands in the south at 13 60 degrees high, sets in the west at 20;
 * low sun is dusk, an hour past sunset is night. An overcast sky stays
 * overcast.
 */
export function timeOfDay(hour: number, sky: MapEnvironment['sky']): Partial<MapEnvironment> {
  const f = (hour - 6) / 14;
  const elevation = 60 * Math.sin(Math.PI * f);
  const azimuth = ((90 + 180 * f) % 360 + 360) % 360;
  const nextSky: MapEnvironment['sky'] = sky === 'overcast' ? 'overcast' : elevation < -6 ? 'night' : elevation < DAY_SUN ? 'dusk' : 'day';
  return { sunAzimuth: Math.round(azimuth), sunElevation: Math.round(Math.max(2, elevation)), sky: nextSky };
}

/**
 * A sky button: Day and Dusk also bring the sun to an hour that gives that
 * sky when the time set does not (Day after an evening on the slider left
 * the land in dusk light with its lanterns lit): Day to 10 o'clock, Dusk to
 * 19 o'clock. Night and Overcast keep the sun where it stands.
 */
export function skyPreset(sky: MapEnvironment['sky'], e: Pick<MapEnvironment, 'sunElevation'>): Partial<MapEnvironment> {
  if (sky === 'day' && e.sunElevation < DAY_SUN) return timeOfDay(10, 'day');
  if (sky === 'dusk' && e.sunElevation >= DAY_SUN) return timeOfDay(19, 'day');
  return { sky };
}

/** The renderer's looks: sky, light, haze, grading, stars and particles in the air */
const LOOKS: { id: MapBiome; label: string }[] = [
  { id: 'temperate', label: 'Temperate' },
  { id: 'mountain', label: 'Mountain' },
  { id: 'swamp', label: 'Swamp' },
  { id: 'desert', label: 'Desert' },
  { id: 'arctic', label: 'Arctic' },
  { id: 'city', label: 'City' },
  { id: 'apocalypse', label: 'Wasteland' },
  { id: 'hell', label: 'Hell' },
  { id: 'moon', label: 'Moon' },
  { id: 'mars', label: 'Mars' },
];

const SKIES: { id: MapEnvironment['sky']; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' },
  { id: 'overcast', label: 'Overcast' },
];

/**
 * Sky, sun and fog. Sliders show the change live while they move and land
 * as one undo step when let go.
 */
@Component({
  selector: 'app-environment-panel',
  standalone: true,
  imports: [RangeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <label class="td-setting">
      <span>Landscape look</span>
      <select class="td-select is-auto" [value]="env()?.biome ?? 'temperate'" (change)="commit({ biome: $any($event.target).value }, 'Look')" aria-label="Look" data-test="look">
        @for (l of looks; track l.id) {
          <option [value]="l.id">{{ l.label }}</option>
        }
      </select>
    </label>
    <label class="td-setting">
      <span>Sky picture</span>
      <select class="td-select is-auto" [value]="env()?.skyImage ?? ''" (change)="commit(chooseSkyImage($any($event.target).value || null), 'Sky picture')" aria-label="Sky picture" data-test="sky-image">
        <option value="">Procedural</option>
        @for (s of skyImages; track s.id) {
          <option [value]="s.id">{{ s.label }}</option>
        }
      </select>
    </label>
    @if (!env()?.skyImage) {
      <div class="td-field">
        <span class="td-label" id="ep-sky">Sky</span>
        <div class="td-seg is-sm" role="radiogroup" aria-labelledby="ep-sky">
          @for (s of skies; track s.id) {
            <button type="button" role="radio" [attr.aria-checked]="env()?.sky === s.id" (click)="commit(skyPreset(s.id, env()!), 'Sky')">{{ s.label }}</button>
          }
        </div>
      </div>
    } @else {
      <p class="td-note">The picture colours sun, light and haze. Sun direction turns the sky so its sun stands there; height moves only the light.</p>
    }
    @if (env(); as e) {
      @if (!e.skyImage) {
        <div class="td-group">
          <h3 class="td-section">Time of day <span class="td-note">{{ clock(e) }}</span></h3>
          <input class="td-slider" type="range" min="4" max="22" step="0.25" [value]="hourOf(e)" aria-label="Time of day"
                 (input)="live(timeOfDay(+$any($event.target).value, e.sky))" (change)="commit(timeOfDay(+$any($event.target).value, e.sky), 'Time of day')" data-test="time-of-day" />
          <p class="td-note">Moves the sun across the sky; dawn and dusk tint it, night darkens it.</p>
        </div>
      }
      @if (e.sky === 'night') {
        <div class="td-group">
          <h3 class="td-section">Moonlight</h3>
          <app-editor-range label="Moonlight" unit="%" [min]="0" [max]="100" [value]="(e.moonlight ?? 0) * 100"
                            (changing)="live({ moonlight: $event / 100 })" (changed)="commit({ moonlight: $event / 100 }, 'Moonlight')" data-test="moonlight" />
          <p class="td-note">A cool light on the land so a night map stays readable; the sky and stars stay dark, lanterns still stand out.</p>
        </div>
      }
      <div class="td-group">
        <h3 class="td-section">Sun</h3>
        <app-editor-range label="Direction" unit="deg" [min]="0" [max]="359" [value]="e.sunAzimuth"
                          (changing)="live({ sunAzimuth: $event })" (changed)="commit({ sunAzimuth: $event }, 'Sun direction')" />
        <app-editor-range label="Height" unit="deg" [min]="2" [max]="90" [value]="e.sunElevation"
                          (changing)="live({ sunElevation: $event })" (changed)="commit({ sunElevation: $event }, 'Sun height')" />
      </div>
      <div class="td-group">
        <h3 class="td-section">Air</h3>
        <app-editor-range label="Fog" unit="" [min]="0" [max]="40" [step]="0.5" [value]="e.fogDensity * 10000"
                          (changing)="live({ fogDensity: $event / 10000 })" (changed)="commit({ fogDensity: $event / 10000 }, 'Fog')" />
        <label class="td-setting">
          <span>Tint</span>
          <input type="color" [value]="e.tint" (input)="live({ tint: $any($event.target).value })"
                 (change)="commit({ tint: $any($event.target).value }, 'Tint')" aria-label="Tint" />
        </label>
      </div>
      <div class="td-group">
        <h3 class="td-section">Weather</h3>
        <div class="td-seg is-sm" role="radiogroup" aria-label="Weather">
          @for (w of weathers; track w.id) {
            <button type="button" role="radio" [attr.aria-checked]="(e.weather ?? 'clear') === w.id" (click)="commit({ weather: w.id }, 'Weather')">{{ w.label }}</button>
          }
        </div>
        @if ((e.weather ?? 'clear') !== 'clear') {
          <app-editor-range label="Strength" unit="%" [min]="5" [max]="100" [value]="(e.weatherStrength ?? 0.6) * 100"
                            (changing)="live({ weatherStrength: $event / 100 })" (changed)="commit({ weatherStrength: $event / 100 }, 'Weather strength')" />
        }
        <app-editor-range label="Snow cover" unit="%" [min]="0" [max]="100" [value]="(e.snowCover ?? 0) * 100"
                          (changing)="live({ snowCover: $event / 100 })" (changed)="commit({ snowCover: $event / 100 }, 'Snow cover')" />
      </div>
      <div class="td-group" data-test="wind">
        <h3 class="td-section">Wind</h3>
        <app-editor-range label="Strength" unit="%" [min]="0" [max]="100" [value]="windOf(e).strength * 100"
                          (changing)="live(wind(e, { strength: $event / 100 }))" (changed)="commit(wind(e, { strength: $event / 100 }), 'Wind strength')" />
        <app-editor-range label="From" unit="deg" [min]="0" [max]="359" [value]="windOf(e).direction"
                          (changing)="live(wind(e, { direction: $event }))" (changed)="commit(wind(e, { direction: $event }), 'Wind direction')" />
        <app-editor-range label="Gusts" unit="%" [min]="0" [max]="100" [value]="windOf(e).gusts * 100"
                          (changing)="live(wind(e, { gusts: $event / 100 }))" (changed)="commit(wind(e, { gusts: $event / 100 }), 'Wind gusts')" />
        <p class="td-note">Moves trees, grass, clouds, smoke, rain and snow. From: where the wind comes from (0 north, 90 east).</p>
        @if (e.wind) {
          <button type="button" class="td-btn-secondary td-btn-sm" (click)="commit({ wind: undefined }, 'Wind')">Use the look's wind</button>
        }
      </div>
    }
  `,
})
export class EnvironmentPanelComponent {
  private readonly session = inject(EditorSession);
  readonly skies = SKIES;
  readonly skyImages = SKY_IMAGES;
  readonly chooseSkyImage = chooseSkyImage;
  readonly looks = LOOKS;
  readonly weathers = WEATHERS;
  readonly timeOfDay = timeOfDay;
  readonly skyPreset = skyPreset;
  readonly windOf = windOf;
  readonly env = computed(() => (this.session.docRev(), this.session.doc ? { ...this.session.doc.environment } : null));
  /** The environment before the slider started moving */
  private before: MapEnvironment | null = null;

  /** The hour the sun's direction stands for (east 6, south 12, west 18) */
  hourOf(e: MapEnvironment): number {
    const h = 6 + ((e.sunAzimuth - 90) / 180) * 14;
    return Math.min(22, Math.max(4, Math.round(h * 4) / 4));
  }

  clock(e: MapEnvironment): string {
    const h = this.hourOf(e);
    return `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  }

  /** The map's wind (or the look's default, which the first change writes into the map) with `patch` on top */
  wind(e: MapEnvironment, patch: Partial<MapWind>): Partial<MapEnvironment> {
    return { wind: { ...windOf(e), ...patch } };
  }

  live(patch: Partial<MapEnvironment>): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.before ??= { ...editor.doc.environment };
    editor.doc.environment = { ...editor.doc.environment, ...patch };
    editor.emit({ environment: true });
  }

  commit(patch: Partial<MapEnvironment>, label: string): void {
    const editor = this.session.editor;
    if (!editor) return;
    const before = this.before ?? { ...editor.doc.environment };
    this.before = null;
    editor.doc.environment = { ...editor.doc.environment, ...patch };
    this.session.execute(new SnapshotCommand(label, { environment: before }, { environment: { ...editor.doc.environment } }));
  }
}
