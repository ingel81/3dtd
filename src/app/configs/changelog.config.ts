import changelogMarkdown from '../../../CHANGELOG.md';
import { parseChangelog } from '../utils/changelog';

/**
 * CHANGELOG.md, bundled as text (the ".md" loader in angular.json) and
 * parsed once. Source for "What's new".
 */
export const CHANGELOG_RELEASES = parseChangelog(changelogMarkdown);
