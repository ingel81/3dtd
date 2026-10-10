export interface Attribution {
  name: string;
  author: string;
  license: string;
  licenseUrl?: string;
  sourceUrl?: string;
}

export interface AttributionCategory {
  title: string;
  icon: string;
  items: Attribution[];
}

/**
 * Credit for the OpenStreetMap data on the map (roads for the enemy routes, the street overlay),
 * shown beside Google's map attribution: the ODbL asks for it, and Google's tile policies ask that
 * the player can tell own map data from Google's.
 */
export const OSM_MAP_ATTRIBUTION = 'Routes © OpenStreetMap contributors';

export const ATTRIBUTIONS: AttributionCategory[] = [
  {
    title: '3D Models',
    icon: 'tower',
    items: [
      {
        name: 'Bat',
        author: 'Quaternius',
        license: 'CC0',
        sourceUrl: 'https://poly.pizza/m/hNO9XvjlKa',
      },
      {
        name: 'SWAT (Hero, recoloured, gun added)',
        author: 'Quaternius',
        license: 'CC0',
        sourceUrl: 'https://poly.pizza/m/Btfn3G5Xv4',
      },
      {
        name: 'Big Arm (Wallsmasher)',
        author: 'Quaternius',
        license: 'CC-BY 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
        sourceUrl: 'https://poly.pizza/m/KaVJET0WHx',
      },
      {
        name: 'Zombie',
        author: 'bachosoftdesign',
        license: 'CC-BY 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
        sourceUrl: 'https://poly.pizza/m/xqEzosAVYX',
      },
      {
        name: 'Tank',
        author: 'Quaternius',
        license: 'CC0',
        sourceUrl: 'https://poly.pizza/m/cW3zvvkMOM',
      },
      {
        name: 'Spider',
        author: 'Murat Can \u00dcNAL (avanar)',
        license: 'CC-BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        sourceUrl: 'https://sketchfab.com/3d-models/spider-164dec837ac040e0880169e0fe952a3d',
      },
      {
        name: 'Penguin',
        author: 'Mateus Schwaab (Mehrus)',
        license: 'CC-BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://sketchfab.com/3d-models/penguin-2c079bc491fb4bb4942c0f87927f8d87',
      },
      {
        name: 'Rat (Animated)',
        author: 'Shintokin',
        license: 'CC-BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://sketchfab.com/3d-models/rat-animated-cba5c3b8a946499083b4adfbb6d568b8',
      },
      {
        name: 'Zombie Soldier',
        author: 'Peter_D',
        license: 'CC-BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://sketchfab.com/3d-models/zombie-soldier-176e930e63d144cc8f615b8dd3a8c74f',
      },
      {
        name: 'Mammoth',
        author: 'slang107123456789',
        license: 'CC-BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://sketchfab.com/3d-models/mammoth-5e0a1d6bb8a74c0f906bafa34cffa0c5',
      },
      {
        name: 'Bear',
        author: 'krutoydenis123',
        license: 'CC-BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://sketchfab.com/3d-models/masha-and-the-bear-bear-bc27b449e8ba4ae098a0c972603492f8',
      },
      {
        name: 'Dragon',
        author: 'endlessvoidmc',
        license: 'CC-BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://sketchfab.com/3d-models/demon-dragon-full-texture-19035a72cdcb4abfa2c161de32823e6b',
      },
      {
        name: 'Tower Round Crystals (Chaos Tower)',
        author: 'Kenney',
        license: 'CC0',
        sourceUrl: 'https://kenney.nl/assets/tower-defense-kit',
      },
      {
        name: 'Skeleton (Graveyard Kit)',
        author: 'Kenney',
        license: 'CC0',
        sourceUrl: 'https://kenney.nl/assets/graveyard-kit',
      },
      {
        name: 'Stone Golem',
        author: 'ingel81',
        license: 'Original work',
      },
      {
        name: 'Herbert',
        author: 'ingel81',
        license: 'Original work',
      },
    ],
  },
  {
    title: 'Fonts and icons',
    icon: 'text',
    items: [
      {
        name: 'Barlow Semi Condensed',
        author: 'Jeremy Tribby',
        license: 'OFL 1.1',
        licenseUrl: 'https://openfontlicense.org',
        sourceUrl: 'https://fonts.google.com/specimen/Barlow+Semi+Condensed',
      },
      {
        name: 'JetBrains Mono',
        author: 'JetBrains',
        license: 'OFL 1.1',
        licenseUrl: 'https://openfontlicense.org',
        sourceUrl: 'https://www.jetbrains.com/lp/mono/',
      },
      {
        name: 'Material Symbols',
        author: 'Google',
        license: 'Apache 2.0',
        licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
        sourceUrl: 'https://fonts.google.com/icons',
      },
      {
        name: 'Lucide',
        author: 'Lucide Contributors',
        license: 'ISC',
        licenseUrl: 'https://lucide.dev/license',
        sourceUrl: 'https://lucide.dev',
      },
    ],
  },
  {
    title: 'Sound Effects',
    icon: 'audio',
    items: [
      {
        name: 'Sound effects',
        author: 'ingel81, generated with ElevenLabs',
        license: 'Original work',
        sourceUrl: 'https://elevenlabs.io/sound-effects',
      },
    ],
  },
  {
    title: 'Textures & Art',
    icon: 'terrain',
    items: [
      {
        name: 'Skybox (day / night)',
        author: 'ingel81, generated with Krea AI',
        license: 'Original work',
        sourceUrl: 'https://www.krea.ai',
      },
      {
        name: 'Grey Plaster 02 (menu and dialog surfaces, recoloured)',
        author: 'Rob Tuytel, Poly Haven',
        license: 'CC0',
        sourceUrl: 'https://polyhaven.com/a/grey_plaster_02',
      },
      {
        name: 'Dark Rock (top bar, recoloured)',
        author: 'Amal Kumar, Poly Haven',
        license: 'CC0',
        sourceUrl: 'https://polyhaven.com/a/dark_rock',
      },
    ],
  },
  {
    title: 'Music',
    icon: 'audio',
    items: [
      {
        name: 'Soundtrack',
        author: 'ingel81, generated with Eleven Music (ElevenLabs) and ACE-Step 1.5',
        license: 'Original work',
        sourceUrl: 'https://elevenlabs.io/music',
      },
    ],
  },
  {
    title: 'Map Data',
    icon: 'globe',
    items: [
      {
        name: 'World map outlines (1:110m coastline and land borders)',
        author: 'Natural Earth',
        license: 'Public Domain',
        licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
        sourceUrl: 'https://www.naturalearthdata.com',
      },
      {
        name: 'Earth of the menu globe (Blue Marble Next Generation, July 2004; Black Marble 2016; clouds)',
        author: 'NASA Earth Observatory, NASA Visible Earth',
        license: 'Public domain (NASA)',
        licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
        sourceUrl: 'https://visibleearth.nasa.gov',
      },
      {
        name: 'Relief and water of the menu globe (GEBCO 2008, via NASA Visible Earth)',
        author: 'GEBCO, NASA Visible Earth',
        license: 'Free use with credit',
        sourceUrl: 'https://www.gebco.net',
      },
      {
        name: 'Stars of the menu globe (Bright Star Catalogue, 5th edition)',
        author: 'D. Hoffleit, W. H. Warren Jr., Yale University Observatory',
        license: 'Public domain',
        sourceUrl: 'http://tdc-www.harvard.edu/catalogs/bsc5.html',
      },
      {
        name: 'Roads for the enemy routes (Overpass API) and place search (Nominatim)',
        author: 'OpenStreetMap contributors',
        license: 'ODbL 1.0',
        licenseUrl: 'https://www.openstreetmap.org/copyright',
        sourceUrl: 'https://www.openstreetmap.org',
      },
    ],
  },
  {
    title: 'Open Source',
    icon: 'filing',
    items: [
      {
        name: 'Three.js',
        author: 'three.js authors',
        license: 'MIT',
        sourceUrl: 'https://threejs.org',
      },
      {
        name: 'Angular',
        author: 'Google',
        license: 'MIT',
        sourceUrl: 'https://angular.dev',
      },
      {
        name: '3DTilesRendererJS',
        author: 'NASA / Cesium',
        license: 'Apache 2.0',
        licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
        sourceUrl: 'https://github.com/NASA-AMMOS/3DTilesRendererJS',
      },
      {
        name: 'Basis Universal (texture transcoder of the menu globe)',
        author: 'Binomial LLC',
        license: 'Apache 2.0',
        licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
        sourceUrl: 'https://github.com/BinomialLLC/basis_universal',
      },
    ],
  },
];
