// What the simulation reaches outside itself while it runs: requests, console errors and warnings,
// rejected promises and thrown errors that nobody caught. Installed before the lab loads, on the
// main thread and in the worker alike; the lab reads it back with `diagnostics`.
export interface Diagnostics {
  fetches: string[];
  errors: string[];
  warnings: string[];
  rejections: string[];
}

const d: Diagnostics = { fetches: [], errors: [], warnings: [], rejections: [] };
(globalThis as { __labDiag?: Diagnostics }).__labDiag = d;

const text = (args: unknown[]) => args.map((a) => (a instanceof Error ? `${a.message} @ ${a.stack?.split('\n')[1]?.trim()}` : String(a))).join(' ').slice(0, 300);
const count = (list: string[], line: string) => { if (list.length < 200 && !list.includes(line)) list.push(line); };

const fetch0 = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  count(d.fetches, String(input instanceof Request ? input.url : input));
  return fetch0(input, init);
}) as typeof fetch;
const XHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
if (XHR) {
  const open0 = XHR.prototype.open;
  XHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    count(d.fetches, `XHR ${String(url)}`);
    return (open0 as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XHR.prototype.open;
}
const error0 = console.error.bind(console);
const warn0 = console.warn.bind(console);
console.error = (...args: unknown[]) => { count(d.errors, text(args)); error0(...args); };
console.warn = (...args: unknown[]) => { count(d.warnings, text(args)); warn0(...args); };
globalThis.addEventListener?.('unhandledrejection', (e) => count(d.rejections, text([(e as PromiseRejectionEvent).reason])));
globalThis.addEventListener?.('error', (e) => count(d.rejections, `uncaught: ${text([(e as ErrorEvent).error ?? (e as ErrorEvent).message])}`));

export const diagnostics = (): Diagnostics => d;
