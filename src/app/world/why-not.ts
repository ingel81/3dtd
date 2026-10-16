import type { WorldRef } from './world-ref';

/**
 * A way the path and the menus offer (docs/WORLDS_NAVIGATION_PLAN.md, 3.2).
 * Phase 4 needs play and edit; the world menus (phase 6) add their own.
 */
export type PathWay = 'play' | 'edit';

/** What decides whether a way is open now */
export interface WhyNotFacts {
  /** The custom maps and the editor are released (CUSTOM_MAPS_OPEN) */
  mapsOpen: boolean;
  /** This player is in a coop room, in its lobby or its game */
  inCoopRoom: boolean;
  /** A guest of that room: the host picks the map */
  coopGuest: boolean;
  /** A replay plays */
  replay: boolean;
}

/**
 * The sentence beside a blocked way, null when it is open. A blocked way
 * stays visible with it (3.2): never hidden.
 */
export function whyNot(way: PathWay, facts: WhyNotFacts): string | null {
  switch (way) {
    case 'play':
      return facts.coopGuest ? 'In a coop room the host picks the map' : null;
    case 'edit':
      if (!facts.mapsOpen) return 'Coming soon';
      if (facts.inCoopRoom) return 'Leave the coop room to edit';
      if (facts.replay) return 'Leave the replay first';
      return null;
  }
}

/** The world as the path names it */
export function worldName(ref: WorldRef): string {
  switch (ref.kind) {
    case 'tiles':
      return 'Real places';
    case 'custom-map':
      return 'Maps';
    case 'tileset':
      return 'Own tilesets';
    case 'devworld':
      return 'DevWorld';
  }
}
