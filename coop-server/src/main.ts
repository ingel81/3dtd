/**
 * npm run coop-server [-- --port 3003]: the coop relay on this machine
 * (docs/COOP_PLAN.md, D17). Node runs the TypeScript as it is.
 */
import { startRelay } from './server.ts';

const index = process.argv.indexOf('--port');
const port = index >= 0 ? Number(process.argv[index + 1]) : 3003;

const relay = await startRelay({ port, log: (line) => console.log(`[coop] ${line}`) });
const stop = () => {
  void relay.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
