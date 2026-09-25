/**
 * npm run coop-server [-- --port 3003] [-- --no-cheats] [-- --origins https://a,app://app]: the coop relay on
 * this machine (docs/COOP_PLAN.md, D17). Node runs the TypeScript as it is.
 * This one lets the dev tools' cheats through, for development in coop;
 * `--no-cheats` refuses them, as a public relay does (docs/COOP_PLAN.md, S1).
 *
 * Every line goes to the console and to logs/coop_<start>.log in the
 * repository, with the local time in front, so a run can be read afterwards
 * (C5). The status page is http://localhost:<port>/ (text) and /status (JSON).
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startRelay } from './server.ts';

const index = process.argv.indexOf('--port');
const port = index >= 0 ? Number(process.argv[index + 1]) : 3003;
const cheats = !process.argv.includes('--no-cheats');
const originsAt = process.argv.indexOf('--origins');
const origins = originsAt >= 0 ? (process.argv[originsAt + 1] ?? '').split(',').filter(Boolean) : undefined;

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date, date: string, time: string) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${date}${pad(d.getHours())}${time}${pad(d.getMinutes())}${time}${pad(d.getSeconds())}`;

const logDir = fileURLToPath(new URL('../../logs/', import.meta.url));
mkdirSync(logDir, { recursive: true });
const logPath = `${logDir}coop_${stamp(new Date(), '_', '-')}.log`;
const file = createWriteStream(logPath, { flags: 'a' });

const log = (line: string) => {
  const text = `${stamp(new Date(), ' ', ':')} ${line}`;
  console.log(`[coop] ${text}`);
  file.write(`${text}\n`);
};

log(`log file ${logPath}`);
log(cheats ? 'cheats allowed (--no-cheats refuses them)' : 'cheats refused');
log(origins ? `pages allowed: ${origins.join(', ')}` : 'pages from any site allowed (--origins limits them)');
const relay = await startRelay({ port, log, cheats, origins });
const stop = () => {
  log('relay stops');
  void relay.close().then(() => file.end(() => process.exit(0)));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
