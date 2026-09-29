self.onmessage = async (e: MessageEvent) => {
  const lab = await import('./lab');
  if (e.data === 'warm') { postMessage('ok'); return; }
  postMessage(lab.spawnTick(78, 777, e.data ?? undefined));
};
