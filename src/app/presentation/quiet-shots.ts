/**
 * Whether a tower's shot plays its sound and muzzle flash. A manned
 * tower's shot is shown at the click already (TowerControlService, coop);
 * the simulation's shot for it comes a tick later and stays quiet. The
 * prediction is taken once per shot: by its sound (audio:play with
 * `shotOf`), which comes first, and the vfx:muzzle-flash after it in the
 * same packet reads the same answer, in shot order when a tower fired more
 * than once in the frame. Unanswered decisions go at the end of the frame
 * (endFrame).
 */
export class QuietShots {
  /** Answers of the frame's shot sounds per tower, oldest first */
  private readonly decided = new Map<string, boolean[]>();
  /** Whether the shot of the tower was shown already; consumes the prediction (ShotPrediction.take) */
  private take: (towerId: string) => boolean = () => false;

  setSource(take: ((towerId: string) => boolean) | null): void {
    this.take = take ?? (() => false);
    this.decided.clear();
  }

  /** The shot sound of `towerId`: true to stay quiet. */
  readonly sound = (towerId: string): boolean => {
    const quiet = this.take(towerId);
    const answers = this.decided.get(towerId);
    if (answers) answers.push(quiet);
    else this.decided.set(towerId, [quiet]);
    return quiet;
  };

  /** The muzzle flash of `towerId`: true to stay quiet, the answer its sound got. */
  readonly flash = (towerId: string): boolean => {
    const answers = this.decided.get(towerId);
    if (answers === undefined) return this.take(towerId);
    const quiet = answers.shift()!;
    if (answers.length === 0) this.decided.delete(towerId);
    return quiet;
  };

  endFrame(): void {
    if (this.decided.size !== 0) this.decided.clear();
  }
}
