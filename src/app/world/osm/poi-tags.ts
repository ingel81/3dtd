/**
 * What a point of interest of an OSM world is and how its front looks
 * (docs/OSM_WORLD_ROUND2_PLAN.md, E239): the kind of shop, inn or service
 * from `shop`, `amenity`, `craft`, `office`, `tourism` and `healthcare`,
 * the word its sign writes in the place's language, its pictogram, and
 * whether it gets a shopfront, an awning, tables outside, a hanging sign.
 *
 * Signs name the kind only ("Bäckerei", "Boulangerie"), never the shop's
 * name or brand (user, 2026-10-18). Data only, like land-tags.ts:
 * convert/pois.ts lays it out.
 */
import type { OsmFrame } from './osm-parse';

/** The languages signs are written in */
export type SignLanguage = 'de' | 'fr' | 'nl' | 'it' | 'es' | 'en';

export type PoiWords = Readonly<Record<SignLanguage, string>>;

export interface PoiCategory {
  id: string;
  words: PoiWords;
  /** A pictogram of render/objects/sign-icons.ts */
  icon: string;
  /** A glazed shopfront on a facade without its own (a shop, not an office or a practice) */
  front: boolean;
  /** An awning over the front: its colour, 'any' for one of AWNING_COLOURS by the place, absent for none */
  awning?: string;
  /** Tables outside where OSM says `outdoor_seating=yes`: bistro sets or beer table sets */
  seating?: 'cafe' | 'beer';
  /** May hang a wrought-iron sign from the wall instead of the board (an old town's inn, baker, pharmacy) */
  bracket?: boolean;
  /** The board's colour (the sign's tint), else one of BOARD_COLOURS by the place */
  board?: string;
  /** Lower comes first when the signs run past their cap */
  rank: number;
}

/** Awning colours of a street: muted, tone on tone with the model's stripes */
export const AWNING_COLOURS: readonly string[] = ['#7a2e2a', '#2f5446', '#3c4a63', '#8a6a32', '#5a3048', '#46533a', '#6b4a32'];
/** Sign boards: dark lacquer mostly, now and then cream with dark writing */
export const BOARD_COLOURS: readonly string[] = ['#2a2e31', '#3b2a22', '#23343a', '#e6dcc5', '#4a2a2a', '#2c3b2c', '#d9cfb4'];

const w = (de: string, fr: string, nl: string, it: string, es: string, en: string): PoiWords => ({ de, fr, nl, it, es, en });

/** The kinds, by id */
export const POI_CATEGORIES: Readonly<Record<string, PoiCategory>> = Object.fromEntries(
  (
    [
      { id: 'bakery', words: w('Bäckerei', 'Boulangerie', 'Bakkerij', 'Panetteria', 'Panadería', 'Bakery'), icon: 'pretzel', front: true, awning: '#6b4a32', bracket: true, rank: 0 },
      { id: 'pastry', words: w('Konditorei', 'Pâtisserie', 'Banketbakker', 'Pasticceria', 'Pastelería', 'Cake shop'), icon: 'cake', front: true, awning: '#7a4652', seating: 'cafe', rank: 1 },
      { id: 'butcher', words: w('Metzgerei', 'Boucherie', 'Slagerij', 'Macelleria', 'Carnicería', 'Butcher'), icon: 'butcher', front: true, awning: '#7a2e2a', bracket: true, rank: 1 },
      { id: 'inn', words: w('Gasthaus', 'Auberge', 'Herberg', 'Trattoria', 'Mesón', 'Inn'), icon: 'beer', front: false, seating: 'beer', bracket: true, board: '#3b2a22', rank: 0 },
      { id: 'restaurant', words: w('Restaurant', 'Restaurant', 'Restaurant', 'Ristorante', 'Restaurante', 'Restaurant'), icon: 'cutlery', front: false, awning: 'any', seating: 'cafe', bracket: true, rank: 1 },
      { id: 'cafe', words: w('Café', 'Café', 'Koffiehuis', 'Caffè', 'Cafetería', 'Café'), icon: 'cup', front: true, awning: 'any', seating: 'cafe', rank: 0 },
      { id: 'pub', words: w('Kneipe', 'Bistrot', 'Café', 'Pub', 'Taberna', 'Pub'), icon: 'beer', front: false, seating: 'beer', bracket: true, board: '#2a2e31', rank: 1 },
      { id: 'biergarten', words: w('Biergarten', 'Brasserie', 'Biertuin', 'Birreria', 'Cervecería', 'Beer garden'), icon: 'beer', front: false, seating: 'beer', rank: 1 },
      { id: 'bar', words: w('Bar', 'Bar', 'Bar', 'Bar', 'Bar', 'Bar'), icon: 'cocktail', front: false, seating: 'cafe', board: '#23343a', rank: 2 },
      { id: 'wine', words: w('Weinstube', 'Cave à vin', 'Wijnbar', 'Enoteca', 'Vinoteca', 'Wine bar'), icon: 'wine', front: false, seating: 'cafe', bracket: true, board: '#4a2a2a', rank: 1 },
      { id: 'snack', words: w('Imbiss', 'Snack', 'Snackbar', 'Rosticceria', 'Bocatería', 'Snack bar'), icon: 'snack', front: true, awning: 'any', rank: 2 },
      { id: 'icecream', words: w('Eiscafé', 'Glacier', 'IJssalon', 'Gelateria', 'Heladería', 'Ice cream'), icon: 'icecream', front: true, awning: '#3c4a63', seating: 'cafe', rank: 0 },
      { id: 'supermarket', words: w('Supermarkt', 'Supermarché', 'Supermarkt', 'Supermercato', 'Supermercado', 'Supermarket'), icon: 'basket', front: true, rank: 1 },
      { id: 'grocery', words: w('Lebensmittel', 'Épicerie', 'Buurtwinkel', 'Alimentari', 'Ultramarinos', 'Grocery'), icon: 'basket', front: true, awning: 'any', rank: 1 },
      { id: 'greengrocer', words: w('Obst & Gemüse', 'Primeur', 'Groenteboer', 'Frutta e verdura', 'Frutería', 'Greengrocer'), icon: 'apple', front: true, awning: '#46533a', rank: 1 },
      { id: 'deli', words: w('Feinkost', 'Traiteur', 'Delicatessen', 'Gastronomia', 'Charcutería', 'Delicatessen'), icon: 'cheese', front: true, awning: 'any', rank: 2 },
      { id: 'drinks', words: w('Getränke', 'Boissons', 'Dranken', 'Bevande', 'Bebidas', 'Drinks'), icon: 'wine', front: true, rank: 3 },
      { id: 'kiosk', words: w('Kiosk', 'Presse', 'Kiosk', 'Edicola', 'Quiosco', 'Newsagent'), icon: 'newspaper', front: true, awning: 'any', rank: 2 },
      { id: 'tobacco', words: w('Tabak', 'Tabac', 'Tabak', 'Tabacchi', 'Estanco', 'Tobacconist'), icon: 'pipe', front: true, rank: 2 },
      { id: 'fashion', words: w('Mode', 'Mode', 'Mode', 'Moda', 'Moda', 'Fashion'), icon: 'hanger', front: true, rank: 2 },
      { id: 'shoes', words: w('Schuhe', 'Chaussures', 'Schoenen', 'Calzature', 'Zapatería', 'Shoes'), icon: 'shoe', front: true, rank: 3 },
      { id: 'hairdresser', words: w('Friseur', 'Coiffeur', 'Kapper', 'Parrucchiere', 'Peluquería', 'Hairdresser'), icon: 'scissors', front: true, rank: 2 },
      { id: 'pharmacy', words: w('Apotheke', 'Pharmacie', 'Apotheek', 'Farmacia', 'Farmacia', 'Pharmacy'), icon: 'cross', front: true, bracket: true, board: '#2f6a3c', rank: 0 },
      { id: 'chemist', words: w('Drogerie', 'Droguerie', 'Drogisterij', 'Drogheria', 'Droguería', 'Chemist'), icon: 'bottle', front: true, rank: 2 },
      { id: 'optician', words: w('Optiker', 'Opticien', 'Opticien', 'Ottica', 'Óptica', 'Optician'), icon: 'glasses', front: true, rank: 2 },
      { id: 'jeweller', words: w('Schmuck', 'Bijouterie', 'Juwelier', 'Gioielleria', 'Joyería', 'Jeweller'), icon: 'ring', front: true, rank: 3 },
      { id: 'books', words: w('Bücher', 'Librairie', 'Boekhandel', 'Libreria', 'Librería', 'Books'), icon: 'book', front: true, awning: 'any', rank: 2 },
      { id: 'florist', words: w('Blumen', 'Fleuriste', 'Bloemist', 'Fiorista', 'Floristería', 'Florist'), icon: 'flower', front: true, awning: '#46533a', rank: 1 },
      { id: 'gifts', words: w('Geschenke', 'Souvenirs', 'Cadeaus', 'Souvenir', 'Regalos', 'Gifts'), icon: 'gift', front: true, awning: 'any', rank: 3 },
      { id: 'electronics', words: w('Elektronik', 'Électronique', 'Elektronica', 'Elettronica', 'Electrónica', 'Electronics'), icon: 'plug', front: true, rank: 3 },
      { id: 'bicycles', words: w('Fahrräder', 'Cycles', 'Fietsen', 'Biciclette', 'Bicicletas', 'Bicycles'), icon: 'bicycle', front: true, rank: 2 },
      { id: 'hardware', words: w('Eisenwaren', 'Quincaillerie', 'IJzerwaren', 'Ferramenta', 'Ferretería', 'Hardware'), icon: 'key', front: true, rank: 3 },
      { id: 'garage', words: w('Werkstatt', 'Garage', 'Garage', 'Officina', 'Taller', 'Garage'), icon: 'wrench', front: false, rank: 3 },
      { id: 'craft', words: w('Handwerk', 'Atelier', 'Werkplaats', 'Bottega', 'Taller', 'Workshop'), icon: 'wrench', front: false, bracket: true, rank: 4 },
      { id: 'gallery', words: w('Galerie', 'Galerie', 'Galerie', 'Galleria', 'Galería', 'Gallery'), icon: 'frame', front: true, rank: 3 },
      { id: 'laundry', words: w('Wäscherei', 'Laverie', 'Wasserette', 'Lavanderia', 'Lavandería', 'Laundry'), icon: 'hanger', front: true, rank: 4 },
      { id: 'shop', words: w('Laden', 'Boutique', 'Winkel', 'Negozio', 'Tienda', 'Shop'), icon: 'bag', front: true, rank: 4 },
      { id: 'bank', words: w('Bank', 'Banque', 'Bank', 'Banca', 'Banco', 'Bank'), icon: 'coin', front: false, board: '#1f3550', rank: 1 },
      { id: 'post', words: w('Post', 'Poste', 'Post', 'Poste', 'Correos', 'Post office'), icon: 'envelope', front: false, board: '#8a6a22', rank: 1 },
      { id: 'hotel', words: w('Hotel', 'Hôtel', 'Hotel', 'Albergo', 'Hotel', 'Hotel'), icon: 'bed', front: false, bracket: true, board: '#23343a', rank: 1 },
      { id: 'guesthouse', words: w('Pension', "Chambres d'hôtes", 'Pension', 'Pensione', 'Pensión', 'Guest house'), icon: 'bed', front: false, bracket: true, rank: 2 },
      { id: 'doctor', words: w('Arztpraxis', 'Médecin', 'Huisarts', 'Medico', 'Médico', 'Doctor'), icon: 'doctor', front: false, board: '#e6dcc5', rank: 3 },
      { id: 'dentist', words: w('Zahnarzt', 'Dentiste', 'Tandarts', 'Dentista', 'Dentista', 'Dentist'), icon: 'tooth', front: false, board: '#e6dcc5', rank: 3 },
      { id: 'museum', words: w('Museum', 'Musée', 'Museum', 'Museo', 'Museo', 'Museum'), icon: 'columns', front: false, board: '#2a2e31', rank: 1 },
      { id: 'office', words: w('Büro', 'Bureau', 'Kantoor', 'Ufficio', 'Oficina', 'Office'), icon: 'briefcase', front: false, board: '#d9cfb4', rank: 5 },
      { id: 'fuel', words: w('Tankstelle', 'Station-service', 'Tankstation', 'Distributore', 'Gasolinera', 'Petrol station'), icon: 'fuel', front: false, rank: 1 },
    ] satisfies PoiCategory[]
  ).map((c) => [c.id, c]),
);

const SHOPS: Readonly<Record<string, string>> = {
  bakery: 'bakery', pastry: 'pastry', confectionery: 'pastry', chocolate: 'pastry', butcher: 'butcher',
  supermarket: 'supermarket', convenience: 'grocery', general: 'grocery', greengrocer: 'greengrocer', farm: 'greengrocer',
  deli: 'deli', cheese: 'deli', seafood: 'deli', tea: 'deli', coffee: 'deli', spices: 'deli', beverages: 'drinks', wine: 'drinks', alcohol: 'drinks',
  kiosk: 'kiosk', newsagent: 'kiosk', tobacco: 'tobacco', e_cigarette: 'tobacco',
  clothes: 'fashion', boutique: 'fashion', fashion_accessories: 'fashion', bag: 'fashion', fabric: 'fashion', tailor: 'fashion', shoes: 'shoes',
  hairdresser: 'hairdresser', beauty: 'hairdresser', cosmetics: 'chemist', chemist: 'chemist', perfumery: 'chemist', medical_supply: 'chemist',
  optician: 'optician', jewelry: 'jeweller', watches: 'jeweller', books: 'books', stationery: 'books', florist: 'florist', garden_centre: 'florist',
  gift: 'gifts', souvenir: 'gifts', toys: 'gifts', art: 'gallery', antiques: 'gallery', frame: 'gallery', photo: 'gallery',
  electronics: 'electronics', mobile_phone: 'electronics', computer: 'electronics', hifi: 'electronics', bicycle: 'bicycles',
  hardware: 'hardware', doityourself: 'hardware', locksmith: 'hardware', houseware: 'hardware', car_repair: 'garage', tyres: 'garage',
  laundry: 'laundry', dry_cleaning: 'laundry',
};
const AMENITIES: Readonly<Record<string, string>> = {
  cafe: 'cafe', pub: 'pub', bar: 'bar', biergarten: 'biergarten', fast_food: 'snack', ice_cream: 'icecream',
  pharmacy: 'pharmacy', bank: 'bank', post_office: 'post', doctors: 'doctor', clinic: 'doctor', dentist: 'dentist', fuel: 'fuel',
};
const TOURISM: Readonly<Record<string, string>> = { hotel: 'hotel', motel: 'hotel', hostel: 'guesthouse', guest_house: 'guesthouse', apartment: 'guesthouse', museum: 'museum', gallery: 'gallery' };
const HEALTHCARE: Readonly<Record<string, string>> = { pharmacy: 'pharmacy', doctor: 'doctor', dentist: 'dentist', clinic: 'doctor' };
/** Shops that are no shop (yet, any more) */
const NO_SHOP = new Set(['vacant', 'no', 'yes;vacant', 'disused']);
/** Cuisines of an inn rather than a restaurant (German or regional food) */
const INN_CUISINE = /(^|;)\s*(german|regional|bavarian|franconian|austrian|swabian|local)\s*($|;)/;

/** The kind of a POI from its tags, null for none the world draws */
export function poiCategory(tags: Readonly<Record<string, string>>): PoiCategory | null {
  const amenity = tags['amenity'];
  if (amenity === 'restaurant') return POI_CATEGORIES[INN_CUISINE.test(tags['cuisine'] ?? '') ? 'inn' : 'restaurant'];
  if (amenity && AMENITIES[amenity]) {
    if (amenity === 'pub' && tags['microbrewery'] === 'yes') return POI_CATEGORIES['biergarten'];
    if (amenity === 'bar' && (tags['bar'] === 'wine' || tags['drink:wine'] === 'yes')) return POI_CATEGORIES['wine'];
    return POI_CATEGORIES[AMENITIES[amenity]];
  }
  const shop = tags['shop'];
  if (shop && !NO_SHOP.has(shop) && !tags['disused:shop']) return POI_CATEGORIES[SHOPS[shop] ?? 'shop'];
  const health = tags['healthcare'];
  if (health && HEALTHCARE[health]) return POI_CATEGORIES[HEALTHCARE[health]];
  const tourism = tags['tourism'];
  if (tourism && TOURISM[tourism]) return POI_CATEGORIES[TOURISM[tourism]];
  if (tags['craft']) return POI_CATEGORIES[tags['craft'] === 'winery' ? 'wine' : tags['craft'] === 'bakery' ? 'bakery' : tags['craft'] === 'butcher' ? 'butcher' : 'craft'];
  if (tags['office'] && tags['office'] !== 'vacant') return POI_CATEGORIES['office'];
  return null;
}

// ---- The place's language ----

/** Country outlines, coarse (a few dozen points each, lon and lat), and their sign language; checked in this order */
const COUNTRIES: readonly { lang: SignLanguage | ((lon: number, lat: number) => SignLanguage); ring: readonly number[] }[] = [
  // The Netherlands
  { lang: 'nl', ring: [3.4, 51.4, 3.9, 51.25, 4.8, 51.45, 5.8, 51.15, 5.85, 50.75, 6.05, 50.8, 6.0, 51.8, 6.8, 51.95, 7.05, 52.25, 7.2, 53.2, 6.9, 53.55, 4.8, 53.45, 4.4, 52.5, 3.6, 51.9] },
  // Belgium: Dutch in the north, French in the south and in Brussels
  { lang: (lon, lat) => (lat > 50.78 && !(lon > 4.25 && lon < 4.5 && lat < 50.92) ? 'nl' : 'fr'), ring: [2.55, 51.1, 3.4, 51.4, 3.9, 51.25, 4.8, 51.45, 5.8, 51.15, 5.85, 50.75, 6.4, 50.3, 5.8, 49.5, 4.85, 50.0, 4.2, 49.95] },
  // Luxembourg
  { lang: 'fr', ring: [5.75, 49.45, 6.4, 49.45, 6.5, 49.8, 6.1, 50.18, 5.75, 49.9] },
  // Germany
  {
    lang: 'de',
    ring: [
      5.9, 50.3, 5.98, 50.78, 6.05, 51.8, 6.8, 51.95, 7.05, 52.25, 7.2, 53.25, 8.0, 53.6, 8.6, 54.9, 9.9, 54.85, 11.0, 54.05, 13.0, 54.65, 14.25, 53.9,
      14.4, 53.3, 14.1, 52.8, 14.65, 52.55, 14.8, 51.0, 14.3, 50.9, 12.6, 50.35, 12.1, 50.3, 13.0, 49.6, 13.85, 48.8, 13.0, 48.3, 12.8, 47.6,
      12.2, 47.7, 10.9, 47.45, 10.2, 47.3, 9.6, 47.55, 8.6, 47.6, 7.6, 47.58, 7.6, 48.1, 8.2, 48.95, 6.4, 49.2, 6.1, 49.5, 6.4, 49.8,
    ],
  },
  // Austria
  { lang: 'de', ring: [9.5, 47.3, 9.6, 47.55, 10.2, 47.3, 10.9, 47.45, 12.2, 47.7, 12.8, 47.6, 13.0, 48.3, 13.85, 48.8, 14.9, 49.0, 16.95, 48.65, 17.15, 48.0, 16.1, 46.85, 14.6, 46.4, 13.7, 46.5, 12.2, 46.95, 10.5, 46.85, 9.5, 47.05] },
  // Switzerland: French in the west, Italian in the south, German in the rest
  {
    lang: (lon, lat) => (lon < 7.25 && lat < 47.3 ? 'fr' : lat < 46.45 && lon > 8.4 ? 'it' : 'de'),
    ring: [6.0, 46.4, 6.9, 47.4, 7.6, 47.58, 8.6, 47.6, 9.6, 47.55, 9.5, 47.05, 10.5, 46.85, 10.1, 46.2, 9.0, 45.82, 8.4, 46.3, 7.0, 45.9, 6.8, 46.0],
  },
  // France (mainland)
  {
    lang: 'fr',
    ring: [
      -4.8, 48.4, -1.8, 49.7, 1.6, 50.9, 2.55, 51.1, 4.2, 49.95, 4.85, 50.0, 5.8, 49.5, 6.4, 49.2, 8.2, 48.95, 7.6, 47.58, 6.9, 47.4, 6.0, 46.4,
      6.8, 46.0, 7.0, 44.2, 7.6, 43.8, 6.5, 43.0, 3.2, 43.0, 3.0, 42.4, 1.7, 42.45, -1.8, 43.4, -1.2, 46.2, -2.3, 47.2, -4.8, 47.9,
    ],
  },
  // Italy, Spain: boxes after their neighbours above
  { lang: 'it', ring: [6.6, 36.6, 18.6, 36.6, 18.6, 47.1, 6.6, 47.1] },
  { lang: 'es', ring: [-9.3, 36.0, 3.3, 36.0, 3.3, 43.8, -9.3, 43.8] },
];

/** `addr:country` codes and their language */
const COUNTRY_CODES: Readonly<Record<string, SignLanguage>> = { DE: 'de', AT: 'de', LI: 'de', FR: 'fr', LU: 'fr', MC: 'fr', NL: 'nl', IT: 'it', SM: 'it', ES: 'es' };

function inRing(lon: number, lat: number, ring: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const yi = ring[i + 1];
    const xj = ring[j];
    const yj = ring[j + 1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The language at a place from its coarse country outline; English elsewhere */
export function placeLanguage(lat: number, lon: number): SignLanguage {
  for (const c of COUNTRIES) {
    if (inRing(lon, lat, c.ring)) return typeof c.lang === 'function' ? c.lang(lon, lat) : c.lang;
  }
  return 'en';
}

/**
 * The language a place's signs are written in: the most common
 * `addr:country` of its tagged elements where it names one of ours (an
 * outline's coarse border), else the outline the frame's middle lies in
 */
export function signLanguage(frame: Pick<OsmFrame, 'lat' | 'lon'>, tagged: Iterable<{ tags: Readonly<Record<string, string>> }>): SignLanguage {
  const counts = new Map<string, number>();
  let seen = 0;
  for (const e of tagged) {
    const c = e.tags['addr:country'];
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
    if (++seen >= 2000) break;
  }
  let best: string | null = null;
  for (const [c, n] of counts) if (!best || n > counts.get(best)!) best = c;
  // Belgium and Switzerland speak more than one: their outlines decide
  if (best && COUNTRY_CODES[best.toUpperCase()]) return COUNTRY_CODES[best.toUpperCase()];
  return placeLanguage(frame.lat, frame.lon);
}
