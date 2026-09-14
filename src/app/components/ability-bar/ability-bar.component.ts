import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { AbilityTargetingService } from '../../services/ability-targeting.service';
import { ABILITIES, type AbilityId } from '../../configs/abilities.config';
import { TdIconComponent } from '../icon/icon.component';
import { TdRichTooltipDirective } from '../tooltip/td-rich-tooltip.directive';
import {
  ABILITY_BAR_PX,
  AbilityBarHero,
  abilityBarIds,
  abilityButtonView,
  abilityTooltip,
  heroTooltip,
} from './ability-button';

/**
 * Bar at the left edge of the playfield: at the top the hero's button, when
 * there is a hero, under it one button per researched ability in ABILITIES
 * order. An ability gets its button once its research is done; a press arms
 * or leaves the targeting mode like the ability's key. With neither a hero
 * nor a researched ability there is no bar.
 *
 * The bar reads the abilities from the config and their state from
 * GameStore.abilities, so a new ability needs no change here. The hero comes
 * in through `hero` and goes out through `heroPressed`.
 */
@Component({
  selector: 'app-ability-bar',
  standalone: true,
  imports: [TdIconComponent, TdRichTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ability-bar.component.html',
  styleUrl: './ability-bar.component.scss',
  // The measures the SCSS draws with, from the same numbers as ABILITY_BAR_EDGE_PX
  host: {
    '[style.left.px]': 'px.left',
    '[style.--td-bar-border]': "px.border + 'px'",
    '[style.--td-bar-pad]': "px.padding + 'px'",
    '[style.--td-bar-btn]': "px.button + 'px'",
  },
})
export class AbilityBarComponent {
  private readonly store = inject(TowerDefenseStore);
  private readonly abilityTargeting = inject(AbilityTargetingService);

  protected readonly px = ABILITY_BAR_PX;

  /** The hero's button at the top of the bar; null while there is no hero */
  readonly hero = input<AbilityBarHero | null>(null);
  /** The hero's button was pressed */
  readonly heroPressed = output<void>();

  readonly heroTooltip = computed(() => {
    const hero = this.hero();
    return hero ? heroTooltip(hero) : null;
  });

  readonly buttons = computed(() => {
    const statuses = this.store.abilities();
    const waveActive = this.store.waveActive();
    const targeting = this.abilityTargeting.targeting();
    return abilityBarIds(statuses).map((id) => {
      const config = ABILITIES[id];
      const status = statuses[id];
      const view = abilityButtonView(config, status, waveActive, targeting === id);
      return {
        id,
        icon: config.icon,
        hotkey: config.hotkey.toUpperCase(),
        view,
        tooltip: abilityTooltip(config, status, view),
      };
    });
  });

  /** Something to show: the hero or a researched ability */
  readonly visible = computed(() => this.hero() !== null || this.buttons().length > 0);

  /**
   * Targeting mode on or off. A button without effect stays clickable
   * (aria-disabled instead of disabled), so its tooltip still shows.
   */
  press(id: AbilityId, enabled: boolean): void {
    if (!enabled) return;
    this.abilityTargeting.toggle(id);
  }
}
