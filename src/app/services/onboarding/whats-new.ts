import { compareVersions, type ChangelogRelease } from '../../utils/changelog';

/** localStorage: the game version the player last saw "What's new" for, or played. */
export const SEEN_VERSION_KEY = 'td_seen_version';

/**
 * Keys only a player who has played before has. Someone who played before
 * this key existed counts as coming from an older version and sees the news
 * once; a first visit sees nothing and just remembers the version.
 */
const RETURNING_PLAYER_KEYS = ['3dtd-tile-credentials', 'td_onboarding_v2', 'td_recent_locations_v1'];

/** A version older than every release, for a returning player without a stored version. */
const BEFORE_ANY_RELEASE = '0.0.0';

export interface SeenVersionStorage {
  getItem(key: string): string | null;
}

/**
 * The version to compare against: the stored one, for a returning player
 * without one a version before any release, for a first visit null.
 */
export function seenVersion(storage: SeenVersionStorage): string | null {
  const stored = storage.getItem(SEEN_VERSION_KEY);
  if (stored) return stored;
  return RETURNING_PLAYER_KEYS.some((key) => storage.getItem(key) !== null) ? BEFORE_ANY_RELEASE : null;
}

/**
 * The releases to announce after an update, newest first: every one after
 * the version the player saw last, up to the current one, so skipped updates
 * show too. Empty on a first visit and when nothing changed.
 */
export function releasesToAnnounce(
  seen: string | null,
  current: string,
  releases: readonly ChangelogRelease[],
): ChangelogRelease[] {
  if (seen === null) return [];
  return releases.filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0);
}
