/**
 * npm run coop-server [-- --port 3003] [-- --no-cheats] [-- --origins https://a,app://app]
 *   [-- --status local] [-- --log-dir DIR] [-- --log-days 14]: the coop relay on
 * this machine (docs/COOP_PLAN.md, D17). Node runs the TypeScript as it is.
 * This one lets the dev tools' cheats through, for development in coop;
 * `--no-cheats` refuses them, as a public relay does (docs/COOP_PLAN.md, S1).
 *
 * Every line goes to the console and to coop_<day>.log in `--log-dir`
 * (logs/ in the repository by default), with the local time in front, so a
 * run can be read afterwards (C5); `--log-days` deletes older days (D64). The
 * status page is http://localhost:<port>/ (text) and /status (JSON);
 * `--status local` hides it from what comes through a tunnel (D66).
 */
import { createWriteStream, mkdirSync, readdirSync, rmSync, type WriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRelay } from './server.ts';
import { PROTOCOL_VERSION } from '../../src/app/coop/protocol.ts';
import { day, expiredLogs, logFileName, stamp } from './log-files.ts';


const argument = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] ?? null : null;
};
const port = Number(argument('--port') ?? 3003);
const cheats = !process.argv.includes('--no-cheats');
const origins = argument('--origins')?.split(',').filter(Boolean);
const logDir = resolve(argument('--log-dir') ?? fileURLToPath(new URL('../../logs/', import.meta.url)));
const keepDays = Number(argument('--log-days') ?? 0);
const statusAccess = argument('--status') === 'local' ? 'local' : 'all';
mkdirSync(logDir, { recursive: true });

// One file a day; older than --log-days are deleted at the start and every day after
let fileDay = '';
let file: WriteStream | null = null;
const logPath = () => join(logDir, logFileName(new Date()));
const tidy = () => {
  if (keepDays <= 0) return;
  for (const name of expiredLogs(readdirSync(logDir), new Date(), keepDays)) rmSync(join(logDir, name), { force: true });
};

const log = (line: string) => {
  const now = new Date();
  if (day(now) !== fileDay) {
    file?.end();
    fileDay = day(now);
    file = createWriteStream(logPath(), { flags: 'a' });
    tidy();
  }
  const text = `${stamp(now)} ${line}`;
  console.log(`[coop] ${text}`);
  file!.write(`${text}
`);
};

const build = process.env['RELAY_BUILD'] || 'dev';
log(`relay ${build}, protocol ${PROTOCOL_VERSION}`);
log(`log file ${logPath()}${keepDays > 0 ? `, kept ${keepDays} days` : ''}`);
log(cheats ? 'cheats allowed (--no-cheats refuses them)' : 'cheats refused');
log(origins ? `pages allowed: ${origins.join(', ')}` : 'pages from any site allowed (--origins limits them)');
log(statusAccess === 'local' ? 'status page for the local network only' : 'status page open (--status local limits it)');
const relay = await startRelay({ port, log, cheats, origins, statusAccess, build });
const stop = () => {
  log('relay stops');
  void relay.close().then(() => (file ? file.end(() => process.exit(0)) : process.exit(0)));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
