import { describe, expect, it } from 'vitest';
import { parseChangelog } from '../../utils/changelog';
import { releasesToAnnounce, seenVersion, SEEN_VERSION_KEY, type SeenVersionStorage } from './whats-new';

const releases = parseChangelog(
  ['0.3.10', '0.3.4', '0.3.3', '0.3.2', '0.3.1'].map((v) => `## ${v}\n\n### New\n- Something in ${v}\n`).join('\n'),
);
const versions = (list: { version: string }[]) => list.map((r) => r.version);

function storage(entries: Record<string, string>): SeenVersionStorage {
  const map = new Map(Object.entries(entries));
  return { getItem: (k) => map.get(k) ?? null };
}

describe('seenVersion', () => {
  it('is the stored version', () => {
    expect(seenVersion(storage({ [SEEN_VERSION_KEY]: 'v0.3.0' }))).toBe('v0.3.0');
  });

  it('is a version before any release for a player who played before the key existed', () => {
    expect(seenVersion(storage({ '3dtd-tile-credentials': '{}' }))).toBe('0.0.0');
  });

  it('is null on a first visit', () => {
    expect(seenVersion(storage({}))).toBeNull();
  });
});

describe('releasesToAnnounce', () => {
  it('announces the current release after an update', () => {
    expect(versions(releasesToAnnounce('v0.3.1', 'v0.3.2', releases))).toEqual(['0.3.2']);
  });

  it('includes the releases a player skipped, newest first', () => {
    expect(versions(releasesToAnnounce('v0.3.1', 'v0.3.4', releases))).toEqual(['0.3.4', '0.3.3', '0.3.2']);
  });

  it('compares versions by number, not as text', () => {
    expect(versions(releasesToAnnounce('v0.3.4', 'v0.3.10', releases))).toEqual(['0.3.10']);
  });

  it('shows every release up to the current one to a player from before the stored version', () => {
    expect(versions(releasesToAnnounce('0.0.0', 'v0.3.2', releases))).toEqual(['0.3.2', '0.3.1']);
  });

  it('stays quiet on a first visit, without a change and after going back a version', () => {
    expect(releasesToAnnounce(null, 'v0.3.2', releases)).toEqual([]);
    expect(releasesToAnnounce('v0.3.2', 'v0.3.2', releases)).toEqual([]);
    expect(releasesToAnnounce('v0.3.3', 'v0.3.2', releases)).toEqual([]);
  });
});
