import { DOCUMENT, Injectable, computed, effect, inject, signal, type Signal } from '@angular/core';
import { UIStore } from '../store/ui.store';
import { DICTIONARIES } from './dictionaries';
import { SOURCE_LOCALE, resolveLocale, type Locale, type LocalePreference } from './locale';
import { en, type Messages } from './messages/en';

/**
 * The texts in the player's language (TODO E245, docs/I18N_PLAN.md).
 * Templates read `t()` and a key, `{{ t().common.cancel }}`: one signal read
 * and a property, no lookup by string, so the HUD pays nothing per frame. A
 * change of language swaps the dictionary and every template that reads `t`
 * follows, without a reload.
 *
 * The choice lives in UIStore (`localePreference`); this service follows it,
 * loads the dictionary and keeps `<html lang>` in step.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  /** The player's choice; a stand-in UIStore in a test without it plays in the system's language */
  private readonly preference: Signal<LocalePreference> =
    inject(UIStore, { optional: true })?.localePreference ?? signal<LocalePreference>('system');
  private readonly document = inject(DOCUMENT, { optional: true });
  private readonly active = signal<{ locale: Locale; t: Messages }>({ locale: SOURCE_LOCALE, t: en });
  /** The latest language asked for; an older load that arrives late is dropped */
  private wanted: Locale = SOURCE_LOCALE;
  private loading: Promise<void> = Promise.resolve();

  /** The dictionary of the language on */
  readonly t: Signal<Messages> = computed(() => this.active().t);
  /** The language on (the one loaded, not merely chosen) */
  readonly locale: Signal<Locale> = computed(() => this.active().locale);
  /** The language the system would pick, for "System (Deutsch)" in Settings */
  readonly systemLocale: Locale = resolveLocale('system', this.languages());

  constructor() {
    effect(() => {
      this.loading = this.use(resolveLocale(this.preference(), this.languages()));
    });
  }

  /** Resolves once the chosen language is loaded: the app waits for it before the first frame */
  ready(): Promise<void> {
    return this.loading;
  }

  private async use(locale: Locale): Promise<void> {
    this.wanted = locale;
    if (this.active().locale === locale) return;
    let t: Messages;
    try {
      t = await DICTIONARIES[locale]();
    } catch {
      // The chunk did not load (offline after an update): the game stays in the language it has
      return;
    }
    if (this.wanted !== locale) return;
    this.active.set({ locale, t });
    this.document?.documentElement.setAttribute('lang', locale);
  }

  private languages(): readonly string[] {
    const nav = this.document?.defaultView?.navigator;
    return nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  }
}
