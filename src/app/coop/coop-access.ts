/**
 * Where coop may be played (docs/COOP_PLAN.md, D52, D59): in the desktop
 * app, and on the dev game for tests. A browser on the site only points to
 * the app; its coop button stays as a showcase for it (E114).
 * Framework-free and pure.
 */

/** 'app': the desktop build; 'dev': the dev game on this machine; 'hint': any other browser */
export type CoopAccess = 'app' | 'dev' | 'hint';

/** Pages of the dev game: coop stays for tests, without a configured lobby over this machine's relay */
export const DEV_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/** Where the desktop app is downloaded, the same files the landing page offers */
export const APP_DOWNLOADS = {
  windows: 'https://github.com/ingel81/3dtd/releases/latest/download/3DTD-win-x64-setup.exe',
  linux: 'https://github.com/ingel81/3dtd/releases/latest/download/3DTD-x86_64.AppImage',
  all: 'https://github.com/ingel81/3dtd/releases/latest',
} as const;

export function coopAccess(desktop: boolean, hostname: string): CoopAccess {
  if (desktop) return 'app';
  return DEV_HOSTS.has(hostname) ? 'dev' : 'hint';
}
