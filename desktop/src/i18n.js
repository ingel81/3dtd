'use strict';

/**
 * The desktop app's own words, English and German (TODO E245,
 * docs/I18N_PLAN.md 4.9): the error page, the save dialog, the download
 * note and the question before leaving the map editor. The game tells the
 * main process its language through the preload (`setLocale`); until it
 * does, the system's languages decide. A language the app has no words for
 * (the game's pseudo language) keeps the one before.
 */
const WORDS = {
  en: {
    loadFailed: 'The game could not be loaded',
    stopped: 'The game stopped',
    errorHelp: 'Reloading usually helps. If it keeps happening, please open an issue on GitHub with what you did and this line:',
    logAt: (dir) => `The log file is in ${dir}; Ctrl+Shift+L opens the folder.`,
    reload: 'Reload',
    saveFile: 'Save file',
    savedToDownloads: 'Saved to Downloads',
    leave: 'Leave',
    stay: 'Stay',
    leaveEditor: 'Leave the map editor?',
    stillSaving: 'The editor is still saving your last changes.',
  },
  de: {
    loadFailed: 'Das Spiel ließ sich nicht laden',
    stopped: 'Das Spiel wurde beendet',
    errorHelp: 'Neu laden hilft meistens. Passiert es wieder, öffne bitte ein Issue auf GitHub mit dem, was du getan hast, und dieser Zeile:',
    logAt: (dir) => `Die Logdatei liegt in ${dir}; Strg+Umschalt+L öffnet den Ordner.`,
    reload: 'Neu laden',
    saveFile: 'Datei speichern',
    savedToDownloads: 'In Downloads gespeichert',
    leave: 'Verlassen',
    stay: 'Bleiben',
    leaveEditor: 'Karteneditor verlassen?',
    stillSaving: 'Der Editor speichert noch deine letzten Änderungen.',
  },
};

let current = 'en';

/** The first of `tags` ("de-AT", "en-US") the app has words for, by its main tag; English else */
function pickLocale(tags) {
  for (const tag of tags ?? []) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (Object.hasOwn(WORDS, base)) return base;
  }
  return 'en';
}

/** The game's language; one the app has no words for changes nothing */
function setLocale(locale) {
  if (Object.hasOwn(WORDS, locale)) current = locale;
}

/** The words of the language in use */
function words() {
  return WORDS[current];
}

module.exports = { WORDS, pickLocale, setLocale, words };
