'use strict';

/**
 * CHANGELOG.md for the release side: the section of one version, as the
 * release text on GitHub and in latest.yml (electron-builder.config.js), and
 * the check that refuses a release without one (release.yml). The game reads
 * the same file with its own parser (src/app/utils/changelog.ts).
 *
 * A section starts with "## <version>" (a date in parentheses may follow)
 * and runs to the next "## " heading.
 *
 * Usage: node scripts/changelog.js check <tag>
 */

const fs = require('node:fs');
const path = require('node:path');

const CHANGELOG = path.join(__dirname, '..', '..', 'CHANGELOG.md');

/** The body of the section for `version` (without its heading), trimmed; null without one. */
function changelogSection(markdown, version) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const wanted = String(version).replace(/^v/, '');
  const start = lines.findIndex((line) => {
    const match = /^##\s+v?(\S+)/.exec(line);
    return match !== null && match[1] === wanted;
  });
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return body === '' ? null : body;
}

function readChangelog() {
  return fs.existsSync(CHANGELOG) ? fs.readFileSync(CHANGELOG, 'utf8') : '';
}

if (require.main === module) {
  const [command, tag] = process.argv.slice(2);
  if (command !== 'check' || !tag) {
    console.error('Usage: node scripts/changelog.js check <tag>');
    process.exit(1);
  }
  if (changelogSection(readChangelog(), tag) === null) {
    console.error(`[changelog] CHANGELOG.md has no section for ${tag}. Write it before tagging.`);
    process.exit(1);
  }
  console.log(`[changelog] section for ${tag} found`);
}

module.exports = { changelogSection, readChangelog };
