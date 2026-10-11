import { Routes } from '@angular/router';

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
    loadComponent: () =>
      import('./world/custom-map/preview/map-preview.component').then(
        m => m.MapPreviewComponent
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
