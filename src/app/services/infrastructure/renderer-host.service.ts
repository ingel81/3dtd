import { inject, Injectable } from '@angular/core';
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
    return this.host.acquire(slot, this.msaa(world));
  }
}
