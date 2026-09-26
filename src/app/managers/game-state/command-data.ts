/**
 * A command as plain data (toPlainData in command-log.ts), `type` included:
 * what the command log keeps and the coop relay carries. An entity in it is
 * its id. Free of imports, the relay reads it as well.
 */
export type CommandData = Readonly<Record<string, unknown>> & { readonly type: string };
