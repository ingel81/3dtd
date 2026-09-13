import type { LocationDialogComponent } from './location-dialog.component';
import type { LocationDialogData, LocationDialogResult } from '../../models/location.types';
import { lazyDialog } from '../../utils/lazy-dialog';

/**
 * Opens the location dialog. The dialog, its address search and the forms and
 * spinner modules only they use load as one lazy chunk on the first open.
 */
export const openLocationDialog = lazyDialog<LocationDialogComponent, LocationDialogData, LocationDialogResult | null>(
  () => import('./location-dialog.component').then((m) => m.LocationDialogComponent),
);

/** What the player reads when the dialog's chunk does not load (network, a newer deploy). */
export const LOCATION_DIALOG_LOAD_FAILED =
  'The location dialog did not load. Check the connection and reload the page.';

/** The location dialog did not load, so no location can be picked in it. */
export class LocationDialogLoadError extends Error {
  constructor(cause: unknown) {
    super(LOCATION_DIALOG_LOAD_FAILED, { cause });
    this.name = 'LocationDialogLoadError';
  }
}
