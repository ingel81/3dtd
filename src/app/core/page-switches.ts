/**
 * The switches of development in the address (`?devworld`, `?bot=`,
 * `?benchmark`, `?quality=`, `?waves=` ...). They stay in it for the page's
 * life (a bot tab reloads on them), so these read the address itself. With
 * WorldStartService, which reads a link's start order once, the only readers
 * of `location.search` (page-switches.guard.spec.ts); no imports, the sim
 * worker's code may use them.
 */
export function pageSwitches(): URLSearchParams {
  return new URLSearchParams(pageQuery());
}

/** The query of pageSwitches as a string, for the parsers that take one */
export function pageQuery(): string {
  return typeof location === 'undefined' ? '' : location.search;
}
