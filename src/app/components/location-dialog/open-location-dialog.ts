import type { LocationDialogComponent } from './location-dialog.component';
import type { LocationDialogData, LocationDialogResult } from '../../models/location.types';
import { lazyDialog } from '../../utils/lazy-dialog';

/** What the player reads when the dialog's chunk does not load (network, a newer deploy). */
export const LOCATION_DIALOG_LOAD_FAILED =
  'The location dialog did not load. Check the connection and reload the page.';

/** What the player reads when the dialog loaded but failed to open (a bug, not the network). */
export const LOCATION_DIALOG_OPEN_FAILED =
  'The location dialog failed to open. Reload the page.';

/**
 * Whether the error screen shows one of the two messages above. New tile
 * credentials would not help there, a reload does.
 */
export function isLocationDialogFailure(message: string | null): boolean {
  return message === LOCATION_DIALOG_LOAD_FAILED || message === LOCATION_DIALOG_OPEN_FAILED;
}

/** The location dialog did not load, so no location can be picked in it. */
export class LocationDialogLoadError extends Error {
  constructor(cause: unknown) {
    super(LOCATION_DIALOG_LOAD_FAILED, { cause });
    this.name = 'LocationDialogLoadError';
  }
}

/**
 * Opens the location dialog. The dialog, its address search and the forms and
 * spinner modules only they use load as one lazy chunk on the first open.
 *
 * Only a chunk that does not load rejects with a LocationDialogLoadError; an
 * error of dialog.open() or the dialog's constructor comes through as it is.
 */
export const openLocationDialog = lazyDialog<LocationDialogComponent, LocationDialogData, LocationDialogResult | null>(
  async () => {
    try {
      return (await import('./location-dialog.component')).LocationDialogComponent;
    } catch (err) {
      throw new LocationDialogLoadError(err);
    }
  },
);
