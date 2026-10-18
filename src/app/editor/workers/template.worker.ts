/// <reference lib="webworker" />
/**
 * The editor's template worker (ops/landscape/template-off-thread.ts): a
 * template built into a fresh map, the share done told as it goes, the map
 * back with its arrays transferred.
 */
import { buffersOf, runTemplateJob, type TemplateJob, type TemplateReply } from '../ops/landscape/template-off-thread';

const reply = (r: TemplateReply, transfer: Transferable[] = []): void => postMessage(r, transfer);

addEventListener('message', (e: MessageEvent<TemplateJob>) => {
  runTemplateJob(e.data, (progress) => reply({ progress })).then(
    (doc) => reply({ doc }, buffersOf(doc.terrain)),
    (err: Error) => reply({ error: err.message }),
  );
});
