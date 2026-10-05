/**
 * Short names for saves. The place a save keeps is the header's name,
 * "Street 51, Town, Country" (GeocodingService.formatAddressShort); a slot
 * name or a line in the menu needs only the town.
 */

/** "49.1234, 9.1234": a place without a geocoded name */
const COORDINATES = /^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/;

/**
 * The town of a place name: "Hauptstraße 51, Bad Wimpfen, Deutschland" is
 * "Bad Wimpfen", "Bad Wimpfen, Deutschland" too. A name of one part and
 * coordinates stay as they are.
 */
export function shortPlaceName(place: string): string {
  const name = place.trim();
  if (COORDINATES.test(name)) return name;
  const parts = name.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length === 2) return parts[0];
  return name;
}

/** The name a save gets when the player gives none: "Bad Wimpfen, wave 2" */
export function defaultSlotName(place: string, wave: number): string {
  return `${shortPlaceName(place)}, wave ${wave}`;
}
