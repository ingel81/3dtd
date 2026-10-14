# Qualitätsstufen des Bildes

**Status:** Gebaut 2026-10-14 (E154, QX3)
**Bezug:** [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (Stufentabelle), [BENCHMARKS.md](BENCHMARKS.md#bildkosten-grafik-benchmark)
(Messung je Stufe)

Eine Einstellung im Menü (Settings, Graphics, „Picture quality“): **Auto, Low, Medium, High, Ultra**. Die Tabelle steht
in `src/app/three-engine/render-quality.ts` (`QUALITY_TABLE`) und ist in drei Teile getrennt, die sich nie mischen:

| Teil | Gilt für | Wer wendet ihn an |
|---|---|---|
| `general` | jede Welt | `ThreeTilesEngine.applyQuality` |
| `customMaps` | nur eigene Karten | `CustomMapWorld.applyQuality` → `CustomMapView.applyQuality`, im Editor `EditorViewport` |
| `tiles` | nur Tiles-Welten (echte Orte) | `TilesWorld.applyQuality` |

Das Menü zeigt die drei Teile genauso getrennt („All worlds“, „Custom maps only“, „Real places (3D tiles) only“).

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
| `errorTarget` | Tiles | 32 | 24 | 20 | 12 |

- **High ist das Bild von vor den Stufen**, auf Tiles exakt (DPR bis 2, MSAA über den Canvas, `errorTarget` 20, kein
  Umweg über den Composer). Auf eigenen Karten deckelt High die Auflösung bei DPR 1,5 (vorher 2): dort kostet jeder
  Pixel ein Vielfaches (Demo-Tal bei doppelter Dichte 2,64 statt 1,39 ms).
- **Bloom:** der Effekt-Schalter (Settings, Effects) bleibt die Wahl des Spielers; Low hält Bloom zusätzlich aus.
- **Partikel und Punktlichter** betreffen die Effekte der Karte (Feuer, Rauch, Funken, Gischt, Laternen). Die Effekte
  des Spiels (Mündungsfeuer, Einschläge, Spuren) steuern weiter die Effekt-Voreinstellungen.
- **Sichtlinie:** Objekte, die die Sicht blockieren, behalten ihre Sichtweite; der LOD-Bias verkürzt nur die Sichtweite
  von Deko. Was die LOS sieht, hängt so nicht an der Stufe. `errorTarget` ändert nicht die Verfeinerung des
  Routenkorridors (eigener Zielwert in Metern, `route-corridor-region.ts`).
- **Teile der Plantabelle, die noch fehlen:** „Bodenschichten je Pixel“ (Ferne gebacken, höchstens vier Schichten in
  Low) hängt an der gebackenen Fern-Albedo aus QX5 und kommt mit ihr.

## Kantenglättung und Kontext

MSAA des Canvas wird beim Anlegen des WebGL-Kontexts festgelegt (`ThreeTilesEngine`, Option `antialias`): eine Seite,
die in Low oder Medium startet, hat keinen MSAA-Canvas. FXAA läuft als letzter Pass im Composer
(`PostProcessingPipeline.setAntialias`). Wechselt der Spieler zur Laufzeit auf High, bekommt ein Canvas ohne MSAA bis
zum Neuladen FXAA statt MSAA im Composer: MSAA auf dem Half-Float-Ziel des Composers kostete im Demo-Tal etwa das
Dreifache (4,4 gegen 1,3 ms GPU, RTX 5080). Das Menü sagt das („Antialiasing changes fully after a reload“).

## Dynamische Auflösung

Low und Medium (`dynamic-resolution.ts`): einmal je Sekunde mit mindestens drei Proben das 90. Perzentil der
GPU-Zeit je Bild (Timer-Query über `GpuFrameMeter`), ohne Timer der Bildabstand. Über 90 % von 16,7 ms (Bildabstand:
über 125 %, also erst wenn Bilder fallen) geht die Skala um 0,1 runter, nach drei günstigen Sekunden in Folge (unter
60 %) um 0,05 hoch, innerhalb der Spanne der Stufe. Lücken über eine Sekunde (verdeckter Tab) zählen nicht. Der
Grafik-Benchmark hält die Skala während der Messung fest (`setDynamicResolutionPaused`).

Geprüft im Browser: Demo-Tal in Medium auf der RTX 5080 steigt auf 100 %, mit SwiftShader (Software-GPU, ein bis zwei
Bilder je Sekunde) fällt es auf 60 %.

## Auto

`RenderQualityService` (Einstellung in localStorage `td_render_quality_v1`):

1. **Vorauswahl über den GPU-Namen** (`levelForGpu`): Software und integrierte GPUs (Intel UHD/Iris, AMD Radeon
   Graphics, Mali, Adreno) Low; GTX, MX, RTX x050, RX 400 bis 5000, Apple M ohne Zusatz Medium; aktuelle RTX, RX 6000+,
   Apple M Pro/Max High. Ultra nur von Hand.
2. **Kurzer Messlauf beim ersten Start:** sobald eine Welt steht, die GPU-Zeit von bis zu 120 Bildern (höchstens 8 s);
   90. Perzentil über 10 ms eine Stufe runter, unter 3 ms (und unter High) eine hoch (`levelAfterMeasure`).
   Gespeichert mit dem GPU-Namen; eine andere GPU (Laptop auf dem anderen Chip) rät neu. Ohne Timer bleibt die
   Vorauswahl und gilt als geprüft.
3. **Eigene Karten eine Stufe vorsichtiger** als Tiles (`resolveLevel`).

`&quality=<level>` in der URL spielt eine Stufe für diesen Seitenaufruf, ohne sie zu speichern (Grafik-Benchmark je
Stufe); das Menü sperrt die Auswahl dann und sagt warum.

## Editor

Der Editor liest dieselbe gespeicherte Einstellung (`storedLevelFor`, Stufe für eigene Karten) und wendet den Teil
`customMaps` und den Auflösungsdeckel an, mit voller Skala, ohne dynamische Auflösung und immer mit MSAA.

## Messung

Stand nach den Draw Calls und KTX2 (RTX 5080, Median der GPU-Zeit je Bild, Spielansicht, DPR 1): Demo-Tal Low 0,72,
Medium 0,75, High 0,96, Ultra 1,12 ms; Hafenstadt Low 0,58, Medium 0,65, High 0,95, Ultra 1,20 ms. Bei DPR 2 kostet
Ultra im Demo-Tal 1,74-mal High (mehr Pixel durch den höheren Deckel). Werte, getrennte Messung der Ultra-Stellschrauben
und Grenzen in [BENCHMARKS.md](BENCHMARKS.md#je-qualitätsstufe-nach-den-draw-calls-und-ktx2-2026-10-14).

Je Stufe mit dem Grafik-Benchmark ([BENCHMARKS.md](BENCHMARKS.md#bildkosten-grafik-benchmark)), Ergebnisse dort.
