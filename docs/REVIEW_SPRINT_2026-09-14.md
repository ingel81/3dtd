# Review-Handover: Nachtschicht 2026-09-14

Zweite Nachtschicht, auf dem neuen Branch `sprint/night-2026-09-14`,
abgezweigt von `1ca6713a` (Ende der Nacht 1 plus Playtest-Doku). Der
Haupt-Checkout `D:/Source/3dtd` steht auf diesem Branch. Alles liegt lokal,
`main` und `sprint/night-2026-09-13` sind unberührt, nichts ist gepusht.
DONE.md ist nicht angefasst. In TODO.md steht der neue Abschnitt 1.9; was
die Nacht an Einträgen aus 1.8 bearbeitet hat, nennt seine Einleitung,
verschoben ist nichts (siehe "TODO-Stand"). Die Runde davor steht in
[REVIEW_SPRINT_2026-09-13.md](REVIEW_SPRINT_2026-09-13.md).

**Reihenfolge für den Playtest:** Die offenen Punkte der Nacht 1 bleiben
offen (REVIEW_SPRINT_2026-09-13.md, Abschnitt "Zwischenstand Playtest
2026-09-13 abends": alte Liste 34 und 36, dann 4, 5, 9, 14, 16, 27, 29, 33,
38, 41 bis 44, 53, 54; aus der Nacht-1-Liste 238 und die Punkte ab 101 ohne
Ergebnis). Wo diese Nacht an einem alten Punkt etwas geändert hat, steht es
am Anfang der Playtest-Liste unten. Danach die neuen Punkte ab Nummer 301.

**Stand dieses Dokuments:** letzter Durchgang. Code-Stand `f786f805`
(replay2), darüber die Handover-Commits. Eingearbeitet sind alle Features,
die Review-Fixes fix1 bis fix4 und replay2 und die Korrekturen des
Faktenchecks (geprüft am `1fe62ebc`, Delta bis `5e1de3f2`). Das Gate am
`f786f805` ist grün (Zahlen unter "Stand").

## Stand

| | |
|---|---|
| Branch | `sprint/night-2026-09-14`, letzter Code-Commit `f786f805` |
| Diese Nacht | 198 Commits `1ca6713a..f786f805`, davon 13 Handover-Commits; 423 Dateien, +43 572 / -4 254 Zeilen |
| Gesamt vor `main` | 686 Commits (bis `f786f805`) |
| Tests | Gate am `f786f805`: vitest 312 Testdateien, 3876 Tests grün, 27 übersprungen (die Shader-Compile-Tests, im Gate ohne `glslangValidator`); Nachtbeginn 241 Dateien mit 3034 Tests. Shader-Check mit glslang 11.7 am `f786f805` (Lead): 57 von 57 grün. pytest 101 (zuletzt fix3), `training-backend/` hat in der Nacht keinen Diff |
| Prüfung | Gate am `f786f805`: beide tsc, ESLint und Production-Build grün; Initial-Bundle 357,21 kB (Nachtbeginn 357,18 kB) |

Nichts davon lief im Browser. Optik, Laufzeiten, Klang und Speicher sind per
Code-Review, Tests und Rechnung geprüft, nicht angesehen, angehört oder
gemessen. Die Shader haben shadercheck und fix4 offline geprüft: Alle 27
Fälle, die 13 Materialien dieser Nacht (Sockel, Sockel-Vorschau, Abzeichen,
Ooze-Band, Blutmond-Stimmung, Suchscheinwerfer, VAT-Gegner mit Glühen,
Portal, HQ-Marker, Frost, EMP, Orbitalstrahl, Pilzwolke) und 14 ältere,
kompilieren und linken als GLSL ES 3.00 mit glslang 11.7.0, so wie three
r186 sie zusammensetzt. Im Gate laufen diese Compile-Tests nicht, dort
fehlt das Binary; der Lead hat den Check am `a26cd7dd` und am `f786f805`
mit glslang 11.7 laufen lassen, jeweils 57 von 57 Tests grün. Nicht geprüft sind
Treiber- und ANGLE-Eigenheiten und GPU-Grenzen (Zahl der Uniforms und
Varyings). Deshalb steht die Konsole weiter als erster Playtest-Punkt (301).

## Vorgehen

21 Worker in eigenen Git-Worktrees (blob2 als Fortsetzung von blob
gezählt), je ein Thema: assets (Blender), perf,
sockel, abilitybar, quickfix, worldmap, veterans, worm, blob (dazu blob2),
refactor, bossintro, bloodmoon, wavejump, hero, abilities, replay,
shadercheck, fix1, fix2, fix3 und fix4 (replay2 als Fortsetzung von replay). Vor jedem Merge hat der Lead den Diff gelesen, bei Bedarf
Nacharbeit angefordert, die Worker haben selbst auf den Nacht-Head rebased,
übernommen wurde per Fast-Forward (Teile per Cherry-Pick: `e92575f4`,
`ae5fe4f8`, die vat-Zerlegung). Nach jedem Merge lief das Gate: vitest,
beide tsc, ESLint, Production-Build. Vier Review-Agents haben den gemergten
Stand gelesen, ein fünfter das Replay (Abschnitt "Review"). Ein Faktencheck
hat dieses Dokument am `1fe62ebc` gegen Code, Configs und Commits geprüft,
dazu die Änderungen bis `5e1de3f2`; seine Korrekturen sind eingearbeitet.

Die Worker-Berichte nennen oft Hashes von vor dem Rebase. In diesem Dokument
stehen die Hashes des Branches.

## Was sich ändert

### Assets (assets, 6 Commits)

- **Held-Modell** (`f731e30f`): "SWAT" von Quaternius, CC0 1.0 (poly.pizza),
  oliv umgefärbt, eine kompakte MP im Skript dazugebaut (140 Dreiecke). 7 892
  Dreiecke, 62 Knochen, Clips `idle`, `walk`, `run`, `run_shoot`, `aim`,
  `shoot`. Lizenznachweis mit SHA-256 in
  `public/assets/models/hero/LICENSES.md`, Eintrag "SWAT (Hero, recoloured,
  gun added)" im Credits-Dialog. Skript `tools/blender/hero_mercenary.py`.
- **Wurm-Modelle** (`1a6d27a6`, Fix `e92575f4`): Kopf und Ringsegment,
  eigenes Werk aus `tools/blender/worm_boss.py`, statisch, je eine
  512er-Basisfarbe. Der Fix backt die Farben in eine Textur, weil der
  statische VAT-Pfad keine Vertexfarben liest (die Teile wären weiß
  gewesen). Segment 634 VAT-Vertices, Kopf 1 700.
- **Tank, Ghost, Mech** (`394fd2b0`, `007bb554`, `57e72d14`): Tank 5 094 auf
  4 477 VAT-Vertices (doppelte Vertices zusammengeführt, Look gleich); Ghost
  mit einem statt knapp zwei Schwebe-Zyklen (VAT 8,0 auf 4,2 MB, Zyklus
  3,5 s); Mech als ein geskinntes, dezimiertes Mesh, 42 455 auf 5 416
  VAT-Vertices, `mech_army` 4,2 auf 0,5 Mio. Vertices pro Frame. VAT aller
  Typen 105,2 auf 88,1 MB. Mech-Textur aus der Nähe weicher, die Sidebar-
  Vorschau zeigt seine kleinen Leuchtpunkte nicht mehr (im Spiel kommt das
  Leuchten wie vorher aus der Config).
- Mech (5 416) und Ghost (5 248) liegen knapp über dem Budget von 5 000.
  Alle Modelle nur in Blender und per Bake-Vergleich in Node geprüft, nicht
  im Spiel.

### Kamera: Ground-Pick-Cache und Benchmarks (perf, `8380bd01` bis `bff9d3e6`, 4 Commits)

- `GroundPickRoot` merkt sich die letzten 4 Strahlen samt Treffern. Ein
  Strahl gilt als gleich, wenn `near`, `far`, `firstHitOnly` und Layer
  stimmen und er am alten Treffer höchstens 1 mm vorbeigeht. Geleert wird
  bei jeder Traversierung der Tiles, bei Laden, Entladen und Sichtbarkeit
  eines Tiles, bei `needs-update` und wenn sich die Tiles-Gruppe bewegt.
  In DevWorld gibt es keinen Cache.
- Erwartung: In Ruhe casten die GlobeControls zwei Strahlen pro Frame, in
  Playtest 254 gemessen mit 0,27 ms je Strahl. Aus dem Cache 0,09 µs (Node).
  Die Wirkung im Browser ist nicht gemessen.
- `npm run bench` (läuft nicht mit `npm test`): Offscreen-Pfeile bei 20 000
  Gegnern im schlechtesten Fall (alle auf den letzten 15 % der Route) 2 bis
  3,5 ms je Tick bei 8 Hz, entlang der Route verteilt unter 1 % der
  Laufzeit; Hover-Pick bei 20 und 80 Towern 0,74 bis 0,88 ms bei einem
  Treffer, sonst wenige µs. Alles in Node, ohne Rendern.
- Nebenbefund, nicht geändert: `raycastTowers()` liefert den ersten
  getroffenen Tower in Einfügereihenfolge, nicht den vordersten.

### Steinsockel (sockel, `7185812f` bis `10c9b178`, 4 Commits)

- **Keine neuen Sperren**: `checkTowerPlacement` ist unverändert. Die
  Grundfläche entscheidet nur über Höhe und Sockel. Abgetastet werden 19
  bis 27 Punkte je nach Tower (Fire 27, Research Center 49) in Mitte und
  zwei Ringen. Ab 0,2 m Unebenheit stand der Tower mit `7185812f` auf der
  höchsten Probe, ein Sockel reicht bis zur tiefsten; seit fix1 hebt auf
  dem Boden nur, was der Boden allmählich erreicht, seit fix4 erkennt der
  Sockel Dächer am Boden rundherum (Abschnitte "Review-Fixes"). Proben mehr als 5 m über der Fläche unter dem Cursor (Fassade,
  Traufe) oder mehr als 30 m darunter zählen nicht.
- `footprintRadius` je Tower-Typ, am Modell gemessen: 2,4 m (Ice) bis 5,3 m
  (Fire), Research Center 10 m.
- `command:place-tower` trägt die Fußhöhe und neu `plinthHeight`. Damit
  starten LOS, LOS-Vorschau, Schussursprung, Tip-Marker und Mündungsfeuer am
  angehobenen Fuß, ohne weitere Codeänderung (Tests für LOS-Vorschau und
  LOS-Registrierung).
- Look: unregelmäßige Bruchsteine aus 3D-Voronoi-Zellen, Kalkmörtel, Moos
  in Fugen und auf Oberseiten, Bump, als `MeshStandardMaterial` mit
  `onBeforeCompile` (logdepthbuf und Farbraum bleiben erhalten). Ein Draw
  Call je Sockel. In der Bauvorschau durchscheinend und grün oder rot
  getönt wie der Vorschau-Tower. Verkaufen entfernt den Sockel.
- Review-Befund 1 (Autos, Hecken heben den Tower an) und seine Behebung:
  Abschnitt "Review-Fixes (fix1)".

### Linke Fähigkeitsleiste und Tabellen je Fähigkeit (abilitybar, `d697e4e7`, `3769d8e3`, `4479bc9f`)

- `d697e4e7`: Jede Fähigkeit trägt `icon` und `hotkey` in der Config,
  Tasten und Tastenübersicht kommen daraus.
- `3769d8e3`: Schmale Glasleiste am linken Rand des Spielfelds, senkrecht
  mittig. Der Atomschlag-Knopf ist aus dem Wave-Panel dorthin gezogen (der
  alte Knopf ist gelöscht). Gesperrte Fähigkeiten sind von Anfang an
  sichtbar, gedimmt mit Schloss, der Tooltip nennt Forschung und Preis
  (überholt durch `586f493e`, Fix-Session 2026-09-14: ein Knopf erscheint
  erst mit fertiger Forschung). Oben ein Platz für den Held-Knopf. Die Offscreen-Pfeile halten am linken Rand
  94 px Abstand.
- `4479bc9f`: VFX, Ton und Shake wählen per `abilityId` aus drei Tabellen
  (`abilityVfx`, `ABILITY_IMPACT_SOUNDS`, `ABILITY_IMPACT_SHAKE`), vollständig
  typisiert: Eine neue Fähigkeit ohne Einträge kompiliert nicht. Der
  Atomschlag verhält sich wie vorher. Erledigt den zweiten Teil des
  TODO-Punkts "Explosionsstufen in Echtzeit" aus 1.8.
- Diese drei Commits sind die Infrastruktur, auf der Held-Knopf und die
  drei neuen Fähigkeiten aufbauen.

### Wellen-Panel neu (abilitybar, `ecbf9a71` bis `dffae174`, 3 Commits)

- Die Kopfzeile "WAVE N" ist weg. Der Knopf heißt "▶ WAVE N", rechts die
  Tastenkappe Space; während einer Welle wie bisher Restzahl und Balken.
  Auto-Start als kleiner Schalter "auto 10s" unter dem Knopf statt der
  Checkbox; der Countdown ersetzt die Kappe. Das MIX-Badge entfällt.
- NEXT als Zeitleiste: fünf Marken (vorher zwei Zeilen), Totenkopf für
  Boss, Flugzeug für Luft; darunter eine Detailzeile zur gewählten Marke
  (Name, Anzahl oder Spanne, Rüstung als Schild, Schwächen als goldene
  Icons). Hover oder Fokus zeigt, Klick hält, Standard ist die nächste
  Welle.
- Emojis raus: Rüstung als graues Schild auch in der Gegnergruppen-Liste.
  `DAMAGE_TYPE_ICON` zieht aus `tower-stats.ts` nach `components/icon` und
  hat jetzt ein eigenes Icon je Schadensart (neu: sparkle, snowflake,
  burst). Nebeneffekt: Das
  Tower-Panel zeigt dieselben neuen Icons.

### Quickfix-Paket (quickfix, `7414ee13` bis `7914062f`, 12 Commits für 10 Punkte aus TODO 1.8)

1. `7414ee13`: Gegner schauen ab dem Spawn in Laufrichtung; vorher bis zum
   ersten Schritt nach Norden (sichtbar bei Debug-Gegnern).
2. `9619b82f`: Der Canvas folgt der Fenstergröße (ResizeObserver, der erste
   Fit sofort, danach höchstens alle 100 ms). Photo Mode ruft `fitToCanvas()`
   nicht mehr selbst.
3. `c3d6f89a`: Ein Wellenstart hebt die Pause auf (Knopf, Space, Auto-Start,
   Bot, Custom Wave).
4. `df847ee8`: Recent speichert einen Ort erst, wenn seine Route steht.
5. `9504032d`: Scheitert der Dialog-Chunk, bietet der Fehlerbildschirm
   "Reload" statt "Change tile credentials". `82f23124`: `@angular/animations`
   aus `package.json` und Lockfile (`node_modules` bleibt bis zum nächsten
   `npm install` gleich, der Build beweist die Abwesenheit also nicht; per
   Grep importiert nichts das Paket).
6. `46a096d2`: Der Nachhall der Fähigkeiten (beim Atomschlag 0,35 und
   0,9 s) läuft in Spielzeit: die Pause hält ihn an, höheres Tempo verkürzt ihn.
7. `dde04a9c`: Stirbt ein Debug-Skeleton außerhalb einer Welle, zielen die
   Tower weiter auf die Minions statt kurz zur Wache zu drehen.
   `cbd01d10`: Enemy Debug setzt Gegner auf die Route selbst (Mittellinie,
   ohne zufälligen Spurversatz und ohne Flughöhen-Variation), nicht mehr auf
   eine Kopie ab dem Klickpunkt.
8. `ae0a5f39`: Tab bleibt in der Photo-Leiste (eigener Handler, weil
   `cdkTrapFocus` im Photo Mode per CSS versteckt wäre).
9. `7c2530f6`: Der Beschwörungskreis ist mit Bloom sichtbar. Er ist als
   Schritt von einer Straße der Helligkeit 0,3 kodiert; exakt gleich hell
   ist er nur dort, bei 0,1 etwa 3,2-fach, bei 0,4 etwa 0,7-fach (gerechnet,
   nicht gemessen).
10. `7914062f`: Eine gesperrte Forschung reiht sich mit ihrer
    Voraussetzungskette ein (Voraussetzungen zuerst). Neue Regel: Wer auf
    eine Voraussetzung wartet, lässt den Nächsten an den Slot; wer auf Gold
    wartet, hält die Schlange wie bisher. Entfernen nimmt Abhängige mit.
    Überholt durch `a1bcb3d5` (Fix-Session 2026-09-14): zurückgenommen, ein
    gesperrter Knoten ist wieder nicht klickbar, die Queue läuft strikt in
    Reihenfolge, Entfernen nimmt nur den einen Eintrag.

### Weltkarte (worldmap, `0bbd9730` bis `fd374b9b`, 7 Commits)

- Beste Welle je Ort in `td_best_waves_v1`, geschrieben bei `wave:started`
  (Welle N gestartet heißt Welle N erreicht, damit zählen auch
  abgebrochene Läufe). Ort heißt: HQs innerhalb 150 m, wie bei Recent.
  Höchstens 200 Orte. DevWorld und Bot-Läufe zählen nicht, Cheats und
  Debug-Wellen schon (Ausnahme: Sprung zu Welle N).
- Globus als 2D-Canvas (kein zweiter WebGL-Kontext), orthografisch, nur
  Linien: Küsten, Grenzen, 30°-Gradnetz aus Natural Earth 1:110m (Public
  Domain), eingebettet mit 20 kB, als Lazy-Chunk von etwa 32 kB. Credits
  "Map Data".
- Drei Einstiege: Tab "World" im Ortsdialog, Knopf "World" im Sidebar-Fuß,
  Rekord-Hinweis 1,2 s nach Game Over unter Restart ("Skip" blendet aus).
  Ein Klick auf einen Ort lädt ihn wie ein Recent-Eintrag, mit dem Spawn des
  Rekordlaufs.
- Initial-Bundle unverändert. Die Globus-Komponente hat keinen Spec (jsdom
  hat kein Canvas); Zeichnen, Hover und Drag sind ungeprüft.

### Tower-Veteranen (veterans, `416725c6` bis `a250c4a6`, 4 Commits)

- Rein kosmetisch. Rang aus den Todesstößen (`combat.kills`, gab es schon):
  Recruit 0, Blooded 10, Veteran 50, Elite 150, Champion 400, Legend 1 000.
  Schwellen aus Bot-Logs vom 2026-08-28 (Median der Kills je Welle; damals
  war W19 noch `rat_tide`). Upgrade behält den Rang, Verkaufen nimmt ihn.
  Fähigkeiten, der Kill-Cheat und der Held geben keinen Tower-Kill.
- Abzeichen über dem Tower: Winkel in Silber, drei goldene Winkel für
  Champion, Stern für Legend. Ein Draw Call für alle, Billboard, 24 CSS-Pixel,
  blendet zwischen 700 und 1 100 m Kameraabstand aus, von Gebäuden verdeckt,
  im Photo Mode aus.
- Tower-Panel: Zeile mit Icon, Rangname, "57 / 150 kills" und Balken,
  Tooltip mit der Leiter.

### Wurm-Boss (worm, `051c5dc4` bis `bffae869`, 11 Commits)

- Neue Typen `worm` und `worm-segment`: eine Kette, jedes Segment ein
  eigener Gegner mit eigener HP (35 HP, Rüstung heavy, 4,5 m/s). Die Länge
  folgt der Route (der Kopf erreicht das HQ, wenn das letzte Segment das
  Portal verlässt), mindestens 16, höchstens 240 Segmente (600 m). Skala
  2,5: 7,2 m breit mit Beinen, ein Ring alle 2,5 m. Flaches Schlängeln (0,35
  der Korridorbreite, 40 m Wellenlänge). Die Segmente kommen einzeln aus dem
  Portal, was noch drin ist, ist nicht treffbar.
- **Split**: Wird ein Segment zerstört, laufen zwei Würmer weiter, das
  erste Segment hinter der Lücke wechselt ins Kopfmodell. Ein Balken für
  alle Teile ("Chitin Worm ×3"), Shake nur beim letzten Segment.
- **Rotation ab W35** (`7c6025b6`, `configs/boss-variants.config.ts`): W35,
  W55, ... bringen den Wurm statt der Boss-Welle des Directors, mit dessen
  HP-Multiplikator; nur im lokalen Director-Pfad, Wellen des
  Trainings-Backends werden nie ersetzt. W1 bis W30 unverändert, Director,
  Templates, Curriculum und `ai-schema.json` ohne Diff.
- **Gold**: fester Betrag je Welle (`goldBudgetForWave`), auf alle Körper
  verteilt. W35: 12 000 Kill-Gold plus 6 000 Abschlussbonus, ganz getötet
  also genau so viel wie die ersetzte Boss-Welle (Spec). Bei 240 Segmenten
  50 Gold je Segment.
- Enemy Debug setzt den Wurm an den Klickpunkt, das Kreuz entfernt ihn
  ganz. Ein verlangsamtes Segment bremst den Wurm über den Mittelwert der
  Slows.
- Nicht gebaut: Sound, Schwanzstück, Beinanimation. Jeder Ring hat eine
  eigene Healthbar.

### Gallert-Boss / Ooze (blob, `905d8b07` bis `4024618c`, 10 Commits; blob2 `f9e75ed6`, `d34a3af7`)

- Typ `ooze`: 3 000 HP, unarmored, 3 m/s, Boss. Ein Gegner, ein HP-Pool,
  der Körper ist eine Strecke auf der Route: Die Spitze kriecht voran, das
  Ende bleibt am Eintrittspunkt, bis der Körper 80 m lang ist (bei 3 m/s nach
  etwa 27 s), dann zieht es mit.
- **Treffen**: Jeder Tower zielt auf den nächsten Körperpunkt in Reichweite
  und Sicht (Stationen alle 2 m, Sicht aus der Boden-LOS der Zelle, sonst
  höchstens 4 Raycasts). Projektile, Flammen, Tentakel und Blitz treffen dort,
  Schadenszahlen und grüne Spritzer erscheinen dort. Splash und Atomschlag
  treffen, sobald ihr Kreis das Band berührt; der Atomschlag nimmt 20 % wie
  bei Bossen. Status-Effekte wirken aufs Ganze. `2a101005`: Ein Kettenblitz
  springt nur auf die Ooze, wo der Tower einen Zielpunkt hat.
- **Band**: prozedural auf der Route in Korridorbreite, eigener Shader mit
  logdepthbuf, Tone Mapping und Farbraum; giftgrün, durchscheinend, Blasen,
  Knochenreste, glänzender Rand (`OOZE_LOOK`).
- **Leck**: An der HQ fließt der Körper mit Spitzentempo hinein, jeder Meter
  kostet HP (voller Körper = 10 Lecks, im normalen Wellen-Cap von 18 HP), die
  HP der Ooze schrumpfen mit. Neues Event `enemy:leaking`.
- **Tod**: höchstens 10 Schleimklumpen (30 HP, 4,5 m/s), einer je 8 m
  Restkörper, eigenes kleines Modell aus `tools/slime-model/`. Leck und
  Debug-Kill hinterlassen keine.
- **Rotation**: `4024618c` trägt die Ooze in dieselbe Liste wie den Wurm ein,
  `['worm', null, 'ooze', null]`: W45, W65, ... Ooze.
- **Gold** (`f9e75ed6`, nur Spec): 11 Körper (Ooze plus 10 Klumpen), ganz
  getötet genau das Wellenbudget; eine junge Ooze zerfällt in weniger
  Klumpen, deren Anteil bleibt unbezahlt.
- **Sounds** (`d34a3af7`): Blubber-Loop, Splat, Schlürfen, im Code
  synthetisiert (fester Seed, kein Asset). Der Loop sitzt am Körperpunkt,
  der dem Hörer am nächsten ist, zählt nicht zum Budget von 12
  Gegner-Sounds und hält in der Pause an.
- Das Band ist offline geprüft (NVIDIA-Treiber als GLSL 330, dazu der
  Shader-Check mit glslang), nicht mit ANGLE oder im Browser.

### Code-Zerlegungen (refactor)

- **marker-shaders** (`9f0591b1` bis `7978eb04`, 3 Commits): 1 154 auf 430
  Zeilen, die Portal-Materialien liegen in
  `renderers/marker/spawn-portal-shader-chunks.ts`,
  `spawn-portal-gate-material.ts` und `spawn-portal-glow-material.ts`
  (dort auch `CIRCLE_STREET`). Ein Fingerprint-Spec vor dem Split, danach
  entfernt; ein Laufzeitvergleich alt gegen neu (review2) fand keinen
  Unterschied.
- **Training-Debugger** (`321edf85`, `ca88d039`): Die Funktions-Inputs
  `onEnableBot` und `onDisableBot` sind durch die Outputs
  `botEnableRequested` (mit Skill-Level) und `botDisableRequested` ersetzt,
  dazu die erste Spec unter `components/`, die eine Komponente selbst baut.
- **vat-baker** (`3ec7e210` bis `9e8393f1`, 5 Commits): 1 214 auf 447 Zeilen,
  Helfer in `vat-clips.ts`, `vat-encoding.ts`, `vat-surface.ts`; eine
  Merge-Funktion statt drei Kopien, eine Clip-Registry statt zwei. Nachweis
  per Hash-Spec über 24 Gegnermodelle und 6 synthetische Fälle, danach
  entfernt. `ae5fe4f8` deckt den Pool-Wechsel Ring zu Kopf des Wurms ab.
- **Pilzwolke** (`8ca1c4bf` bis `ac10bed9`, 3 Commits):
  `mushroom-cloud.renderer.ts` 1 052 auf 184 Zeilen (Wolken-Pool, Zünden,
  Frame-Schleife, Bloom-Stoß, Aufräumen); Form, Glühen, Rauch und
  Druckwelle liegen in `mushroom-cloud-shape.ts`, `-glow.ts`, `-smoke.ts`,
  `-blast.ts`, aufbauend auf `effect-buffers.ts` aus den Fähigkeiten.
  Nachweis per Fingerprint-Spec über zwei Läufe (Pause, 75x, zweiter
  Schlag, Slot-Wiederverwendung) unter geseedetem `Math.random`, danach
  entfernt.
- Keine Verhaltensänderung.

### Boss-Intro (bossintro, `88537dff` bis `be0d91fc`, 7 Commits)

- Auslöser: ein Boss, der aus dem Portal kommt (`enemy:spawned` mit neuem
  Feld `viaPortal`), der Wurm über `worm:spawned` (`be0d91fc`). Einmal je
  Bosstyp und Welle. Nur Wellen-Spawns und Custom Wave; kein Intro bei
  Debug-Platzierung, Photo Mode, Trainings-Bot, verbundenem
  Trainings-Backend, Tempo über 4x.
- Der Schnitt wartet, bis der Boss etwa 8 m aus dem Portal ist (Herbert bei
  1x etwa 2 s). Dann 220 ms Blende, Schnitt aufs Portal, 2,8 s Einstellung
  mit Titelkarte "BOSS · WAVE n" und Name, Schnitt zurück in die exakte
  vorherige Kamera; zusammen etwa 3,7 s. Kein Flug, weil ein schneller Flug
  über Kilometer nur Tile-Matsch zeigte.
- Das Spiel pausiert währenddessen (eine eigene Pause des Spielers bleibt
  danach bestehen). Klick oder Esc überspringt, die übrigen Spieltasten
  warten. Schalter "Boss Intro" im Display-Menü unter General, Standard an,
  gespeichert.
- Kein Hindernis-Check für die Einstellung (Kurven, Brücken, Hänge).

### Blutmond (bloodmoon, `626f0581` bis `fe69ba4c`, 10 Commits)

- Nur Look, keine Logik liest ihn. Jede 7. Welle ab W14 (W14, W21, W28,
  ...), nur die Wellennummer zählt, Custom Waves eingeschlossen. W35, W70
  ... sind zugleich Boss-Wellen.
- Stimmung per Multiplikations-Quad am Ende des opaken Durchgangs (Rotstich,
  dunklere Ecken), Himmel dunkler, Nebel dunkelrot; kein Composer-Pass,
  weil dessen Einschalten andere Shader hätte springen lassen. Folge:
  Transparentes (Feuer, Projektile, Healthbars, Kegel, Decals) bleibt
  ungetönt, und es gibt nur Tönung, keine Entsättigung.
- Blende 3 s ein, 4,5 s aus, auf Wanduhr, solange das Spiel läuft (steht in
  der Pause, gleich lang bei 1x und 4x).
- Gegner mit rotem Randleuchten (ein geteilter Uniform im VAT-Shader), auch
  Wurm und Ooze (`1b4311d6`, `74e0c8f3`). Suchscheinwerfer: ein additiver
  Kegel je Kampf-Tower, alle in einem Draw Call, 34 m lang, schwenkt ±60° um
  die Wachrichtung (Periode 10 bis 16 s).
- Schalter "Blood Moon" im Display-Menü unter General, Standard an. Mond auf
  der NEXT-Marke und ein Banner "BLOOD MOON" beim Wellenstart (3,6 s).

### Dev-Cheat: Sprung zu Welle N (wavejump, `f334663e` bis `b63f4320`, 3 Commits)

- Im Fenster Wave Debug der Abschnitt "Jump to wave": Feld (Standard 35),
  Name der Welle, Schalter "Gold of the skipped waves" (Standard an),
  Knopf. Nur zwischen Wellen, nur vorwärts, mindestens eine Welle
  übersprungen.
- Der Zähler springt auf N-1, nichts spawnt. Gold: Kill-Budget,
  Abschlussbonus und Meilensteine der übersprungenen Wellen ohne Skill-Boni,
  in der Game-Over-Bilanz als Cheat-Gold. Fähigkeiten laden nach, als wären
  die Wellen gespielt; Forschung und Auto-Start bleiben (sie laufen in
  Spielzeit). Director und Fairness-Gate unverändert, geplant wird aus dem
  Zähler, damit greifen Curriculum, Boss-Takt und Rotation für Welle N.
- Ab dem Sprung schreibt der Lauf keinen Bestwellen-Rekord mehr.
  `game:started` hängt jetzt an einem Flag statt an Welle 0.

### Held (hero, `9741ffb6` bis `46c300ac`, 13 Commits)

- **Freischalten**: Forschung "Mercenary Contract" (Global Perk, 600 Gold,
  30 s, nach Siege Engineering), danach einmal anheuern für 1 000. Der Weg
  kostet zusammen 2 500 (Gatling 400, Siege Engineering 500, Forschung,
  Anheuern); das kumulierte Einkommen erreicht 3 000 um W6, realistisch
  kauft man ihn W8 bis W10 (Herleitung in [HERO.md](HERO.md)). Bots
  überspringen die Forschung. `1e13ad5c` zählt ihn im Economy-Roster und
  erzeugt die Charts neu.
- **Steuerung**: Held-Knopf oben in der linken Leiste (vor dem Anheuern eine
  Münze ohne Taste, Klick kauft; danach das Personen-Icon mit G). G oder
  Knopf wählt ihn, zweiter Druck fährt die Kamera hin, V schaltet die
  Munition. Gewählt rastet ein Klick bis 30 m auf die Route; der Weg läuft
  per Dijkstra auf einem Graphen der Gegnerrouten, berechnet im Befehl
  (deterministisch). Er hält den Posten und verfolgt Gegner höchstens 20 m
  entlang der Route. 8 m/s.
- **Kampf**: 18 m Reichweite, Boden und Luft, ohne Sichtlinie,
  unverwundbar, Schaden über den `DamageApplicationService` mit Quelle
  `hero`. Munition Standard (physical, 16 × 3/s), Explosive (siege, 32 ×
  1,5/s, ohne Flächenschaden), Rune (magic, 24 × 2/s), je 48 DPS vor der
  Matrix; Tracer-Farbe und Schuss-Sample wechseln mit. Stufen bei 0, 30,
  100, 250, 500 Kills, Schaden ×1 bis ×1,6.
- **Fairness-Gate**: als virtueller Tower mit Präsenz 0,5 in
  `effectiveDPSPerArmor` und `killThroughput`, nicht in `totalDPS`. Seine
  Kills füttern den Leck-Regler normal.
- **Modell**: `mercenary.glb`, 4,5 m groß wie die menschengroßen Gegner
  (nicht 1,8 m), sonst stünde er als halbe Figur neben den Zombies. Die
  Mündung ist fest aus der Zielpose gemessen (`HERO.muzzle`), nicht pro
  Frame aus dem Modell gelesen, damit die Simulation bei jedem Tempo und
  ohne Renderer gleich bleibt. Beim Bau des Specs gefunden und behoben: Der
  Lader maß das Modell mit veralteten Knochenmatrizen, der Held wäre etwa
  13 cm groß gewesen.
- `46c300ac`: Er zielt auf den nächsten Körperpunkt der Ooze statt auf die
  Spitze. Dev-Cheat "Hero" macht die Forschung fertig und heuert ihn
  kostenlos an.

### Frostbombe, EMP, Orbitallaser (abilities, `eaf8d5f2` bis `fcc543fa`, 24 Commits)

- Jede nach dem Muster des Atomschlags: eigene Forschung, eine Ladung, eine
  neue nach je 3 abgeschlossenen Wellen, eigene Taste, Knopf in der Leiste
  (kommt automatisch aus der Config), Befehl über `command:use-ability`,
  Wirkung in festen Sub-Steps. Kills zählen im Fairness-Gate als Leck, über
  das neue Event `ability:resolved`.

| | Frostbombe (F) | EMP (E) | Orbitallaser (L) |
|---|---|---|---|
| Forschung | 700 Gold, 25 s, nach Arcane Studies | 800 Gold, 30 s, nach Storm Mastery | 1 500 Gold, 45 s, nach Master Engineering |
| Vorwarnung | 0,5 s | 0,5 s | 1 s |
| Fläche | 20 m Radius, Boden und Luft | 30 m Radius | Strahl mit 5 m Radius (etwa 10 m breit), läuft vom Klick die Route zurück Richtung Spawn, 18 m/s, 4 s, höchstens 72 m |
| Wirkung | Freeze 3 s, Bosse 1 s | Stun: Tank und Mech 6 s, Bosse 0,75 s, andere 1,5 s | Feuer 100 % der Max-HP je Sekunde (Bosse 30 %) mal Matrix `fire`, Kappe 60 % (Bosse 20 %) je Gegner und Strahl |

- Grundlagen: Freeze ist jetzt ein echter Halt (Bewegung und Laufzyklus
  stehen), neu der Status `stun`; Tank und Mech tragen `mechanical`. Die
  Hinweisbox sagt je Fähigkeit "Click Strike", "Click Freeze", "Click
  Pulse", "Click Fire". Der Dev-Cheat "Nuke" heißt jetzt "Abilities" und
  macht alle Fähigkeiten bereit.
- Frost und EMP kosten keine HP, sie verschaffen den Towern Zeit. Der Laser
  nimmt keinem Gegner mehr als der Atomschlag, reicht aber die Route
  entlang; über `fire` taugt er gegen ungepanzerte und leichte Gegner, kaum
  gegen befestigte und ätherische. Eine Welle bleibt offen, bis der Strahl
  aus ist. Freischaltzeitpunkte aus dem Curriculum-Gold geschätzt, kein
  Balance-Lauf.
- Wurm und Ooze (`fcc543fa`): Ein eingefrorenes oder betäubtes Segment hält
  den ganzen Wurm an (ein Slow geht weiter ins Mittel); die Ooze steht mit
  Spitze und Einfließen, das Band tönt weiß-cyan (Freeze) bzw. violett
  (Stun).
- Bots: strategist und meta erforschen und nutzen alle drei (Prioritäten 96,
  94, 93); ihre Läufe sind mit früheren nicht direkt vergleichbar.
- `2cfb850f`: Die Variable `flat` im Strahl-Shader ist in GLSL ES 3.00
  reserviert, der Strahl wäre nicht kompiliert. `7d5992da` erzeugt die
  Charts neu (Forschung gesamt 16 550 auf 19 550 Gold).

- `9d6d2d15` (nur Spec, Lead): Frost, EMP und Laser treffen die Ooze über
  ihren Körper, auch 95 m hinter der Spitze; der Laser hält die Boss-Kappe
  von 20 %, auch wenn alle 72 m seines Wegs auf dem Körper liegen. Kein
  Fehler gefunden.

### Replay der letzten Welle (replay, `a4d8c839` bis `4d415013`, 12 Commits)

- **Präsentations-Replay statt Re-Simulation**: Aufgezeichnet wird, was
  die Renderer gezeigt haben, abgespielt über dieselben Renderer; die
  Simulation wird nie berührt. Den Zustand beim Wellenstart zu sichern und
  die Welle mit den Befehlen neu zu simulieren, geht heute nicht
  verlässlich: Der Spawn nutzt ungeseedetes `Math.random()` (Seitenversatz,
  Flughöhe, Wahl des Spawnpunkts), die Sichtlinie der Tower kommt aus
  GPU-Readbacks gegen gestreamte Tiles, die Turmdrehung, die das Feuern
  freigibt, lebt im Renderer, und die Simulationsdienste sind Singletons des
  laufenden Spiels. Belege in [REPLAY.md](REPLAY.md). Zufall, GPU-LOS und
  Zellhöhen stehen auch in MULTIPLAYER_CONCEPT.md Abschnitt 2, Turmdrehung
  im Renderer und Singleton-Dienste kommen dazu. Alle `command:*` der Welle stehen trotzdem als
  Klartext im Log, mit der `WaveConfig` des Starts.
- **Bedienung**: "replay W12" im WAVE-Panel neben "auto 10s" (zwischen den
  Wellen) und "Replay wave N" auf dem Game-Over-Screen. Im Replay ist das HUD
  weg, unten mittig eine Leiste; freie Kamera (Maus, WASD, Pos1, N),
  Leertaste oder P pausiert, 0,25x bis 4x, Sprung über den
  Fortschrittsbalken mit Marken für eigene Befehle, Esc zurück. Kamera,
  Pause, Menü und Fokus kehren danach zurück wie vorher. Bauen, Verkaufen,
  Fähigkeiten und Photo Mode ruhen; über 1x kein Ton.
- **Aufnahme**: ab `wave:started` 10 Frames je Sekunde Spielzeit (Gegner
  22 B, Projektil 16 B, Turm 23 B, Ooze-Körper 12 B, Held 13 B je Frame),
  dazu Tabellen und Effekt-Events vom Bus. Nur die letzte Welle bleibt; der
  nächste Wellenstart, Neustart, Ortswechsel und ein Sprung zu Welle N
  (`360f5c82`) verwerfen sie. Ohne Rendering (Training) nimmt nichts auf.
- **Speicher**: höchstens 48 MB für die Stichproben. Bei 2 800 Körpern
  gleichzeitig sind das 616 KB je Sekunde, die Grenze reicht dann etwa 78 s
  mit 10 Frames/s; danach dünnt die Aufnahme auf 5, 2,5 und 1,25 Frames/s
  aus und hört zuletzt auf zu wachsen, das Replay endet dann früher. Mit
  einigen hundert Gegnern belegt eine dreiminütige Welle etwa 20 MB. Events
  höchstens 150 000, geschätzt bis 15 MB.
- **Kosten**: in vitest/jsdom 77 bis 84 µs je Frame bei 2 800 Gegnern, 300
  Projektilen und 60 Towern (erste Welle 96 bis 120 µs), etwa 0,8 ms je
  Sekunde Spielzeit; ohne Oozes und Held gemessen, im Browser nicht.
- **Nacharbeit** (`5c17dc88` bis `4d415013`): Held (Pose, Blickrichtung,
  Tracer je Munition, "LEVEL N"), Ooze-Bänder, Freeze und Stun, der
  Blutmond-Look der aufgezeichneten Welle; kein Replay, solange ein
  Boss-Intro läuft, und im Replay startet keins (`d9b0d17e`). `a4d8c839`:
  Die Zielwahl im Tower-Panel geht jetzt über `command:set-targeting`, damit
  sie im Befehlslog steht; für den Spieler gleich.
- **Nicht wiedergegeben**: Schadenszahlen, Gold-Popups, Aufblitzen der
  Kettenblitze, Eis-Explosionen der Eis-Treffer, Bodenmarken (angehalten),
  Gegner-Sounds, Ooze-Blubbern und Flammen-Loop, Verlauf des HQ-Feuers,
  Boss-Tod-Shake, Ringe des Helden; Upgrades nicht Schritt für Schritt.
  Gegner, die zwischen zwei Frames spawnen und sterben, fehlen. Landet im
  Replay eine Fähigkeit, räumt das Verlassen auch deren Effekte im
  Live-Spiel ab.
- Nicht im Browser gesehen; der Player ist mit Fake-Renderern getestet.
  review5 hat das Replay samt Nacharbeit gelesen, replay2 seine Befunde
  behoben (Abschnitt "Review-Fixes (replay2)").

### Review-Fixes (fix1, `2b7da859` bis `5744bcce`, 5 Commits)

Behebt die fünf Befunde von review1 (Abschnitt "Review", Befunde 1 bis 5).

- **Sockel neben Autos** (`f500aaaf`, Befund 1): Was den Tower heben darf,
  hängt jetzt davon ab, wo der Cursor steht. Liegt die Fläche unter dem
  Cursor mehr als 2,5 m über dem Boden ihrer eigenen Säule
  (`ROOF_ABOVE_GROUND`), gilt die Dach-Regel wie bisher: jede Probe bis
  5 m darf heben, First und gestufte Dächer bekommen ihren Sockel. (Stand
  `f500aaaf`: Zeigte die Säule unter einem Dach keinen Boden, galt dort die
  Boden-Regel; seit fix4 erkennt der Sockel Dächer zusätzlich am Boden
  rundherum, siehe dort.) Sonst gilt die Boden-Regel: Nur Proben, die
  der Boden vom Cursor aus allmählich erreicht, zählen; ein Schritt zur
  Nachbarprobe darf beliebig fallen, aber nur 0,5 m (`MAX_STEP`) plus die
  Steigung unter dem Cursor steigen. Die Steigung kommt aus
  gegenüberliegenden Proben des inneren Rings, je Paar die kleinere Seite,
  damit ein Auto auf einer Seite sie nicht verkippt. Der Sockel reicht
  weiter bis zur tiefsten Probe. Warum nicht einfach die Bodenhöhe der
  Säule: In der Photogrammetrie ist ein Auto eine Beule in derselben
  Fläche, ohne Boden-Treffer darunter.
- **Weniger Säulen in der Bauvorschau** (`5744bcce`, Befund 2): Die Vorschau
  probt erst Mitte und inneren Ring; liegen die eben, folgt der äußere Ring
  einen Frame nach dem Anhalten des Cursors, beim Klick sofort. Ergebnis
  gleich, ein Sockel, den nur der äußere Ring verlangt (Flachdachkante),
  erscheint erst im Stillstand. Eine Wegwerf-Messung in Node (ohne BVH)
  schätzt 0,26 bis 0,76 ms je Säule, also 5 bis 14 ms je Validierung für
  einen Tower und 13 bis 37 ms für das Research Center; beim Überstreichen
  ebenen Bodens 7 bis 10 Säulen (Research Center 17) statt 19 bis 49. Im
  Browser nicht gemessen.
- **Abzeichen liest die Kills jeden Frame** (`bf573095`, Befund 5):
  `TowerManager.syncVeteranBadges()` statt des `tower:kill`-Abos; ein Weg,
  der `kills` ohne Event setzt (Wiederherstellen, Replay), zeigt das
  Abzeichen jetzt auch. Sichtbar gleich.
- **Doku** (`2b7da859`, `386a17c1`, Befunde 3 und 4): Kommentar zu
  `TileSetVersion` nennt die Events, die den Cache wirklich leeren;
  WAVE_SYSTEM.md sagt NEXT statt COMING UP.

### Review-Fixes (fix2, `bea17437` bis `913a66ee`, 10 Commits)

Behebt die neun Befunde von review2 (Abschnitt "Review", Befunde 6 bis 14).

- **BodyAim merkt sich die Raycasts** (`bea17437`, Doku `913a66ee`, Befund
  6): je Körperpunkt die Antwort (unbekannt, frei, verdeckt), bis sich
  `TerrainQueries.lodVersion` ändert (jeder fertige Tile-Load) oder die
  Ansicht neu gebaut wird; ein LOS-Eintrag der Zelle hat Vorrang. Spec: über
  40 Züge erst 4, am Ende 0 Raycasts je Zug.
- **Ooze ist ab dem ersten Leckpunkt ein Leck** (`188bacc2`, Befund 7):
  einmal, auch wenn sie danach stirbt; für Wellenstatistik und Run-Stats.
  Die Leck-Quote des Fairness-Gates ändert sich laut fix2 nicht (sie las für
  eine solche Ooze schon vorher 1), wohl aber `enemiesKilled`,
  `enemiesReachedBase` und die Game-Over-Übersicht.
- **HQ-Shake höchstens alle 900 ms** (`684993d6`, Befund 8), auf der
  Wanduhr, im Takt des roten Rands; ein härterer Treffer schüttelt sofort.
  Gilt auch ohne Ooze: mehrere gleich starke Lecks innerhalb 900 ms
  schütteln einmal.
- **Suchscheinwerfer folgt der neuen Wachrichtung** (`ee4a3722`, Befund 10),
  sofort, auch während der Welle.
- **Bodendecals unter dem Blutmond getönt** (`3f1f5fdc`, Befund 11): Blut-,
  Eis- und Brandflecken nehmen den geteilten Tint.
- **Zwei Bosstypen, ein Intro** (`96715cb0`, Befund 12): Bosse derselben
  Welle, die beim Start noch warten, laufen mit ("HERBERT & OOZE"), die
  Einstellung bleibt beim ersten; ein später kommender anderer Typ bekommt
  weiter ein eigenes.
- **DoT-Zahl auf dem Körper** (`dfcf1d5c`, Befund 9) und **Flammenkegel
  über den Körper** (`15a1778f`, Befund 13): Der Kegel prüft zusätzlich die
  Körperpunkte an seinem Ende und seiner Mitte; kreuzt der Körper schräg,
  können beide Stichproben einen Treffer verfehlen.
- **Spec für `mergeBakedMeshes`** (`f68a1553`, Befund 14, erster Teil); die
  Portal-Shader-Inhalte haben weiter keine eigene Spec.

### Review-Fixes (fix3, `d597329f` bis `8d34c49e`, 5 Commits)

Behebt die fünf Befunde von review3 (Befunde 15 bis 19).

- `d597329f` (Befund 15): Das Band der Laser-Zielvorschau wird beim Abbau
  der Engine entsorgt.
- `900cadff` (Befund 16): Anheuern und Marschbefehl zeigen den Helden sofort
  (`presentFrame()` im Befehl, wie beim Tower), auch in der Pause. Ein
  Neubau des Routengraphen in der Pause zeigt sich weiter erst beim
  Fortsetzen.
- `eea57760` (Befund 17): Die Forschungsquote im Snapshot zählt nur die 11
  Knoten, auf denen das ONNX-Modell trainiert wurde (Trainingsstart
  `1d173d32`, Export `e8ae88a9`); der Baum hat heute 20. Betrifft nur das
  Opt-in-Modell und Trainingsläufe (Dashboard "Completed x/11"). Der Held
  bleibt im DPS-Eingang, dokumentiert in AI_WAVE_DIRECTOR_PLAN.md
  Abschnitt 7.
- `8d34c49e` (Befund 18): Routengraph ohne Objekte je Kante, Suchpuffer für
  die Lebensdauer des Graphen; am Posten ohne Ziel eine Graph-Abfrage statt
  einer je 250 ms. Golden-Trace über 8 000 Sub-Steps vorher und nachher
  byte-gleich; Node-Bench mit 20 000 Neuplanungen 278 bis 289 ms und 20 GCs
  auf 150 bis 160 ms und 2 bis 3 GCs (synthetischer Graph, nicht im Spiel
  gemessen).
- `ede0b617` (Befund 19): Frost-, EMP- und Laser-Bots zielen einmal je
  Entscheidung.

### Shader-Compile-Check (shadercheck, `795f9cef` bis `292d788f`, 3 Commits)

- `npm run shader-check` (läuft auch in `npm test`): Der echte
  `WebGLRenderer` von three r186 läuft über einem Ersatz-Kontext, der nur
  die Quelltexte aufhebt; `renderer.compile()` setzt die Programme wie im
  Spiel zusammen (Chunks, `onBeforeCompile`, Log-Depth, Prefix), in drei
  Aufbauten wie in der Engine (sRGB-Canvas mit Nebel, Composer-Ziel,
  Canvas ohne Nebel). `glslangValidator -l` kompiliert und linkt beide
  Stufen als `#version 300 es`; ein eigener Test prüft, dass jedes benutzte
  Fragment-`in` ein Vertex-`out` hat.
- Ergebnis: 13 Fälle, alle grün, kein Fix nötig. Den Stand vor `2cfb850f`
  (`flat` im Strahl-Shader) erkennt der Check (`unexpected FLAT`). fix4 hat
  14 ältere Materialien dazugenommen, seitdem 27 Fälle.
- Das Binary gehört nicht zum Repo: `GLSLANG_VALIDATOR` oder
  `glslangValidator` im PATH, Bezugsquelle in ARCHITECTURE.md §13. Ohne
  Binary laufen nur die Aufbau-Tests, die Compile-Tests stehen als
  übersprungen da (so im Gate; seit fix4 "30 passed | 27 skipped (57)"). Die
  Log-Depth-Prüfung dieser Aufbau-Tests las bis `4bf9ade9` nur die Defines,
  die three ohnehin setzt; ein Material ohne die Chunks hätte bestanden
  (review4, Befund 20). Gelaufen mit 11.7.0, die dort genannte
  16.6.0 ist nicht getestet.
- `292d788f`: Kommentar zu `forceSinglePass` in `vat-material.ts` und die
  Gotcha zu `USE_INSTANCING` in ARCHITECTURE.md §13 richtiggestellt (three
  setzt das Define für jedes Material auf einem InstancedMesh selbst).

### Review-Fixes (fix4, `4bf9ade9` bis `a26cd7dd`, 4 Commits)

Behebt die vier Befunde von review4 (Abschnitt "Review", Befunde 20 bis 23).

- **Dach erkannt am Boden rundherum** (`a26cd7dd`, Befund 21): Geben Dach-
  und Boden-Regel verschiedene Füße und zeigt die eigene Säule keinen Boden
  mehr als 2,5 m tiefer, werden 8 Säulen rund um die Grundfläche geprobt,
  8 m jenseits davon (`ROOF_PROBE_REACH`). Zeigen beide Säulen eines
  gegenüberliegenden Paars Boden mehr als 2,5 m unter der Cursor-Fläche,
  gilt die Dach-Regel. Ein Hang fällt nur zu einer Seite ab und bleibt
  Boden; ein Auto neben dem Gehweg hebt weiter nicht (die Specs von fix1
  unverändert grün). Ein gestuftes Dach ohne Boden unter den Säulen ergibt
  jetzt Fuß 12 m mit 2 m Sockel statt 10 m ohne. Wo die Regeln einig sind,
  wird nichts zusätzlich geprobt, sonst 8 Säulen mehr je Validierung (nicht
  gemessen). In Dev-Builds gibt `__footprintDebug()` für die letzte
  Vorschau Cursor-Fläche, `centreGroundY` und `centreTopY` der
  Cursor-Säule, Regel, Fuß, Sockel und den Boden der 8 Umgebungsproben aus;
  damit lässt sich im Playtest klären, ob die Tiles unter Dächern Boden
  zeigen (die Kommentare im Code widersprechen sich dazu).
- **Log-Depth-Prüfung liest die Zuweisungen** (`4bf9ade9`, Befund 20): statt
  der Defines, die three in jedes ShaderMaterial schreibt, `vFragDepth =` im
  Vertex und `gl_FragDepth =` im Fragment. Ein Material ohne die Chunks
  fällt jetzt durch (Negativtest).
- **Eigener Temp-Ordner je Lauf** (`d4ae0f6b`, Befund 22): Parallele Läufe
  stören sich nicht mehr; scheitert `glslangValidator -E`, bricht der Test
  ab, statt still zu bestehen.
- **14 ältere Materialien als Fälle** (`0ae09431`, Befund 23): Lebensbalken,
  Boden-Decals, Floating Text, Blitze, Projektil-Orbs und -Trails, Tentakel,
  DevWorld-Terrain, LOS-Cube-Material (Mesh und InstancedMesh), Debug-Quad
  der Cube-Faces, Tower-LOS-Layer, Routenraster-Overlay, Luftrouten-Röhren,
  Farbkorrektur-Pass. Alle kompilieren mit glslang 11.7, kein Fix nötig.
  Ohne Log-Depth, im Fall begründet: Farbkorrektur-Pass, Luftrouten-Röhren,
  Debug-Quad. Nicht erfasst: `/engine-test` (nicht Teil des Spiels). Mit
  Binary laufen jetzt 57 Tests im Check, ohne sind 27 übersprungen.

### Review-Fixes (replay2, `b7f974da` bis `f786f805`, 8 Commits)

Behebt die sieben Befunde von review5 (Abschnitt "Review", Befunde 24 bis
30), per Cherry-Pick übernommen; je Befund ein Commit, dazu die Doku in
`f786f805` (REPLAY.md, EVENT_SYSTEM, ARCHITECTURE).

- `b7f974da` (24): Nahe der Grenze wachsen die Spalten, die wachsen müssen,
  um bis zur Hälfte ihres Bedarfs mehr, soweit das Budget reicht: ein bis
  zwei Kopien vor dem Ausdünnen statt einer je Frame (Spec mit kleinem
  Budget: vorher fünf, jetzt höchstens zwei).
- `7474bcd2` (25): Der AudioService des Players hört auf einem eigenen Bus,
  der Töne und Einschläge nur bei einem Tempo mit Ton bekommt; über 1x und
  nach einem Sprung fällt der ausstehende Nachhall weg.
- `b74352a0` (26): Jeder Sprung räumt wartende Zielmarker ab und, wenn im
  Replay eine Fähigkeit gelandet ist, Pilze, Frost, EMP und Laser, wie beim
  Verlassen auch die des Live-Spiels.
- `ec10db08` (27): `pointerup` und `pointercancel` beenden das Ziehen am
  Balken ebenfalls. Ohne Spec (kein Komponenten-Harness), nicht im Browser
  geprüft.
- `28ea36d0` (28): Suchscheinwerfer lassen sich je Tower ausblenden und
  folgen der Sichtbarkeit im Replay; ein in der Welle verkaufter Tower
  bekommt im Replay einen eigenen Kegel, der um eine zufällige Richtung
  schwenkt (seine Wachrichtung steht nicht in der Aufnahme).
- `4ae0f3be` (29): Der Recorder hört Wellenstart, Startbefehl und
  Wellensprung über normale Listener und hängt nur während einer
  aufgezeichneten Welle am Catch-all-Pfad; jeder Schritt ist geschützt, ein
  Fehler verwirft die Aufnahme. Der `GameEventBus` führt Catch-all-Listener
  jetzt isoliert wie die übrigen. Folge: Zwischen den Wellen und im Training
  behält der Bus seinen schnellen Pfad, während einer aufgezeichneten Welle
  nicht.
- `cd4036d9` (30): Das Replay nimmt je Frame höchstens 50 ms Wanduhr, wie
  die Spieluhr; unter 20 Bildern je Sekunde läuft es langsamer als sein
  Tempo.
- Bewusst nicht behoben: die zwei Hinweise von review5 ("Befunde, offen"
  17).

## Revert: Abhängigkeiten und Probe

Jeder Bereich wurde probeweise mit `git revert --no-commit` zurückgenommen
und danach verworfen: zuerst alle am `fcc543fa`, die von späteren Commits
berührten noch einmal am `292d788f` (mit den Handover-Commits darüber).
"Am Head" heißt `292d788f`. Die Probe zeigt nur
Textkonflikte; ob der Stand danach baut und die Tests besteht, ist nicht
geprüft. Git hält beim ersten Konflikt an, was dahinter kommt, ist dann
nicht mehr geprüft. "Doku" heißt: der Konflikt liegt nur in einem Dokument.

| Bereich | Probe | Abhängigkeiten |
|---|---|---|
| Ground-Pick-Cache `8380bd01` bis `bff9d3e6` | Konflikt in `ground-pick-root.ts` (Kommentar aus `2b7da859`); mit `2b7da859` zuerst konfliktfrei | Der Benchmark `42fb575b` nutzt den Cache |
| Assets Held `f731e30f` | nur `docs/ENEMY_MODEL_BUDGET.md` | `9b802416` lädt das GLB; ohne Datei ist der Held unsichtbar (Warnung in der Konsole) |
| Assets Wurm `1a6d27a6`, `e92575f4` | nur `docs/ENEMY_MODEL_BUDGET.md` | `f2a403b6` lädt sie, nur mit dem Wurm zurücknehmen |
| Tank, Ghost, Mech `394fd2b0` bis `57e72d14` | nur `docs/ENEMY_MODEL_BUDGET.md` | danach `npm run model-budget` |
| Sockel `7185812f` bis `10c9b178` | Doku `ARCHITECTURE.md`; ohne den Doku-Commit Konflikt in `tower-placement.service.ts` (fix1); nach `5744bcce` und `f500aaaf` Konflikte in `tower.manager.ts`, `three-tiles-engine.ts` und drei Specs (Nachbarzeilen von Veteranen und Blutmond) | erst die beiden Placement-Fixes von fix1 zurücknehmen (zusammen konfliktfrei), dann Handarbeit; die Commits bauen aufeinander auf |
| Leiste `d697e4e7`, `3769d8e3` | Wave-Panel, `tower-defense.component.*`, `ABILITIES.md`, `DESIGN_SYSTEM.md` | Wellen-Panel, Held-Knopf `613af403` und alle neuen Fähigkeiten bauen darauf; nur mit ihnen zurücknehmen |
| Tabellen je Fähigkeit `4479bc9f` | Audio, VFX, Shake samt Configs und Specs | die neuen Fähigkeiten tragen sich dort ein, der Nachhall `46a096d2` baut darauf |
| Wellen-Panel `ecbf9a71` bis `dffae174` | `97d6f690`: NEXT, `upcoming-waves.ts`, Tower-Panel, `icon.component.ts` | Wurm-Vorschau (`7c6025b6`), Blutmond-Marke (`87a878e5`) und Veteranen-Zeile (`c299f5fa`) bauen darauf |
| Quickfix, 12 einzeln | konfliktfrei: `7414ee13`, `9619b82f`, `c3d6f89a`, `df847ee8`, `82f23124`, `46a096d2`. Konflikt: `9504032d` und `ae0a5f39` (`tower-defense.component.ts`), `dde04a9c` (Order-Spec), `cbd01d10` (`game-event-bus.ts`), `7c2530f6` (die Datei hat refactor verschoben), `7914062f` (nur Doku) | `46a096d2` braucht `4479bc9f` |
| Weltkarte `0bbd9730` bis `fd374b9b` | Doku `LOCATION_SYSTEM.md`; ohne Doku Konflikt in `tower-defense.component.ts` (`61fd3d46`) | Der Sprung-Cheat meldet `wave:jumped` an den `BestWaveService`: erst ihn zurücknehmen oder von Hand lösen |
| Veteranen `416725c6` bis `a250c4a6` | Doku `EVENT_SYSTEM.md`; ohne Doku `icon.component.ts` (`c299f5fa`), auch nach `bf573095` | Handarbeit gering (Icon-Liste); `bf573095` (fix1) baut auf dem Abzeichen auf, allein konfliktfrei |
| Wurm `051c5dc4` bis `bffae869` | allein: `worm-chains.ts` (`fcc543fa`); zuerst `fcc543fa`, `74e0c8f3`, `ae5fe4f8`, `be0d91fc`: Stopp in der generierten `ENEMY_MODEL_BUDGET.md` (`c555c734`), dahinter nicht geprüft | Die Ooze-Rotation `4024618c` steht in der Datei, die `7c6025b6` anlegt; Assets Wurm |
| Ooze `905d8b07` bis `4024618c`, blob2 | Doku `a3890e48`; ohne Doku `ooze-bodies.ts` (`939f31a8`); zuerst Held `46c300ac`, Blutmond `1b4311d6`, blob2 und `fcc543fa`: Stopp in `three-tiles-engine.ts` (`52a6527d`) | `4024618c` allein und blob2 allein konfliktfrei; Handarbeit in der Engine |
| Zerlegungen | marker (`9f0591b1` bis `7978eb04`), Debugger (`321edf85`, `ca88d039`) und `ae5fe4f8` konfliktfrei; vat (`3ec7e210` bis `9e8393f1`) Konflikt in `vat-material.ts` | Der Blutmond (`3e3af93b`) importiert aus `vat-surface.ts` |
| Boss-Intro `88537dff` bis `be0d91fc` | Doku `b17924c1`; die sechs Code-Commits konfliktfrei | `be0d91fc` braucht den Wurm, allein konfliktfrei |
| Blutmond `626f0581` bis `fe69ba4c` | Doku `1aa13049`; ohne Doku Konflikt in `three-tiles-engine.ts` (Held daneben) | `1b4311d6` (Ooze) und `74e0c8f3` (Wurm) allein konfliktfrei |
| Sprung zu Welle `f334663e` bis `b63f4320` | am `fcc543fa` allein Konflikt (`game-event-bus.ts`, `game-commands.handler.ts`, GSM-Specs), nach Fähigkeiten und Held konfliktfrei; am Head stoppt diese Kette schon beim Held (siehe dort) | braucht den `BestWaveService` der Weltkarte |
| Held `9741ffb6` bis `46c300ac` | am `fcc543fa` allein Konflikt (Doku `613af403`, `hero-control.service.ts`, `hotkey.service.ts`, `tower-defense.component.ts`), nach den Fähigkeiten konfliktfrei; am Head nach Pilzwolke und Fähigkeiten nur noch in `docs/INDEX.md` (`90938f8b`, die Nachbarzeile hat dieses Handover geändert), dahinter nicht geprüft | `613af403` braucht die Leiste, `9b802416` das Held-GLB, `46c300ac` die Ooze |
| Fähigkeiten `eaf8d5f2` bis `fcc543fa`, dazu `9d6d2d15` | am Head allein Konflikt in `docs/ABILITIES.md` (die Zerlegung der Pilzwolke nennt dort ihre Dateien; der Faktencheck fand am `1fe62ebc` in Einzelschritten den ersten Stopp bei `325512de`), mit der Pilzwolke zuerst konfliktfrei. Am `5e1de3f2` nicht mehr am Stück: mit der Pilzwolke zuerst Stopp bei `1f92f349` (Laser-Bot, danach von fix3 `ede0b617` geändert); mit fix3 zuerst Stopp bei `0db2d032` (`icon.component.ts`, `game-state.manager.ts`); mit Replay und fix3 zuerst Stopp bei `325512de` (`visual-effects.config.ts`, `combat-effect.service.ts`). Am Head einzeln konfliktfrei: `fcc543fa`, `4234de2e`, `9d6d2d15`; Laser (`8fc55ae8`, `a25e0260`, `0db2d032`, `1f92f349`, `538ddf87`, `2cfb850f`) nur Doku `ABILITIES.md`. Frost oder EMP allein: Konflikt in `strategy-bot.factory.ts`, `research-pick.strategy.ts`, `ABILITIES.md`, `BOT_SYSTEM.md` | brauchen Leiste und Tabellen; EMP nutzt den Halt-Weg aus `325512de` (Frost); die Pilzwolke nutzt `effect-buffers.ts` aus `459235bd`; Replay, fix2 und fix3 ändern dieselben Dateien |
| Pilzwolke `8ca1c4bf` bis `ac10bed9` | konfliktfrei | `66a94828` baut auf `459235bd` (Fähigkeiten) auf |
| fix1 `2b7da859` bis `5744bcce` | `2b7da859`, `386a17c1`, `bf573095`, `5744bcce` einzeln konfliktfrei; `f500aaaf` nur zusammen mit `5744bcce`. Am `94d9b012` kollidiert das Paar in `tower-footprint.ts` und `tower-placement.service.ts`; mit `a26cd7dd` (fix4) zuerst konfliktfrei | `5744bcce` baut auf `f500aaaf` auf; beide auf dem Sockel, `bf573095` auf dem Abzeichen |
| Shader-Check `795f9cef` bis `292d788f` | am `292d788f` konfliktfrei; am `94d9b012` allein Doku-Konflikt in `ARCHITECTURE.md` (`88523460`), mit den drei Shader-Commits von fix4 zuerst konfliktfrei | nur Test, Doku und Kommentare |
| Replay `a4d8c839` bis `4d415013` | am `4d415013`: ganzer Bereich konfliktfrei; einzeln konfliktfrei auch `a4d8c839`, `360f5c82`, `d9b0d17e` und die Nacharbeit `5c17dc88` bis `4d415013` für sich | `a4d8c839` entbehrlich (dann fehlt nur die Zielwahl im Befehlslog); die Nacharbeit liest Held, Ooze, Freeze und Stun, Blutmond, Boss-Intro und Sprung-Cheat |
| fix2 `bea17437` bis `913a66ee` | am `4d415013` einzeln konfliktfrei: `bea17437`, `188bacc2`, `684993d6`, `96715cb0`, `f68a1553`, `913a66ee`; Doku-Konflikt: `ee4a3722` (`WAVE_SYSTEM.md`), `dfcf1d5c` und `15a1778f` (gemeinsame Zeile in `ENEMY_CREATION.md`); Code-Konflikt: `3f1f5fdc` in `three-effects.renderer.ts` (das Replay hängt daneben an) | `913a66ee` beschreibt `bea17437` |
| fix3 `d597329f` bis `8d34c49e` | am `4d415013` einzeln konfliktfrei außer `900cadff` (`hero.manager.ts` und Spec, die Replay-Nacharbeit liegt daneben) | sonst voneinander unabhängig |
| replay2 `b7f974da` bis `f786f805` | am `f786f805`: ganzer Bereich konfliktfrei, zusammen mit dem Replay ebenfalls; einzeln konfliktfrei außer `cd4036d9` (Spec) und `7474bcd2` (`replay-player.ts` und Spec), auf die spätere Commits aufbauen | alle bauen auf dem Replay auf; `4ae0f3be` ändert auch den `GameEventBus` |
| fix4 `4bf9ade9` bis `a26cd7dd` | am `94d9b012`: `a26cd7dd` und `0ae09431` einzeln konfliktfrei, die drei Shader-Commits zusammen konfliktfrei; `4bf9ade9` und `d4ae0f6b` allein nicht (dieselbe Spec, die späteren bauen darauf) | `a26cd7dd` baut auf fix1 (`f500aaaf`) auf; `0ae09431` braucht `4bf9ade9` und `d4ae0f6b` |

Am Head wiederholt: Ground-Pick-Cache, Sockel, Veteranen, Fähigkeiten, Held,
Sprung, die Boss-Intro-Code-Commits, die einzelnen Ooze- und
Blutmond-Commits (`4024618c`, blob2, `1b4311d6`, `74e0c8f3`), marker,
Debugger, `ae5fe4f8`, die sechs konfliktfreien Quickfixes und die neuen
Bereiche. Die übrigen Angaben (Assets, Leiste, Tabellen, Wellen-Panel, die
übrigen Quickfixes, Weltkarte, Wurm, Ooze und Blutmond als Ganzes, vat)
stammen aus der Probe am `fcc543fa`.

Kurz: Am `292d788f` gingen Pilzwolke und Fähigkeiten zusammen sauber
zurück, danach der Held (bis auf eine Doku-Zeile); seit Replay, fix2 und
fix3 braucht der Fähigkeiten-Block Handarbeit. Perf (mit `2b7da859`), Boss-Intro (ohne
Doku), fix1 (die Placement-Fixes mit `a26cd7dd` zuerst), der Shader-Check (mit den
Shader-Commits von fix4 zuerst), fix2 und fix3 bis auf je einen Commit und
die meisten Quickfixes gehen einzeln.
Alles, was die Engine-Felder, `tower.manager.ts` oder
`tower-defense.component.ts` teilt (Sockel, Veteranen, Blutmond, Ooze, Held,
Leiste), braucht Handarbeit an Nachbarzeilen.

**Generierte Dateien nach einem Revert:** `npm run economy-chart` und
`npm run wave-planner` (Held und Fähigkeiten ändern die Forschungskosten),
`npm run model-budget` (Assets, Wurm, Ooze), zur Sicherheit
`npm run tower-stats-chart` und `npm run ai-schema`; danach `git diff`
ansehen.

## Entscheidungen für dich

Von Workern selbst getroffen, bitte im Playtest bewerten:

1. **Held 4,5 m groß** (`9b802416`), wie die menschengroßen Gegner, nicht
   1,8 m. Eine Zahl (`HERO_MODEL.heightM`); wer sie ändert, muss
   `HERO.muzzle` neu messen, der Spec meldet es.
2. **Held-Preis** 600 Forschung plus 1 000 Anheuern, also etwa W8 bis W10.
   Ein Klick ohne Gold bleibt ohne Meldung (der Tooltip nennt den Fehlbetrag
   vorher). Held-Kills zählen nicht für Veteranen-Ränge.
3. **Gesperrte Fähigkeiten sichtbar** mit Schloss (`3769d8e3`). Wer sie
   versteckt haben will: im Template nur Knöpfe mit `state !== 'locked'`.
   Überholt durch `586f493e` (Fix-Session 2026-09-14): entschieden, ein
   Knopf erscheint erst mit fertiger Forschung, `locked` gibt es nicht mehr.
4. **NEXT zeigt fünf Wellen**, und das Tower-Panel hat neue
   Schadensart-Icons (Siege als Explosion, Magie als Stern, Lightning als
   Blitz statt Schwert).
5. **Sockel-Grenzen**: Schwelle 0,2 m, Proben bis 5 m über und 30 m unter
   der Cursorfläche, runder Sockel (steht bei eckigen Basen seitlich über),
   kein LOS-Blocker für andere Tower.
6. **Wurm-Maße**: Skala 2,5 statt 3,6 (bei 3,6 wäre er 10,4 m breit, die
   Portalöffnung hat bei Skala 1 8 m und folgt sonst der Korridorbreite), 35 HP je Segment, höchstens 240 Segmente, weil
   jedes Segment ein ganzer Gegner ist und 240 Segmente 133 s aus dem Portal
   brauchen.
7. **Frost und EMP halten den ganzen Wurm** an, sobald ein Segment steht
   (`fcc543fa`). Über den Mittelwert würde eine Frostbombe auf 16 von 240
   Segmenten den Wurm nur um 7 % bremsen, und die vereisten Segmente
   rutschten mit.
8. **Ooze-Werte**: 3 000 HP, 80 m, voller Körper im HQ = 10 Lecks, 10
   Klumpen à 30 HP. Ungespielt.
9. **Rotation** `['worm', null, 'ooze', null]`: W35 Wurm, W40 Director, W45
   Ooze, W50 Director, dann von vorn. Die Größe der Varianten-Wellen
   bestimmt nicht das Fairness-Gate.
10. **Boss-Intro** pausiert das Spiel, nur bei Wellen-Spawns, einmal je
    Bosstyp und Welle; zwei Bosstypen in einer Welle bekommen zwei Intros
    hintereinander.
11. **Blutmond** als Rotstich über ein Multiplikations-Quad: Transparentes
    bleibt ungetönt; Blende auf Wanduhr, steht in der Pause.
12. **Veteranen-Schwellen** aus Bot-Logs, nicht aus Spielen von Menschen.
    Nachjustieren an einer Stelle: `VETERAN_RANKS`.
13. **Weltkarte**: Eine Welle zählt als erreicht, sobald sie startet, auch
    bei sofortigem Abbruch; Cheats und Debug-Wellen setzen Rekorde, ein
    Sprung zu Welle N nicht.
14. **Sprung-Gold** ohne Skill-Boni (Perfect, Close Call, Combo): die untere
    Linie eines sauberen Laufs.
15. **Research-Queue**: Wer auf eine Voraussetzung wartet, gibt den Slot
    ab; vorher galt strikt die Reihenfolge (`7914062f`). Überholt durch
    `a1bcb3d5` (Fix-Session 2026-09-14): wieder strikt in Reihenfolge, eine
    gesperrte Forschung lässt sich nicht einreihen.
16. **Beschwörungskreis** auf Straßenhelligkeit 0,3 kalibriert (`7c2530f6`).
17. **Orbitallaser** läuft Richtung Spawn (trifft die Kolonne frontal) und
    macht Feuerschaden.
18. **Bot-Baselines**: strategist und meta nutzen jetzt Frost, EMP und Laser,
    den Held nicht.
19. **Debug-Gegner auf der Mittellinie** (`cbd01d10`), ohne zufällige Spur
    und Flughöhe.
20. **Sockel: Dach-Regel und Boden-Regel** (`f500aaaf`): Auf dem Boden hebt
    nur, was der Boden allmählich erreicht (0,5 m je Nachbarschritt plus
    Steigung). Folgen: Steht der Cursor auf einem Autodach, kommt der Tower
    dorthin (die Cursor-Fläche zählt); Terrassenmauern und Böschungen, die
    neben ebenem Cursor steiler steigen, heben nicht mehr; auf einem
    Parkdeck (Dach-Regel) heben Autos weiter. Seit fix4 gilt die Dach-Regel
    auch, wo die eigene Säule keinen Boden zeigt, der Boden rundherum aber
    tief liegt (Entscheidung 28).
21. **Sockel an der Flachdachkante erst im Stillstand** (`5744bcce`): Beim
    schnellen Überfahren fehlt ein Sockel, den nur der äußere Ring
    verlangt; er erscheint einen Frame nach dem Anhalten, der Klick setzt
    ihn immer.
22. **Keine npm-Abhängigkeit für den Shader-Check** (`795f9cef`): Eine
    Abhängigkeit, die glslang mitbringt, wurde bewusst abgelehnt; das
    Binary kommt über `GLSLANG_VALIDATOR` oder den PATH. Folge: Ohne
    installiertes `glslangValidator` prüft `npm test` nur den Aufbau der
    Shader, die Compile-Tests (am `4d415013` 13, seit fix4 27) stehen als
    übersprungen da (so auch im Gate).
23. **Forschungsquote des ONNX-Modells über 11 Knoten** (`eea57760`): Die
    Quote zählt nur den Baum, auf dem das Modell trainiert wurde; bei einem
    neuen Training muss die Liste bewusst erweitert werden. Der Held bleibt
    im DPS-Eingang (auf Stufe 1 24 bis 48 effektive DPS je Rüstung), ihn
    herauszurechnen bräuchte ein zweites Snapshot-Feld in beiden Encodern.
24. **Ooze ab dem ersten Leckpunkt ein Leck** (`188bacc2`), auch wenn sie
    danach stirbt; in der Game-Over-Übersicht fehlt sie dann bei den Kills.
25. **HQ-Shake gedrosselt** (`684993d6`): höchstens alle 900 ms, das gilt
    auch für normale Lecks.
26. **Zwei Bosse, ein Intro** (`96715cb0`): Ein zweiter Boss, der beim Start
    des Intros noch im Portal steht, wird auf der Karte genannt, aber nicht
    gezeigt.
27. **Replay ohne Re-Simulation** (`91346c78` bis `acded7cb`): Es zeigt, was
    die Renderer gezeigt haben; ein Sprung zu Welle N verwirft die Aufnahme
    (`360f5c82`).
28. **Dach am Boden rundherum erkannt** (`a26cd7dd`): 8 zusätzliche
    Säulenproben, wo Dach- und Boden-Regel uneinig sind, statt eine
    Annahme über die Tiles zu treffen, die niemand geprüft hat. Grenzen:
    Damm oder Kuppe mit Abfall zu zwei Seiten gilt als Dach, die Mitte sehr
    großer Dächer ohne Boden unter der Säule als Boden.

## Review

Fünf Review-Agents haben gelesen, alle nur lesend. Keiner fand einen Befund
der Schwere hoch. Die 23 Befunde von review1 bis review4 sind bearbeitet:
Bei 14 und 17 ist ein Teil bewusst offen (siehe dort), ob die Behebung von
21 trägt, klärt Playtest 429; die übrigen 20 sind vollständig behoben.
Behoben haben sie fix1 bis fix4 (Abschnitte "Review-Fixes"). Was die
Fix-Worker bewusst ausgelassen haben, steht bei den Befunden und unter
"Befunde, offen". Die sieben Befunde von review5 (Replay, 24 bis 30) hat
replay2 behoben, die zwei Hinweise nicht.

**review1**, `1ca6713a..bffae869` (54 Commits: Assets, perf, Sockel, Leiste,
Wellen-Panel, Quickfix, Weltkarte, Veteranen, Wurm): 1 mittel, 4 niedrig,
alle behoben.

1. **Sockel hebt Tower auf Autos, Hecken, Mauern** (mittel): Jede Probe nahm
   die oberste Fläche ihrer Säule (`topY`), ein Tower neben parkenden Autos
   stand etwa 1,5 m höher auf einem Sockel um die Autos. Behoben
   `f500aaaf` (Boden-Regel).
2. **19 bis 49 ungecachte Säulen-Raycasts je Validierung** im Bau-Modus
   (niedrig), alle 1 m Cursorweg, auch auf ebenem Grund. Behoben
   `5744bcce` (äußerer Ring erst im Stillstand).
3. **Kommentar zu `TileSetVersion`** nannte `needs-update` als Weg des
   Fade-Plugins, der sendet es nicht (niedrig, nur Begründung falsch; fix1
   hat im Plugin-Code nachgelesen und keinen veralteten Cache-Pfad
   gefunden). Behoben `2b7da859`.
4. **WAVE_SYSTEM.md nannte das Panel "COMING UP"** (niedrig). Behoben
   `386a17c1`.
5. **Veteranen-Abzeichen änderte sich nur über `tower:kill`** (niedrig):
   Ein Wiederherstellen, das `kills` setzt, ohne das Event zu senden, hätte
   den Rang im Panel, aber kein Abzeichen gezeigt. Behoben `bf573095`.

**review2**, `bffae869..fe69ba4c` (40 Commits: Ooze, Boss-Intro, Blutmond,
Zerlegungen): 1 mittel, 8 niedrig, alle behoben (fix2). Ohne Fehler im
Spielablauf (Targeting, Splash, Kettenblitz, Status-Effekte, Atomschlag,
Leck, Reset, Pause).

6. **BodyAim wiederholte den Raycast-Rückfall in jedem Tower-Zug**
   (mittel, Performance): Lagen Körperpunkte der Ooze in Zellen ohne
   LOS-Eintrag des Towers, kostete jeder Sub-Step bis zu 4 rekursive
   Raycasts gegen die Tiles je Tower. Behoben `bea17437` (Antwort je Punkt
   gemerkt bis zum nächsten Tile-Load); ein Debug-Override der Tip-Höhe
   verwirft den Cache nicht.
7. **Wellenstatistik und Run-Stats zählten eine Ooze erst als Leck, wenn
   sie ganz drin war** (niedrig). Behoben `188bacc2`; die Leck-Quote des
   Gates war laut fix2 nicht betroffen.
8. **Screen Shake bei jedem Leckpunkt der einfließenden Ooze** (niedrig).
   Behoben `684993d6` (höchstens alle 900 ms, Wanduhr).
9. **Treffpunkt der Ooze konnte veraltet sein** (niedrig, nur Optik).
   Behoben `dfcf1d5c` für DoT-Zahlen.
10. **Suchscheinwerfer schwenkte nach einem Reichweiten-Upgrade um die alte
    Richtung** (niedrig, nur im Blutmond). Behoben `ee4a3722`.
11. **Bodendecals bekamen die Blutmond-Tönung nicht** (niedrig). Behoben
    `3f1f5fdc`.
12. **Zwei Bosstypen in einer Welle: zwei Intros direkt hintereinander**
    (niedrig). Behoben `96715cb0` (ein gemeinsames Intro).
13. **Flammenkegel traf die Ooze nur an ihrem Zielpunkt** für diesen Tower
    (niedrig). Behoben `15a1778f` mit zwei Stichproben am Körper.
14. **Nach dem Entfernen der Fingerprint-Specs fehlte eine direkte
    Abdeckung** für `mergeBakedMeshes` und die Portal-Shader (niedrig).
    Behoben für `mergeBakedMeshes` (`f68a1553`); die Portal-Shader bleiben
    ohne eigene Spec.

**review3**, `fe69ba4c..fcc543fa` (Sprung-Cheat, Held, Fähigkeiten): 5
niedrig, kein mittlerer, alle behoben (fix3). Geprüft ohne Defekt:
Atomschlag unverändert (nur `ability:impact` kommt jetzt vor dem Schaden,
Treffer und Kills in `ability:resolved`), `isSlowed()`,
Status-Zusammenspiel, Laser, Determinismus, Gate-Buchung, Bots ohne Held,
Tasten, Shader, Aufräumen bei Restart und Ortswechsel.

15. **Band der Laser-Zielvorschau wurde nie entsorgt** (niedrig): eine
    Geometrie und ein Material je Engine-Lebensdauer. Behoben `d597329f`.
16. **Held nach Anheuern in der Pause unsichtbar und nicht anklickbar**
    (niedrig, nur Darstellung), ebenso blieb der Postenring nach einem
    Marschbefehl in der Pause am alten Ort. Behoben `900cadff`; ein Neubau
    des Routengraphen in der Pause zeigt sich weiter erst beim Fortsetzen.
17. **Eingaben des ONNX-Modells verschoben sich** (niedrig, nur beim
    Opt-in-Modell): neue Forschungen vergrößerten den Nenner der
    Forschungsquote, der Held erhöht `effectiveDPSPerArmor`. Behoben
    `eea57760` für die Quote (Entscheidung 23); der Held bleibt im
    DPS-Eingang.
18. **Held plante bei hohem Tempo mit vielen kurzlebigen Objekten neu**
    (niedrig). Behoben `8d34c49e`, Bahn byte-gleich.
19. **Zielsuche der drei neuen Bot-Strategien lief je Entscheidung
    doppelt** (niedrig, nur Bots). Behoben `ede0b617`.

**review4**, `fcc543fa..292d788f` (12 Commits: Ooze-Spec, fix1, Pilzwolke,
Shader-Check, Doku): 1 mittel, 3 niedrig, alle behoben (fix4). Geprüft
ohne Befund: der Pilzwolken-Split (die Charakterisierungs-Spec läuft
unverändert gegen den neuen Code), die Abzeichen je Frame, der
Determinismus der Platzierung, die Zahlen der Boden-Regel.

20. **Log-Depth-Prüfung im Shader-Check griff bei `ShaderMaterial` ins
    Leere** (mittel): Sie suchte Defines, die three in jedes Programm
    schreibt; ein Material ohne logdepthbuf-Chunks bestand. Kein heutiges
    Material war betroffen. Behoben `4bf9ade9`.
21. **Dach-Regel las nur den Boden der eigenen Säule** (niedrig, mittel,
    falls die Tiles unter Dächern keinen Boden zeigen): Ohne Boden unter
    der Säule gab ein gestuftes Dach keinen Sockel, am Steildach steckte der
    Tower bis 0,5 m im Dach. Behoben `a26cd7dd` (Boden rundherum); ob die
    Voraussetzung auf echten Tiles zutrifft, klärt Playtest 429.
22. **Fester, geteilter Temp-Ordner im Shader-Check** (niedrig): Parallele
    Läufe konnten sich die Quellen löschen, ein gescheitertes Präprozessieren
    bestand still. Behoben `d4ae0f6b`.
23. **"Ein Fall je Material" galt nur für die Materialien dieser Nacht**
    (niedrig, Doku). Behoben `0ae09431` (14 ältere Materialien als Fälle).

Hinweis aus review4, kein Defekt: Auf dem Rechner der Nacht gibt es kein
`glslangValidator`, das Gate-Grün schließt den Compile-Schritt also nicht
ein; die Fix-Worker und der Lead (57 von 57 am `a26cd7dd`) haben mit
einem Binary aus dem Scratchpad geprüft.

**review5** (Replay, gelesen am Worker-Branch vor dem Merge, auf dem Branch
`a4d8c839` bis `4d415013`): 1 mittel, 6 niedrig, 2 Hinweise. Der Kern hält:
Das Live-Spiel bleibt während des Replays unverändert, das Verlassen stellt
Kamera, Pause, Timescale, Tower, Held und Blutmond zurück, die Spielbefehle
sind gesperrt, die Determinismus-Prüfung fand nichts. Alle sieben Befunde
sind behoben (replay2), die zwei Hinweise nicht.

24. **Nahe der Speichergrenze wachsen die Stichproben-Spalten in jedem
    Frame neu** (mittel, Kosten): Würde das Verdoppeln einer Spalte das
    Budget von 48 MB sprengen, wächst sie nur auf genau den Bedarf; bis das
    Ausdünnen greift, legt dann jedes Frame die betroffenen Spalten neu an
    und kopiert rund 46 MB, kurz nahe dem doppelten Budget. Betrifft nur
    Wellen mit mehr als 2^21 Gegner-Stichproben (etwa 500 Gegner über rund
    7 Minuten oder 2 800 über rund 75 s), bei 500 Gegnern rund 380 Frames
    in Folge. Belegt mit einer Probe-Spec (Budget 1 MB, 54 Neuanlagen in
    Folge); Hänger im Browser nicht gemessen. Behoben `b7f974da`.
25. **Einschlagsounds der Fähigkeiten laufen auch über 1x** (niedrig),
    obwohl das Replay dort sonst stumm ist. Behoben `7474bcd2`.
26. **Zielmarker bleibt nach einem Sprung über den Einschlag bis zum
    Verlassen stehen** (niedrig, nur Darstellung); nach einem Sprung zurück
    vor den Einschlag kommen Pilz, Frost, EMP und Laser doppelt. Behoben
    `b74352a0`.
27. **Ein Klick auf den Regler ohne Wertänderung lässt das Replay
    pausiert** (niedrig; `change` feuert dann nicht, im Browser nicht
    geprüft). Behoben `ec10db08`, ohne Spec (kein Komponenten-Harness).
28. **Suchscheinwerfer ausgeblendeter Tower leuchten im Replay einer
    Blutmond-Welle** (niedrig): Kegel an den leeren Stellen später gebauter
    Tower. Behoben `28ea36d0`.
29. **Der Recorder hängt ungeschützt am Debug-Listener-Pfad des Busses**
    (niedrig): Würfe er bei einem Event, bekäme kein normaler Listener das
    Event; einen konkreten Wurf gibt es nicht. Die Abkürzung für einen Bus
    ohne Debug-Listener greift nie mehr, auch nicht im Training. Behoben
    `4ae0f3be`; der Bus behält den schnellen Pfad jetzt zwischen den Wellen
    und im Training, während einer aufgezeichneten Welle nicht.
30. **Das Replay läuft mit ungedeckeltem Frame-Delta** (niedrig): Ein
    langer Frame spielt bei 4x und 500 ms 2 s Events auf einmal ab. Behoben
    `cd4036d9` (höchstens 50 ms je Frame).

Hinweise ohne Defekt, bewusst nicht behoben: Ein Replay-Tower-Modell, das beim Verlassen noch
lädt, bliebe danach stehen (praktisch nicht erreichbar, das Modell liegt im
Cache); die Leiste stößt die Change Detection mit 20 Hz an, nicht gemessen.

## Befunde, offen

In TODO.md unter 1.9 eingetragen. Die Befunde von review1 bis review4 sind
bearbeitet; was die Fix-Worker bewusst ausgelassen haben, steht unter 16.
Von review5 sind die zwei Hinweise offen (17).

1. **Pause**: Nur der Ooze-Loop hält an; Loops von Zombies und Flammen laufen
   in der Pause weiter.
2. **Mech und Ghost** knapp über dem Budget; der Ghost hat 1 487 doppelte
   Dreiecke in zwei deckungsgleichen Lagen.
3. **Wurm**: An scharfen Ecken können außen Lücken aufgehen; Beine starr,
   kein Schwanzstück, kein Sound; eine Healthbar je Ring.
4. **Boss-Varianten** (Wurm, Ooze) ohne Fairness-Gate für ihre Größe,
   Balance ungespielt.
5. **Ooze**: Gold-Popup, Offscreen-Pfeil und Knochen-Burst an der Spitze;
   Klumpen ohne Tod-Sound.
6. **Held**: Ablehnung ohne Meldung; ohne GLB unsichtbar; Tracer in der
   Lauf-Schieß-Pose bis 0,2 m neben dem Lauf; nicht in `totalDPS`.
7. **Fähigkeiten**: keine eigenen Sounds für Frost und EMP, keine
   Warnsirene; Eiskristalle an großen Modellen klein.
8. **Blutmond**: Transparentes ungetönt; auf W35 läuft das Banner eventuell
   unter dem Schleier des Boss-Intros ab.
9. **Leiste**: `ABILITY_BAR_EDGE_PX` hängt nur per Kommentar am SCSS; bei sehr
   niedrigen Fenstern kann die Leiste das Info-Overlay berühren.
10. **Quickfix-Reste**: Training-`total_count` zählt Minions (Entscheidung
    offen); `hasRoutes` bei Neuerzeugung der Spielkomponente ungeprüft;
    Kreis exakt nur bei Straßenhelligkeit 0,3.
11. **Hover-Pick** nimmt den ersten statt des vordersten Towers (nicht
    nachgestellt).
12. **Boss-Intro** ohne Hindernis-Check; die Tastenübersicht nennt Esc zum
    Überspringen nicht.
13. **Sockel nach fix1 und fix4**: Ob die Tiles unter Dächern Boden zeigen,
    ist unbelegt (Playtest 429). Auf Damm, Kuppe oder Terrasse, die zu zwei
    Seiten stark abfällt, gilt fälschlich die Dach-Regel; in der Mitte sehr
    großer Dächer ohne Boden unter der Säule die Boden-Regel. Neben Autos,
    Mauern und an Dachkanten 8 Säulenproben mehr je Validierung, nicht
    gemessen; eine Probe auf einer Autoflanke kann bis 0,5 m heben.
14. **Shader-Check** braucht `glslangValidator` von Hand; ohne ihn prüft
    `npm test` nur den Aufbau, nicht das Kompilieren (27 Compile-Tests
    übersprungen).
15. **Replay**: keine Re-Simulation, solange die Determinismus-Blocker
    bestehen (ungeseedeter Zufall beim Spawn, GPU-LOS, Turmdrehung im
    Renderer, Singleton-Dienste); nicht wiedergegeben werden unter anderem
    Schadenszahlen, Gold-Popups, Gegner-Sounds und Bodenmarken; im Browser
    nicht gesehen, Kosten nur in jsdom gemessen.
16. **Reste der Review-Fixes**: Portal-Shader ohne eigene Spec; der
    BodyAim-Cache verfällt nicht bei einem Debug-Override der Tip-Höhe; eine
    Ooze, die über einen Wellenwechsel ins HQ fließt, zählt doppelt (im
    normalen Ablauf nicht möglich); HQ-Shake-Drossel auf der Wanduhr;
    Flammenkegel mit zwei Stichproben; Neubau des Routengraphen in der
    Pause; weitere Eingangsverschiebungen des ONNX-Modells nicht untersucht.
17. **Replay-Hinweise aus review5**: Ein Replay-Tower-Modell, das beim
    Verlassen noch lädt, bliebe danach stehen (praktisch nicht erreichbar);
    die Replay-Leiste stößt die Change Detection mit 20 Hz an, nicht
    gemessen. Seit `cd4036d9` läuft das Replay unter 20 Bildern je Sekunde
    langsamer als sein Tempo.

## Playtest-Liste

**Ergebnisse Playtest 2026-09-14 (Nachmittag, nach der Fix-Session)**,
vorsortiert in `tmp/fix1/reports/sorter-night2.md` (überholt, per Test,
User, zurückgestellt):
- **305/306 ok:** nach dem Laden im Stillstand keine `cameraControls`-
  Raycasts (Nacht 1 etwa 5 000); beim heftigen Manövrieren 2 019 Aufrufe
  in 65 s, 0,25 ms im Mittel. **307, 308, 330 ok.**
- **309/310, 311 (auch mit Bloom), 312, 431 ok.**
- **315/432, 402, 316, 401 ok:** auf perfekt ebener Fläche kein Sockel,
  in allen anderen Fällen ist der Sockel laut User korrekt.
- **430 ok.** **429:** gleichzeitig im Spiel zeigen und in der Konsole
  tippen ist zu umständlich; `__footprintDebug` bekommt einen Beobachtungs-
  modus (footprintdbg), dann erneut: Konsole `__footprintDebug.watch()`,
  dann im Spiel mit dem Build-Cursor auf Flachdach bzw. Straße stehen
  bleiben, je Ruhepunkt kommt eine Zeile; `__footprintDebug.watch(false)`
  beendet.
- **366 ok** mit Wunsch: die Kamera könnte näher an den Boss vor dem Tor
  (tweaks). **370 ok. 303 ok.** **304:** Ghost ok; der Tank sitzt zu tief,
  mit Höhenversatz 1 im Enemy Debugger sind die Ketten wieder sichtbar
  (tweaks setzt `heightOffset` 1). Umgesetzt von tweaks2: Tank
  `heightOffset` 0 auf 1 (der Lebensbalken steigt mit); Boss-Intro-Kamera
  näher am Boss (Herbert bei Skala 1: 23 m statt 31 m). **Nachtest:** 366
  mit Herbert und dem Chitin Worm (Boss groß genug im Bild, Portal noch
  lesbar dahinter), 304 Tank per Custom Wave (Ketten sichtbar). Hinweis:
  bei den heutigen Bossen setzt ab Portalgröße 1 das ganze Portal samt
  Krone den Mindestabstand; noch näher geht nur, wenn die Krone oben
  angeschnitten werden darf (`BOSS_SHOT.crown` über 1).
- **Logik-Punkte per Szenario-Test (verifyC, verifyD):** Logikteile der
  Bündel Fähigkeiten/Leiste, Wellen-Panel, Held, Boss-Intro/Blutmond,
  Ooze/Wurm/Kampf, Veteranen/Weltkarte und Quickfix per Test bestätigt,
  meist in neuen `*.scenario.spec.ts`, 331 bis 333 und 337 mit vorhandenen
  Specs, 334 nur per grep (`npm ci` und `ng build` im frischen Checkout
  nicht gelaufen); einige Verdrahtungen nur per Code (321, 393, 398, 400).
  Ausnahme 421 (D1, D2 unten). Überholt: Schwenk in 373/374 (`6a42d3a5`),
  Haarlinie in 384 (`586f493e`), Charakterisierungstest in 405, Fußzeile in
  346. Befunde zu 421: **D1** das Leck-Budget (18 HP je Welle) deckelt das
  Wackeln der Ooze am HQ nach etwa 2,3 s bei 4x, der rote Rand pulst
  weiter (Text von 421 zu eng); **D2** ein Zombie-Leck in W45 (5 HP) wackelt
  innerhalb von 900 ms nach einem Ooze-Punkt nicht, weil der Faktor bei
  0,5 geklemmt ist; ob "härter" die Amplitude oder die HP meint, ist eine
  Entscheidung (offen). Die Augen-/Ohren-Teile stehen in den Runden E bis N
  (ohne J) der Vorsortierung.
- Überholt: 317, 322, 339, 406, 434. Zurückgestellt: Replay 407 bis 418
  und 435 bis 440 (User: Replay eigenes Thema), 323 (Offener Punkt 8 im
  Fix-Handover), 428 (optional).

Nummeriert, damit du mit "305 ok, 312 kaputt" antworten kannst. Die neuen
Punkte beginnen bei 301.

**Zuerst: alte Punkte, die diese Nacht berührt**

- **Nacht 1, 248** (Beschwörungskreis mit Bloom): siehe 338.
- **Nacht 1, 254** (Kamera-Raycasts in Ruhe): siehe 305.
- **Nacht 1, bei 237** (Debug-Gegner schauen falsch): siehe 329.
- **Nacht 1, Wunsch Tower auf schrägen Dächern**: siehe 309 bis 316.
- **Nacht 1, 109** (Research-Queue): die Queue nimmt jetzt Ketten, siehe 339.
- **Nacht 1, 110** (Auto-Start): jetzt ein Schalter, siehe 324.

**Vorab: Werkzeuge**

- Konsole: F12, Reiter Console. Ein kaputter Shader meldet sich beim Laden
  oder beim ersten Auftauchen als `THREE.WebGLProgram: Shader Error` und das
  betroffene Objekt fehlt.
- Dev-Menü: Quick Actions unten rechts, ganz rechts der Knopf "Developer
  options". Gruppe **Cheats**: Kill (alle Gegner tot, gibt keinen
  Tower-Kill), Credits (+1 000, Shift+Klick +100 000), +HP (+1 000, Shift+Klick
  +100 000; Rechtsklick -10, Shift+Rechtsklick -50 für die HQ-Feuerstufen), Research (alle
  Forschungen fertig), Max Up, **Abilities** (alle vier Fähigkeiten
  erforscht und geladen), **Hero** (Forschung fertig, Söldner kostenlos
  angeheuert). Gruppe **Waves & Inspect**: Waves öffnet Wave Debug (Single,
  Typ, Count, "Start Custom Wave"; darin der Abschnitt **Jump to wave**),
  Enemies öffnet Enemy Debug ("Place enemy on route", Klick auf die Route,
  "Start moving").
- Späte Wellen: Wave Debug, Jump to wave, Zahl eintragen, Knopf, dann Space.
  W14 ist die erste Blutmond-Welle, W35 der Wurm, W45 die Ooze.

**Vorab**

301. Echten Ort laden, Konsole offen, danach nacheinander einen Tower aufs
     Dach (Sockel), Welle mit Kills (Abzeichen), Ooze und Wurm per Custom
     Wave, Sprung auf W14 (Blutmond), Cheat Abilities und F, E, L zünden:
     keine Zeile `Shader Error`, nichts fehlt.

**Modelle**

302. Sidebar-Fuß, Attributions: Eintrag "SWAT (Hero, recoloured, gun
     added)", Quaternius, CC0; Abschnitt "Map Data" mit Natural Earth,
     "Public Domain".
303. Custom Wave Mech (oder W28): laufen wie vorher (Beine und Kolben
     synchron), gleiche Größe, Tarnfarbe, Warnstreifen; aus der Nähe
     weichere Textur. Mech in der Sidebar-Vorschau: normal texturiert,
     nicht weiß.
304. Tank (W9): unverändert facettiert. Ghost (W13): gleiches Schweben und
     gleiche Schleier, der Zyklus wiederholt sich nach 3,5 s statt 6,7 s.

**Kamera-Cache**

305. Echten Ort laden, warten, bis keine Tiles mehr nachladen. Konsole
     `__raycastStats(true)`, 10 s nichts anfassen, `__raycastStats()`: die
     Zeile `cameraControls` fehlt oder hat nur wenige Aufrufe (in 254 etwa
     5 000).
306. Danach 10 s zoomen und ziehen, `__raycastStats()`: `cameraControls`
     zählt wieder; Zoomen und Ziehen fühlen sich an wie vorher.
307. Direkt nach dem Laden, solange Tiles fein werden, bis zum Anschlag auf
     eine Straße zoomen: die Kamera hält nah am Boden, nicht in der Luft,
     nicht darunter. Über einer grob geladenen Stelle ruhen, bis sie fein
     ist, dann ziehen und drehen: der Boden bleibt unter dem Zeiger.
308. Nah an ein nachladendes Gebäude zoomen: die Kamera bleibt über dem
     Dach. Ortswechsel, Tiles per Debug aus und ein, `?devworld`: Zoom,
     Ziehen und Drehen wie gewohnt.

**Steinsockel**

309. Ort mit steilen Satteldächern (etwa Rothenburg ob der Tauber,
     Marktplatz), Cannon wählen, Cursor über ein Dach: der Geist-Tower steht
     auf dem höchsten Dachpunkt unter seiner Grundfläche, darunter ein
     durchscheinender, grün getönter Steinsockel bis zur Traufe; nach mehr
     als 1 m Cursorweg passt er sich an.
310. Cursor auf eine ebene Straße: kein Sockel, Tower auf derselben Höhe wie
     vor der Nacht.
311. Auf dem Dach klicken: Tower auf Bruchsteinen mit Mörtelfugen und etwas
     Moos, beleuchtet wie der Tower, keine Lücke zwischen Tower und Sockel.
     Bloom im Display-Menü an: gleiche Farbwirkung.
312. Den Tower über den Sockel anklicken, dann nur überfahren: er wird
     gewählt bzw. zeigt die Reichweite. Die LOS beginnt an der angehobenen
     Spitze; Tower-Debug "Show Shoot Height": die magenta Kugel sitzt dort.
     In der Welle starten die Projektile oben, nicht im Dach.
313. Verkaufen: der Sockel verschwindet mit dem Tower.
314. Auf einem Dach zu nah an der Route: Tower und Sockel rot, Klick setzt
     nicht.
315. Am Straßenrand vor einer hohen Fassade: der Tower klettert nicht aufs
     Gebäude. Wohnstraße mit parkenden Autos, Archer auf den Gehweg direkt
     neben ein Auto (nicht aufs Dach), mindestens 10 m von der Route: Geist
     und platzierter Tower auf Straßenhöhe, kein Sockel, der Fuß darf ins
     Auto ragen. Dasselbe neben einer Hecke, Gartenmauer oder einem kleinen
     Baum. Cursor direkt auf dem Autodach: Tower dort mit Sockel (bewusst).
     Weicht etwas ab: `__footprintDebug()` (429) ausführen und die Zeile
     melden.
316. Research Center auf ein Gefälle: großer runder Sockel (etwa 10 m
     Radius). Tower an einer Flachdachkante, die Grundfläche steht über:
     Tower auf Dachhöhe, Sockel bis zur Straße.

**Fähigkeitsleiste**

317. Neues Spiel: links mittig am Spielfeldrand eine schmale Glasleiste mit
     vier gedimmten Knöpfen mit Schloss (K, F, E, L), kein Held-Knopf. Neben
     dem Wellen-Knopf kein Atomschlag-Knopf mehr. Tooltip nennt Forschung und
     Preis; Klick und Taste tun nichts.
     **Überholt** durch `586f493e` (Fix-Session 2026-09-14), so nicht mehr
     testen: ohne erforschte Fähigkeit und ohne Held zeigt ein neues Spiel
     keine Leiste, ein Knopf erscheint erst mit fertiger Forschung. Weiter
     gültig: kein Atomschlag-Knopf neben dem Wellen-Knopf, K, F, E und L tun
     vor der Forschung nichts.
318. Cheat Abilities: zwischen den Wellen graue Icons mit drei goldenen
     Strichen, Tooltip "READY, FIRES DURING A WAVE", CHARGES 1/1, RECHARGE
     3 waves.
319. Welle, K: Knopf voll gold, Hinweis "Click Strike / ESC Cancel",
     Zielring; Klick auf die Route: Einschlag nach 1,5 s mit Atompilz, Shake
     und Ton wie vorher. Danach drei graue Striche, je geschaffte Welle wird
     einer gold.
320. Screen Shake aus und nochmal zünden: kein Shake. Restart während der
     Vorwarnung: Marker und Pilz weg, kein Nachgrollen.
321. O (Photo Mode): die Leiste verschwindet mit dem HUD, O oder Esc bringt
     sie zurück.
322. Kamera so drehen, dass Gegner nahe dem HQ links außerhalb laufen: der
     Pfeil steht rechts neben der Leiste (etwa 94 px vom Rand).
323. Fenster etwa 1280 × 720, dann ein sehr niedriges Fenster: keine
     Überlappung mit dem Info-Overlay oben links, dem Controls-Hint und den
     Logos unten links.

**Wellen-Panel**

324. Neues Spiel: keine Kopfzeile, goldener Knopf "▶ WAVE 1" mit Kappe
     Space, darunter der Schalter "auto 10s". Schalter an: Spur teal; nach
     einer Welle zählt der Knopf "10s" bis "0s" statt Space, ein dünner
     Balken läuft ab, dann startet die nächste Welle. Nach Reload noch an.
325. In der Welle: Knopf eingelassen, "WAVE 1" in Teal, rechts "N left",
     Teal-Balken; die Gegnergruppen zeigen die Rüstung als graues Schild,
     kein Emoji.
326. NEXT: fünf Rauten, die erste gold; Zeile "Zombie Horde 20 ...,
     Unarmored" mit drei goldenen Icons (Flamme, Tropfen, Zielscheibe). Maus
     auf Raute 3 zeigt Welle 3, weg springt zurück; Klick auf 4 bleibt
     stehen; Tooltip "Weak to Fire, Poison, Pierce."; Tab auf die Rauten:
     goldener Fokusrahmen.
327. Nach W5: Marken 6 bis 10, über 7 ein graues Flugzeug, über 10 ein
     goldener Totenkopf.
328. Tower-Panel: Schadensart-Icon Explosion für die Cannon, Stern für
     Magic, Schneeflocke für Ice, Tropfen für Poison, Blitz für Lightning.

**Quickfix**

329. Enemy Debug, Zombie, Place knapp neben der Route zwischen zwei
     Wegpunkten: der Gegner steht auf der Routenmitte und schaut Richtung
     HQ, nicht nach Norden; beim Wellenstart läuft er ohne Drehung und ohne
     Abkürzung los.
330. Fenster ziehen, DevTools andocken und lösen, F11, Photo Mode an und
     aus, einmal mit Bloom: das Bild streckt sich nicht und bleibt scharf
     (beim Ziehen bis 100 ms gestreckt).
331. P, dann Space oder "▶ WAVE N": die Welle läuft sofort, der Chip
     "Paused" verschwindet. Dasselbe mit Start Custom Wave.
332. Ort, dessen Spawn keine Straße zum HQ hat, bis "No route possible
     between HQ and spawn": der Ort steht danach nicht unter Recent; ein
     normaler Ort schon.
333. DevTools, Network: den Chunk des Ortsdialogs blockieren (oder offline),
     ohne Ort in der URL laden: der Fehlerbildschirm bietet "Reload", nicht
     "Change tile credentials".
334. Frischer Checkout, `npm ci`, `npm start`: kein Modulfehler.
335. Atomschlag zünden, direkt nach dem Einschlag P: die zwei leiseren
     Nachhalle kommen erst nach dem Fortsetzen; bei 4x schneller.
336. Zwischen den Wellen, Tower gebaut, Enemy Debug: ein Skeleton als
     einziger Gegner. Stirbt es, bleiben die Tower auf den Minions; nach dem
     letzten Minion drehen sie zur Wache. Kill mit Skeleton: sie drehen zur
     Wache.
337. O, mehrmals Tab und Shift+Tab: der Fokus pendelt nur zwischen "Save
     screenshot" und "Exit"; nach einem Klick auf die Karte holt Tab ihn
     zurück.
338. Nacht 1, 248 wiederholen: Kamera auf die Straße vor dem Portal, Bloom
     an und aus: der Kreis ist beide Male sichtbar und etwa gleich hell;
     beim Wellenstart blüht er etwas auf.
339. Research Center, gesperrten Knoten "Advanced Weaponry" klicken: die
     Queue zeigt Gatling Technology, Siege Engineering, Ice Magic, Arcane
     Studies, Advanced Weaponry; Gold geht erst beim jeweiligen Start ab.
     Mit weniger als 400 Credits (sonst startet Gatling sofort) Gatling aus
     der Queue nehmen: Siege Engineering und Advanced Weaponry fallen mit
     heraus.
     **Überholt** durch `a1bcb3d5` (Fix-Session 2026-09-14), so nicht mehr
     testen: der gesperrte Knoten ist nicht klickbar, sein Tooltip nennt nur
     "Requires: ..."; Entfernen aus der Queue nimmt nur den einen Eintrag.

**Weltkarte**

340. Echter Ort, Research Center und ein Tower, Welle 1 und 2 starten,
     Sidebar-Fuß "World": Ortsdialog auf Tab World, Globus zum Ort gedreht,
     goldener Marker mit "2" und grauem Ring; Liste "playing now · wave 2"
     ausgegraut; ein Klick darauf tut nichts.
341. Weiter bis Game Over: nach etwa 1,2 s unter Restart ein kleiner Globus,
     "New record for <Ort>: wave N", "First run here"; Restart verschiebt
     sich nicht; "Skip" blendet aus.
342. Restart, früher sterben: kein Hinweis; nochmal, später sterben:
     Hinweis mit "Best before: wave M".
343. Zweiten Ort (Showcase) laden, 1 bis 2 Wellen, Tab World: beide Orte,
     höchste Welle zuerst; Hover über eine Zeile dreht den Globus hin;
     Warnung "The current game will be ended"; Klick lädt den Ort mit dem
     Spawn des Rekordlaufs.
344. Globus ziehen, auch über den Pazifik: kein Sprung; Mausrad bis 8x;
     Beschriftungen überlappen nicht; Küsten enden sauber am Rand, kein
     Strich quer über die Scheibe.
345. Bis Welle 5, F5 ohne Game Over, Tab World: Welle 5 für den Ort.
346. Sidebar-Fuß: World, Tips, Map Key, Attributions in einer Zeile.
     `td_best_waves_v1` löschen, neu laden: Tab World zeigt "None yet".
     Network: der Globus-Chunk (etwa 32 kB) lädt erst beim ersten Öffnen.

**Tower-Veteranen**

347. Archer an die Route, anklicken: Zeile "RECRUIT", grauer Winkel, "0 / 10
     kills"; der Tooltip nennt die Leiter.
348. Welle 1: bei 10 Kills "BLOODED", "10 / 50 kills", über dem Archer ein
     silberner Winkel mit dunklem Rand.
349. Kamera nah (etwa 20 m) und weit weg: nah im Maßstab zum Tower, ab etwa
     700 m blasst es aus, ab 1 100 m weg, hinter einem Gebäude verdeckt.
     Tower auf einem Sockel: Abzeichen über der Modellspitze.
350. Upgrade: Rang und Abzeichen bleiben. Verkaufen: Abzeichen sofort weg.
     O: keine Abzeichen. Restart: alle weg.
351. Credits, mehrere Tower an eine Stelle, bis W19 oder eine große
     Debug-Welle: ab 150 drei silberne Winkel, ab 400 drei goldene (Name und
     Balken gold), ab 1 000 ein Stern. Der Kill-Cheat zählt nicht. Lesbar
     über hellen Dächern und vor dunklem Himmel?

**Wurm-Boss**

352. Wave Debug, Single, "Chitin Worm", Count 1, Start Custom Wave: Ringe
     kommen einzeln aus dem Portal, erst gerade, dann flach schlängelnd,
     ohne Lücken; dunkelbraunes Chitin mit hellen Rändern (nicht weiß), Kopf
     mit Mandibeln und roten Augen schaut nach vorn, alles sitzt auf der
     Straße; Boss-Leiste "Chitin Worm".
353. Tower mit Ziel Strongest oder Closest an die Wurmmitte: nach einem
     zerstörten Ring laufen zwei Würmer, der Ring hinter der Lücke hat das
     Kopfmodell (ohne Aufblitzen), Leiste "Chitin Worm ×2".
354. Count 2: der zweite kommt erst, wenn der erste ganz draußen ist; die
     Welle endet nach dem letzten Ring, der Zähler zählt jeden Ring. Kill,
     während er noch herauskommt: nichts kommt nach, die Welle endet.
355. Enemy Debug, "Chitin Worm" mitten auf die Route: der Kopf steht an der
     Klickstelle und schaut die Route entlang, nach Start kommen die Ringe
     dort heraus; das Kreuz entfernt den ganzen Wurm.
356. Wurm um eine scharfe Ecke: gehen außen Lücken auf? Bei 4x: Abstände und
     Schlängeln wie bei 1x.
357. Bis W34 spielen oder auf 35 springen: NEXT zeigt W35 "Boss:
     Chitin Worm" mit Totenkopf, Rüstung Heavy; W35 bringt den Wurm, "Why
     this wave" nennt den ersetzten Boss; ganz getötet bringt die Welle
     12 000 Kill-Gold, mit Abschlussbonus 18 000 (Skill-Boni extra). W40 ist wieder ein Director-Boss.

**Ooze**

358. Enemy Debug, Ooze, Place, Klick, Start moving: ein giftgrünes,
     durchscheinendes Band wächst vom Klickpunkt, mit Blasen, Knochenresten,
     glänzendem Rand, dickerer Spitze; Boss-Leiste "Ooze"; ab 80 m zieht das
     Ende nach.
359. Tower entlang der Route, auch weit hinter der Spitze: jeder schießt auf
     den nächsten Punkt des Bands, grüne Spritzer und Zahlen dort.
360. Ice, Poison, Fire dazu: das Band wird bläulich, dunkler bzw. glüht
     orange; die ganze Ooze wird langsamer.
361. Custom Wave Ooze, Cheat Abilities, K auf ein Stück weit hinter der
     Spitze: die Boss-Leiste fällt um 20 %.
362. Ooze ohne Tower bis ins HQ: das Band fließt hinein, HQ-HP sinken
     punktweise, roter Rand, die Leiste leert sich; die Welle endet, wenn
     alles drin ist. In W1 kostet eine volle Ooze 10 HP. Schüttelt der
     Bildschirm bei jedem Punkt (Review-Befund 8)?
363. Kill: das Band sinkt in etwa 0,6 s weg, bis zu 10 hüpfende Klumpen mit
     grünen Spritzern, Knochen-Burst an der Spitze; die Welle endet nach dem
     letzten Klumpen. Kurz nach dem Spawn getötet: 1 bis 3 Klumpen. Bei 4x
     gleich.
364. Ton: leises Blubbern am Körper, folgt dem nächsten Körperpunkt; P: es
     verstummt (Zombie-Loops laufen weiter, bekannt); Kill: ein nasser
     Splat; Fließen ins HQ: etwa jede Sekunde ein Schlürfen; mit 12 oder mehr
     Zombies bleibt die Ooze hörbar.
     **Überholt** in einem Teil durch `177ba53f` (Fix-Session 2026-09-14):
     In der Pause verstummen jetzt auch die Zombie- und Flammen-Loops, siehe
     REVIEW_FIX_2026-09-14.md, Playtest 545 bis 548. Der Rest gilt weiter.
365. Sprung auf 45: NEXT zeigt W45 "Boss: Ooze", die Welle bringt eine Ooze.

**Boss-Intro**

366. Wave Debug, Single, Herbert, Count 1, Start: kurz dunkel, Schnitt aufs
     Portal, Herbert davor, Karte "BOSS · WAVE n", "HERBERT", Goldlinie,
     "Esc or click to skip", langsame Heranfahrt, obere HUD-Spalte weg; nach
     etwa 2,8 s dunkel, exakt die vorherige Ansicht, das Spiel läuft,
     Boss-Leiste da.
367. Während der Karte: Gegner stehen, Tower schießen nicht, P und WASD tun
     nichts. Esc: sofort zurück (im Build-Modus bleibt der an). Klick auf
     die Karte: zurück, nichts gewählt oder gebaut.
368. Herbert Count 3, Delay etwa 1 s: genau ein Intro. Wurm: ein Intro
     "CHITIN WORM", sobald der Kopf draußen ist, beim Split keins. Ooze: ein
     Intro "OOZE".
369. Enemy Debug, Herbert setzen: kein Intro, keine Pause. Display, General,
     "Boss Intro" aus: kein Intro, nach Reload noch aus. Photo Mode direkt
     nach dem Start: kein Intro, auch später keins.
370. Bei 4x: das Intro kommt, danach wieder 4x. Vorher eine auffällige
     Ansicht einstellen: danach exakt dieselbe, kein Nachrutschen.
371. Held angeheuert, Intro läuft: G tut nichts, ein Klick auf den
     Held-Knopf überspringt nur das Intro.

**Blutmond**

372. Nach W9 in der Bauphase: über Marke 14 ein roter Mond, der Tooltip
     endet mit "Blood moon (every 7th wave): ..."; sonst dieselben Werte.
373. W14 starten (oder Sprung auf 14): Banner "BLOOD MOON / Wave 14" etwa
     3,6 s; das Bild wird in etwa 3 s rot und dunkler, Himmel und Ecken
     dunkler, Gegner mit rotem Rand; jeder Kampf-Tower schwenkt einen
     warmweißen Kegel Richtung Route, das Research Center nicht; auf einem
     Sockel beginnt der Kegel oben am Tower.
     **Überholt** in einem Teil durch `6a42d3a5` (Fix-Session 2026-09-14):
     Der Kegel schwenkt nicht mehr selbst, er zeigt in die Zielrichtung des
     Turms und dreht mit ihm, siehe REVIEW_FIX_2026-09-14.md, Playtest 549
     bis 552. Der Rest gilt weiter.
374. P mitten in der Blende: Blende und Schwenk stehen, weiter ohne Sprung.
     4x: die Blende dauert weiter etwa 3 s. Wellenende: Look blendet in etwa
     4,5 s aus.
     **Überholt** in einem Teil durch `6a42d3a5` (Fix-Session 2026-09-14):
     Einen Schwenk gibt es nicht mehr, in der Pause steht der Kegel mit dem
     Turret; siehe REVIEW_FIX_2026-09-14.md, Playtest 549 bis 552. Blende,
     4x und Ausblenden gelten weiter.
375. Photo Mode in W14: HUD und Banner weg, Look und Kegel bleiben, auch im
     Screenshot. Display, General, "Blood Moon" aus: Look und Mond sofort
     weg. Restart in W14: Look sofort aus.
376. Bloom an in W14: Tönung etwa gleich, Kegel über hellem Boden
     schwächer. Fledermäuse in W21 getönt wie die anderen (W21 ist
     `bat_swarm`); Ghost oder Bear per Custom Wave, wenn die nächste Welle
     14, 21 oder 28 ist. Sprung auf
     35: Wurmringe glühen rot (auch ein neuer Kopf nach einem Split); Ooze
     auf einer Blutmond-Welle: Band dunkler, roter Rand.
377. Perf-Fenster W14 gegen W13: etwa ein Vollbild-Durchgang und ein Draw
     Call mehr, sonst gleich.

**Sprung zu Welle N**

378. Vor W1: Dev, Waves, Abschnitt "Jump to wave": Feld 35, "Boss: Chitin
     Worm", Schalter "Gold of the skipped waves" an, Knopf "Jump: next start
     Wave 35". Drücken: der Knopf in der Sidebar zeigt "WAVE 35", die
     Credits steigen deutlich, keine Gegner.
379. Space: W35 ist die Wurm-Welle (mit Boss-Intro), der Header zeigt 35.
380. Nach der Welle 45 eintragen ("Boss: Ooze"), springen, starten:
     Ooze-Welle. Eine Zahl, die nicht mindestens eine Welle überspringt:
     Knopf grau "Wave N or later"; in einer Welle: "Between waves only".
     Schalter aus: die Credits bleiben gleich.
381. Atomschlag eingesetzt (Ladung leer), nach der Welle 3 Wellen weiter
     springen: die Leiste zeigt die Ladung wieder voll.
382. Ort mit Rekord (etwa W5), Restart, auf 35 springen, spielen bis Game
     Over: kein Rekord-Hinweis, die Weltkarte zeigt weiter W5. Die Bilanz
     zählt das Sprung-Gold nicht unter "Earned".

**Held**

383. Neues Spiel: in der Leiste oben kein Held-Knopf und keine Haarlinie.
384. Mercenary Contract erforschen (nach Siege Engineering, 600, 30 s) oder
     Cheat Research: oben eine Münze ohne Tastenkappe, darunter die
     Haarlinie; Tooltip "Hire Mercenary", mit zu wenig Gold "1,000 credits,
     N short.". Klick ohne Gold: nichts passiert, keine Meldung (bekannt).
385. Mit 1 000 Gold auf die Münze: 1 000 weg, am Routenpunkt beim HQ steht
     der Soldat (oliv, mit Gewehr, etwa so groß wie ein Zombie); keine
     Konsolenzeile "[HeroRenderer] Hero model did not load"; der Knopf
     zeigt das Personen-Icon mit G.
386. Knopf drücken: Held gewählt, goldener Ring unter ihm, ein kleinerer auf
     seinem Posten, Helden-Panel in der Sidebar (Stufe, Kills, DPS,
     Reichweite, drei Munitionssegmente), Hinweisbox "Click Send", "V Ammo",
     "G Camera", "ESC Let go". Nochmal drücken: die Kamera gleitet zu ihm.
     Dasselbe mit G.
387. Gewählt über die Karte fahren: goldener Ring auf dem nächsten
     Routenpunkt, weiter als 30 m rot mit "No route within 30 m". Klick etwa
     100 m entfernt hinter einer Abzweigung: er läuft die Route entlang um
     die Ecke, nicht quer durch Gebäude; Panel "On his way", dann "Holding
     his post".
388. Welle, Gegner auf 18 m: er dreht sich hin, Gewehr im Anschlag, Tracer
     starten am Lauf, nicht im Boden oder über dem Kopf; Kills zählen im
     Panel. Unterwegs feuert er im Laufen.
389. V (auch ungewählt): Munition reihum Standard, Explosive, Rune;
     Tracer-Farbe und Schussgeräusch wechseln; Explosive mit
     Explosionseffekt.
390. Gegner laufen am Posten vorbei: er folgt höchstens etwa 20 m entlang
     der Route und kehrt zurück.
391. Loslassen: Esc, kurzer Rechtsklick, Klick auf ihn, Build-Modus, Tower
     anklicken, Photo Mode: Auswahl und Ringe jedes Mal weg; im Photo Mode
     tut G nichts. H: Gruppe "Hero" mit G und V.
392. Bis 30 Kills: "LEVEL 2" steigt gold über ihm auf. Neues Spiel, Cheat
     Hero: Knopf zeigt sofort das Personen-Icon.
393. Ooze an seinem Posten vorbei: er schießt weiter, solange ein Stück
     Körper in 18 m ist; die Tracer fliegen zum nächsten Körperpunkt, nicht
     zur Spitze.

**Frostbombe, EMP, Orbitallaser**

394. Cheat Abilities: Log "Abilities ready (Debug)", vier entsperrte Knöpfe
     (K, F, E, L) unter dem Held-Platz. Passt "Abilities" in die Kachel?
395. Welle, F: Ring 20 m, "Click Freeze"; Klick auf eine Gruppe: 0,5 s
     Marker, dann Frostausbruch (Blitz, Kältering, Reif, Splitter, Nebel);
     Gegner stehen 3 s weiß-cyan mit Eiskristallen, Herbert 1 s,
     Fledermäuse hängen in der Luft; Knistern, leichter Shake. P: alles
     steht; bei 4x schneller vorbei.
396. Welle mit Tanks oder Mechs (W9, W22, W28 oder Custom Wave), E: Ring
     30 m, "Click Pulse"; blaue Fronten, Funken; Maschinen 6 s still
     (violett-blau), andere 1,5 s, Bosse 0,75 s.
397. L: Ring 5 m und ein goldenes Band Richtung Spawn, "Click Fire";
     abseits rot "No route within 30 m". Klick vor eine Gruppe: 1 s oranges
     Band, dann eine Lichtsäule, deren Fuß 4 s Richtung Portal läuft,
     Funken, Brandspur; Ungepanzerte bis 60 % (Kappe), Tanks gut 25 %,
     Geister kaum; die Welle endet erst, wenn der Strahl aus ist.
398. Wurm: F auf einen Teil: betroffene Ringe vereist, der ganze Wurm steht
     1 s; E ebenso 0,75 s; L brennt die Ringe unter dem Strahl.
399. Ooze: F oder E auf den Körper: Band weiß-cyan bzw. violett, die Spitze
     steht, am HQ fließt nichts hinein; L über den Körper: die Leiste fällt
     höchstens um 20 %.
400. Display, Preset Low: Frost ohne Splitter und Nebel, EMP und Laser ohne
     Funken. H: F, E, L in der Übersicht. Restart während eines Effekts:
     alles weg.

**Review-Fixes, Pilzwolke, Shader-Check (zweiter Durchgang)**

401. Flachdach: Tower so setzen, dass die Mitte 2 bis 3 m von der Kante
     liegt und nur der Rand übersteht. Maus schnell darüber: kein Sockel
     während der Bewegung; anhalten: der Sockel bis zur Straße erscheint im
     nächsten Frame; ohne Anhalten klicken: der Tower hat den Sockel
     trotzdem.
402. Hanglage (geneigte Straße oder Wiese abseits der Route): Tower neben
     die geneigte Straße: auf der Bergseite angehoben, Sockel bis zur
     Talseite. Steildach und Gaube wie in 309: der Tower steigt darauf,
     auch wo die Tiles unter dem Dach keinen Boden zeigen (seit fix4, siehe
     429 bis 431).
403. F12, `__raycastStats(true)`, Research Center wählen, 10 s zügig über
     einen ebenen Platz ziehen, `__raycastStats()`: Zeile `towerFootprint`
     mit etwa 17 Aufrufen je Validierung statt 49 (grob Weg in Metern mal
     17); `totalMs` notieren.
404. Welle bis 10 Kills eines Towers: silberner Winkel wie bisher, bei 50
     zwei Winkel; Verkaufen nimmt das Abzeichen, Photo Mode blendet es aus.
405. Atomschlag nach der Zerlegung der Pilzwolke: Wolke mit Glühen, Rauch,
     Ringen, Kuppel und Blitz wie vorher; P hält die Wolke an, bei 4x läuft
     sie schneller ab.
406. Optional: `glslangValidator` von
     https://github.com/KhronosGroup/glslang/releases holen, in Git Bash
     `export GLSLANG_VALIDATOR=<pfad>/bin/glslangValidator.exe`, dann
     `npm run shader-check`: seit fix4 "57 passed (57)" (vorher 27). Ohne
     die Variable: die Warnung "[shader-check] glslangValidator not found,
     compile tests skipped", seit fix4 27 Tests übersprungen (vorher 13).

**Replay (dritter Durchgang)**

407. Tower bauen, Welle 1 durchspielen: unter dem Wellen-Knopf rechts neben
     "auto 10s" steht "replay W1" (grau, mit Icon). Klick: Header, Sidebar
     und Overlays weg, unten mittig die Leiste "REPLAY Wave 1"; die Welle
     läuft von Beginn an mit Gegnern, drehenden Towern, Projektilen,
     Einschlägen und Ton, Herz- und Totenkopfzahl laufen mit.
408. Im Replay die Kamera mit Maus, WASD, Pos1 und N bewegen, dann Esc: die
     Kamera steht wie vor dem Klick, das HUD ist wieder da; Forschungsbalken
     und Auto-Start-Countdown standen während des Replays.
409. Leertaste und P pausieren und setzen fort (die Flammen hören in der
     Pause auf); + und - oder die Knöpfe 0.25x bis 4x ändern das Tempo, über
     1x kein Ton, die Laufanimationen passen zum Tempo.
410. Am Fortschrittsbalken ziehen: das Replay hält, springt und spielt beim
     Loslassen weiter; vor den Tod eines Gegners zurück: er läuft wieder;
     teal Marken an den eigenen Befehlen. Am Ende stoppt es, der Play-Knopf
     zeigt einen Kreispfeil und startet von vorn.
411. Welle 2: mittendrin einen Tower bauen und einen verkaufen, nach der
     Welle einen weiteren bauen, dann "replay W2": der mittendrin gebaute
     erscheint zu seinem Zeitpunkt, der verkaufte steht bis zum Verkauf, der
     danach gebaute ist unsichtbar. Nach Esc: alle Tower wie vorher,
     Abzeichen da, keine Replay-Gegner, keine neuen Brandflecken.
412. Welle 3 starten: "replay W2" verschwindet sofort, nach W3 steht "replay
     W3" da. Game Over: unter RESTART "Replay wave N", Esc bringt das
     Game-Over-Fenster zurück.
413. Im Replay 1 bis 9, U, Entf, K, O und G: nichts passiert; H zeigt die
     Gruppe "Replay of the last wave". Außerhalb: Targeting im Tower-Panel
     umschalten (auch "Air" und seine Unterauswahl) wirkt wie bisher.
414. Große Welle (W19 oder viele Gegner per Wave Debug) aufnehmen und
     abspielen: flüssig, Skelette splitten mit Knochen-Burst. Welle mit
     Atomschlag: Zielmarker, Einschlag, Pilz und Shake; nach Esc kein Marker
     und kein Pilz übrig.
415. Held anheuern, mitten in der Welle umsetzen und die Munition wechseln,
     dann Replay: der Held ist ab dem Anheuern zu sehen, läuft mit
     Animation, schießt mit der Tracer-Farbe der Munition, Marken für
     Anheuern, Laufbefehl und Munition; vorher kein Held. Nach Esc steht der
     Live-Held am Posten, nicht gewählt.
416. Ooze-Welle abspielen: das Band wird länger und kürzer wie im Spiel,
     getönt bei Slow, Gift, Eis und EMP, sinkt beim Tod ein, die Klumpen
     laufen weiter; nach Esc kein Replay-Band übrig.
417. Frost, EMP und Laser in einer Welle einsetzen, dann Replay: die Effekte
     zum aufgezeichneten Zeitpunkt, getroffene Gegner eisig bzw. violett mit
     Funken; nach Esc keine Reste.
418. Auf 14 springen, W14 spielen, dann "replay W14": roter Look von Anfang
     an, auch wenn er im Spiel schon ausgeblendet ist; nach Esc normaler
     Look. Mit sichtbarem Replay-Link "Jump to wave" nutzen: der Link
     verschwindet. Welle mit Boss abspielen: kein Intro im Replay.

**Review-Fixes fix2 und fix3 (dritter Durchgang)**

419. Auf 45 springen, einen Tower seitlich an den Rand der Ooze-Route
     stellen, 4x: das Spiel läuft flüssig (optional im Chrome-Profil:
     `raycastLineOfSight` aus `BodyAim` nur in den ersten Zügen).
420. W45: die Ooze teilweise ins HQ fließen lassen, dann töten; später Game
     Over: die Übersicht zeigt für W45 ein Leck, die Ooze fehlt bei den
     Kills.
421. W45 bei 4x, die Ooze fließt voll ins HQ: der Bildschirm wackelt etwa
     einmal je Sekunde im Takt des roten Rands, nicht durchgehend; ein
     Zombie-Leck mit 10 HP dazwischen wackelt sofort.
422. Auf 14 springen, Archer mit der Straße seitlich, Welle starten,
     Reichweite upgraden: der Lichtkegel schwenkt sofort um die neue
     Wachrichtung. In W14 einen Ice Tower Zombies töten lassen: Eis- und
     Blutflecken sind rot getönt wie der Boden.
423. Custom Wave mit Herbert und Ooze zugleich: ein Intro, Karte "HERBERT &
     OOZE", danach kein zweites.
424. Poison Tower an die Ooze-Route, den Schwanz am Tower vorbeiziehen
     lassen: grüne DoT-Zahlen auf dem Körper, nicht auf der leeren Straße.
     Fire Tower an einer Kurve, Zombies vor der Ooze: streicht der Kegel
     über den Körper, während der Tower einen Zombie anvisiert, sinkt der
     Balken der Ooze.
425. Pause, dann über den Held-Knopf anheuern: der Held steht sofort am HQ,
     noch in der Pause; anklicken wählt ihn; Klick auf einen fernen
     Routenpunkt: der Postenring springt sofort, nach der Pause läuft er
     los.
426. 75x, Held an einem Posten, zwei Wellen: er verfolgt bis zur Leine und
     kehrt zurück wie vorher, ohne Ruckler oder Sprünge.
427. Laser anwählen (goldenes Band sichtbar), abbrechen, dann den Ort über
     die Weltkarte wechseln: keine Konsolenfehler, kein Band am neuen Ort.
428. Optional: im Debug-Fenster das ONNX-Modell einschalten, drei Wellen
     spielen: Wellen wie gewohnt, keine Konsolenfehler; im
     Trainings-Dashboard steht bei Research "Completed x/11".

**Review-Fixes fix4 (dritter Durchgang)**

429. Echter Ort im Dev-Build, Archer wählen, Cursor auf das Flachdach eines
     mehrstöckigen Hauses, Konsole `__footprintDebug()`: eine Zeile mit
     Regel, Fuß und Sockel. `centreGroundY` und `centreTopY` notieren und
     melden (gleich: die Tiles zeigen unter dem Dach keinen Boden; deutlich
     kleiner: Boden darunter). Dasselbe mit dem Cursor auf der Straße.
430. Gestuftes Dach, Cursor auf den niedrigeren Teil 1 bis 2 m vor der
     Stufe: die Vorschau steht auf dem höheren Teil, der Sockel reicht zum
     niedrigeren; `__footprintDebug()` zeigt `roof-column` oder
     `roof-surroundings`. Zeigt es `ground`, die Zeile melden.
431. Steiles Satteldach, Cursor knapp unter dem First: der Tower steht auf
     Firsthöhe mit Sockel und steckt nicht im Dach.
432. Gehweg 2 bis 3 m neben einem parkenden Auto: kein Sockel, Regel
     `ground`, `agree` oder `even`. Straße am Hang mit Hecke oder Mauer
     daneben: der Tower folgt dem Hang und steigt nicht auf die Hecke.
433. Mitte eines großen Flachdachs neben einem Aufbau: bei `centreGroundY`
     gleich `centreTopY` Regel `ground`, der Aufbau hebt nicht (bekannte
     Grenze). Optional danach `__raycastStats()`, Zeile `towerFootprint`
     ansehen.
434. Optional, mit `glslangValidator` wie in 406: `npm run shader-check`
     meldet "57 passed (57)"; ohne Binary sind 27 Tests übersprungen.

**Review-Fixes replay2 (letzter Durchgang)**

435. Welle mit Atomschlag oder Frostbombe, dann Replay bei 2x oder 4x: kein
     Einschlagston und kein Nachhall; bei 1x wie im Spiel. Bei 1x mitten im
     Nachhall springen: der Rest des Nachhalls fällt weg.
436. Replay mit Atomschlag: Zielmarker sichtbar, dann hinter den Einschlag
     springen: der Marker ist weg. Zurück vor den Einschlag springen und
     weiterspielen: der Pilz kommt einmal, nicht doppelt.
437. Replay läuft, auf den Knopf des Fortschrittsbalkens klicken und ohne
     Bewegung loslassen: das Replay spielt weiter. Aus der Pause heraus
     ziehen und loslassen: es bleibt pausiert.
438. Auf 14 springen, W14 mit Towern spielen, nach der Welle einen weiteren
     Tower bauen, dann "replay W14": an der Stelle des neuen Towers steht
     kein Lichtkegel; ein in der Welle verkaufter Tower hat im Replay seinen
     Kegel. Nach Esc: Kegel wie vorher.
439. Große Welle über mehrere Minuten aufnehmen (W19 oder viele Gegner per
     Wave Debug) und abspielen: kein Ruckeln gegen Ende der Welle. Event
     Debugger während einer Welle offen: zeigt die Events wie vorher.
440. Replay bei 4x, kurz den Browser-Tab wechseln und zurückkommen: das
     Replay springt nicht um Sekunden, Einschläge kommen nicht gebündelt.

## TODO-Stand

Nach DONE.md verschoben ist nichts, das passiert nach deinem OK. In 1.8 hat
kein Eintrag eine Stand-Zeile bekommen; die Einleitung des neuen Abschnitts
1.9 nennt, was die Nacht dort bearbeitet hat. Nur die Dateiverweise im
Eintrag "Eigene Shader ohne Ausgabe-Kodierung" sind nachgezogen: Portal und
HQ-Marker auf die Dateien nach der Zerlegung, der Atompilz auf
`mushroom-cloud-blast.ts`, die VAT-Gegner auf die Ausgabezeilen in
`vat-material.ts`.

| TODO-Eintrag (1.8) | Stand | Commits |
|---|---|---|
| Canvas folgt keiner Fenstergröße | umgesetzt, ungesehen | `9619b82f` |
| Nuklearschlag: Explosionsstufen in Echtzeit | überholt: die Stufen-Timer fielen schon am 2026-09-13 weg (`configs/visual-effects.config.ts:212`), der Nachhall läuft in Spielzeit, VFX, Ton und Shake je Fähigkeit; offen nur die Warnsirene | `46a096d2`, `4479bc9f` |
| Skeleton-Split: Reste | Debug-Platzierung auf der Route, Tower drehen nicht mehr zur Wache; offen: `total_count`, Balance | `cbd01d10`, `dde04a9c` |
| Lazy-Chunks: Reste | beide Punkte erledigt | `9504032d`, `82f23124` |
| Steuerung und HUD: Kleinkram | Pause, Queue-Ketten (überholt durch `a1bcb3d5`, Fix-Session 2026-09-14), Fokusfalle erledigt; Hover-Pick und Offscreen-Scan in Node gemessen; offen: "100/100" knapp | `c3d6f89a`, `7914062f`, `ae0a5f39`, `42fb575b` |
| Meta: ungeprüft | Recent erst nach stehender Route; Showcase weiter nicht angespielt | `df847ee8` |
| Training-Debugger: Callbacks als Funktions-Inputs | umgestellt auf Outputs | `321edf85`, `ca88d039` |
| Beschwörungskreis mit Bloom unsichtbar | behoben, kalibriert auf Straßenhelligkeit 0,3 | `7c2530f6` |
| Tower auf schrägen Dächern | Steinsockel | `7185812f` bis `10c9b178` |
| Debug-Gegner: falsche Anfangsrichtung | behoben | `7414ee13`, `cbd01d10` |
| Kamera-Raycasts gegen die Tiles | Cache in Ruhe, im Browser ungemessen | `8380bd01` |
| Gameplay-Konzept: Spieler aktiver einbinden (Backlog) | Held Stufe 1 und drei weitere Fähigkeiten | `9741ffb6` bis `46c300ac`, `eaf8d5f2` bis `fcc543fa` |

Die Punkte unter "Befunde, offen" stehen in TODO.md im neuen Abschnitt "1.9
Befunde aus der Nachtschicht 2026-09-14 (nicht behoben)".
