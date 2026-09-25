/**
 * The relay's log on disk (docs/COOP_PLAN.md, D64, D66): one file a day,
 * `coop_<date>.log`, and files older than the kept days are deleted. Pure
 * helpers; main.ts does the writing. The log holds room codes and player
 * names, never an IP address.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-09-25" in local time */
export function day(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-09-25 18:04:07" in local time, in front of every line */
export function stamp(date: Date): string {
  return `${day(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function logFileName(date: Date): string {
  return `coop_${day(date)}.log`;
}

/**
 * The log files among `names` to delete on `now`: a day's file older than
 * `keepDays` days. Files of the old naming (one per start,
 * `coop_2026-09-25_18-04-07.log`) count by their date as well; anything else
 * is left alone.
 */
export function expiredLogs(names: readonly string[], now: Date, keepDays: number): string[] {
  const oldest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - keepDays + 1);
  return names.filter((name) => {
    const match = /^coop_(\d{4})-(\d{2})-(\d{2})(?:_[\d-]+)?\.log$/.exec(name);
    if (!match) return false;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date < oldest;
  });
}
