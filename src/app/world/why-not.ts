import type { Messages } from '../i18n/messages/en';
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

/** Why a way is blocked; its sentence is the dictionary's (worlds.whyNot) */
export type WhyNot =
  | 'hostPicksMap' | 'needsKey' | 'mapsSoon' | 'soon' | 'leaveCoopToEdit' | 'leaveReplay' | 'hostSaves'
  | 'trialNotSaved' | 'noRun' | 'hostsMap' | 'hostRestarts' | 'afterFirstWave' | 'leaveCoop' | 'tilesetNoMap';

/**
 * Why a way is blocked, null when it is open. A blocked way stays visible
 * with its sentence (3.2, `worlds.whyNot` in the player's language): never hidden.
 */
export function whyNot(way: PathWay, facts: WhyNotFacts): WhyNot | null {
  switch (way) {
    case 'play':
      if (facts.coopGuest) return 'hostPicksMap';
      if (facts.world === 'real' && facts.hasKey === false) return 'needsKey';
      if ((facts.world === 'osm' || facts.world === 'maps') && !facts.mapsOpen) return 'mapsSoon';
      return null;
    case 'edit':
      if (!facts.mapsOpen) return 'soon';
      if (facts.inCoopRoom) return 'leaveCoopToEdit';
      if (facts.replay) return 'leaveReplay';
      return null;
    case 'save':
      if (facts.coopGuest) return 'hostSaves';
      if (facts.trial) return 'trialNotSaved';
      if (facts.runLoaded === false) return 'noRun';
      return null;
    case 'load':
      return facts.coopGuest ? 'hostsMap' : null;
    case 'restart':
      return facts.coopGuest ? 'hostRestarts' : null;
    case 'replay':
      return facts.waveRecorded === false ? 'afterFirstWave' : null;
    case 'leave':
      return facts.inCoopRoom ? 'leaveCoop' : null;
  }
}

/** The sentence of a blocked way in the player's language, null when it is open */
export function whyNotText(t: Messages, way: PathWay, facts: WhyNotFacts): string | null {
  const why = whyNot(way, facts);
  return why ? t.worlds.whyNot[why] : null;
}

/**
 * The world as the path names it: the globes' world the page plays in
 * (worldOfPage), so an OpenStreetMap map is OpenStreetMap's and an own
 * tileset the real places', as their menus and the pause menu say; DevWorld
 * is none of them
 */
export function worldName(t: Messages, world: WorldId | null): string {
  return world ? t.worlds.names[world] : t.worlds.devWorld;
}
