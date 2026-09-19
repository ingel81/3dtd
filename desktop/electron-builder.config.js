'use strict';

/**
 * electron-builder configuration.
 *
 * JavaScript instead of YAML so the version can come from the root
 * package.json: the game, the installer and the updater all read that one
 * number, and desktop/package.json deliberately has none to forget.
 */

const rootPackage = require('../package.json');
const { APP_ID } = require('./src/app-id');

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: APP_ID,
  productName: '3DTD',
  copyright: 'Copyright © 2026 ingel81',
  extraMetadata: { version: rootPackage.version },

  directories: { output: 'release', buildResources: 'build' },
  files: ['src/**/*', 'app/**/*', 'package.json'],
  asar: true,
  // Next to 3DTD.exe: the game's licence and those of the libraries bundled into
  // it (Angular's build lists them). Electron's and Chromium's come with Electron.
  extraFiles: [
    { from: '../LICENSE', to: 'LICENSE.txt' },
    { from: '../dist/3DTD/3rdpartylicenses.txt', to: 'THIRD-PARTY-LICENSES.txt' },
  ],
  // Chromium's own strings (native dialogs). The game is English; the
  // other ~50 locales are 47 MB nobody reads.
  electronLanguages: ['en-US', 'de'],

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // build/icon.ico, electron-builder's default; made by scripts/make-icon.sh.
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    artifactName: '${productName}-Setup-${version}.${ext}',
  },

  // Where electron-updater looks for new versions: the releases of the
  // public repository, no token needed. Written into the app as
  // app-update.yml; `--publish never` builds still carry it.
  publish: [{ provider: 'github', owner: 'ingel81', repo: '3dtd' }],

  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
};
