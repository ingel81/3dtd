'use strict';

/**
 * The only bridge between the game and Electron. The page runs sandboxed with
 * context isolation; whatever it may know about the desktop build is listed
 * here and nowhere else. The game reads it in one place, its update hint.
 */

const { contextBridge, ipcRenderer } = require('electron');

const VERSION_ARG = '--desktop-version=';
const versionArg = process.argv.find((arg) => arg.startsWith(VERSION_ARG));

// Registered before the page runs, so an update the main process reports
// while the page still loads is kept and handed to the first listener.
let readyUpdate = null;
const listeners = new Set();
ipcRenderer.on('desktop:update-ready', (_event, update) => {
  readyUpdate = { version: String(update?.version ?? ''), notes: String(update?.notes ?? '') };
  for (const listener of listeners) listener(readyUpdate);
});

contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    version: versionArg ? versionArg.slice(VERSION_ARG.length) : '',

    /** Calls `listener` with { version } once an update is downloaded; returns an unsubscribe. */
    onUpdateReady(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      if (readyUpdate) listener(readyUpdate);
      return () => listeners.delete(listener);
    },

    /** Quit now and install the downloaded update; the app starts again afterwards. */
    installUpdateNow() {
      ipcRenderer.send('desktop:install-update');
    },
  })
);
