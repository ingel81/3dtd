import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';
import { routes } from './app.routes';
import { ConfigService } from './core/services/config.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    // Tile credentials are resolved before the first component renders, so the
    // engine never starts against a half-loaded config.
    provideAppInitializer(() => inject(ConfigService).load()),
    // A dialog closed with Esc would hand the focus back with the keyboard as
    // origin: the button clicked last (layer menu, header, sidebar) shows its
    // tooltip, and the tooltip swallows the next Esc, so the game menu took
    // two presses. The game keys need no focus, so no dialog restores it.
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { ...new MatDialogConfig(), restoreFocus: false } },
  ],
};
