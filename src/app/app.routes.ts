import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { customMapsByLink } from './world/custom-maps-open';

/** The editor and the map pages, before the custom maps' release only outside a production build */
const customMapsOnly = () => customMapsByLink() || inject(Router).parseUrl('/');

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./tower-defense.component').then(
        m => m.TowerDefenseComponent
      ),
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
    path: 'editor',
    canMatch: [customMapsOnly],
    loadComponent: () =>
      import('./editor/ui/editor-page.component').then(
        m => m.EditorPageComponent
      ),
  },
  {
    path: 'engine-test',
    loadComponent: () =>
      import('./components/engine-test/engine-test.component').then(
        m => m.EngineTestComponent
      ),
  },
];
