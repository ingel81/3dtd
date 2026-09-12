/**
 * Writing generated files without line-ending churn.
 *
 * The checkout runs with core.autocrlf, so tracked text files sit on disk
 * with CRLF while the generators build their output with LF. A generator that
 * rewrites such a file on every test run leaves it marked as modified although
 * nothing changed, and one that splices into a hand-written file mixes both
 * endings.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const toLf = (text: string): string => text.replace(/\r\n/g, '\n');

/** The "Generated <code>timestamp</code>" line of the HTML charts in docs/. */
export const GENERATED_AT_STAMP = /Generated <code>[^<]*<\/code>/;

/**
 * Writes `content` to `path` unless the file already holds the same text, line
 * endings aside. An existing file keeps its line endings, a new file gets LF.
 * A match of `volatile` (a generation timestamp) does not count as a change,
 * so the file keeps its old stamp until something else differs; use the g
 * flag if the pattern can match more than once.
 * Returns whether the file was written.
 */
export function writeGeneratedFile(path: string, content: string, volatile?: RegExp): boolean {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const next = toLf(content);
  const stable = (text: string): string => (volatile ? text.replace(volatile, '') : text);
  if (current !== null && stable(toLf(current)) === stable(next)) return false;
  writeFileSync(path, current?.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next);
  return true;
}
