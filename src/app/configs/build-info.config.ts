import { version } from '../../../package.json';

/**
 * Version shown to the player: loading screen corner and sidebar footer; the
 * bot server gets it as the game version. Read from package.json, the
 * one version the game, the desktop installer and its updater share. The
 * build takes only this field of the file into the bundle.
 */
export const BUILD_VERSION = `v${version}`;
