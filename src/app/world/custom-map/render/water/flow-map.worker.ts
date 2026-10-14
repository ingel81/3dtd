/// <reference lib="webworker" />
/**
 * The bake of a water body's current off the page's thread (flow-map.ts
 * bakeFlowOffThread): the input's arrays come transferred, the flow goes
 * back the same way.
 */
import { bakeFlow, type FlowInput } from './flow-map';

addEventListener('message', (e: MessageEvent<{ id: number; input: FlowInput }>) => {
  const flow = bakeFlow(e.data.input);
  postMessage({ id: e.data.id, flow }, [flow.buffer]);
});
