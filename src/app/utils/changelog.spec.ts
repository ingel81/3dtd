import { describe, expect, it } from 'vitest';
import { compareVersions, parseChangelog, parseReleaseBody, releaseFor } from './changelog';
import { CHANGELOG_RELEASES } from '../configs/changelog.config';
import { version } from '../../../package.json';

const markdown = `# Changelog

Intro.

## 0.4.0 (2026-10-01)

### New
- A new tower, the **Frost Spire**,
  with a second line.

### Fixed
- The [share link](https://example.org) works again.

## 0.3.1 (2026-09-19)

### Better
- Faster in \`Firefox\`.

## 0.3.0
`;

describe('parseChangelog', () => {
  it('reads versions, dates, groups and items, newest first', () => {
    const releases = parseChangelog(markdown);
    expect(releases.map((r) => r.version)).toEqual(['0.4.0', '0.3.1']);
    expect(releases[0].date).toBe('2026-10-01');
    expect(releases[0].groups).toEqual([
      { title: 'New', items: ['A new tower, the Frost Spire, with a second line.'] },
      { title: 'Fixed', items: ['The share link works again.'] },
    ]);
    expect(releases[1].groups).toEqual([{ title: 'Better', items: ['Faster in Firefox.'] }]);
  });

  it('leaves out a release without items', () => {
    expect(releaseFor(parseChangelog(markdown), '0.3.0')).toBeNull();
  });
});

describe('parseReleaseBody', () => {
  it('takes items before any heading', () => {
    expect(parseReleaseBody('- one\n- two')).toEqual([{ title: '', items: ['one', 'two'] }]);
  });

  it('turns HTML release notes into text', () => {
    const html = '<h3>New</h3>\n<ul>\n<li>A <strong>Windows</strong> app &amp; more</li>\n</ul>';
    expect(parseReleaseBody(html)).toEqual([{ title: '', items: ['A Windows app & more'] }]);
  });
});

describe('releaseFor', () => {
  it('finds a release by version or tag', () => {
    const releases = parseChangelog(markdown);
    expect(releaseFor(releases, 'v0.4.0')?.version).toBe('0.4.0');
    expect(releaseFor(releases, '0.9.9')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by the dotted numbers', () => {
    expect(compareVersions('0.3.10', '0.3.9')).toBeGreaterThan(0);
    expect(compareVersions('v0.4.0', '0.3.99')).toBeGreaterThan(0);
    expect(compareVersions('0.3.1', 'v0.3.1')).toBe(0);
    expect(compareVersions('0.3', '0.3.0')).toBe(0);
    expect(compareVersions('0.3.1-beta.2', '0.3.1')).toBe(0);
    expect(compareVersions('0.0.0', '0.3.1')).toBeLessThan(0);
  });
});

describe('CHANGELOG.md', () => {
  it('has a section for the version in package.json, the one the game shows', () => {
    expect(releaseFor(CHANGELOG_RELEASES, version)).not.toBeNull();
  });
});
