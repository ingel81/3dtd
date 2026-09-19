'use strict';

/**
 * Release guard: the tag being built has to name the version in the root
 * package.json. The installer, latest.yml and the game all carry that
 * version; a tag v0.4.0 on a commit that still says 0.3.0 would publish an
 * update the updater never offers, or one that installs over itself.
 *
 * Usage: node scripts/check-version.js <tag>   (release.yml passes the tag)
 */

const path = require('node:path');

/** Whether `tag` (v1.2.3 or 1.2.3) names `version`. */
function tagMatchesVersion(tag, version) {
  return String(tag).replace(/^v/, '') === String(version);
}

if (require.main === module) {
  const tag = process.argv[2];
  const { version } = require(path.join(__dirname, '..', '..', 'package.json'));
  if (!tag) {
    console.error('[check-version] no tag given');
    process.exit(1);
  }
  if (!tagMatchesVersion(tag, version)) {
    console.error(`[check-version] tag ${tag} does not match package.json version ${version}`);
    process.exit(1);
  }
  console.log(`[check-version] ${tag} matches ${version}`);
}

module.exports = { tagMatchesVersion };
