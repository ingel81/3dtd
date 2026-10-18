import { formatters } from '../format';
import type { Messages } from './en';

const f = formatters('de');

/** Die Texte auf Deutsch; Begriffe nach dem Glossar in docs/I18N_PLAN.md */
export const de: Messages = {
  common: {
    ok: 'OK',
    cancel: 'Abbrechen',
    close: 'Schließen',
    back: 'Zurück',
    continue: 'Weiter',
    save: 'Speichern',
    delete: 'Löschen',
    retry: 'Nochmal',
  },
  settings: {
    language: 'Sprache',
    languageSystem: (name) => `System (${name})`,
  },
  coop: {
    runLogSent: 'Laufbericht gesendet. Danke!',
    runLogRefused: (why) => `Der Laufbericht wurde nicht angenommen: ${why}`,
    runLogRefusals: {
      'not-collected': 'dieser Koop-Server sammelt keine Laufberichte',
      'too-many': 'zu viele aus diesem Spiel',
      busy: 'der Koop-Server ist gerade ausgelastet, versuch es später',
      invalid: 'das ist kein lesbarer Laufbericht',
      'already-sent': 'er kam schon an',
      failed: 'der Koop-Server konnte ihn nicht speichern',
    },
  },
  units: {
    waves: (n) => `${f.int(n)} ${f.plural(n, 'Welle', 'Wellen')}`,
    seconds: (n) => `${f.fixed(n, 1)} s`,
  },
};
