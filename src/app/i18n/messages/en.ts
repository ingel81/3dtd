import type { RunLogRefusal } from '../../coop/protocol';
import { formatters } from '../format';

const f = formatters('en');

const runLogRefusals: Record<RunLogRefusal, string> = {
  'not-collected': 'this coop server collects no run logs',
  'too-many': 'too many sent from this game',
  busy: 'the coop server is busy, try again later',
  invalid: 'it is not a readable run log',
  'already-sent': 'it was sent already',
  failed: 'the coop server could not store it',
};

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
  coop: {
    runLogSent: 'Run log sent. Thanks!',
    /** `why` is a RunLogRefusal's text, or what an older relay said */
    runLogRefused: (why: string) => `The run log was not kept: ${why}`,
    runLogRefusals,
  },
  units: {
    waves: (n: number) => `${f.int(n)} ${f.plural(n, 'wave', 'waves')}`,
    seconds: (n: number) => `${f.fixed(n, 1)} s`,
  },
};

export type Messages = typeof en;
