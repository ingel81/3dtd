import { waveButtonAction } from '../../../coop/room-options';
import type { CoopService } from '../../../services/coop.service';
import type { Messages } from '../../../i18n/messages/en';

/** What the wave button shows, derived from the store outside the template. */
export interface WaveButtonView {
  /** "Wave N": the upcoming wave when idle or locked, the running one during a wave */
  label: string;
  /**
   * Accessible name when the visible text does not say it all: "Start wave
   * N" idle, with the countdown while it runs; during a wave of known size
   * the wave and the enemies left in words; null otherwise
   */
  ariaLabel: string | null;
  /** "{n} left" while a wave of known size runs, otherwise null */
  left: string | null;
  /**
   * The share in percent: while a wave runs the share of enemies still left,
   * while the auto-start counts down the time left, in coop between waves
   * the share of players ready (the bar at the bottom of the button)
   */
  barPercent: number;
  /**
   * Lit notches of WAVE_NOTCHES: a running wave of known size or the
   * auto-start's countdown, a notch per started tenth of barPercent; null
   * shows none
   */
  notches: number | null;
  /** "{n}s" while the auto-start counts down to this wave, otherwise null */
  countdown: string | null;
  /** Coop between waves: "{ready}/{players} ready", otherwise null */
  coopReady: string | null;
  /** Coop between waves: this player said ready, the button stays pressed */
  pressed: boolean;
}

/** Coop between waves: the wave starts once every player is ready (docs/COOP_PLAN.md, D15) */
export interface CoopReadyState {
  /** This player is ready */
  ready: boolean;
  /** Players ready, and players still in the game */
  readyCount: number;
  playerCount: number;
  /** The room lets the host start the waves, and this is the host (D38): the button starts it */
  hostStarts: boolean;
}

/** What coopReadyState reads of the room */
export type CoopRoomView = Pick<CoopService, 'inGame' | 'leftIds' | 'readyIds' | 'roster' | 'playerId' | 'options' | 'isHost'>;

/**
 * Readiness for the button from the room; null outside a coop game, and
 * after game over: no wave comes, so no "Ready for wave N" either
 */
/** Notches beside the wave number: each a tenth of the wave, or of the countdown */
export const WAVE_NOTCHES = 10;

/** Lit notches for a share in percent: a started tenth lights its notch, so the last goes out only at 0 */
export function notchesLit(percent: number): number {
  const share = Math.min(Math.max(percent, 0), 100) / 100;
  return share > 0 ? Math.ceil(share * WAVE_NOTCHES - 1e-9) : 0;
}

export function coopReadyState(coop: CoopRoomView | null, gameOver: boolean): CoopReadyState | null {
  if (!coop?.inGame() || gameOver) return null;
  const left = coop.leftIds();
  const ready = coop.readyIds();
  const players = coop.roster().filter((p) => !left.has(p.id));
  return {
    ready: ready.has(coop.playerId() ?? ''),
    readyCount: players.filter((p) => ready.has(p.id)).length,
    playerCount: players.length,
    hostStarts: waveButtonAction(coop.options(), coop.isHost()) === 'start',
  };
}

/**
 * @param wave    the upcoming wave when idle, the running one during a wave
 * @param running whether a wave is running
 * @param total   enemies the running wave brings in total, 0 = not announced
 *                (manual debug waves)
 * @param left    enemies of it not yet killed or through to the HQ
 * @param countdownSeconds seconds until the auto-start, null when it is off
 * @param countdownTotal   full length of that countdown in seconds
 * @param coop  coop readiness; the button then says ready instead of start
 */
export function waveButtonView(
  t: Messages,
  wave: number,
  running: boolean,
  total: number,
  left: number,
  countdownSeconds: number | null = null,
  countdownTotal = 0,
  coop: CoopReadyState | null = null,
): WaveButtonView {
  const says = t.hud.wave;
  const label = says.wave(wave);
  const plain = { coopReady: null, pressed: false };
  const none = { notches: null };
  if (!running && coop) {
    // "Auto 10 s" counts on every client alike (D44)
    const auto = countdownSeconds !== null ? ` | ${says.seconds(Math.max(countdownSeconds, 0))}` : '';
    const count = `${says.readyCount(coop.readyCount, coop.playerCount)}${auto}`;
    if (coop.hostStarts) {
      return {
        label: says.start(wave),
        ariaLabel: says.startCount(wave, count),
        left: null,
        barPercent: coop.playerCount > 0 ? (coop.readyCount / coop.playerCount) * 100 : 0,
        ...none,
        countdown: null,
        coopReady: count,
        pressed: false,
      };
    }
    return {
      label: coop.ready ? says.isReady(wave) : says.readyFor(wave),
      ariaLabel: coop.ready ? says.notReadyAfterAll(wave, count) : says.readyForCount(wave, count),
      left: null,
      barPercent: coop.playerCount > 0 ? (coop.readyCount / coop.playerCount) * 100 : 0,
      ...none,
      countdown: null,
      coopReady: count,
      pressed: coop.ready,
    };
  }
  if (!running) {
    const start = says.start(wave);
    if (countdownSeconds === null || countdownTotal <= 0) {
      return { label, ariaLabel: start, left: null, barPercent: 0, ...none, countdown: null, ...plain };
    }
    const seconds = Math.min(Math.max(countdownSeconds, 0), countdownTotal);
    const barPercent = (seconds / countdownTotal) * 100;
    return {
      label,
      ariaLabel: says.startsBySelf(start, seconds),
      left: null,
      barPercent,
      notches: notchesLit(barPercent),
      countdown: says.seconds(seconds),
      ...plain,
    };
  }
  if (total <= 0) {
    return { label, ariaLabel: null, left: null, barPercent: 0, ...none, countdown: null, ...plain };
  }
  const remaining = Math.min(Math.max(left, 0), total);
  const barPercent = (remaining / total) * 100;
  return {
    label,
    // The button shows the number, the notches and the count; the name says them in words
    ariaLabel: says.running(wave, remaining, total),
    left: says.left(remaining),
    barPercent,
    notches: notchesLit(barPercent),
    countdown: null,
    ...plain,
  };
}
