// Before any test: the dev server runs (npm start, the user's to start), and
// no relay holds the port the tests start their own on.
import { relayUp } from './game';

export default async function globalSetup(): Promise<void> {
  const url = process.env.GAME_URL ?? 'http://localhost:4200';
  let game = false;
  try {
    game = (await fetch(url)).ok;
  } catch {
    game = false;
  }
  if (!game) throw new Error(`No game at ${url}: start the dev server first (npm start in the repository root).`);
  if (await relayUp()) {
    throw new Error('A coop relay runs on port 3003: stop it first, the tests start their own (a leftover of an aborted run?).');
  }
}
