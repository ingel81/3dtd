import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Inline-SVG icon set, 24×24 viewBox, currentColor, ~1.5px stroke.
 *
 * Set is curated from the design refinements bundle (tmp/td-components.jsx, `Ico` map).
 * Used as a refined alternative to material-symbols for game-HUD / tooltips / sidebar.
 * Debug views may continue using <mat-icon> for backwards compatibility.
 *
 * Usage: `<td-icon name="heart" size="20" />`
 *
 * Implementation note: rendering SVG markup via [innerHTML] requires the host
 * element to NOT be an <svg> itself — otherwise the parsed children land in
 * the HTML namespace instead of SVG. We use a `<span>` host and embed the
 * full <svg>...</svg> string. SVG bodies are author-controlled (no user input)
 * so DomSanitizer.bypassSecurityTrustHtml is safe.
 */
export type TdIconName =
  | 'heart' | 'coin' | 'wave' | 'sword' | 'tower' | 'target' | 'bolt' | 'flame'
  | 'flask' | 'shield' | 'skull' | 'bug' | 'pin' | 'flag' | 'home' | 'search'
  | 'caret' | 'caretL' | 'caretR' | 'caretU' | 'play' | 'pause' | 'stop'
  | 'cog' | 'eye' | 'eyeOff' | 'speed' | 'fullscreen' | 'layers' | 'grid'
  | 'audio' | 'audioOff' | 'build' | 'refresh' | 'text' | 'bulb' | 'user'
  | 'sliders' | 'chart' | 'share' | 'filing' | 'case' | 'cross' | 'check'
  | 'info' | 'warn' | 'random' | 'manual' | 'edit'
  // additions for full mat-icon migration
  | 'lock' | 'bookmark' | 'plus' | 'minus' | 'terrain' | 'copyright'
  | 'vibration' | 'fastForward' | 'gamepad' | 'trash' | 'copy' | 'dragHandle'
  | 'externalLink' | 'shuffle' | 'arrowUp' | 'walk' | 'run'
  | 'splash' | 'route' | 'undo';

interface IconDef {
  /** Inner SVG markup. Stroke uses currentColor; fill defaults to none unless set explicitly per <path>. */
  body: string;
  /** Optional override for fill mode (default 'none' — stroked icon). */
  fill?: 'none' | 'currentColor';
}

const ICONS: Record<TdIconName, IconDef> = {
  heart: { body: '<path d="M12 21s-7-4.5-9.5-9C0.5 8 3 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4 0 6.5 4 4.5 8C19 16.5 12 21 12 21Z" />' },
  coin: { body: '<circle cx="12" cy="12" r="8.5" /><path d="M12 7v10M9 9c1-1 2-1.5 3-1.5s3 .5 3 2-1 2-3 2-3 .5-3 2 2 2 3 2 2-.5 3-1.5" fill="none" />' },
  wave: { body: '<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />' },
  sword: { body: '<path d="M14.5 4 20 4l0 5.5L9 20.5 3.5 15 14.5 4ZM7 17l-2 2M14.5 4 11 7.5M16.5 7.5 13 11" />' },
  tower: { body: '<path d="M8 21h8M9 21V11h6v10M10 11V8h4v3M11 8V4h2v4M11 14h2M11 17h2" />' },
  target: { body: '<circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" />' },
  bolt: { body: '<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />' },
  flame: { body: '<path d="M12 21c-4 0-7-3-7-7 0-3 2-5 3-7 1 2 2 2 3 1 0-3-1-5 1-7 1 4 3 4 4 7 1 2 3 4 3 6 0 4-3 7-7 7Z" />' },
  flask: { body: '<path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3M7 14h10" />' },
  shield: { body: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />' },
  skull: { body: '<path d="M12 3a8 8 0 0 0-8 8v4l2 2v3h3v-2h6v2h3v-3l2-2v-4a8 8 0 0 0-8-8Z" /><circle cx="9" cy="12" r="1.5" fill="currentColor" /><circle cx="15" cy="12" r="1.5" fill="currentColor" /><path d="M11 16l1 2 1-2" />' },
  bug: { body: '<path d="M12 4v3M9 5l1.5 2M15 5l-1.5 2M5 14h3M16 14h3M6 18l2-1M18 18l-2-1M6 10l2 1M18 10l-2 1" /><ellipse cx="12" cy="13" rx="5" ry="6" />' },
  pin: { body: '<path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12Z" /><circle cx="12" cy="10" r="2.5" />' },
  flag: { body: '<path d="M5 21V4M5 4h12l-2 4 2 4H5" />' },
  home: { body: '<path d="M4 11 12 4l8 7M6 10v10h12V10" />' },
  search: { body: '<circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" />' },
  caret: { body: '<path d="M6 9l6 6 6-6" />' },
  caretL: { body: '<path d="M15 6l-6 6 6 6" />' },
  caretR: { body: '<path d="M9 6l6 6-6 6" />' },
  play: { body: '<path d="M7 4v16l13-8L7 4Z" />' },
  pause: { body: '<path d="M7 4h4v16H7zM13 4h4v16h-4z" />' },
  cog: { body: '<circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M22 12h-3M5 12H2M19 5l-2 2M7 17l-2 2M19 19l-2-2M7 7 5 5" />' },
  eye: { body: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />' },
  eyeOff: { body: '<path d="m3 3 18 18M6 6c-2 2-4 6-4 6s4 7 10 7c2 0 4-1 5-2M9 5c1 0 2-.5 3-.5 6 0 10 7 10 7s-1 2-3 4" /><path d="M10 10a3 3 0 0 0 4 4" />' },
  speed: { body: '<path d="M4 16a8 8 0 0 1 16 0" /><path d="m12 16 5-5" />' },
  fullscreen: { body: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />' },
  layers: { body: '<path d="M12 3 2 8l10 5 10-5-10-5ZM2 13l10 5 10-5M2 18l10 5 10-5" />' },
  grid: { body: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />' },
  audio: { body: '<path d="M5 9v6h4l5 4V5L9 9H5ZM17 9c1 1 1 5 0 6M19.5 6.5c2.5 2.5 2.5 8.5 0 11" />' },
  audioOff: { body: '<path d="M5 9v6h4l5 4V5L9 9H5ZM16 9l5 6M21 9l-5 6" />' },
  build: { body: '<path d="m14 6 4 4-9 9-4 1 1-4 9-10ZM13 7l4 4M3 21h18" />' },
  refresh: { body: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" />' },
  text: { body: '<path d="M5 6h14M12 6v14M8 20h8" />' },
  bulb: { body: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c1 1 2 2 2 4h4c0-2 1-3 2-4a6 6 0 0 0-4-10Z" />' },
  user: { body: '<circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" />' },
  sliders: { body: '<path d="M4 8h12M18 8h2M4 16h4M10 16h10M16 6v4M8 14v4" />' },
  chart: { body: '<path d="M3 20h18M5 20V10M10 20V5M15 20v-8M20 20v-4" />' },
  share: { body: '<circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 11 7.6-4M8.2 13l7.6 4" />' },
  filing: { body: '<path d="M4 4h16v6H4zM4 14h16v6H4zM8 7h2M8 17h2" />' },
  case: { body: '<path d="M3 7h18v13H3zM8 7V4h8v3M3 13h18" />' },
  cross: { body: '<path d="M6 6l12 12M18 6 6 18" />' },
  check: { body: '<path d="M5 12l5 5 9-11" />' },
  info: { body: '<circle cx="12" cy="12" r="9" /><path d="M12 8v.01M12 11v6" />' },
  warn: { body: '<path d="M12 4 2 20h20L12 4ZM12 10v5M12 18v.01" />' },
  random: { body: '<rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /><circle cx="7" cy="7" r="1" fill="currentColor" /><circle cx="17" cy="17" r="1" fill="currentColor" /><circle cx="14" cy="20" r="1" fill="currentColor" /><circle cx="20" cy="14" r="1" fill="currentColor" />' },
  manual: { body: '<path d="M5 19V5l7 3 7-3v14l-7-3-7 3ZM12 8v11" />' },
  edit: { body: '<path d="M4 20h4l11-11-4-4L4 16v4ZM14 6l4 4" />' },
  // === additions for full mat-icon migration ===
  caretU: { body: '<path d="M6 15l6-6 6 6" />' },
  stop: { body: '<rect x="6" y="6" width="12" height="12" rx="1" />' },
  lock: { body: '<rect x="5" y="11" width="14" height="9" rx="1" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />' },
  bookmark: { body: '<path d="M6 4h12v18l-6-4-6 4Z" />' },
  plus: { body: '<path d="M12 5v14M5 12h14" />' },
  minus: { body: '<path d="M5 12h14" />' },
  terrain: { body: '<path d="M3 19h18M5 19l5-9 4 6 3-4 4 7M14 16l3-4" />' },
  copyright: { body: '<circle cx="12" cy="12" r="9" /><path d="M15 9a4 4 0 1 0 0 6" />' },
  vibration: { body: '<rect x="9" y="5" width="6" height="14" rx="1" /><path d="M5 9v6M3 11v2M19 9v6M21 11v2" />' },
  fastForward: { body: '<path d="M4 5l8 7-8 7V5ZM12 5l8 7-8 7V5Z" />' },
  gamepad: { body: '<rect x="3" y="7" width="18" height="10" rx="3" /><path d="M7 12h3M8.5 10.5v3M14 11h.01M16 13h.01" />' },
  trash: { body: '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v6M14 11v6" />' },
  copy: { body: '<rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />' },
  dragHandle: { body: '<circle cx="9" cy="6" r="1.4" fill="currentColor" /><circle cx="15" cy="6" r="1.4" fill="currentColor" /><circle cx="9" cy="12" r="1.4" fill="currentColor" /><circle cx="15" cy="12" r="1.4" fill="currentColor" /><circle cx="9" cy="18" r="1.4" fill="currentColor" /><circle cx="15" cy="18" r="1.4" fill="currentColor" />' },
  externalLink: { body: '<path d="M14 4h6v6M20 4 11 13M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />' },
  shuffle: { body: '<path d="M3 6h4l10 12h4M3 18h4l3-3.5M14 8.5l3-2.5h4M19 4l3 2-3 2M19 16l3 2-3 2" />' },
  arrowUp: { body: '<path d="M12 19V5M5 12l7-7 7 7" />' },
  walk: { body: '<circle cx="12" cy="4" r="2" /><path d="M9 22l3-7-2-3 4-4 3 5 3 1M7 12l3-3" />' },
  run: { body: '<circle cx="14" cy="4" r="2" /><path d="M5 17l5-2 2-3 4 1 4 5M9 13l-3-3 3-4 4 4 1 4" />' },
  splash: { body: '<path d="M12 4c-3 4-5 7-5 10a5 5 0 0 0 10 0c0-3-2-6-5-10Z" /><path d="M5 18c1 1 2 1.5 3 1.5M19 18c-1 1-2 1.5-3 1.5" />' },
  route: { body: '<circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M6 16.5V12a4 4 0 0 1 4-4h4a4 4 0 0 0 4-4" />' },
  undo: { body: '<path d="M9 14l-5-5 5-5M4 9h11a5 5 0 0 1 0 10h-2" />' },
};

@Component({
  selector: 'td-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span [innerHTML]="svgMarkup()"></span>`,
  styles: [`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      line-height: 0;
    }
    :host > span {
      display: inline-flex;
    }
    :host ::ng-deep svg {
      display: block;
    }
  `],
})
export class TdIconComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly name = input.required<TdIconName>();
  readonly size = input<number>(20);
  readonly strokeWidth = input<number>(1.5);
  readonly ariaLabel = input<string | null>(null);

  protected readonly svgMarkup = computed<SafeHtml>(() => {
    const def = ICONS[this.name()];
    const body = def?.body ?? '<circle cx="12" cy="12" r="6" />';
    const fill = def?.fill ?? 'none';
    const sz = this.size();
    const sw = this.strokeWidth();
    const aria = this.ariaLabel()
      ? ` role="img" aria-label="${this.ariaLabel()}"`
      : ' role="presentation"';
    const svg = `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${aria}>${body}</svg>`;
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  });
}
