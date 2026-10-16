import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { customMapsByLink } from './world/custom-maps-open';

/** The editor and the map pages, before the custom maps' release only outside a production build */
const customMapsOnly = () => customMapsByLink() || inject(Router).parseUrl('/');

export const routes: Routes = [
  {
    // The game and the map editor in one window, the game first (AppShellComponent, AppScreen)
    path: '',
    data: { screen: 'game' },
    loadComponent: () => import('./app-shell.component').then((m) => m.AppShellComponent),
  },
  {
    // Dev page: the demo map in the custom map renderer
    path: 'map-preview',
    canMatch: [customMapsOnly],
    loadComponent: () =>
      import('./world/custom-map/preview/map-preview.component').then(
        m => m.MapPreviewComponent
      ),
  },
  {
    // The same window with the editor first (`?map=` names its map, WorldStartService.editorMap)
    path: 'editor',
    canMatch: [customMapsOnly],
    data: { screen: 'editor' },
    loadComponent: () => import('./app-shell.component').then((m) => m.AppShellComponent),
  },
  {
    path: 'engine-test',
    loadComponent: () =>
      import('./components/engine-test/engine-test.component').then(
        m => m.EngineTestComponent
      ),
  },
];
