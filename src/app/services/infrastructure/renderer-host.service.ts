import { inject, Injectable, signal } from '@angular/core';
import { RendererHost, type RendererLease } from '../../three-engine/renderer-host';
import type { QualityWorld } from '../../three-engine/render-quality';
import { RenderQualityService } from './render-quality.service';

/**
 * The page's one WebGLRenderer (three-engine/renderer-host.ts), lent to the
 * view that draws a world now: the game's engine, world after world.
 */
@Injectable({ providedIn: 'root' })
export class RendererHostService {
  private readonly quality = inject(RenderQualityService);
  private readonly host = new RendererHost();
  /** The view holding the renderer now: its world and whether its canvas has MSAA; null while none does */
  readonly lent = signal<{ world: QualityWorld; msaa: boolean } | null>(null);

  /**
   * Whether the canvas draws with MSAA for `world`: the one place that
   * decides it. For now the quality level's antialiasing for every view
   * (MSAA on High and Ultra, FXAA in the composer below); a view asking for
   * the other setting than the live renderer has gets a new context.
   */
  msaa(world: QualityWorld): boolean {
    return this.quality.canvasMsaa(world);
  }

  /** The renderer for a view of `world`, its canvas in `slot` */
  acquire(slot: HTMLElement, world: QualityWorld): RendererLease {
    const lease = this.host.acquire(slot, this.msaa(world));
    const lent = { world, msaa: lease.msaa };
    this.lent.set(lent);
    return {
      ...lease,
      release: () => {
        lease.release();
        if (this.lent() === lent) this.lent.set(null);
      },
    };
  }

  /**
   * Whether the view drawing now has another antialiasing than its world's
   * level asks for: MSAA is fixed with the canvas's context, so a level
   * picked in play changes it at the next start (a new view acquires anew)
   */
  readonly antialiasPending = (): boolean => {
    const lent = this.lent();
    return lent !== null && lent.msaa !== this.msaa(lent.world);
  };
}
