import { describe, expect, it } from 'vitest';
import {
  LOCATION_DIALOG_LOAD_FAILED,
  LOCATION_DIALOG_OPEN_FAILED,
  isLocationDialogFailure,
} from './open-location-dialog';

/** The error screen offers a reload for these, new tile credentials for the rest. */
describe('isLocationDialogFailure', () => {
  it('knows the chunk that did not load and the dialog that did not open', () => {
    expect(isLocationDialogFailure(LOCATION_DIALOG_LOAD_FAILED)).toBe(true);
    expect(isLocationDialogFailure(LOCATION_DIALOG_OPEN_FAILED)).toBe(true);
  });

  it('leaves every other error to the credentials way out', () => {
    expect(isLocationDialogFailure('No Google Maps API key configured.')).toBe(false);
    expect(isLocationDialogFailure('Error loading 3D map')).toBe(false);
    expect(isLocationDialogFailure(null)).toBe(false);
  });
});
