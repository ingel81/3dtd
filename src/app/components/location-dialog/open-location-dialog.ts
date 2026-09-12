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
