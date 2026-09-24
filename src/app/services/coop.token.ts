import { InjectionToken } from '@angular/core';
import type { CoopService } from './coop.service';

/**
 * CoopService for who reaches it optionally (the facade, the sidebar): an
 * optional inject of the class itself needs the JIT compiler where it is not
 * provided, the token does not. A file of its own, so that importing it does
 * not pull in the service and what it depends on.
 */
export const COOP = new InjectionToken<CoopService>('CoopService');
