import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { HeroControlService } from '../../../services/hero-control.service';
import type { HeroAmmoId } from '../../../configs/hero.config';
import { heroPanelView } from './hero-panel';

/**
 * Sidebar-Panel des Helden, sichtbar solange er gewählt ist, an der Stelle
 * des Tower-Details: Stufe, Kills, Weg zur nächsten Stufe, Munitionswahl und
 * der Hinweis, wie man ihn schickt. Die Munition geht als Command raus
 * (HeroControlService), der Rest liest GameStore.hero.
 */
@Component({
  selector: 'app-sidebar-hero-panel',
  standalone: true,
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hero-panel.component.html',
  styleUrl: './hero-panel.component.scss',
})
export class SidebarHeroPanelComponent {
  private readonly store = inject(TowerDefenseStore);
  private readonly heroControl = inject(HeroControlService);

  readonly view = computed(() => heroPanelView(this.store.hero()));

  setAmmo(ammo: HeroAmmoId): void {
    this.heroControl.setAmmo(ammo);
  }
}
