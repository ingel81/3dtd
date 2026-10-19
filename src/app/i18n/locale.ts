import { isDevMode } from '@angular/core';

/**
 * The languages the game speaks (TODO E245, docs/I18N_PLAN.md). A new one is
 * a code here, its own name below and a file under `messages/`; the compiler
 * then asks for every text.
 */
export const LOCALES = ['en', 'de'] as const;

/** The pseudo language for developers (pseudo.ts): chosen in a development build only, never detected */
export const PSEUDO_LOCALE = 'xx' as const;

export type Locale = (typeof LOCALES)[number] | typeof PSEUDO_LOCALE;

/** The player's choice in Settings: a language, or the system's */
export type LocalePreference = Locale | 'system';

/** The source language: the dictionary every other one must match */
export const SOURCE_LOCALE: Locale = 'en';

/** Each language in its own words, as the Settings list shows it whatever language is on */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  de: 'Deutsch',
  xx: 'Pseudo (xx)',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && ((LOCALES as readonly string[]).includes(value) || (value === PSEUDO_LOCALE && isDevMode()));
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isLocale(value);
}

/**
 * The first of the browser's (or the system's, in the desktop app) languages
 * the game speaks, by its main tag ("de-AT" speaks "de"); English without one.
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const main = tag.split('-')[0].toLowerCase();
    if ((LOCALES as readonly string[]).includes(main)) return main as Locale;
  }
  return SOURCE_LOCALE;
}

/** The language a preference stands for, `languages` being navigator.languages */
export function resolveLocale(preference: LocalePreference, languages: readonly string[]): Locale {
  return preference === 'system' ? detectLocale(languages) : preference;
}
