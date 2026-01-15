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
    path: 'particle-test',
    loadComponent: () =>
      import('./components/particle-test/particle-test.component').then(
        m => m.ParticleTestComponent
      ),
  },
];
