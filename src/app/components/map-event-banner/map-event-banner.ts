/** What one banner of a custom map's wave events says: the map's messages, then the portals that opened */
export function waveEventLines(messages: readonly string[], opened: readonly string[]): string[] {
  return [...messages, ...opened.map((name) => `A portal opens: ${name}. Enemies come from there from this wave on.`)];
}
