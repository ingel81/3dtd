/// <reference lib="webworker" />
/**
 * A whole shore cut bake off the page's thread (shore-cut.ts
 * bakeShoreCutOffThread): the input's arrays come transferred, the bytes go
 * back the same way.
 */
import { bakeShoreCutWhole, type ShoreCutInput } from './shore-cut';

addEventListener('message', (e: MessageEvent<{ id: number; input: ShoreCutInput }>) => {
  const cut = bakeShoreCutWhole(e.data.input);
  postMessage({ id: e.data.id, cut }, [cut.buffer]);
});
