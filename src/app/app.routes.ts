import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./game/tower-defense/tower-defense.component').then(
        m => m.TowerDefenseComponent
      ),
  },
];
