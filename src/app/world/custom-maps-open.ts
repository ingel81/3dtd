import { InjectionToken } from '@angular/core';

/**
 * Whether the menu opens the custom maps and the map editor. Until they are
 * released their buttons show but stay disabled; a spec hands in true.
 */
export const CUSTOM_MAPS_OPEN = new InjectionToken<boolean>('CUSTOM_MAPS_OPEN', { providedIn: 'root', factory: () => false });
