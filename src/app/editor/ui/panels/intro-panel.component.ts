import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { MapIntro } from '../../../world/custom-map/map-document';
import { INTRO_ORBIT, INTRO_SECONDS, MAX_INTRO_VIEWS } from '../../../world/custom-map/map-intro';
import { heightAt } from '../../../map-ops/grid';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { RangeRowComponent } from './range-row.component';
import { injectT } from '../../../i18n/i18n.service';

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
    <h3 class="td-section">{{ t().editor.intro.title }}</h3>
    <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.intro.title">
      @for (k of kinds; track k) {
        <button type="button" role="radio" [attr.aria-checked]="kind() === k" [matTooltip]="t().editor.intro.kinds[k].hint" (click)="choose(k)" [attr.data-test]="'intro-' + k">{{ t().editor.intro.kinds[k].label }}</button>
      }
    </div>
    @switch (intro()?.kind) {
      @case ('orbit') {
        @if (orbit(); as o) {
          <p class="td-note">{{ t().editor.intro.orbitLine(o.radius, o.height) }}</p>
          <app-editor-range [label]="t().editor.intro.turn" unit="°" [min]="sweep.min" [max]="sweep.max" [step]="15" [value]="o.sweep" (changed)="setSweep($event)" />
        }
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="orbitFromView()" data-test="intro-orbit-view">{{ t().editor.intro.orbitFromView }}</button>
      }
      @case ('path') {
        <ol class="ip-views">
          @for (v of views(); track $index) {
            <li>
              <button class="td-btn-ghost td-btn-sm" type="button" (click)="showView($index)" [matTooltip]="t().editor.intro.lookFrom">{{ t().editor.intro.view($index + 1) }}</button>
              <button class="td-btn-ghost td-btn-sm" type="button" (click)="removeView($index)" [attr.aria-label]="t().editor.intro.removeViewLabel($index + 1)">{{ t().editor.intro.remove }}</button>
            </li>
          }
        </ol>
        <button class="td-btn-secondary td-btn-sm" type="button" [disabled]="views().length >= maxViews" (click)="addView()" data-test="intro-add-view">{{ t().editor.intro.addView }}</button>
        <p class="td-note">{{ t().editor.intro.pathNote }}</p>
      }
      @default {
        <p class="td-note">{{ t().editor.intro.defaultNote }}</p>
      }
    }
    @if (intro(); as i) {
      <app-editor-range [label]="t().editor.intro.length" unit="s" [min]="seconds.min" [max]="seconds.max" [value]="i.seconds" (changed)="setSeconds($event)" />
      <button class="td-btn-secondary td-btn-sm" type="button" (click)="preview()" data-test="intro-preview">{{ session.view.introPreviewing() ? t().editor.intro.stop : t().editor.intro.preview }}</button>
      <p class="td-note">{{ t().editor.intro.previewNote }}</p>
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
  protected readonly t = injectT();
  readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('intro', 'terrain');
  readonly seconds = INTRO_SECONDS;
  readonly sweep = INTRO_ORBIT.sweep;
  readonly maxViews = MAX_INTRO_VIEWS;
  readonly kinds: readonly IntroKind[] = ['default', 'orbit', 'path'];

  readonly intro = computed(() => (this.rev(), this.session.doc?.intro ?? null));
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
    this.session.view.previewIntro(null);
    const seconds = this.intro()?.seconds ?? INTRO_SECONDS.default;
    if (kind === 'default') this.session.editIntro(undefined, this.t().editor.intro.defaultStep);
    else if (kind === 'orbit') this.orbitFromView(seconds);
    else {
      const view = this.session.view.introView();
      if (view) this.session.editIntro({ kind: 'path', seconds, views: [view] }, this.t().editor.intro.pathStep);
    }
  }

  /** The orbit through the current view: its distance from the HQ, its height above it, its bearing */
  orbitFromView(seconds = this.intro()?.seconds ?? INTRO_SECONDS.default): void {
    const doc = this.session.doc;
    const view = this.session.view.introView();
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
      this.t().editor.intro.orbitStep,
    );
  }

  addView(): void {
    const i = this.intro();
    const view = this.session.view.introView();
    if (i?.kind !== 'path' || !view || i.views.length >= MAX_INTRO_VIEWS) return;
    this.session.editIntro({ ...i, views: [...i.views, view] }, this.t().editor.intro.viewStep);
  }

  removeView(k: number): void {
    const i = this.intro();
    if (i?.kind !== 'path') return;
    const views = i.views.filter((_, j) => j !== k);
    this.session.editIntro(views.length ? { ...i, views } : undefined, this.t().editor.intro.removeViewStep);
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
    this.session.view.showView({
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
    if (i) this.session.editIntro({ ...i, seconds }, this.t().editor.intro.lengthStep);
  }

  setSweep(sweep: number): void {
    const i = this.intro();
    if (i?.kind === 'orbit') this.session.editIntro({ ...i, sweep }, this.t().editor.intro.turnStep);
  }

  preview(): void {
    this.session.view.previewIntro(this.session.view.introPreviewing() ? null : (this.session.doc?.intro ?? null));
  }
}
