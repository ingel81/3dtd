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
    path: 'engine-test',
    loadComponent: () =>
      import('./components/engine-test/engine-test.component').then(
        m => m.EngineTestComponent
      ),
  },
];
