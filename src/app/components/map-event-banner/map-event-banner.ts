/** What one banner of a custom map's wave events says: the map's messages, then the portals that opened */
import type { Messages } from '../../i18n/messages/en';
export function waveEventLines(t: Messages, messages: readonly string[], opened: readonly string[]): string[] {
  return [...messages, ...opened.map((name) => t.hud.mapEvents.portal(name))];
}
