import type { WorldRef } from './world-ref';
import type { WorldId } from '../worlds/world-rules';

/**
 * A way the path and the menus offer (docs/WORLDS_NAVIGATION_PLAN.md, 3.2).
 * Phase 4 needs play and edit; the world menus (phase 6) add their own.
 */
export type PathWay = 'play' | 'edit' | 'save' | 'load' | 'restart' | 'replay' | 'leave';

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
  /** The world the way goes to (the globes ask per world); absent for the world open now */
  world?: WorldId | null;
  /** A tile key (Cesium Ion or Google) is there; absent where it does not matter */
  hasKey?: boolean;
  /** A run is loaded in the page (the game, not the globes) */
  runLoaded?: boolean;
  /** The run is an editor's trial run: never saved */
  trial?: boolean;
  /** A wave of the run was played: a replay exists */
  waveRecorded?: boolean;
}

/**
 * The sentence beside a blocked way, null when it is open. A blocked way
 * stays visible with it (3.2): never hidden.
 */
export function whyNot(way: PathWay, facts: WhyNotFacts): string | null {
  switch (way) {
    case 'play':
      if (facts.coopGuest) return 'In a coop room the host picks the map';
      if (facts.world === 'real' && facts.hasKey === false) return 'Needs a map key (Cesium Ion or Google)';
      if ((facts.world === 'osm' || facts.world === 'maps') && !facts.mapsOpen) return 'Maps are coming soon';
      return null;
    case 'edit':
      if (!facts.mapsOpen) return 'Coming soon';
      if (facts.inCoopRoom) return 'Leave the coop room to edit';
      if (facts.replay) return 'Leave the replay first';
      return null;
    case 'save':
      if (facts.coopGuest) return 'In coop the host saves';
      if (facts.trial) return 'A trial run is not saved';
      if (facts.runLoaded === false) return 'No run to save';
      return null;
    case 'load':
      return facts.coopGuest ? "The room plays the host's map" : null;
    case 'restart':
      return facts.coopGuest ? 'The host restarts' : null;
    case 'replay':
      return facts.waveRecorded === false ? 'After the first wave' : null;
    case 'leave':
      return facts.inCoopRoom ? 'Leave the coop room first' : null;
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
