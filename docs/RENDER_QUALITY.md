# Qualitätsstufen des Bildes

**Status:** Gebaut 2026-10-14 (E154, QX3); Teile je Welt und Pflanzenbewegung 2026-10-14 (E156)
**Bezug:** [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (Stufentabelle), [BENCHMARKS.md](BENCHMARKS.md#bildkosten-grafik-benchmark)
(Messung je Stufe)

Eine Einstellung im Menü (Settings, Graphics, „Picture quality“): **Auto, Low, Medium, High, Ultra**. Die Tabelle steht
in `src/app/three-engine/render-quality.ts` (`QUALITY_TABLE`) und ist in drei Teile getrennt, die sich nie mischen:

| Teil | Gilt für | Wer wendet ihn an |
|---|---|---|
| `general` | jede Welt | `ThreeTilesEngine.applyQuality` |
| `customMaps` | nur eigene Karten | `CustomMapWorld.applyQuality` → `CustomMapView.applyQuality`, im Editor `EditorViewport` |
| `tiles` | nur Tiles-Welten (echte Orte) | `TilesWorld.applyQuality` |

Das Menü (Settings, Graphics, E156) hat oben die eine Stufe für beide Welten und darunter eine Zeile, was sie je Welt
spielt („Real places: High | Custom maps: Medium“, Auto spielt eigene Karten eine Stufe tiefer). Danach je Welt ein
Abschnitt mit dem, was dort wirklich wirkt, und zuletzt „Everywhere“:

| Abschnitt | Inhalt |
|---|---|
| Real places | Auflösung und Kantenglättung der Stufe (Text), **Tile detail** (`errorTarget`) als Stufenreihe. Schatten und Karteneffekte gibt es dort nicht: sie gehören zum Teil `customMaps` |
| Custom maps | Auflösung und Kantenglättung der Stufe (Text), **Shadows**, **Far detail**, **Grass** als Stufenreihen, Schalter **Water refraction**, **Sea waves**, **Lava glow and heat haze**, **Far land shadow**, dazu **Plant motion** (Off, Calm, Full). Partikel und Laternenlichter nennt eine Zeile, sie folgen nur der Stufe |
| Everywhere | Effekt-Voreinstellungen und ihre Schalter, Color grading, Frame limit, Menu globe, Fullscreen |

## Die Stufen

| Stellschraube | Teil | Low | Medium | High | Ultra |
|---|---|---|---|---|---|
| Renderauflösung | allgemein | 60 % von DPR ≤ 1, dynamisch 50–80 % | 80 % von DPR ≤ 1, dynamisch 60–100 % | DPR bis 2, fest | DPR bis 2, fest |
| Kantenglättung | allgemein | FXAA | FXAA | MSAA 4× | MSAA 4× |
| Bloom darf laufen | allgemein | nein | ja | ja | ja |
| Auflösungsdeckel | eigene Karten | DPR 1 | DPR 1 | DPR 1,5 | DPR 2 |
| Schattenkarte | eigene Karten | 1024 | 2048 | 4096 | 4096, weicher (PCF 2,5) |
| LOD-Bias, Sichtweite | eigene Karten | 0,5× | 0,75× | 1× | 1,25× |
| Impostor ab | eigene Karten | 200 m | 280 m | 380 m | 500 m |
| Gras nah | eigene Karten | aus | 35 000 Halme bis 90 m | 70 000 bis 140 m | 100 000 bis 180 m |
| Grasring fern | eigene Karten | aus | 30 000 Halme bis 200 m | 60 000 bis 300 m | 90 000 bis 400 m |
| Partikel der Karte | eigene Karten | 40 % | 70 % | 100 % | 100 % |
| Punktlichter nachts | eigene Karten | 2 | 4 | 6 | 6 |
| Leben der Karte (Lebensbereiche, treibende Boote, wehende Banner, Funken über Lava) | eigene Karten | aus | 70 %, ohne Bereiche „High“ | 100 % | 100 % |
| Boden billiger ab (eine Schicht / nur Mittelwerte) | eigene Karten | 80 / 220 m | 110 / 300 m | 150 / 400 m | 220 / 600 m |
| Brechung im Wasser (`refraction`) | eigene Karten | aus | aus | an | an |
| Dünung auf dem Meer (`seaWaves`) | eigene Karten | aus | an | an | an |
| Lava-Glut über 1 und Hitzeflimmern (`lavaGlow`) | eigene Karten | aus | aus | an | an |
| Ferner Bodenschatten (`shadowCascade`) | eigene Karten | aus | an | an | an |
| Reicheres Wasser (`waterDetail`, kein Schalter) | eigene Karten | aus | an | an | an |
| Spiegelbild im Wasser (`waterReflection`, kein Schalter) | eigene Karten | aus | aus | 35 %, jedes zweite Bild | 50 %, jedes Bild |
| Pflanzen im Wind (`plantSway`) | eigene Karten | 1 | 1 | 1 | 1 (nur die Einstellung „Plant motion“ ändert ihn) |
| `errorTarget` | Tiles | 32 | 24 | 20 | 12 |

- **High ist das Bild von vor den Stufen**, auf Tiles exakt (DPR bis 2, MSAA über den Canvas, `errorTarget` 20, kein
  Umweg über den Composer). Auf eigenen Karten deckelt High die Auflösung bei DPR 1,5 (vorher 2): dort kostet jeder
  Pixel ein Vielfaches (Demo-Tal bei doppelter Dichte 2,64 statt 1,39 ms).
- **Bloom:** der Effekt-Schalter (Settings, Effects) bleibt die Wahl des Spielers; Low hält Bloom zusätzlich aus.
- **Partikel und Punktlichter** betreffen die Effekte der Karte (Feuer, Rauch, Funken, Gischt, Laternen); der
  Partikel-Anteil gilt auch für Wetter und Umgebungsteilchen (Regen, Schnee, Glut, Asche, Staub). Die Effekte
  des Spiels (Mündungsfeuer, Einschläge, Spuren) steuern weiter die Effekt-Voreinstellungen.
- **Sichtlinie:** Objekte, die die Sicht blockieren, behalten ihre Sichtweite; der LOD-Bias verkürzt nur die Sichtweite
  von Deko. Was die LOS sieht, hängt so nicht an der Stufe. `errorTarget` ändert nicht die Verfeinerung des
  Routenkorridors (eigener Zielwert in Metern, `route-corridor-region.ts`).
- **Effekte der eigenen Karten** (`map-effects.ts`, Kosten in [CUSTOM_MAPS.md](CUSTOM_MAPS.md)): High hat sie alle an,
  das Bild von vor den Stufen hatte sie noch nicht. Der Boden wird ab `farSingle` mit einer Schicht und ab `farFlat`
  nur mit den Mittelwerten der Schichten gezeichnet (QX5); Low liest so ab 80 m nur noch eine Schicht. Steile gemalte
  Hänge lesen ihre Seitenebenen bis `steepNear` (Low 0, Medium 110, High 150, Ultra 220 m).

## Eigene Teile je Welt (E156)

Auf die Stufe setzt der Spieler einzelne Teile je Welt (`QualityOverrides` in `render-quality.ts`, gespeichert mit der
Stufe in `td_render_quality_v1`). Eine Stufenreihe nimmt ihren Teil aus der Zeile dieser Stufe der Tabelle, es gibt
keine Zwischenwerte:

| Override | Welt | Nimmt aus der Zeile der gewählten Stufe |
|---|---|---|
| `tileDetail` | echte Orte | `errorTarget` |
| `shadows` | eigene Karten | `shadowMapSize`, `shadowRadius` |
| `farDetail` | eigene Karten | `lodBias`, `impostorFrom`, `farSingle`, `farFlat`, `steepNear` |
| `grass` | eigene Karten | `grassBlades`, `grassDistance`, `grassFarBlades`, `grassFarDistance` (Low: „Off“, kein Gras) |
| `refraction`, `seaWaves`, `lavaGlow`, `shadowCascade` | eigene Karten | Schalter, an oder aus |

- `knobsWith(level, overrides, plantMotion)` baut daraus die Stellschrauben, die spielen; der `RenderQualityService`
  wendet sie sofort an (`knobsFor`), der Editor liest sie über `storedKnobsFor`.
- **Eigene Mischung:** weicht ein Override von dem ab, was die Stufe der Welt ohnehin setzt, nennt das Menü die Welt
  „own mix“ (oben in der Zeile je Welt und im Kopf des Abschnitts, mit „Back to <Stufe>“, das die Overrides dieser Welt
  löscht). Ein Override, der dem Wert der Stufe entspricht, wird nicht gespeichert.
- **Eine Stufe wählen setzt alle Teile neu**, wie die Effekt-Voreinstellungen ihre Schalter: die Overrides gehen.
  Verschiebt Auto die Stufe nach seiner Messung, bleiben sie.
- Auflösung, Kantenglättung, Bloom, Partikel und Laternenlichter haben keinen Override, sie folgen nur der Stufe.
- Ändert ein Override die Stellschrauben, macht die Engine den neuen Zustand wie beim Stufenwechsel vorab bereit und
  schaltet erst dann um (`applyQuality` vergleicht die ganzen Stellschrauben, nicht nur die Stufe): ein Karteneffekt
  schaltet Shader um.

**Plant motion** (Off, Calm, Full; Standard Full, gespeichert als `plantMotion`) gilt für alle eigenen Karten und hängt
an keiner Stufe; eine neu gewählte Stufe lässt sie stehen. Sie skaliert das Schwingen von Gras, Bäumen und Pflanzen
(`plantSway` 0, 0,4, 1 → Uniform `uPlantSway`, `wind.ts`). Die Karte behält ihre Windstärke: Wolken, Rauch, Wetter und
die Umgebungspartikel ziehen weiter mit dem vollen Wind, schwimmende Objekte schaukeln weiter.

## Kantenglättung und Kontext

MSAA des Canvas wird beim Anlegen des WebGL-Kontexts festgelegt (`ThreeTilesEngine`, Option `antialias`): eine Seite,
die in Low oder Medium startet, hat keinen MSAA-Canvas. FXAA läuft als letzter Pass im Composer
(`PostProcessingPipeline.setAntialias`). Wechselt der Spieler zur Laufzeit auf High, bekommt ein Canvas ohne MSAA bis
zum Neuladen FXAA statt MSAA im Composer: MSAA auf dem Half-Float-Ziel des Composers kostete im Demo-Tal etwa das
Dreifache (4,4 gegen 1,3 ms GPU, RTX 5080). Das Menü sagt das („Antialiasing changes fully after a reload“).

Ein Stufenwechsel zur Laufzeit (Menü oder Auto nach seiner Messung) ändert, wofür viele Programme gebaut sind: die
Zahl der Punktlichter, die jedes beleuchtete Material durchläuft, den Weg durch den Composer (FXAA in Low und Medium)
und die Wasser-Effekte einer Karte. Bloom und Farbkorrektur (Effekt-Schalter) wechseln ebenfalls den Weg durch den
Composer, dazu kommen die Programme der Pässe selbst. In beiden Fällen läuft das Bild weiter:

- Nach dem Laden, im Hintergrund, macht `ThreeTilesEngine.prepareSwitchStates` jeden Zustand bereit, den ein
  Wechsel bringen kann: jede Stufe (der Teil der Welt über `WorldProvider.withQuality`, Custom Maps: Punktlichter und
  Wasser-Effekte; Gras, Detail und Partikel ändern keine Programme) durch den Composer mit allen Pässen an, und wo die
  Stufe auf den Schirm zeichnet, ohne Pässe; die Nachbarstufen zuerst (die tiefere vor der höheren, Auto stuft eher
  ab), dann Bloom und Farbkorrektur auf der aktuellen Stufe, dann der Rest. Je Zustand zeichnet sie einen Frame nur
  zum Schein auf (`recordDraws` in `frame-compile-ahead.ts`: jeder Pass richtet sich ein wie im echten Frame,
  gezeichnet wird nichts) und kompiliert ihn (`FrameAhead`, `compileOnly`): eine Aufgabe von 1 ms je ruhigem Moment,
  die vor dem nächsten neuen Programm endet, `KHR_parallel_shader_compile` linkt neben den Frames, der Status wird
  abgefragt, ohne zu warten; die erste Nutzung jedes Programms bekommt einen ruhigen Moment für sich. Ruhig heißt
  (`quietMoment`): kein Gegner auf der Karte (der Kampf bleibt unberührt), kein Wechsel in Arbeit, der Browser idle
  mit 4 ms bis zum nächsten Frame (`requestIdleCallback`) und der GPU-Prozess mit dem letzten Frame durch (ein Fence
  danach hat signalisiert). Keine ersten Zeichnungen: sie kosteten Frames, und der Wechsel kommt ohne sie genauso
  schnell. Nach 2 s Ruhe genügt auch das Ende eines Frames, sobald der GPU-Prozess einen Frame fertig hat
  (höchstens eine Aufgabe je Frame): ohne Obergrenze der Bildrate oder auf einem ausgelasteten Rechner gab es kaum
  Leerlauf, und der Hintergrund war nach 45 s nicht fertig.
- `ProgramPins` (`program-pins.ts`) hält das Warm-up und den Hintergrund fest: Ohne Material frei three ein Programm, und die Id eines eigenen
  Shader-Texts (Teil jedes Programmschlüssels) verfällt mit dem letzten Material dieses Texts. Eine Schicht, die ihre
  Materialien neu baut (Effekte einer Karte beim Stufenwechsel, die Routenlinien), baute ihre Programme im Spiel
  sonst erneut. Je Shader-Text ein nie freigegebener Zwilling hält die Id (beim Laden), und jedes Programm des
  Warm-ups und des Hintergrunds bekommt einen Nutzer mehr.
- Im Spiel zeichnet die Engine den Frame im neuen Zustand wieder nur zum Schein auf, und `FrameAhead` kompiliert ihn
  (ein Frame je Aufgabe von 3 ms, die vor dem nächsten neuen Programm endet). Baut das kein Programm, war der Zustand
  vorbereitet, und im nächsten Frame schaltet die Engine um (`switchPasses`, `setQuality`), mit der neuen Auflösung
  im selben Frame. Baut es eins (ein Override abseits der Stufen, ein Wechsel vor dem Hintergrund), zeichnet sie jedes Objekt einmal in ein Pixel,
  höchstens ein neues Material je Frame, und wartet auf einen Fence, bevor sie umschaltet.

Die Schattenkarte einer neuen Größe baut wie jede Änderung über einige Frames (`ShadowParts`), die alte bleibt bis
dahin; der Fernschatten einer eingeschalteten Kaskade backt verteilt; das Licht der Laternen auf dem Boden backt nur
neu, wenn sich die Lichter oder der Boden darunter ändern (`LampLight.bake`). Gemessen auf Autumn Keep und Harbor
Town (RTX 5080, headless, der Rechner geteilt): Laden wie zuvor (14,3 bis 16,8 s). Ohne V-Sync ist der Hintergrund
nach 20 s fertig (fünf Zustände, 320 bis 350 Programme), längster Frame dabei 15 ms, keiner über 20 ms; mit V-Sync nach
32 bis 34 s, längster Frame 25 bis 29 ms, keiner über 30 ms (ohne Hintergrund 22 bis 23 ms, das Takt-Zittern des
Headless-V-Sync). Was bleibt: der GPU-Prozess schließt ein Programm erst bei seiner ersten Abfrage ab
(`getProgramInfoLog` wartet 5 bis 20 ms, obwohl der Link als fertig gemeldet war), ab und zu länger als
der Leerlauf vor dem nächsten Frame. Danach kommt ein Wechsel nach 38 bis 120 ms, längster Frame 10 bis 28 ms, in
einem von acht Wechseln 44 ms (vor E215 stand das Bild 3,9 s). Kommt ein Wechsel, bevor sein Zustand fertig ist, geht er den Weg
von `FrameAhead` mit ersten Zeichnungen (einige Sekunden bis zur Umschaltung, rund zehn Frames um 45 ms). Den Halt
(`ProgramCompileHold`) gibt es nur noch für eine Stufe vor dem ersten Frame: eine neue Auflösung setzt er erst nach
dem Kompilieren, sofort gesetzt leerte die Größenänderung den Canvas, und die angehaltenen Bilder zeigten Schwarz.

## Dynamische Auflösung

Low und Medium (`dynamic-resolution.ts`): einmal je Sekunde mit mindestens drei Proben das 90. Perzentil der
GPU-Zeit je Bild (Timer-Query über `GpuFrameMeter`), ohne Timer der Bildabstand. Über 90 % von 16,7 ms (Bildabstand:
über 125 %, also erst wenn Bilder fallen) geht die Skala um 0,1 runter, nach drei günstigen Sekunden in Folge (unter
60 %) um 0,05 hoch, innerhalb der Spanne der Stufe. Lücken über eine Sekunde (verdeckter Tab) zählen nicht. Der
Grafik-Benchmark hält die Skala während der Messung fest (`setDynamicResolutionPaused`).

Der Bildabstand gilt gegen den Takt der Anzeige, wo er langsamer ist als 60 Hz: ein 30-Hz-Schirm zeigt 33 ms
zwischen zwei Bildern, wie billig sie auch sind, und drückte die Skala sonst bis aufs Minimum. Den Takt liest
`DisplayRefresh` aus Bildern, in denen die Engine nichts zeichnet (Menü-Globus über dem Spiel, ladende Karte,
kompilierende Programme): 30 solche Abstände, deren mittlere Hälfte innerhalb von 15 % um den Median liegt, auf eine
übliche Rate gerundet; der kürzeste gewinnt. Bis dahin gilt 60 Hz wie vorher.

Geprüft im Browser: Demo-Tal in Medium auf der RTX 5080 steigt auf 100 %, mit SwiftShader (Software-GPU, ein bis zwei
Bilder je Sekunde) fällt es auf 60 %.

## Auto

`RenderQualityService` (Einstellung in localStorage `td_render_quality_v1`):

1. **Vorauswahl über den GPU-Namen** (`levelForGpu`): Software und integrierte GPUs (Intel UHD/Iris, AMD Radeon
   Graphics, Mali, Adreno) Low; GTX, MX, RTX x050, RX 400 bis 5000, Apple M ohne Zusatz Medium; aktuelle RTX, RX 6000+,
   Apple M Pro/Max High. Ultra rät der Name nie.
2. **Kurzer Messlauf beim ersten Start:** wenn der Ladebildschirm der Welt gegangen ist (`worldStood`), 2 s später,
   ab dem ersten gezeichneten Bild (das Menü mit dem Globus kann das Spiel noch verdecken) die GPU-Zeit von bis zu
   120 Bildern (höchstens 8 s); 90. Perzentil über 10 ms eine Stufe runter, unter 3 ms (und unter High) eine hoch
   (`levelAfterMeasure`). Gemessen wird die Stufe der Welt, verschoben wird die Vorauswahl: misst eine eigene Karte
   auf Medium unter 3 ms, wird aus High Ultra (Tiles Ultra, eigene Karten High). Gespeichert mit dem GPU-Namen; eine
   andere GPU (Laptop auf dem anderen Chip) rät neu. Kamen zu wenige Bilder (Welt verlassen, Tab verborgen), bleibt
   nichts gespeichert und die nächste Welt misst neu. Ohne Timer bleibt die Vorauswahl und gilt als geprüft.
   Das Ergebnis gilt erst nach dem Einflug der Kamera (`IntroCameraFlightService.isRunning`): mitten im Flug
   wechselte die Stufe sonst Gras, Schatten, Sichtweite und Auflösung auf einmal, nach Sekunden Schwarz.
3. **Eigene Karten eine Stufe vorsichtiger** als Tiles (`resolveLevel`).

`&quality=<level>` in der URL spielt eine Stufe für diesen Seitenaufruf, ohne sie zu speichern (Grafik-Benchmark je
Stufe); das Menü sperrt die Auswahl dann und sagt warum.

## Editor

Der Editor liest dieselbe gespeicherte Einstellung (`storedKnobsFor`: Stufe für eigene Karten, darauf die Overrides
und die Pflanzenbewegung) beim Öffnen und wendet den Teil `customMaps` und den Auflösungsdeckel an, mit voller Skala,
ohne dynamische Auflösung und immer mit MSAA.

## Messung

Stand nach den Draw Calls und KTX2 (RTX 5080, Median der GPU-Zeit je Bild, Spielansicht, DPR 1): Demo-Tal Low 0,72,
Medium 0,75, High 0,96, Ultra 1,12 ms; Hafenstadt Low 0,58, Medium 0,65, High 0,95, Ultra 1,20 ms. Bei DPR 2 kostet
Ultra im Demo-Tal 1,74-mal High (mehr Pixel durch den höheren Deckel). Werte, getrennte Messung der Ultra-Stellschrauben
und Grenzen in [BENCHMARKS.md](BENCHMARKS.md#je-qualitätsstufe-nach-den-draw-calls-und-ktx2-2026-10-14).

Je Stufe mit dem Grafik-Benchmark ([BENCHMARKS.md](BENCHMARKS.md#bildkosten-grafik-benchmark)), Ergebnisse dort.
