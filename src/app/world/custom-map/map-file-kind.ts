/**
 * What the code around a `.3dtdmap` file needs without reading one: its
 * extension and the error an invalid map throws. Apart from map-file.ts
 * (zip, repair, check), which the map store and the menu load only when they
 * read or write a map (`import()`), so the page's first load does without it.
 */

export const MAP_FILE_EXTENSION = '.3dtdmap';

export class MapFileError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [message],
  ) {
    super(message);
    this.name = 'MapFileError';
  }
}
