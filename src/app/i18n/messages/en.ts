import { formatters } from '../format';

const f = formatters('en');

/**
 * The game's texts in English, the source language (TODO E245,
 * docs/I18N_PLAN.md). Its shape is the type `Messages`: every other language
 * fills the same keys, a text with values is a function of them. Group by
 * area (`common`, `settings`, `hud` …), name a key for what it says, not for
 * where it stands.
 */
export const en = {
  common: {
    ok: 'OK',
    cancel: 'Cancel',
    close: 'Close',
    back: 'Back',
    continue: 'Continue',
    save: 'Save',
    delete: 'Delete',
    retry: 'Retry',
  },
  settings: {
    language: 'Language',
    languageSystem: (name: string) => `System (${name})`,
  },
  units: {
    waves: (n: number) => `${f.int(n)} ${f.plural(n, 'wave', 'waves')}`,
    seconds: (n: number) => `${f.fixed(n, 1)} s`,
  },
};

export type Messages = typeof en;
