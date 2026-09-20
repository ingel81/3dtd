/**
 * A run as a file: JSONL, one record per line, in the order they happened.
 *
 * The same text goes to the browser download, to the desktop app's `runs`
 * folder and to the bot server, so one reader handles all three
 * (docs/RUN_LOG.md).
 */

import type { RunLog, RunLogRecord } from './run-log.types';

/** One line per record, newline-terminated. */
export function toJsonl(records: readonly RunLogRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

/** Parse a JSONL run back; bad lines are skipped rather than failing the file. */
export function fromJsonl(text: string): RunLogRecord[] {
  const records: RunLogRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as RunLogRecord);
    } catch {
      // a truncated last line (a tab closed mid-write) costs one record, not the file
    }
  }
  return records;
}

/** `3dtd-run-<id>.jsonl` */
export function runFileName(runId: string): string {
  return `3dtd-run-${runId}.jsonl`;
}

/**
 * Hand the run to the player as a download.
 *
 * Returns false when the browser has no DOM to hang the link on (a spec, a
 * worker), so the caller can say so instead of failing silently.
 */
export function downloadRun(run: RunLog, doc: Document | undefined = globalThis.document): boolean {
  if (!doc) return false;
  const blob = new Blob([toJsonl(run.records)], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = runFileName(run.head.runId);
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
