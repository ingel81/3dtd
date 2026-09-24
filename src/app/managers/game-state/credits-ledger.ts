import { signal } from '@angular/core';
import { GameEventBus } from '../../game-engine';
import type { CreditsSource } from '../../game-engine/game-event-bus';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { LOCAL_PLAYER_ID } from './command-log';

/**
 * The players' credits, one account each (docs/COOP_PLAN.md, D6). The single
 * player game is one player, LOCAL_PLAYER_ID. Every change goes through here
 * and is announced as `credits:changed` with the player, the new total of
 * that account and the delta.
 *
 * `credits` is the account of the player at this client, the one the UI
 * shows; the simulation asks balance() for the player a booking belongs to.
 *
 * Owned by the GameStateManager, which exposes the signal as `credits`.
 */
export class CreditsLedger {
  readonly credits = signal<number>(GAME_BALANCE.player.startCredits);

  /** The players in roster order; the order of the state hash and the snapshot */
  private roster: readonly string[] = [LOCAL_PLAYER_ID];
  private local = LOCAL_PLAYER_ID;
  private readonly accounts = new Map<string, number>([[LOCAL_PLAYER_ID, GAME_BALANCE.player.startCredits]]);

  constructor(private readonly eventBus: GameEventBus) {}

  /** The players in roster order. */
  get players(): readonly string[] {
    return this.roster;
  }

  /** The player at this client. */
  get localPlayer(): string {
    return this.local;
  }

  /**
   * The players of the run and the one at this client. Every account starts
   * with the start credits (D21), without a booking: this is the run's
   * starting line, not income.
   */
  setPlayers(players: readonly string[], local: string): void {
    this.roster = [...players];
    this.local = local;
    this.accounts.clear();
    for (const id of players) this.accounts.set(id, GAME_BALANCE.player.startCredits);
    this.credits.set(this.balance(local));
  }

  /** The credits of `playerId`; 0 for a player not in the run. */
  balance(playerId: string): number {
    return this.accounts.get(playerId) ?? 0;
  }

  /** Every account's credits in roster order, for the state hash. */
  balances(): number[] {
    return this.roster.map((id) => this.balance(id));
  }

  /**
   * Books a delta (negative to charge) on `playerId`. `source` says where it
   * came from; the run log splits income and spending by it, which the sign
   * alone cannot do (a refund and a kill are both positive). A player not in
   * the run books nothing.
   */
  add(delta: number, source: CreditsSource, playerId: string): void {
    const before = this.accounts.get(playerId);
    if (before === undefined) return;
    const newCredits = before + delta;
    this.accounts.set(playerId, newCredits);
    const local = playerId === this.local;
    if (local) this.credits.set(newCredits);
    this.eventBus.emit({
      type: 'credits:changed',
      credits: newCredits,
      delta,
      source,
      playerId,
      local,
    });
  }

  /** The same delta on every account (wave gold, the dev wave jump). */
  addEach(delta: number, source: CreditsSource): void {
    for (const id of this.roster) this.add(delta, source, id);
  }

  /**
   * Charges `playerId` the amount if the credits reach.
   * @returns true if credits were spent, false if not enough
   */
  spend(amount: number, source: CreditsSource, playerId: string): boolean {
    if (this.balance(playerId) < amount) return false;
    this.add(-amount, source, playerId);
    return true;
  }

  /** Every account as [player, credits], roster order, for the snapshot. */
  saveAccounts(): [string, number][] {
    return this.roster.map((id) => [id, this.balance(id)]);
  }

  /**
   * Set the credits a snapshot saved, without a booking: a restore is no
   * income or spending, the run log must not count it. The stores do not
   * hear a replay (GameEventBus.onLive), so they still show the live value.
   */
  restore(accounts: readonly (readonly [string, number])[]): void {
    for (const [id, credits] of accounts) {
      if (this.accounts.has(id)) this.accounts.set(id, credits);
    }
    this.credits.set(this.balance(this.local));
  }

  /** Every account back to the start credits, booked as one delta each. */
  reset(): void {
    for (const id of this.roster) this.add(GAME_BALANCE.player.startCredits - this.balance(id), 'reset', id);
  }
}
