/**
 * The commit a build came from, for the run log's head.
 *
 * Angular has no way to read git at build time, so `tools/build-info.mjs`
 * writes `public/build-info.json` before `npm run build` and `npm start`, and
 * the app fetches it once at startup. Without the file (someone ran `ng build`
 * directly, or the fetch failed) the head says `unknown` rather than claiming
 * a commit it does not know.
 *
 * The config hash next to it in the head covers the balance tables; this
 * covers the code.
 */

let commit = 'unknown';

/** The commit of this build, `unknown` until the file has been read. */
export function buildCommit(): string {
  return commit;
}

/**
 * Read `build-info.json` once. Called at startup; failures are silent, the
 * head then says `unknown`.
 */
export async function loadBuildCommit(fetchFn: typeof fetch = fetch): Promise<string> {
  try {
    const response = await fetchFn('build-info.json', { cache: 'no-cache' });
    if (!response.ok) return commit;
    const info = await response.json() as { commit?: string; dirty?: boolean };
    if (typeof info.commit === 'string' && info.commit.length > 0) {
      commit = info.dirty ? `${info.commit}-dirty` : info.commit;
    }
  } catch {
    // no file, no network, no git: `unknown` is the honest answer
  }
  return commit;
}

/** Only for specs. */
export function setBuildCommit(value: string): void {
  commit = value;
}
