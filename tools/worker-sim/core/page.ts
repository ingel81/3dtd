Object.assign(window, {
  labWorker: async (real: [number, number][]) => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    await new Promise((resolve) => { w.onmessage = resolve; w.postMessage('warm'); });
    return new Promise((resolve) => { w.onmessage = (e) => resolve(e.data); w.postMessage({ real }); });
  },
  labMain: async (real: [number, number][]) => (await import('./lab')).spawnTick(78, 777, { real } as never),
});
