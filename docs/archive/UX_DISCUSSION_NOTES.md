# UX-Diskussionsnotizen

**Status:** Bericht. Teil A ist entschieden und gebaut (2026-09-12). Teil B:
das Review vom 2026-09-12 hielt fest, dass Color Grading ein Debug-Feature
bleibt (DONE.md); die dramaturgischen Einsätze (Option 2) sind nicht gebaut.
**Stand:** 2026-09-11, Code-Stand `3338f4b`.
**Bezug:** TODO.md 3.1, „Türme nach Wegfall des Ziels nicht in Grundstellung
zurückdrehen“ und „Color Grading Anwendungsfall klären“.

---

## A. Türme nach Wegfall des Ziels nicht zurückdrehen

### Befund

- **Während der Welle** ruft jede Kampfschleife im Zweig ohne Ziel
  `resetRotation` auf: Projektil-Tower (`tower-combat.service.ts:263`,
  `:283`), Beam (`:461`), Nahkampf (`:693`). Ketten-Tower (Lightning) setzen
  nicht zurück (`:776-781`).
- **Zwischen den Wellen** setzt `updateTowerIdleRotations` jeden Frame alle
  Tower zurück (`tower-combat.service.ts:120-125`, Aufruf
  `game-state.manager.ts:488-493`).
- `resetRotation` setzt nur das Ziel auf die Grundstellung des Modells
  (`three-tower.renderer.ts:660-668`). Gedreht wird im Sub-Step mit π rad/s
  Spielzeit (`:868-870`, `:909-925`). Die Grundstellung ist die
  Platzierungsdrehung des Spielers (`customRotation`, `:383`).
- **Die Rückdrehung ist spielrelevant.** Ein Tower schießt nur, wenn der Turm
  auf 15° genau ausgerichtet ist (`three-tower.renderer.ts:968`, geprüft in
  `tower-combat.service.ts:252-253`). Nach einem Reset braucht er bis zu 1 s
  (180° bei π rad/s), bevor er auf einen neuen Gegner schießt. Bleibt er
  stehen, zeigt er meist schon dorthin, woher der nächste Gegner kommt. Bei
  der Cannon (0,5 Schuss/s) ist 1 s ein halber Schuss.
- Nur Modelle mit Turret-Knoten (`turret_top`, `tower_top`, `top`) drehen
  (`three-tower.renderer.ts:387-396`). Ein Scan-Schwenk von ±75° läuft einmal
  nach dem Platzieren (`:536`, `:886-908`), danach nie wieder. Magic dreht im
  Leerlauf kosmetisch weiter (`:845-855`).

### Pro stehen bleiben

- Kein Zeitverlust, wenn der nächste Gegner aus derselben Richtung kommt.
- Wirkt wacher, weniger Bewegung im Bild, kein Einrasten nach jedem Kill.
- Kleinere Codeänderung als jede Alternative.

### Contra

- Die Grundstellung zeigt heute „kein Ziel“ an. Ohne sie fehlt dieses Signal
  (für Tower ohne Turret gibt es es ohnehin nicht).
- Zwischen den Wellen zeigen die Türme in zufällige Richtungen, und die
  Platzierungsdrehung des Spielers geht für den Turm verloren.
- Das Kampf-Timing ändert sich leicht, Bot-Baselines verschieben sich.

### Empfehlung

1. **Während der Welle stehen bleiben:** kein `resetRotation` im Zweig ohne
   Ziel. Aufwand S, plus Test auf Schusszeitpunkt.
2. **Nach der Sleep-Verzögerung** (2 s ohne Ziel,
   `combat-tuning.config.ts:11`) langsam auf eine **Wachrichtung** drehen:
   dorthin, wo die Route in die Reichweite des Towers eintritt, also wo der
   nächste Gegner auftauchen wird. Einmal nach der LOS-Registrierung aus den
   Routen-Polylinien und `tower.visibleCells` berechnen. Das sieht gewollt aus
   und spart beim nächsten Gegner die Drehung. Aufwand S bis M.
3. **Zwischen den Wellen** ebenfalls die Wachrichtung statt der
   Platzierungsdrehung. Der Sockel behält die Drehung des Spielers.

Offen für den Menschen: Ist die Platzierungsdrehung für den Turm gewollt
(dann bleibt Punkt 3 weg) oder nur für den Sockel?

**Entschieden (2026-09-12) und umgesetzt:** Während der Welle hält der Turm
die Richtung des letzten Ziels. Nach der Welle (`wave:completed`, nicht nach
der Sleep-Verzögerung) dreht er zur Wachrichtung; neu platzierte Tower starten
in ihr. Die Wachrichtung ist der Eintritt der Route in die Reichweite, ohne
Sichtlinie. Die Platzierungsdrehung gilt nur noch für den Sockel. Stand der
Mechanik: `docs/TOWER_CREATION.md`, Abschnitt „Ohne Ziel“.

---

## B. Color Grading: Anwendungsfall

### Befund

- Drei Presets (Dark Fantasy, Noir, Warm Sunset) als 16³-LUT in einem
  Vollbild-Pass, Intensität 0 bis 1 (`color-grading.ts:13-23`, `:28`,
  `:36-107`, `:146-148`).
- Nur im Debug-Panel erreichbar (`display-options.component.ts:82-86`),
  gespeichert in localStorage (`debug-facade.service.ts:254-273`). Das war der
  Stand 2026-09-11; heute steht die Auswahl im Display-Menü
  (`quick-actions.component.html`).
- **Kosten:** Ist ein Preset aktiv, rendert die Szene über den
  EffectComposer (Render-Pass in ein Target, LUT-Pass, Output-Pass) statt
  direkt (`post-processing-pipeline.ts:40-65`). Auf schwachen Geräten ist das
  messbar. TODO.md 3.2 plant ohnehin ein VFX-Menü.
- Einen Tag/Nacht-Zyklus gibt es nicht. Die Photoreal-Tiles bringen ihr
  Tageslicht in den Texturen mit und ignorieren dynamische Lichter.

### Optionen

| Option | Inhalt | Aufwand | Bewertung |
|---|---|---|---|
| 1 Kosmetik | Look-Auswahl und Intensität in den Einstellungen | S | sinnvoll, geringer Nutzen allein |
| 2 Dramaturgie | Boss-Welle blendet Dark Fantasy mit 40 % ein; unter 25 HP (CloseCall-Schwelle, `game-balance.config.ts:72`) entsättigt das Bild schrittweise Richtung Noir; Game Over voll Noir. Übergänge über `setIntensity` in 1 bis 2 s | S bis M | gibt dem Feature einen Zweck, der Composer läuft nur in diesen Momenten |
| 3 Wellen-Stimmung | Look pro Template (Geister kalt, Feuer warm) | M | braucht neue Presets, verwässert das Signal aus Option 2 |
| 4 Nacht oder Wetter als Gameplay | Reichweite nachts kürzer | L | ein LUT dunkelt nur ab und macht keine Nacht; braucht Sichtweiten-Mechanik, Licht-Ersatz über additive Overlays und ein Fairness-Gate, das den Reichweitenmalus kennt |

### Empfehlung

Option 1 und 2 zusammen: ein Eintrag in den Einstellungen (Aus, Dark
Fantasy, Noir, Warm Sunset, Intensität) und die zwei dramaturgischen Einsätze
(Boss-Welle, niedrige HP) standardmäßig an und abschaltbar. Keine
Nacht-Mechanik auf dem Color Grading aufbauen. Vorher die Frame-Zeit mit und
ohne Composer auf einem schwachen Gerät messen, weil Option 2 den Composer
genau in den dichtesten Momenten zuschaltet.

Offen für den Menschen: Soll Noir bei niedrigen HP die Lesbarkeit der
Schadenszahlen-Farben opfern (Grau, Rot, Orange, Gold werden entsättigt), oder
bleibt die Entsättigung unter 50 %?

**Stand 2026-09-15:** Die Frage entfällt, Option 2 ist nicht gebaut (siehe
Status).
