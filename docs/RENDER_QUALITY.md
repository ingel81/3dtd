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
| Gras | eigene Karten | aus | 35 000 Halme bis 90 m | 70 000 bis 140 m | 100 000 bis 180 m |
| Partikel der Karte | eigene Karten | 40 % | 70 % | 100 % | 100 % |
| Punktlichter nachts | eigene Karten | 2 | 4 | 6 | 6 |
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
| `grass` | eigene Karten | `grassBlades`, `grassDistance` (Low: „Off“, kein Gras) |
| `refraction`, `seaWaves`, `lavaGlow`, `shadowCascade` | eigene Karten | Schalter, an oder aus |

- `knobsWith(level, overrides, plantMotion)` baut daraus die Stellschrauben, die spielen; der `RenderQualityService`
  wendet sie sofort an (`knobsFor`), der Editor liest sie über `storedKnobsFor`.
- **Eigene Mischung:** weicht ein Override von dem ab, was die Stufe der Welt ohnehin setzt, nennt das Menü die Welt
  „own mix“ (oben in der Zeile je Welt und im Kopf des Abschnitts, mit „Back to <Stufe>“, das die Overrides dieser Welt
  löscht). Ein Override, der dem Wert der Stufe entspricht, wird nicht gespeichert.
- **Eine Stufe wählen setzt alle Teile neu**, wie die Effekt-Voreinstellungen ihre Schalter: die Overrides gehen.
  Verschiebt Auto die Stufe nach seiner Messung, bleiben sie.
- Auflösung, Kantenglättung, Bloom, Partikel und Laternenlichter haben keinen Override, sie folgen nur der Stufe.
- Ändert ein Override die Stellschrauben, hält die Engine wie beim Stufenwechsel das Zeichnen an, bis die Programme
  kompiliert sind (`applyQuality` vergleicht die ganzen Stellschrauben, nicht nur die Stufe): ein Karteneffekt schaltet
  Shader um.

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
Zahl der Punktlichter, die jedes beleuchtete Material durchläuft, und den Weg durch den Composer. Damit der nächste
Frame sie nicht alle auf dem Hauptthread linkt (Hafenstadt in der Dämmerung: 2,7 bis 4,3 s Standbild), hält die
Engine das Zeichnen an, bis `compileAsync` für den neuen Weg fertig ist (`ProgramCompileHold`, höchstens 5 s): das
Bild steht kurz, die Seite bleibt bedienbar, längster Frame 60 bis 90 ms. Eine neue Auflösung setzt sie erst danach: sofort
gesetzt, leerte die Größenänderung den Canvas, und die angehaltenen Bilder zeigten für die Dauer des Kompilierens
Schwarz (Ruined City, Hafenstadt: 2,5 s schwarz mitten im Einflug beim ersten Start, siehe unten).

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
