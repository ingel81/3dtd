// K0 "Das Versprechen" (DREHBUCH_R4.md 2.2, menu-globes): the app's world menu with its three globes. The pointer
// walks the promise in the order the film keeps it: the OSM globe, the globe of the maps, the Map editor entry;
// then the OSM globe is picked and its world opens. The captions go on in the cut (CAPTIONS, English).
import { click, wait } from './common.mjs';

const move = (to, label, dur = 0.8) => ({ do: 'move', to, dur, label });

/** The cut's captions by the mark they start on */
export const CAPTIONS = {
  osm: 'Your street as a map',
  maps: 'Hand-built worlds',
  editor: 'Build your own',
};

export const SCENES = [
  {
    name: 'menu-globes',
    // A fresh profile: no autosave, so no Continue; the globes on High
    start: { menu: true },
    env: { globe: 'high', seed: 2 },
    steps: [
      // All three globes, the Earth turning with its night side and city lights
      { do: 'mark', name: 'globes' },
      wait(1.5),
      move('[data-world=osm] .ws-slot', 'osm'),
      wait(1.6),
      move('[data-world=maps] .ws-slot', 'maps'),
      wait(1.6),
      move('[data-entry=editor]', 'editor'),
      wait(1.2),
      // The OSM globe picked: its world menu opens, the globe in the middle
      click('[data-world=osm]', { dur: 0.8, label: 'pick' }),
      wait(1.2),
      { do: 'mark', name: 'effect:osm world' },
      wait(1.3),
    ],
  },
];
