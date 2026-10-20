import { ChangeDetectionStrategy, Component, Injectable, input, signal } from '@angular/core';
import type { WorldId } from './world-rules';

/**
 * The still pictures of the stage's globes (StageGlobes takes them once per
 * visit, the maps' again after new towers), kept for the page: a run's
 * Continue shows the globe of its world without a globe drawn per frame.
 * Root, so a visit back to the globes shows them at once.
 */
@Injectable({ providedIn: 'root' })
export class GlobePictures {
  private readonly urls = signal<Readonly<Partial<Record<WorldId, string>>>>({});
  readonly all = this.urls.asReadonly();

  set(world: WorldId, url: string): void {
    this.urls.update((urls) => ({ ...urls, [world]: url }));
  }
}

/**
 * A world's globe the size of an icon: its still picture, or the world's lit
 * disc while there is none (before the earth's maps are up, the menu globe
 * off, no WebGL), as the globes' squares show it then. Named by `label`.
 */
@Component({
  selector: 'app-globe-picture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()', '[attr.title]': 'label()', '[attr.data-globe-picture]': 'world()' },
  template: `
    @if (src(); as url) {
      <img class="gp-img" [src]="url" alt="" draggable="false">
    } @else {
      <span class="gp-disc td-world-disc" [class.is-osm]="world() === 'osm'" [class.is-maps]="world() === 'maps'"></span>
    }
  `,
  styles: [`
    :host { position: relative; display: block; flex: 0 0 auto; width: var(--gp-size, 36px); height: var(--gp-size, 36px); }
    .gp-img { display: block; width: 100%; height: 100%; }
    /* As the squares' disc: the globe fills 86 % of its square */
    .gp-disc { position: absolute; inset: 7%; }
  `],
})
export class GlobePictureComponent {
  readonly world = input.required<WorldId>();
  /** The picture's URL, null for the disc */
  readonly src = input<string | null>(null);
  readonly label = input.required<string>();
}
