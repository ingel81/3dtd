/**
 * Esc gehört einem offenen Dialog, nicht dem Spiel. Sonst schließt ein Druck
 * den Dialog und beendet dahinter zusätzlich Build- oder Platzierungsmodus.
 *
 * - `defaultPrevented`: MatDialog verbraucht Esc im keydown-Listener auf body
 *   (vor unserem window-Listener). Ohne Animationen ist der Dialog dann schon
 *   aus `openDialogs` entfernt, deshalb reicht die Zählung allein nicht.
 * - `openDialogCount`: deckt Dialoge mit `disableClose` ab, die Esc ignorieren.
 */
export function isEscapeForDialog(key: string, defaultPrevented: boolean, openDialogCount: number): boolean {
  return key === 'Escape' && (defaultPrevented || openDialogCount > 0);
}
