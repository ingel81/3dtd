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

/**
 * Writes `content` to `path` unless the file already holds the same text, line
 * endings aside. An existing file keeps its line endings, a new file gets LF.
 * Returns whether the file was written.
 */
export function writeGeneratedFile(path: string, content: string): boolean {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const next = toLf(content);
  if (current !== null && toLf(current) === next) return false;
  writeFileSync(path, current?.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next);
  return true;
}
