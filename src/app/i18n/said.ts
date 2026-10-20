/**
 * A text as data (TODO E245, docs/I18N_PLAN.md 4.4): the key of a sentence
 * in a section of the dictionary and its values, typed by the sentence's
 * own signature. Whoever makes the text (a worker, the simulation, a check)
 * needs only the type; whoever shows it words it in the player's language,
 * logs and the agents in English. Data, so it crosses a worker or the
 * network and keeps in a save as it is.
 */
export type Said<S> = {
  [K in keyof S]: S[K] extends string
    ? { key: K }
    : S[K] extends (...v: infer A) => string
      ? A extends []
        ? { key: K }
        : { key: K; v: A[0] }
      : never;
}[keyof S];

/** The sentence `said` names in `section` (`t.mapFile.says`, `en.mapFile.says`) */
export function say<S>(section: S, said: Said<S>): string {
  const entry = section[said.key as keyof S] as unknown;
  if (typeof entry === 'function') return (entry as (v: unknown) => string)('v' in said ? (said as { v: unknown }).v : undefined);
  return typeof entry === 'string' ? entry : String(said.key);
}
