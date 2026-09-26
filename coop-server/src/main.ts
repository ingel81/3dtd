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
 * status page is http://localhost:<port>/ (a live page), /status (JSON),
 * /text; `--status local` hides it from what comes through a tunnel (D66).
 * With RELAY_ADMIN_TOKEN set (or `--admin-token`), the page can close rooms
 * and drop players for whoever enters the token.
 *
 * A day's file stops at LOG_DAY_MAX_BYTES (review M1); a failing disk ends
 * the file, not the relay (M2). An exception nobody caught is logged and the
 * relay goes on (K1). SIGTERM tells the players the relay restarts (M6).
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
// The environment rather than the command line: a process list shows arguments
const adminToken = process.env['RELAY_ADMIN_TOKEN'] || argument('--admin-token') || undefined;
/** A day's log file stops growing here; the console goes on (review M1) */
const LOG_DAY_MAX_BYTES = 50 * 1024 * 1024;
mkdirSync(logDir, { recursive: true });

// One file a day; older than --log-days are deleted at the start and every day after
let fileDay = '';
let file: WriteStream | null = null;
let fileBytes = 0;
let fileFull = false;
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
    fileBytes = 0;
    fileFull = false;
    file = openLogFile();
    try {
      tidy();
    } catch (error) {
      console.error(`[coop] could not delete old logs: ${String(error)}`);
    }
  }
  const text = `${stamp(now)} ${line}`;
  console.log(`[coop] ${text}`);
  if (!file || fileFull) return;
  fileBytes += text.length + 1;
  if (fileBytes > LOG_DAY_MAX_BYTES) {
    fileFull = true;
    file.write(`${stamp(now)} log full for today (${LOG_DAY_MAX_BYTES / 2 ** 20} MB), the console goes on\n`);
    return;
  }
  file.write(`${text}\n`);
};

/** The day's file; a disk that fails (full, no rights) ends the file, not the relay (review M2) */
function openLogFile(): WriteStream | null {
  const stream = createWriteStream(logPath(), { flags: 'a' });
  stream.on('error', (error) => {
    console.error(`[coop] log file failed, writing to the console only: ${error.message}`);
    if (file === stream) file = null;
  });
  return stream;
}

// Nothing a room or a message does may end the relay (review K1); timers and handlers catch their own
process.on('uncaughtException', (error) => log(`uncaught: ${String(error?.stack ?? error).slice(0, 500)}`));
process.on('unhandledRejection', (reason) => log(`unhandled rejection: ${String(reason).slice(0, 500)}`));

const build = process.env['RELAY_BUILD'] || 'dev';
log(`relay ${build}, protocol ${PROTOCOL_VERSION}`);
log(`log file ${logPath()}${keepDays > 0 ? `, kept ${keepDays} days` : ''}`);
log(cheats ? 'cheats allowed (--no-cheats refuses them)' : 'cheats refused');
log(origins ? `pages allowed: ${origins.join(', ')}` : 'pages from any site allowed (--origins limits them)');
log(statusAccess === 'local' ? 'status page for the local network only' : 'status page open (--status local limits it)');
log(adminToken ? 'status page actions on (admin token set)' : 'status page read only (no admin token)');
const relay = await startRelay({ port, log, cheats, origins, statusAccess, adminToken, build });
let stopping = false;
const stop = () => {
  // Once, whichever signal came first (review N7)
  if (stopping) return;
  stopping = true;
  log('relay stops');
  void relay.close('The coop server restarts').then(() => (file ? file.end(() => process.exit(0)) : process.exit(0)));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
