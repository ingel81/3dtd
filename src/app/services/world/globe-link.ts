import { InjectionToken, signal, type WritableSignal } from '@angular/core';

/** Latitude and longitude in degrees */
export interface GlobePlace {
  lat: number;
  lon: number;
}

/**
 * What the menu and a change of place need from the menu globe
 * (docs/GLOBE_PLAN.md), without depending on it: the globe
 * (GlobeDirectorService) fills it in when it runs. Without a globe the
 * defaults hold: Play never waits for a landing, a change of place does not
 * wait for a rise.
 */
export interface GlobeLink {
  /** The globe stands between the player and the place: Play waits for the landing */
  readonly holdsPlay: WritableSignal<boolean>;
  /** The globe is the picture: an engine made now draws nothing until it goes */
  readonly coversGame: WritableSignal<boolean>;
  /** Play was pressed while the place loads: the dive is quicker */
  readonly playWaits: WritableSignal<boolean>;
  /** The camera rises out of the place into the globe before the origin moves */
  beforeOriginChange: () => Promise<void>;
  /**
   * The place a change goes to, said as soon as it is known (before its
   * streets load): the globe turns to it meanwhile
   */
  readonly nextPlace: WritableSignal<GlobePlace | null>;
}

export const GLOBE_LINK = new InjectionToken<GlobeLink>('GLOBE_LINK', {
  providedIn: 'root',
  factory: () => ({
    holdsPlay: signal(false),
    coversGame: signal(false),
    playWaits: signal(false),
    beforeOriginChange: () => Promise.resolve(),
    nextPlace: signal(null),
  }),
});
