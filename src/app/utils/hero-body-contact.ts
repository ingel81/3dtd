import type { RouteBody, RouteBodyContact } from './route-body';

/**
 * The point of a body along the route (the ooze) the hero measures his range
 * to and aims at, see HeroWorld.bodyContact.
 */
export interface HeroBodyContact {
  lat: number;
  lon: number;
  /** Geo height of the ground there */
  height: number;
  /** Metres from the spot to the point, 0 inside the body */
  distanceM: number;
}

const contact: RouteBodyContact = { station: 0, offset: 0, distance: 0 };

/**
 * The point of `body` nearest to local (x, z): RouteBody.nearest, the point
 * towers aim at (BodyAim) but without their line of sight, which the hero
 * never checks. The ground comes from `groundLocalYAt` under the point,
 * `fallbackGroundY` where it has none, as in the route grid's radius query.
 * Puts the body's hit there (RouteBody.setHit), as BodyAim.aim does.
 */
export function heroBodyContact(
  body: RouteBody,
  x: number,
  z: number,
  groundLocalYAt: (x: number, z: number) => number | null,
  fallbackGroundY: number,
  out: HeroBodyContact,
): HeroBodyContact {
  body.nearest(x, z, contact);
  const st = body.stations;
  const k = contact.station;
  const groundY = groundLocalYAt(st.x[k] + st.rightX[k] * contact.offset, st.z[k] + st.rightZ[k] * contact.offset)
    ?? fallbackGroundY;
  body.setHit(k, contact.offset, groundY);
  out.lat = body.hit.lat;
  out.lon = body.hit.lon;
  out.height = body.hit.height;
  out.distanceM = contact.distance;
  return out;
}
