/**
 * What a coop player plays with (docs/COOP_PLAN.md, lobby wishes): browser
 * or desktop build, its version, the operating system. The lobby shows it,
 * the relay logs it, and players on different engines get a hint: Chrome and
 * Firefox compute the simulation slightly differently, the games drift
 * apart (C5, D29).
 *
 * Read from the user agent string, which every engine sends; framework-free
 * so the relay's specs can use it.
 */
export interface ClientInfo {
  /** "Chrome", "Edge", "Firefox", "Safari", "Electron", or "Browser" when none of those */
  engine: string;
  /** Its version as the user agent gives it; "" when unknown */
  version: string;
  /** JavaScript engine family: the one thing that decides whether two clients compute alike */
  family: 'blink' | 'gecko' | 'webkit' | 'other';
  /** "Windows", "macOS", "Linux", "Android", "iOS", "ChromeOS", or "" */
  os: string;
}

const match = (ua: string, re: RegExp): string | null => re.exec(ua)?.[1] ?? null;

/** The client info a user agent string gives. */
export function clientInfoFrom(ua: string): ClientInfo {
  const os = /Windows/.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
        : /Android/.test(ua) ? 'Android'
          : /CrOS/.test(ua) ? 'ChromeOS'
            : /Linux/.test(ua) ? 'Linux' : '';

  const electron = match(ua, /Electron\/([\d.]+)/);
  if (electron !== null) {
    const chromium = match(ua, /Chrome\/(\d+)/);
    return { engine: 'Electron', version: chromium ? `${electron}, Chromium ${chromium}` : electron, family: 'blink', os };
  }
  const firefox = match(ua, /Firefox\/([\d.]+)/);
  if (firefox !== null) return { engine: 'Firefox', version: firefox, family: 'gecko', os };
  const edge = match(ua, /Edg\/([\d.]+)/);
  if (edge !== null) return { engine: 'Edge', version: edge, family: 'blink', os };
  const chrome = match(ua, /Chrome\/([\d.]+)/);
  if (chrome !== null) return { engine: 'Chrome', version: chrome, family: 'blink', os };
  const safari = match(ua, /Version\/([\d.]+).*Safari/);
  if (safari !== null) return { engine: 'Safari', version: safari, family: 'webkit', os };
  return { engine: 'Browser', version: '', family: 'other', os };
}

/** "Chrome 140.0.0.0, Windows" */
export function clientLabel(info: ClientInfo): string {
  const name = info.version ? `${info.engine} ${info.version}` : info.engine;
  return info.os ? `${name}, ${info.os}` : name;
}

/** Players whose clients may compute differently: more than one engine family among them. */
export function mixedEngines(infos: readonly (ClientInfo | null)[]): boolean {
  return new Set(infos.filter((info) => info !== null).map((info) => info!.family)).size > 1;
}
