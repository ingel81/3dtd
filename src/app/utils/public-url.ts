/** The game's public site: the landing page, and the address on saved pictures. */
export const SITE_URL = 'https://3dtd.sgeht.net';

/** The web version on the public site. */
export const PUBLIC_GAME_URL = `${SITE_URL}/play/`;

/**
 * `href` as a link someone else can open. A page served over http(s) links
 * to itself. A page without a web address, the desktop build on app://,
 * links to the same place on the public web version: the query carries the
 * whole location (l, s), the rest of the address means nothing outside the
 * app.
 */
export function shareableUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return href;
  return `${PUBLIC_GAME_URL}${url.search}`;
}
