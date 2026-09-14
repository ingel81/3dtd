/**
 * loadShowcase(): a showcase place with a fixed spawn (ShowcaseLocation.spawn)
 * closes the dialog with that spawn, the same shape a recent or a world-record
 * place uses (closeWithPlace) - not the random-spawn path. A place without one
 * still rolls random, as before. Constructed via runInInjectionContext, like
 * LocationManagementService's own spec: no TestBed, no template compilation,
 * loadShowcase() does not touch the DOM.
 */
// MatDialogRef pulls in Material modules that need the JIT compiler here.
import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { GeocodingService } from '../../services/location/geocoding.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { BestWaveService } from '../../services/location/best-wave.service';
import { LocationDialogComponent } from './location-dialog.component';
import type { LocationDialogData, LocationDialogResult } from '../../models/location.types';

function create(close: (result: LocationDialogResult | null) => void): LocationDialogComponent {
  const data: LocationDialogData = { currentLocation: null, currentSpawn: null, isGameInProgress: false };
  const injector = Injector.create({
    providers: [
      { provide: MatDialogRef, useValue: { close } },
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: GeocodingService, useValue: {} },
      { provide: LocationManagementService, useValue: { recents: signal([]) } },
      { provide: BestWaveService, useValue: { records: signal([]) } },
    ],
  });
  return runInInjectionContext(injector, () => new LocationDialogComponent());
}

describe('LocationDialogComponent.loadShowcase', () => {
  it('closes with a random spawn for a place without a fixed one, as before', () => {
    const close = vi.fn();
    const component = create(close);

    component.loadShowcase({
      id: 'nyc-times-square', name: 'New York, Times Square', hint: 'Midtown grid', lat: 40.75701, lon: -73.98597,
    });

    expect(close).toHaveBeenCalledWith({
      hq: { lat: 40.75701, lon: -73.98597, name: 'New York, Times Square', displayName: 'New York, Times Square' },
      spawn: { id: 'spawn_random', lat: 0, lon: 0, isRandom: true },
      confirmed: true,
    });
  });

  it('closes with the fixed spawn, same shape as a recent or world-record place (spawn_showcase, no random roll)', () => {
    const close = vi.fn();
    const component = create(close);

    component.loadShowcase({
      id: 'rio-copacabana', name: 'Rio de Janeiro, Copacabana', hint: 'Beachfront avenue', lat: -22.96889, lon: -43.18085,
      spawn: { lat: -22.96421, lon: -43.17463 },
    });

    expect(close).toHaveBeenCalledWith({
      hq: { lat: -22.96889, lon: -43.18085, name: 'Rio de Janeiro, Copacabana', displayName: 'Rio de Janeiro, Copacabana' },
      spawn: { id: 'spawn_showcase', lat: -22.96421, lon: -43.17463, isRandom: false },
      confirmed: true,
    });
  });

  it('carries the portal bearing along when the fixed spawn has one', () => {
    const close = vi.fn();
    const component = create(close);

    component.loadShowcase({
      id: 'x', name: 'X', hint: 'Y', lat: 1, lon: 2, spawn: { lat: 1.01, lon: 2.01, portalBearing: 187.5 },
    });

    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      spawn: { id: 'spawn_showcase', lat: 1.01, lon: 2.01, portalBearing: 187.5, isRandom: false },
    }));
  });
});
