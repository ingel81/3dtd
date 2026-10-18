import { DOCUMENT, InjectionToken, computed, effect, inject, signal, type Provider, type Signal } from '@angular/core';
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
export class I18nService {
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

  /** @param preference the player's choice (UIStore.localePreference) */
  constructor(private readonly preference: Signal<LocalePreference>) {
    try {
      effect(() => {
        this.loading = this.use(resolveLocale(this.preference(), this.languages()));
      });
    } catch {
      // An injector without change detection (one a spec builds by hand): the source language stays
    }
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

/**
 * The game's I18nService, one per app: `inject(I18n).t`. A token with a
 * factory rather than an @Injectable class, so the specs that build their
 * services by hand need no JIT compiler for it.
 */
export const I18n = new InjectionToken<I18nService>('I18n', {
  providedIn: 'root',
  // A stand-in UIStore of a spec without the setting plays in the system's language
  factory: () => new I18nService(inject(UIStore, { optional: true })?.localePreference ?? signal<LocalePreference>('system')),
});

/** I18n for an injector made by hand (Injector.create without a root): the specs that build services so */
export function provideI18n(): Provider {
  return { provide: I18n, useFactory: () => new I18nService(signal<LocalePreference>('system')) };
}
