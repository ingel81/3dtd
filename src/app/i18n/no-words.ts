import type { Messages } from './messages/en';

/**
 * A dictionary that says nothing (TODO E245, docs/I18N_PLAN.md 5): for
 * work no player reads the words of, the steps of a document built off the
 * page (the template worker, an agent's dry run). Every key is there, every
 * text is empty, so such work needs no language and its bundle carries no
 * dictionary. A worker that must word something gets codes instead.
 */
const silent: () => string = () => '';
export const NO_WORDS: Messages = new Proxy(silent, {
  get: (_target, key) => (key === Symbol.toPrimitive || key === 'toString' ? silent : NO_WORDS),
  apply: () => '',
}) as unknown as Messages;
