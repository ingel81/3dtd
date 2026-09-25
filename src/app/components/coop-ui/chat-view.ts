import type { CoopChatLine } from '../../services/coop.service';

/** A chat line as the lobby and the game show it */
export interface ChatViewLine {
  id: number;
  /** A system line: what happened in the room */
  system: boolean;
  warn: boolean;
  /** The first line of a player's burst: name and time over it (lobby) */
  head: boolean;
  name: string;
  /** Lane colour of the writer, CSS */
  color: string;
  /** "19:42", local time it came */
  time: string;
  text: string;
}

/** "19:42" of `at` (Date.now()), local time */
export function chatTime(at: number): string {
  const date = new Date(at);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * The lines for the view: a player's name and time only over the first
 * line of each burst (docs/COOP_PLAN.md, C8); a system line ends a burst.
 */
export function chatView(
  lines: readonly CoopChatLine[],
  nameOf: (playerId: string) => string,
  colorOf: (playerId: string) => string,
): ChatViewLine[] {
  return lines.map((line, i) => {
    const before = lines[i - 1];
    const system = line.from === null;
    return {
      id: line.id,
      system,
      warn: line.warn,
      head: !system && (!before || before.from !== line.from),
      name: system ? '' : nameOf(line.from!),
      color: system ? '' : colorOf(line.from!),
      time: chatTime(line.at),
      text: line.text,
    };
  });
}
