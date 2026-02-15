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

export const ATTRIBUTIONS: AttributionCategory[] = [
  {
    title: '3D Models',
    icon: 'view_in_ar',
    items: [
      {
        name: 'Bat',
        author: 'Quaternius',
        license: 'CC0',
        sourceUrl: 'https://poly.pizza/m/hNO9XvjlKa',
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
        author: 'Zsky',
        license: 'CC-BY 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
        sourceUrl: 'https://poly.pizza/m/7GG1xDtc8l',
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
    ],
  },
  {
    title: 'Fonts',
    icon: 'text_fields',
    items: [
      {
        name: 'Roboto',
        author: 'Google',
        license: 'Apache 2.0',
        licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
        sourceUrl: 'https://fonts.google.com/specimen/Roboto',
      },
      {
        name: 'Material Symbols',
        author: 'Google',
        license: 'Apache 2.0',
        licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
        sourceUrl: 'https://fonts.google.com/icons',
      },
    ],
  },
  {
    title: 'Sound Effects',
    icon: 'volume_up',
    items: [
      {
        name: 'Tentacle Slime',
        author: 'The Odyssey Collection: Expanded',
        license: 'Commercial',
      },
    ],
  },
  {
    title: 'Open Source',
    icon: 'code',
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
    ],
  },
];
