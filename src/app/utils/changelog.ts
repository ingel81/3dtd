/**
 * CHANGELOG.md as the game shows it: "What's new" after an update, and the
 * release notes a downloaded desktop update carries. One release is a
 * "## <version> (<date>)" section with "### <group>" headings (New, Better,
 * Fixed) and "- " items; see CHANGELOG.md at the repository root.
 *
 * The release side reads the same file in desktop/scripts/changelog.js.
 */

export interface ChangelogGroup {
  /** "New", "Better", "Fixed"; empty for items before any group heading. */
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  /** Without a leading v, as in package.json. */
  version: string;
  date: string | null;
  groups: ChangelogGroup[];
}

/**
 * Markdown and HTML reduced to the text a player reads: links keep their
 * text, emphasis and code marks go. Release notes from GitHub can arrive as
 * HTML; the game prints them as text either way.
 */
function plainText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]{1,2}([^*_`]+)[*_`]{1,2}/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** The groups of one release body: "### Title" headings and "- " items, continuation lines joined. */
export function parseReleaseBody(body: string): ChangelogGroup[] {
  const groups: ChangelogGroup[] = [];
  let group: ChangelogGroup | null = null;
  let item: string | null = null;
  const flush = () => {
    if (item !== null && group !== null) {
      const text = plainText(item);
      if (text) group.items.push(text);
    }
    item = null;
  };
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      group = { title: plainText(heading[1]), items: [] };
      groups.push(group);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line) ?? /^\s*<li>(.*)$/i.exec(line);
    if (bullet) {
      flush();
      if (group === null) {
        group = { title: '', items: [] };
        groups.push(group);
      }
      item = bullet[1];
      continue;
    }
    if (item !== null && line.trim() !== '') item += ' ' + line.trim();
    else flush();
  }
  flush();
  return groups.filter((g) => g.items.length > 0);
}

/** Every release in the file, newest first as written. */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let current: { version: string; date: string | null; body: string[] } | null = null;
  const finish = () => {
    if (current) releases.push({ version: current.version, date: current.date, groups: parseReleaseBody(current.body.join('\n')) });
  };
  for (const line of lines) {
    const heading = /^##\s+v?(\S+)(?:\s+\(([^)]*)\))?\s*$/.exec(line);
    if (heading) {
      finish();
      current = { version: heading[1], date: heading[2] ?? null, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  finish();
  return releases.filter((r) => r.groups.length > 0);
}

/** The release of `version` (with or without v), or null. */
export function releaseFor(releases: readonly ChangelogRelease[], version: string): ChangelogRelease | null {
  const wanted = version.replace(/^v/, '');
  return releases.find((r) => r.version === wanted) ?? null;
}

/**
 * Orders two versions by their dotted numbers: negative, zero or positive.
 * A leading v and anything from a "-" on are ignored, missing parts count as 0.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
