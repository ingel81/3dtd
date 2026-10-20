import type { NominatimAddress } from './geocoding.service';

/** "6", "12a", "3-5": a part of an address line that is only a house number */
const HOUSE_NUMBER = /^\d{1,3}\s?[a-z]?(\s?[-/]\s?\d{1,3}\s?[a-z]?)?$/i;

/** "12345", "1010": a part that is only a postcode */
const POSTCODE = /^\d{4,}(-\d+)?$/;

/** "49.1234, 9.1234": a place without a geocoded name */
const COORDINATES = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/;

/**
 * The name of a geocoded place as the search list shows it: "Am Thorwengert
 * 6, Miltenberg" (street and house number, then the locality) from the
 * result's address details, else from its address line. Nominatim writes a
 * house first ("6, Am Thorwengert, Miltenberg-Nord, ..."), so the first
 * comma part of the line is no name: a bare house number goes behind the
 * street that follows it, a postcode before the name goes. A line without
 * a street or a house number keeps its first part ("Miltenberg" of
 * "Miltenberg, Bayern, Deutschland"), coordinates stay as they are.
 */
export function placeLabel(line: string, address?: NominatimAddress): string {
  if (address) {
    const street = address.road ? (address.house_number ? `${address.road} ${address.house_number}` : address.road) : '';
    const locality = address.city || address.town || address.village || address.municipality || address.suburb || address.county || '';
    const label = [street, locality].filter((part) => part.trim() !== '').join(', ');
    if (label) return label;
  }
  if (COORDINATES.test(line.trim())) return line.trim();
  const parts = line.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (!parts.length) return line.trim();
  if (parts.length >= 2 && POSTCODE.test(parts[0])) parts.shift();
  if (parts.length >= 2 && HOUSE_NUMBER.test(parts[0])) parts.splice(0, 2, `${parts[1]} ${parts[0]}`);
  // A street with its number names the place with the locality after it; a name alone stands for itself
  return /\d/.test(parts[0]) && parts.length >= 2 ? `${parts[0]}, ${parts[1]}` : parts[0];
}
