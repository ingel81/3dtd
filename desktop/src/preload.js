'use strict';

/**
 * The only bridge between the game and Electron. The page runs sandboxed with
 * context isolation; whatever it may know about the desktop build is listed
 * here and nowhere else.
 */

const { contextBridge } = require('electron');

const VERSION_ARG = '--desktop-version=';
const versionArg = process.argv.find((arg) => arg.startsWith(VERSION_ARG));

contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    version: versionArg ? versionArg.slice(VERSION_ARG.length) : '',
  })
);
