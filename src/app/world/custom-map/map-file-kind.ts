import type { MapFault, MapProblem, MapStoreText } from './map-text';

/**
 * What the code around a `.3dtdmap` file needs without reading one: its
 * extension and the error an invalid map throws. Apart from map-file.ts
 * (zip, repair, check), which the map store and the menu load only when they
 * read or write a map (`import()`), so the page's first load does without it.
 */

export const MAP_FILE_EXTENSION = '.3dtdmap';

/**
 * A file that is no map, or a map that is not whole: why as data (`fault`,
 * the problems of a map that does not hold), worded where it is shown
 * (map-text.ts mapFaultText, mapErrorMessage); the message is its key, for logs
 */
export class MapFileError extends Error {
  constructor(
    readonly fault: MapFault,
    readonly problems: readonly MapProblem[] = [],
  ) {
    super(`map-file:${String(fault.key)}`);
    this.name = 'MapFileError';
  }
}

/** What the map store refuses or could not do, as data (map-text.ts mapErrorMessage words it); the message is its key, for logs */
export class MapStoreError extends Error {
  override name = 'MapStoreError';

  constructor(readonly said: MapStoreText) {
    super(`map-store:${String(said.key)}`);
  }
}
