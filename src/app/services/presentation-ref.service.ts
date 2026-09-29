import { Injectable } from '@angular/core';
import type { PresentationHost } from '../presentation/presentation-host';

/**
 * The presentation of the engine in use (docs/SIM_WORKER.md): set by the
 * tower defense facade when the engine stands, null before and after. The
 * services that drive the look and sound outside the packets (music volume,
 * screen shake, the HQ, a partner hero's colour, a replay's clean field)
 * reach it here.
 */
@Injectable({ providedIn: 'root' })
export class PresentationRef {
  host: PresentationHost | null = null;
}
