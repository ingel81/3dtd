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

**Stand dieses Dokuments:** zweiter Durchgang auf Head `292d788f`, mit den
Review-Fixes von fix1, der Zerlegung der Pilzwolke und dem
Shader-Compile-Check. Replay und die Behebung der Befunde von review2 (fix2)
und review3 (fix3) sind noch nicht gemergt und folgen.

## Stand

| | |
|---|---|
| Branch | `sprint/night-2026-09-14`, Head `292d788f` (ohne die Handover-Commits) |
| Diese Nacht | 146 Commits `1ca6713a..292d788f`, 386 Dateien, +34 448 / -4 169 Zeilen |
| Gesamt vor `main` | 634 Commits |
| Tests | vitest 303 Testdateien mit 3732 Tests (Nachtbeginn 241 mit 3034); im Gate davon 13 übersprungen, die Shader-Compile-Tests ohne `glslangValidator`; pytest 101 laut blob-Worker, `training-backend/` hat in der Nacht keinen Diff |
| Prüfung | Gate am Head: beide tsc, ESLint und Production-Build grün; Initial-Bundle 357,18 kB wie zu Nachtbeginn |

Nichts davon lief im Browser. Optik, Laufzeiten, Klang und Speicher sind per
Code-Review, Tests und Rechnung geprüft, nicht angesehen, angehört oder
gemessen. Die Shader hat der Worker shadercheck offline geprüft: Alle 13
Fälle (Sockel, Sockel-Vorschau, Abzeichen, Ooze-Band, Blutmond-Stimmung,
Suchscheinwerfer, VAT-Gegner mit Glühen, Portal, HQ-Marker, Frost, EMP,
Orbitalstrahl, Pilzwolke) kompilieren und linken als GLSL ES 3.00 mit
glslang 11.7.0, so wie three r186 sie zusammensetzt. Nicht geprüft sind
Treiber- und ANGLE-Eigenheiten und GPU-Grenzen (Zahl der Uniforms und
Varyings). Deshalb steht die Konsole weiter als erster Playtest-Punkt (301).

## Vorgehen

17 Worker in eigenen Git-Worktrees, je ein Thema: assets (Blender), perf,
sockel, abilitybar, quickfix, worldmap, veterans, worm, blob (dazu blob2),
refactor, bossintro, bloodmoon, wavejump, hero, abilities, fix1 und
shadercheck. Vor jedem Merge hat der Lead den Diff gelesen, bei Bedarf
Nacharbeit angefordert, die Worker haben selbst auf den Nacht-Head rebased,
übernommen wurde per Fast-Forward (Teile per Cherry-Pick: `e92575f4`,
`ae5fe4f8`, die vat-Zerlegung). Nach jedem Merge lief das Gate: vitest,
beide tsc, ESLint, Production-Build. Drei Review-Agents haben den gemergten
Stand gelesen (Abschnitt "Review").

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
  Punkte (Research Center 49) in Mitte und zwei Ringen. Ab 0,2 m Unebenheit
  steht der Tower auf der höchsten Probe, ein Sockel reicht bis zur
  tiefsten. Proben mehr als 5 m über der Fläche unter dem Cursor (Fassade,
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
- Review-Befund M1 (Autos, Hecken heben den Tower an) siehe "Review".

### Linke Fähigkeitsleiste und Tabellen je Fähigkeit (abilitybar, `d697e4e7`, `3769d8e3`, `4479bc9f`)

- `d697e4e7`: Jede Fähigkeit trägt `icon` und `hotkey` in der Config,
  Tasten und Tastenübersicht kommen daraus.
- `3769d8e3`: Schmale Glasleiste am linken Rand des Spielfelds, senkrecht
  mittig. Der Atomschlag-Knopf ist aus dem Wave-Panel dorthin gezogen (der
  alte Knopf ist gelöscht). Gesperrte Fähigkeiten sind von Anfang an
  sichtbar, gedimmt mit Schloss, der Tooltip nennt Forschung und Preis. Oben
  ein Platz für den Held-Knopf. Die Offscreen-Pfeile halten am linken Rand
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
  Tastenkappe SPACE; während einer Welle wie bisher Restzahl und Balken.
  Auto-Start als kleiner Schalter "auto 10s" unter dem Knopf statt der
  Checkbox; der Countdown ersetzt die Kappe. Das MIX-Badge entfällt.
- NEXT als Zeitleiste: fünf Marken (vorher zwei Zeilen), Totenkopf für
  Boss, Flugzeug für Luft; darunter eine Detailzeile zur gewählten Marke
  (Name, Anzahl oder Spanne, Rüstung als Schild, Schwächen als goldene
  Icons). Hover oder Fokus zeigt, Klick hält, Standard ist die nächste
  Welle.
- Emojis raus: Rüstung als graues Schild auch in der Gegnergruppen-Liste.
  Neue gemeinsame Zuordnung `DAMAGE_TYPE_ICON` mit eigenem Icon je
  Schadensart (neu: sparkle, snowflake, burst). Nebeneffekt: Das
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
6. `46a096d2`: Der Nachhall einer Fähigkeit (0,35 und 0,9 s) läuft in
   Spielzeit: die Pause hält ihn an, höheres Tempo verkürzt ihn.
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

### Weltkarte (worldmap, `0bbd9730` bis `fd374b9b`, 7 Commits)

- Beste Welle je Ort in `td_best_waves_v1`, geschrieben bei `wave:started`
  (Welle N gestartet heißt Welle N erreicht, damit zählen auch
  abgebrochene Läufe). Ort heißt: HQs innerhalb 150 m, wie bei Recent.
  Höchstens 200 Orte. DevWorld und Bot-Läufe zählen nicht, Cheats und
  Debug-Wellen schon (Ausnahme: Sprung zu Welle N).
- Globus als 2D-Canvas (kein zweiter WebGL-Kontext), orthografisch, nur
  Linien: Küsten, Grenzen, 30°-Gradnetz aus Natural Earth 1:110m (Public
  Domain), eingebettet mit 20 kB, als Lazy-Chunk von 32,4 kB. Credits
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
- Das Band lief nur durch den NVIDIA-Desktop-Compiler (GLSL 330), nicht
  durch ANGLE oder einen Browser.

### Code-Zerlegungen (refactor)

- **marker-shaders** (`9f0591b1` bis `7978eb04`, 3 Commits): 1 154 auf 430
  Zeilen, die Portal-Materialien liegen in
  `renderers/marker/spawn-portal-shader-chunks.ts`,
  `spawn-portal-gate-material.ts` und `spawn-portal-glow-material.ts`
  (dort auch `CIRCLE_STREET`). Ein Fingerprint-Spec vor dem Split, danach
  entfernt; ein Laufzeitvergleich alt gegen neu (review2) fand keinen
  Unterschied.
- **Training-Debugger** (`321edf85`, `ca88d039`): `onEnableBot` und
  `onDisableBot` sind jetzt Outputs, dazu die erste Komponenten-Spec unter
  `components/`.
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
| Fläche | 20 m Radius, Boden und Luft | 30 m Radius | Strahl 5 m breit, läuft vom Klick die Route zurück Richtung Spawn, 18 m/s, 4 s, höchstens 72 m |
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

### Review-Fixes (fix1, `2b7da859` bis `5744bcce`, 5 Commits)

Behebt die fünf Befunde von review1 (Abschnitt "Review", Befunde 1 bis 5).

- **Sockel neben Autos** (`f500aaaf`, Befund 1): Was den Tower heben darf,
  hängt jetzt davon ab, wo der Cursor steht. Liegt die Fläche unter dem
  Cursor mehr als 2,5 m über dem Boden ihrer eigenen Säule
  (`ROOF_ABOVE_GROUND`, wie `roofRise` im Routenraster), gilt die
  Dach-Regel wie bisher: jede Probe bis 5 m darf heben, First und gestufte
  Dächer bekommen ihren Sockel. Sonst gilt die Boden-Regel: Nur Proben, die
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
  (`flat` im Strahl-Shader) erkennt der Check (`unexpected FLAT`).
- Das Binary gehört nicht zum Repo: `GLSLANG_VALIDATOR` oder
  `glslangValidator` im PATH, Bezugsquelle in ARCHITECTURE.md §13. Ohne
  Binary laufen nur die Aufbau-Tests, die 13 Compile-Tests stehen als
  übersprungen da (so im Gate). Gelaufen mit 11.7.0, die dort genannte
  16.6.0 ist nicht getestet.
- `292d788f`: Kommentar zu `forceSinglePass` in `vat-material.ts` und die
  Gotcha zu `USE_INSTANCING` in ARCHITECTURE.md §13 richtiggestellt (three
  setzt das Define für jedes Material auf einem InstancedMesh selbst).

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
| Fähigkeiten `eaf8d5f2` bis `fcc543fa`, dazu `9d6d2d15` | am Head Konflikt in `docs/ABILITIES.md` (`0db2d032`; die Zerlegung der Pilzwolke nennt dort ihre Dateien); mit der Pilzwolke zuerst konfliktfrei. Einzeln konfliktfrei: `fcc543fa`, `4234de2e`, `9d6d2d15`. Laser (`8fc55ae8`, `a25e0260`, `0db2d032`, `1f92f349`, `538ddf87`, `2cfb850f`) nur noch Doku `ABILITIES.md`. Frost oder EMP allein: Konflikt in `strategy-bot.factory.ts`, `research-pick.strategy.ts`, `ABILITIES.md`, `BOT_SYSTEM.md` | brauchen Leiste und Tabellen; EMP nutzt den Halt-Weg aus `325512de` (Frost); die Pilzwolke nutzt `effect-buffers.ts` aus `459235bd` |
| Pilzwolke `8ca1c4bf` bis `ac10bed9` | konfliktfrei | `66a94828` baut auf `459235bd` (Fähigkeiten) auf |
| fix1 `2b7da859` bis `5744bcce` | `2b7da859`, `386a17c1`, `bf573095`, `5744bcce` einzeln konfliktfrei; `f500aaaf` nur zusammen mit `5744bcce` | `5744bcce` baut auf `f500aaaf` auf; beide auf dem Sockel, `bf573095` auf dem Abzeichen |
| Shader-Check `795f9cef` bis `292d788f` | konfliktfrei | nur Test, Doku und Kommentare |

Am Head wiederholt: Ground-Pick-Cache, Sockel, Veteranen, Fähigkeiten, Held,
Sprung, die Boss-Intro-Code-Commits, die einzelnen Ooze- und
Blutmond-Commits (`4024618c`, blob2, `1b4311d6`, `74e0c8f3`), marker,
Debugger, `ae5fe4f8`, die sechs konfliktfreien Quickfixes und die neuen
Bereiche. Die übrigen Angaben (Assets, Leiste, Tabellen, Wellen-Panel, die
übrigen Quickfixes, Weltkarte, Wurm, Ooze und Blutmond als Ganzes, vat)
stammen aus der Probe am `fcc543fa`.

Kurz: Pilzwolke und Fähigkeiten gehen zusammen sauber zurück, danach der
Held (bis auf eine Doku-Zeile). Perf (mit `2b7da859`), Boss-Intro (ohne
Doku), fix1, der Shader-Check und die meisten Quickfixes gehen einzeln.
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
4. **NEXT zeigt fünf Wellen**, und das Tower-Panel hat neue
   Schadensart-Icons (Siege als Explosion, Magie als Stern, Lightning als
   Blitz statt Schwert).
5. **Sockel-Grenzen**: Schwelle 0,2 m, Proben bis 5 m über und 30 m unter
   der Cursorfläche, runder Sockel (steht bei eckigen Basen seitlich über),
   kein LOS-Blocker für andere Tower.
6. **Wurm-Maße**: Skala 2,5 statt 3,6 (bei 3,6 wäre er 10,4 m breit, die
   Portalöffnung hat 8 m), 35 HP je Segment, höchstens 240 Segmente, weil
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
    ab; vorher galt strikt die Reihenfolge (`7914062f`).
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
    Parkdeck (Dach-Regel) heben Autos weiter.
21. **Sockel an der Flachdachkante erst im Stillstand** (`5744bcce`): Beim
    schnellen Überfahren fehlt ein Sockel, den nur der äußere Ring
    verlangt; er erscheint einen Frame nach dem Anhalten, der Klick setzt
    ihn immer.
22. **Keine npm-Abhängigkeit für den Shader-Check** (`795f9cef`): Eine
    Abhängigkeit, die glslang mitbringt, wurde bewusst abgelehnt; das
    Binary kommt über `GLSLANG_VALIDATOR` oder den PATH. Folge: Ohne
    installiertes `glslangValidator` prüft `npm test` nur den Aufbau der
    Shader, die 13 Compile-Tests stehen als übersprungen da (so auch im
    Gate).

## Review

Drei Review-Agents haben gelesen, alle nur lesend. Keiner fand einen Befund
der Schwere hoch. Die Befunde von review1 hat fix1 behoben (Abschnitt
"Review-Fixes"); die von review2 (fix2) und review3 (fix3) sind zum Stand
dieses Dokuments offen, ihre Behebung läuft.

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

**review2**, `bffae869..fe69ba4c` (42 Commits: Ooze, Boss-Intro, Blutmond,
Zerlegungen): 1 mittel, 8 niedrig. Ohne Fehler im Spielablauf (Targeting,
Splash, Kettenblitz, Status-Effekte, Atomschlag, Leck, Reset, Pause).

6. **BodyAim wiederholt den Raycast-Rückfall in jedem Tower-Zug**
   (mittel, Performance): Liegen Körperpunkte der Ooze in Zellen ohne
   LOS-Eintrag des Towers (Rand der Reichweite, LOS noch nicht aufgelöst),
   kostet jeder Sub-Step bis zu 4 rekursive Raycasts gegen die Tiles je
   Tower. Belegt mit einer temporären Spec, auf echten Karten nicht
   gemessen.
7. **Gate und Run-Stats zählen eine Ooze erst als Leck, wenn sie ganz drin
   ist** (niedrig); der HP-Verlust kommt richtig an.
8. **Screen Shake bei jedem Leckpunkt der einfließenden Ooze** (niedrig), bei
   4x etwa 7,5-mal pro Sekunde, bis das Wellen-Cap erreicht ist.
9. **Treffpunkt der Ooze kann veraltet sein** (niedrig, nur Optik):
   DoT-Zahlen und Blut erscheinen am letzten Treffpunkt.
10. **Suchscheinwerfer schwenkt nach einem Reichweiten-Upgrade um die alte
    Richtung** (niedrig, nur im Blutmond).
11. **Bodendecals bekommen die Blutmond-Tönung nicht** (niedrig): grüne
    Schleimflecken und Eis leuchten ungetönt auf rotem Boden.
12. **Zwei Bosstypen in einer Welle: zwei Intros direkt hintereinander**
    (niedrig, nur mit Custom Wave oder Enemy Debug).
13. **Flammenkegel trifft die Ooze nur an ihrem Zielpunkt** für diesen
    Tower (niedrig, Designgrenze).
14. **Nach dem Entfernen der Fingerprint-Specs** fehlt eine direkte
    Abdeckung für `mergeBakedMeshes` und die Portal-Shader (niedrig).

**review3**, `fe69ba4c..fcc543fa` (Sprung-Cheat, Held, Fähigkeiten): 5
niedrig, kein mittlerer. Geprüft ohne Defekt: Atomschlag unverändert (nur
`ability:impact` kommt jetzt vor dem Schaden, Treffer und Kills in
`ability:resolved`), `isSlowed()`, Status-Zusammenspiel, Laser,
Determinismus, Gate-Buchung, Bots ohne Held, Tasten, Shader, Aufräumen bei
Restart und Ortswechsel.

15. **Band der Laser-Zielvorschau wird nie entsorgt** (niedrig):
    `ability-marker.renderer.ts`, `aimPath` fehlt in `dispose()`; eine
    Geometrie und ein Material je Engine-Lebensdauer.
16. **Held nach Anheuern in der Pause unsichtbar und nicht anklickbar**
    (niedrig, nur Darstellung): Der Pause-Zweig im `GameStateManager` ruft
    `heroManager.presentFrame()` nicht, erst der erste Sub-Step nach der
    Pause zeigt ihn; ebenso bleibt der Postenring nach einem Marschbefehl
    in der Pause am alten Ort. Der Cheat "Hero" zeigt es nicht, der echte
    Knopf schon.
17. **Eingaben des ONNX-Modells verschieben sich** (niedrig, nur beim
    Opt-in-Modell): vier neue Forschungen vergrößern den Nenner der
    Forschungsquote, der Held erhöht `effectiveDPSPerArmor`. Der
    Regel-Director ist nicht betroffen, `ai-schema.json` unverändert.
18. **Held plant bei hohem Tempo mit vielen kurzlebigen Objekten neu**
    (niedrig, nicht gemessen): alle 250 ms Spielzeit `nearestPoint` über
    alle Kanten und bis zu zwei Dijkstra-Läufe mit frischen Puffern, bei 75x
    etwa 300 Neuplanungen je Sekunde.
19. **Zielsuche der drei neuen Bot-Strategien läuft je Entscheidung
    doppelt** (niedrig, nicht gemessen, nur Bots).

## Befunde, offen

In TODO.md unter 1.9 eingetragen. Die Review-Befunde oben kommen dazu, soweit
sie in der Nacht nicht mehr behoben werden.

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
13. **Sockel nach fix1**: Die Boden-Regel stützt sich auf Annahmen über die
    Photogrammetrie (unter Autos kein Boden-Treffer, unter Dächern schon),
    im Browser nicht geprüft; eine Probe auf einer Autoflanke kann bis
    0,5 m heben.
14. **Shader-Check** braucht `glslangValidator` von Hand; ohne ihn prüft
    `npm test` nur den Aufbau, nicht das Kompilieren.

## Playtest-Liste

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
  Tower-Kill), Credits (+1 000, Shift+Klick +100 000), +HP, Research (alle
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
316. Research Center auf ein Gefälle: großer runder Sockel (etwa 10 m
     Radius). Tower an einer Flachdachkante, die Grundfläche steht über:
     Tower auf Dachhöhe, Sockel bis zur Straße.

**Fähigkeitsleiste**

317. Neues Spiel: links mittig am Spielfeldrand eine schmale Glasleiste mit
     vier gedimmten Knöpfen mit Schloss (K, F, E, L), kein Held-Knopf. Neben
     dem Wellen-Knopf kein Atomschlag-Knopf mehr. Tooltip nennt Forschung und
     Preis; Klick und Taste tun nichts.
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
     SPACE, darunter der Schalter "auto 10s". Schalter an: Spur teal; nach
     einer Welle zählt der Knopf "10s" bis "0s" statt SPACE, ein dünner
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
     Gatling aus der Queue nehmen: Siege Engineering und Advanced Weaponry
     fallen mit heraus.

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
     this wave" nennt den ersetzten Boss; ganz getötet steigt das Gold über
     die Welle um 12 000. W40 ist wieder ein Director-Boss.

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
374. P mitten in der Blende: Blende und Schwenk stehen, weiter ohne Sprung.
     4x: die Blende dauert weiter etwa 3 s. Wellenende: Look blendet in etwa
     4,5 s aus.
375. Photo Mode in W14: HUD und Banner weg, Look und Kegel bleiben, auch im
     Screenshot. Display, General, "Blood Moon" aus: Look und Mond sofort
     weg. Restart in W14: Look sofort aus.
376. Bloom an in W14: Tönung etwa gleich, Kegel über hellem Boden
     schwächer. Ghost oder Bear in W21: getönt wie die anderen. Sprung auf
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
     Funken, Brandspur; Ungepanzerte bis etwa 40 % HP, Tanks weniger,
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
     Talseite. Steildach und Gaube wie in 309: der Tower steigt darauf.
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
     `npm run shader-check`: "Tests 27 passed (27)". Ohne die Variable: die
     Warnung "[shader-check] glslangValidator not found, compile tests
     skipped", 13 Tests übersprungen.

## TODO-Stand

Nach DONE.md verschoben ist nichts, das passiert nach deinem OK. In 1.8 hat
kein Eintrag eine Stand-Zeile bekommen; die Einleitung des neuen Abschnitts
1.9 nennt, was die Nacht dort bearbeitet hat. Nur die Dateiverweise im
Eintrag "Eigene Shader ohne Ausgabe-Kodierung" sind auf die neuen Dateien
nachgezogen.

| TODO-Eintrag (1.8) | Stand | Commits |
|---|---|---|
| Canvas folgt keiner Fenstergröße | umgesetzt, ungesehen | `9619b82f` |
| Nuklearschlag: Explosionsstufen in Echtzeit | überholt: die Stufen-Timer fielen schon am 2026-09-13 weg (`configs/visual-effects.config.ts:212`), der Nachhall läuft in Spielzeit, VFX, Ton und Shake je Fähigkeit; offen nur die Warnsirene | `46a096d2`, `4479bc9f` |
| Skeleton-Split: Reste | Debug-Platzierung auf der Route, Tower drehen nicht mehr zur Wache; offen: `total_count`, Balance | `cbd01d10`, `dde04a9c` |
| Lazy-Chunks: Reste | beide Punkte erledigt | `9504032d`, `82f23124` |
| Steuerung und HUD: Kleinkram | Pause, Queue-Ketten, Fokusfalle erledigt; Hover-Pick und Offscreen-Scan in Node gemessen; offen: "100/100" knapp | `c3d6f89a`, `7914062f`, `ae0a5f39`, `42fb575b` |
| Meta: ungeprüft | Recent erst nach stehender Route; Showcase weiter nicht angespielt | `df847ee8` |
| Training-Debugger: Callbacks als Funktions-Inputs | umgestellt auf Outputs | `321edf85`, `ca88d039` |
| Beschwörungskreis mit Bloom unsichtbar | behoben, kalibriert auf Straßenhelligkeit 0,3 | `7c2530f6` |
| Tower auf schrägen Dächern | Steinsockel | `7185812f` bis `10c9b178` |
| Debug-Gegner: falsche Anfangsrichtung | behoben | `7414ee13`, `cbd01d10` |
| Kamera-Raycasts gegen die Tiles | Cache in Ruhe, im Browser ungemessen | `8380bd01` |
| Gameplay-Konzept: Spieler aktiver einbinden (Backlog) | Held Stufe 1 und drei weitere Fähigkeiten | `9741ffb6` bis `46c300ac`, `eaf8d5f2` bis `fcc543fa` |

Die Punkte unter "Befunde, offen" stehen in TODO.md im neuen Abschnitt "1.9
Befunde aus der Nachtschicht 2026-09-14 (nicht behoben)".
