import { InjectionToken } from '@angular/core';
import { environment } from '../../environments/environment';

/** Whether the custom maps and the map editor are released (TODO E134) */
export const CUSTOM_MAPS_RELEASED = false;

/**
 * Whether the menu opens the custom maps and the map editor. Until they are
 * released their buttons show but stay disabled; a spec hands in true.
 */
export const CUSTOM_MAPS_OPEN = new InjectionToken<boolean>('CUSTOM_MAPS_OPEN', { providedIn: 'root', factory: () => CUSTOM_MAPS_RELEASED });

/**
 * Whether a link may open a custom map or the editor (`?world=map:…`,
 * `/editor`). Before the release only outside a production build: the
 * release ships without `public/maps`.
 */
export function customMapsByLink(production = environment.production): boolean {
  return CUSTOM_MAPS_RELEASED || !production;
}
