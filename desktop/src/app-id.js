'use strict';

/**
 * The app's identity towards Windows: the installer registers it
 * (electron-builder appId), notifications are sent under it
 * (app.setAppUserModelId) and the updater recognises the installation by it.
 * Never change it once a release is out, or installed copies stop receiving
 * updates.
 */
const APP_ID = 'net.sgeht.3dtd';

module.exports = { APP_ID };
