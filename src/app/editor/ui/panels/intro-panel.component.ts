import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { MapIntro } from '../../../world/custom-map/map-document';
import { INTRO_ORBIT, INTRO_SECONDS, MAX_INTRO_VIEWS } from '../../../world/custom-map/map-intro';
import { heightAt } from '../../model/grid';
import { EditorSession } from '../editor-session.service';
import { RangeRowComponent } from './range-row.component';

type IntroKind = 'default' | MapIntro['kind'];

/**
 * The map's intro camera flight (CustomMapDocument.intro, map-intro.ts): the
 * game's default tour, an orbit around the HQ taken from the current view,
 * or a path through views kept one by one; Preview plays it in the view
 */
@Component({
  selector: 'app-intro-panel',
  standalone: true,
  imports: [RangeRowComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-group', 'data-test': 'intro-panel' },
  template: `
    <h3 class="td-section">Intro flight</h3>
    <div class="td-seg is-sm" role="radiogroup" aria-label="Intro flight">
      @for (k of kinds; track k.id) {
        <button type="button" role="radio" [attr.aria-checked]="kind() === k.id" [matTooltip]="k.hint" (click)="choose(k.id)" [attr.data-test]="'intro-' + k.id">{{ k.label }}</button>
      }
    </div>
    @switch (intro()?.kind) {
      @case ('orbit') {
        @if (orbit(); as o) {
          <p class="td-note">{{ o.radius }} m around the HQ, {{ o.height }} m above it</p>
          <app-editor-range label="Turn" unit="°" [min]="sweep.min" [max]="sweep.max" [step]="15" [value]="o.sweep" (changed)="setSweep($event)" />
        }
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="orbitFromView()" data-test="intro-orbit-view">Orbit from this view</button>
      }
      @case ('path') {
        <ol class="ip-views">
          @for (v of views(); track $index) {
            <li>
              <button class="td-btn-ghost td-btn-sm" type="button" (click)="showView($index)" matTooltip="Look from this view">View {{ $index + 1 }}</button>
              <button class="td-btn-ghost td-btn-sm" type="button" (click)="removeView($index)" [attr.aria-label]="'Remove view ' + ($index + 1)">Remove</button>
            </li>
          }
        </ol>
        <button class="td-btn-secondary td-btn-sm" type="button" [disabled]="views().length >= maxViews" (click)="addView()" data-test="intro-add-view">Add this view</button>
        <p class="td-note">The camera flies through the views in turn, the same time between each two.</p>
      }
      @default {
        <p class="td-note">The game flies from the HQ past every spawn and back to the overview.</p>
      }
    }
    @if (intro(); as i) {
      <app-editor-range label="Length" unit="s" [min]="seconds.min" [max]="seconds.max" [value]="i.seconds" (changed)="setSeconds($event)" />
      <button class="td-btn-secondary td-btn-sm" type="button" (click)="preview()" data-test="intro-preview">{{ session.introPreviewing() ? 'Stop' : 'Preview' }}</button>
      <p class="td-note">A click or the wheel in the view stops the preview. In the game the flight swings in from the start view and ends in the overview; a click skips it.</p>
    }
  `,
  styles: `
    .ip-views {
      margin: 0;
      padding-left: 1.2em;
      li {
        display: flex;
        gap: 4px;
        align-items: center;
      }
    }
  `,
})
export class IntroPanelComponent {
  readonly session = inject(EditorSession);
  readonly seconds = INTRO_SECONDS;
  readonly sweep = INTRO_ORBIT.sweep;
  readonly maxViews = MAX_INTRO_VIEWS;
  readonly kinds: { id: IntroKind; label: string; hint: string }[] = [
    { id: 'default', label: 'Default', hint: 'The game’s tour from the HQ past every spawn' },
    { id: 'orbit', label: 'Orbit the HQ', hint: 'Circles the HQ from the current view' },
    { id: 'path', label: 'Camera path', hint: 'Flies through views you keep one by one' },
  ];

  readonly intro = computed(() => (this.session.docRev(), this.session.doc?.intro ?? null));
  readonly kind = computed<IntroKind>(() => this.intro()?.kind ?? 'default');
  readonly views = computed(() => {
    const i = this.intro();
    return i?.kind === 'path' ? i.views : [];
  });
  readonly orbit = computed(() => {
    const i = this.intro();
    if (i?.kind !== 'orbit') return null;
    return { radius: Math.round(i.radius), height: Math.round(i.height), sweep: i.sweep ?? INTRO_ORBIT.sweep.default };
  });

  choose(kind: IntroKind): void {
    if (kind === this.kind()) return;
    this.session.previewIntro(false);
    const seconds = this.intro()?.seconds ?? INTRO_SECONDS.default;
    if (kind === 'default') this.session.editIntro(undefined, 'Default intro flight');
    else if (kind === 'orbit') this.orbitFromView(seconds);
    else {
      const view = this.session.introView();
      if (view) this.session.editIntro({ kind: 'path', seconds, views: [view] }, 'Intro camera path');
    }
  }

  /** The orbit through the current view: its distance from the HQ, its height above it, its bearing */
  orbitFromView(seconds = this.intro()?.seconds ?? INTRO_SECONDS.default): void {
    const doc = this.session.doc;
    const view = this.session.introView();
    if (!doc || !view) return;
    const { hq } = doc;
    const { radius, height } = INTRO_ORBIT;
    const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));
    const prev = this.intro();
    this.session.editIntro(
      {
        kind: 'orbit',
        seconds,
        radius: clamp(Math.hypot(view.x - hq.x, view.y - hq.y), radius),
        height: clamp(view.h - heightAt(doc.terrain, hq.x, hq.y), height),
        angle: Math.atan2(view.y - hq.y, view.x - hq.x),
        ...(prev?.kind === 'orbit' && prev.sweep !== undefined ? { sweep: prev.sweep } : {}),
      },
      'Intro orbit',
    );
  }

  addView(): void {
    const i = this.intro();
    const view = this.session.introView();
    if (i?.kind !== 'path' || !view || i.views.length >= MAX_INTRO_VIEWS) return;
    this.session.editIntro({ ...i, views: [...i.views, view] }, 'Intro view');
  }

  removeView(k: number): void {
    const i = this.intro();
    if (i?.kind !== 'path') return;
    const views = i.views.filter((_, j) => j !== k);
    this.session.editIntro(views.length ? { ...i, views } : undefined, 'Remove intro view');
  }

  /** The editor camera to a kept view: it orbits the view's look point from where the view stood */
  showView(k: number): void {
    const v = this.views()[k];
    if (!v) return;
    const dx = v.x - v.lookX;
    const dy = v.y - v.lookY;
    const horizontal = Math.hypot(dx, dy);
    const distance = Math.hypot(horizontal, v.h - v.lookH);
    // CameraController: scene x is west, yaw 0 looks north, the camera stands behind the target
    this.session.viewport?.showView({
      x: -v.lookX,
      y: v.lookH,
      z: v.lookY,
      distance,
      yaw: Math.atan2(-dx, -dy),
      pitch: Math.atan2(v.h - v.lookH, Math.max(0.001, horizontal)),
    });
  }

  setSeconds(seconds: number): void {
    const i = this.intro();
    if (i) this.session.editIntro({ ...i, seconds }, 'Intro length');
  }

  setSweep(sweep: number): void {
    const i = this.intro();
    if (i?.kind === 'orbit') this.session.editIntro({ ...i, sweep }, 'Intro orbit turn');
  }

  preview(): void {
    this.session.previewIntro(!this.session.introPreviewing());
  }
}
