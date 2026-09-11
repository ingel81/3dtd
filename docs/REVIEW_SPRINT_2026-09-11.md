# Review-Handover: TODO-Sprint 2026-09-11

Arbeitsstand für dein Review. Alles liegt auf lokalen Branches, `main` ist
unberührt, nichts ist gepusht. Kein TODO-Eintrag ist nach DONE.md verschoben;
welche Einträge erledigt sind, steht unten in der Tabelle "TODO-Stand".

## Branches

| Branch | Inhalt | Empfehlung |
|---|---|---|
| `sprint/todo-2026-09-11` | Bugfixes, Refactorings, UI, Performance, Balance, Doku, Konzepte | nach Playtest nach `main` |

Die drei Draft-Branches (`draft/gameplay-2026-09-11`,
`draft/lightning-instanced-2026-09-11`, `draft/balance-2026-09-11`) hast du am
Morgen des 2026-09-11 komplett übernommen; sie sind in den Sprint-Branch
gemergt und stehen nur noch als Marker da. Details im Abschnitt "Aus den
Drafts übernommen".

Stand Sprint-Branch: 104 Commits vor `main`, 254 Dateien, +17 594 / -7 395
Zeilen. vitest 100 Testdateien mit 1320 Tests (vorher 66 mit 1003), beide
tsc, ESLint, pytest und Production-Build grün.

## Vorgehen

Worker-Agents in eigenen Git-Worktrees, je ein Themenblock. Vor jedem Merge
habe ich den Diff gelesen, bei Bedarf mit Nacharbeit zurückgegeben, auf den
Sprint-Branch rebased und per Fast-Forward übernommen. Nach den Merges liefen
vitest, beide tsc, ESLint und der Production-Build. Ein unabhängiger
Review-Agent hat die riskanten Teile (Route-Grid, Instancing, Combat,
Platzierung, Lazy-Training, FPS-Limit) danach noch einmal gelesen; seine vier
Befunde sind behoben (`88ddc55`, `d3c01b2`, `e6ed8c2`, `797a56f`).

Nichts davon lief im Browser. Alle optischen Änderungen und alles, was nur
mit WebGL läuft (Shader, Skybox, Instancing), ist per Code-Review und Tests
geprüft, nicht angesehen. Die Playtest-Liste unten sammelt, worauf du achten
solltest.

## Was sich ändert

### Simulation und Gameplay (Bugfixes, Verhalten ändert sich)

- **Route-Grid-Zellschlüssel** (`333894e`): Anlegen und Abfragen rechnen jetzt
  einheitlich mit `Math.floor`. Östlich und südlich des HQ (negative lokale
  Koordinaten, -X ist Osten) landeten Gegner bisher in der Nachbarzelle (bis
  2 m daneben) für Targeting und Bodenhöhe. Der Commit-Body sagt fälschlich
  "west or south".
- **AA-Retrofit ohne vorberechnete Luft-Sicht** (`1b11e46`): Der
  Research-Handler lief vor dem Store-Update und hat deshalb keine Air-LOS in
  den Zellen hinterlegt. Umgerüstete Gatlings schossen trotzdem auf Luftziele,
  über den Raycast-Fallback pro Kandidat (teurer), verpassten aber Zellen, die
  nur in Flughöhe sichtbar sind, etwa hinter niedrigen Hindernissen. Jetzt wird
  die Air-LOS nach dem Research einmal aufgelöst und gecacht.
- **Höhenänderungen erreichen andere Tower** (`ef1a1c7`): Zweite Tower behielten
  LOS gegen alte Höhen, wenn beim Platzieren eines anderen Towers Höhen
  nachgeschärft wurden.
- **Wake-Check mit upgegradeter Reichweite** (`76a6197`, nicht beauftragt,
  einzeln verwerfbar): Schlafende Tower wachten erst bei Gegnern innerhalb der
  1,1-fachen Basis-Reichweite auf, und der Radius-Fallback ohne LOS-Zellen
  suchte ebenfalls nur dort. Range-Upgrades wirken dadurch in der Praxis
  stärker; die Balance wurde bisher mit dem Fehler gespielt.
- **Beam-Fallback-Radius** (`1e887b4`): Der Fire-Tower sah ohne LOS-Zellen
  Gegner zwischen 24 und 25 m nicht, mit Range-Upgrades nichts jenseits von
  24 m.
- **HQ-Abzweig der Route** (`4ad010a`): wurde in Grad statt Metern bestimmt und
  rutschte auf schrägen Straßen die Straße entlang, im Testfall (48° N, HQ
  20 m neben der Straße) etwa 6,5 m, bei größerem Abstand mehr.
- **Kill-Zählung** (`b4df1d2`): nur noch bei tatsächlichem Tod; heute ohne
  Wirkung, weil der betroffene Pfad unerreichbar ist. Absicherung für später.

### Engine und Rendering

- **Instancing** (`3f71c64` bis `fc2d962`): gemeinsamer `InstanceSlotAllocator`
  für Gegner, Health-Bars, Projektile und Decals. `activeCount` schrumpft nach
  großen Wellen wieder (vorher Uploads in Peak-Größe bis zum Reset).
  Projektile laden nur noch die belegte Scheibe hoch. Health-Bars ohne das
  ungenutzte `instanceMatrix` (2,56 MB). Mit "Animationen aus" froren Gegner
  und Health-Bars ein, das ist behoben. Im Headless-Training häuften sich
  Upload-Ranges unbegrenzt an, auch behoben.
- **Tower-LOS** (`fac16de`, `2a9d320`, `d3c01b2`, `e6ed8c2`): Recompute einmal
  pro Terrain-Sweep statt pro Slice, verteilt auf einen Tower pro Frame.
  Der Freeze von 1 bis 2 s beim großen Reinzoomen sollte weg sein. Dafür folgt
  die Tower-LOS (Targeting und Anzeige) neuen Höhen erst nach dem Sweep, ein
  Tower pro Frame; die Wartezeit auf einen Sweep ist auf 3 s begrenzt.
- **Engine zerlegt** (`04ca3d7` bis `9f1e701`): `CameraRig` und
  `TileLoadingTracker` aus `three-tiles-engine.ts` (2437 auf 2000 Zeilen, mit
  der Skybox-Änderung 2024).
  Dabei gefunden und behoben: Timer liefen nach `dispose()` weiter, Controls
  wurden nie disposed. Ungenutzte Kamera-API entfernt (`flyTo` u. a.).
- **Route-Grid zerlegt** (`d4c2475` bis `493998b`): `global-route-grid.ts` von
  2199 auf 1253 Zeilen, fünf neue Module. Hot Path per Skript byte-gleich
  geprüft. Der LOS-Resolve pro Tower bleibt in der Hauptdatei.
- **Render-Kleinkram** (`610c22b` bis `e8d2710`): Das Tower-Feuer blieb nach
  mehr als etwa einer Sekunde verdecktem Tab unsichtbar, bis ein weiteres
  Tower-Feuer entstand (behoben). Decal-Fade läuft nur noch, wenn
  einer fällig ist. Die Skybox wird einmal in eine Cubemap umgerechnet und die
  Quelle freigegeben, rund 34 MB VRAM (`e8d2710`, einzeln verwerfbar).
- **FPS-Limit** (`f7a207b`, `797a56f`): 60, 30 oder unbegrenzt über einen
  Button im Display-Menü der Quick-Actions. Model-Previews laufen mit 30 fps.
- **Audio** (`aec28d6`): Loops, die erst nach dem Entfernen ihres Gegners
  fertig erzeugt waren, spielten bis zum Verlassen des Spiels weiter, ebenso
  der erste von zwei überlappenden Starts desselben Sounds.

### Oberfläche

- **Texte auf Englisch** (`cb2162a`): Platzierungshinweise, Ortsnamen und die
  derzeit nirgends angezeigten Director-Begründungen waren deutsch, jetzt
  englisch. Maus-Vorschau, Klick und Bot prüfen jetzt über eine gemeinsame
  Funktion (`utils/tower-placement-rules.ts`).
- **Zellfarben beim Platzieren** (`5472a8f`, `e151a70`): Boden grün, Luft blau,
  verdeckt orange-rot; jede Ebene zeigt nur ihre eigene Abdeckung. Vorher rechneten
  beide Ebenen dieselbe Sammelfarbe, deshalb sahen sie identisch aus. Reine
  Boden- oder Luft-Tower zeigen nur ihre Ebene.
- **Dev-Menü** (`6fa7913`) in zwei Spalten, überlappt den Kompass nicht mehr.
  **Alle Debug-Panels resizable** (`25ff7d4`) mit gespeicherter Größe.
- **Next-Wave-Button** (`2562bbf`), **Header an der Sidebar ausgerichtet**
  (`9720314`), **ARIA-Labels** (`f9dfc48`).
- **Damage-vs-Armor-Übersicht** (`46c350d` bis `324ca45`): Dialog über den
  i-Button im BUILD- und Tower-Header, liest direkt aus der Matrix-Config.
- **Projektile** (`c91a011` bis `574ce33`): Magic schießt einen violett-cyanen
  `arcane-orb` statt `fireball`; die Rakete sieht wie eine Rakete aus, mit
  kurzer Düsenflamme (etwa 6 m) und dünner Rauchspur statt 40-m-Feuerschweif;
  Muzzle Flash nur noch bei Archer, Gatling, Cannon und Rocket (vorher auch
  Poison). Nebenbei: Geschosse und Schweife zeigten bei schrägen Schüssen bis
  etwa 13 Grad neben die Flugrichtung (London); die Flugbahn selbst stimmte
  (`330b173`).
- **Damage Numbers aus** blieb nur einen Reload lang aus (`9762534`).
- **Sidebar zerlegt** (`1162a4c` bis `5041be1`): Wave-, Build-, Tower- und
  Research-Panel als eigene Components, Parent von 743 auf 105 Zeilen. Die
  Styles sind per Skript verschoben und per sass-Vergleich je Selektor
  geprüft. Kills, Tower-Stats und der Research-Balken hängen jetzt an eigenen
  Events (`tower:kill`, `research:progress` höchstens 10 Hz), die Store-Signale
  fortschreiben; vorher aktualisierten sie sich nur, wenn sich zufällig die
  Credits änderten. Optisch unverändert: die Trennlinie hängt jetzt direkt am
  WAVE-Panel, weil `:last-of-type` in eigenen Host-Elementen nicht mehr greift.

### Build, Training, Backend

- **Training-Code lazy** (`85d8402`, `88ddc55`): Bots und WebSocket-Client laden
  erst beim Training. Start-Chunks 27,8 kB kleiner, Training-Code beim Start
  51 auf 17 kB; die gzip-Transfergröße bleibt etwa gleich.
- **Training-Dashboard** (`c2ee884`): Laufmetriken links, Modellmetriken rechts,
  neu approx KL. **Backend-Struktur** (`058df7a`): `core/`, `utils/`,
  `scripts/`; `start.bat` und `npm run export-ai` unverändert.

### Doku und Konzepte (unter `docs/game-design/` und `docs/`)

- `BALANCE_PROPOSAL_2026-09.md`: Upgrade-Kurven, Cannon, Matrix-Spreizung,
  Boss-Takt ab W31, mit Tabellen und Patch-Liste. Umsetzung als Draft-Branch.
- `PLAYER_AGENCY_CONCEPT.md`: Empfehlung Nuklearschlag zuerst, dann Held.
- `COMBAT_HEATMAP_STUDY.md`: machbar, zwei Schichten, Aufwand S und M.
- `UX_DISCUSSION_NOTES.md`: Turmdrehung nach Zielverlust, Color Grading.
- `ROUTE_GEOMETRY_ANALYSIS.md`: Die Route verliert keine Straßenpunkte; die
  Ursache der geschnittenen Hausecke ist offen, `__routes.describe()` zeigt sie
  im nächsten Playtest.

## Entscheidungen für dich

1. **`76a6197`** behalten? Macht Range-Upgrades wirksamer.
2. **Gameplay und Balance**: entschieden, alles übernommen. Nach dem Playtest
   offen: Gold für W16 bis W30 nachsteuern, falls der Puffer zu groß ist, und
   die übrigen offenen Fragen am Ende von `BALANCE_PROPOSAL_2026-09.md`.
3. **Lightning**: übernommen, im Playtest ansehen (Shader nur per Review
   geprüft).
4. **Raketen-Sound**: braucht ein neues CC0-Asset, Anforderung in
   `docs/PROJECTILES.md`.
5. **Route an der Engstelle**: nach `__routes.describe()` im Playtest
   entscheiden (Fälle A bis D in `ROUTE_GEOMETRY_ANALYSIS.md`).

## Aus den Drafts übernommen

Reihenfolge im Sprint-Branch: Lightning, dann Balance, dann Gameplay. Beim
Übernehmen wurde der Burn-Commit auf den neuen Fire-Beam aus dem Balance-Teil
gesetzt (20 % der Beam-DPS inklusive Upgrade-Faktor), `ai-schema.json` enthält
Balance-Stand und `baseSpeed` 4.

### Gameplay (`9c01a1d`, `2d4806d`, `a43fd26`)

1. **fire beam applies burn**: Bisher applizierte nichts `burn`, das Design
   sieht ihn aber vor. 20 % der Fire-DPS laufen als Nachbrennen (3 s, Tick
   500 ms), im Kegel bleibt der Schaden gleich. DoT-Kills (Poison und Burn)
   werden jetzt dem Quell-Tower gutgeschrieben; die Poison-Tick-Phase endet
   jetzt exakt im Sub-Step statt framerate-abhängig.
2. **wallsmasher rush, in the simulation**: 3 bis 8 s Phasen Gehen/Rennen in
   Spielzeit, deterministisch aus der Enemy-ID geseedet, Multiplikator wirkt im
   selben Sub-Step. Rennt 50 % der Zeit, im Mittel +75 % Tempo.
3. **slow the wallsmasher walk**: `baseSpeed` 7 auf 4 (Mittel wieder 7 m/s),
   Animationsgeschwindigkeit angepasst, `ai-schema.json` neu. Nur zusammen mit 2.
   Der Commit-Body nennt noch einen Hash von vor dem Rebase (`9b5776f`);
   gemeint ist der Rush-Commit `2d4806d`.

### Lightning (`e847bee`, `29b9799`)

Alle Bolts über ein Mesh mit `InstancedBufferGeometry`, Instanzdaten in einem
Buffer, Slots über den `InstanceSlotAllocator`. Vorher 192 Meshes und bis zu
192 Draw Calls, jetzt einer. Formel, Farben, Blending und Tiefenverhalten wie
vorher. Der Shader ist nicht im Browser kompiliert: Wenn Blitze fehlen, steht
der Fehler in der Konsole.

### Balance (`1b08dc1` bis `9e46b11`)

1. **splash only hits what the tower can target**: Cannon- und Poison-Splash
   treffen keine Flieger mehr (Bugfix).
2. **fire tower engages only what its flame reaches**: Erfassung gleich
   Flammenreichweite, Basis 20 m, Range-Upgrades verlängern die Flamme (Bugfix).
3. **defense model reads splash from the tower configs**: Rocket zählt nicht
   mehr als Splash, Ice und Poison schon (Bugfix im Wave-Director-Modell).
4. **upgrade curves**: ab L16 nur noch 40 % des Zuwachses, Profile je Tower,
   Range-Track auf 10 Stufen ×1,03 gekappt (vorher 25 Stufen ×1,04, Archer
   ×1,02), Fire-Beam-Width ebenso. L25 bringt das 5,3- bis 6,4-Fache der
   Basis-DPS statt des 14,5-Fachen (Fire mit nur einem Damage-Track: 3,0 statt
   3,4).
5. **cannon**: Splash 6 m, höchstens 8 Ziele, Reichweite 70 m, siege gegen
   unarmored/light 0,5.
6. **wider damage matrix with a fairness floor**: Matrix nach dem Vorschlag,
   Fairness-Floor 0,6 im Gate (TS und `server.py`).
7. **a boss every fifth wave after the curriculum**: ab W31 jede fünfte Welle
   Boss, zwei neue Boss-Templates, doppeltes Boss-Gold. Simuliert 20 statt 0,7
   Boss-Wellen zwischen W31 und W130.

Folge für die Economy: Das Design-Roster bis W30 kostet 431 542 statt 632 834
Gold bei 791 000 Einnahmen, der Puffer steigt von 25 % auf 83 %. Gold ist
bewusst nicht nachgesteuert; wenn du bei W30 über 150k Gold oder mehr als 20
Tower hast, schlägt der Vorschlag vor, das Gold für W16 bis W30 um 20 % zu
kürzen.

Falls du nach dem Playtest Teile zurücknehmen willst: Die Commits bauen
aufeinander auf und lassen sich sauber von hinten zurücknehmen. Der
Matrix-Commit (`5b3102e`) lässt sich allein revertieren. Die Bugfixes
(`1b08dc1`, `a1302d0`, `cc0aabc`) sollten bleiben, auch wenn der Rest geht.
Der Rush (`2d4806d`) setzt Burn (`9c01a1d`) voraus, die Kompensation
(`a43fd26`) ergibt nur mit dem Rush Sinn.

## Playtest-Liste

- Build-Mode je Tower-Typ: Zellfarben (Archer/Ice/Lightning beide Ebenen;
  Cannon/Magic/Fire/Gatling/Poison/Tentacle nur Boden, Gatling nach
  AA-Retrofit beide; Rocket nur Luft; verdeckt orange-rot), Legende passt dazu.
- Großer Zoom-In mit mehreren Towern: kein Freeze, die Tower-LOS zieht nach dem
  Sweep nach.
- Research AA-Retrofit mit platzierten Gatlings: treffen Luftziele auch hinter
  niedrigen Hindernissen.
- Route östlich oder südlich des HQ: Gegner laufen bodennah.
- Debug "Animationen aus": Gegner laufen weiter.
- Nach einer großen Welle: keine hängenden Gegner oder Health-Bars.
- Fire-Tower bauen, Tab 30 s verdecken: Feuer bleibt sichtbar.
- Skybox sieht aus wie vorher.
- FPS-Limit 30 und 60: Zähler hält die Werte, Spielgeschwindigkeit bleibt.
- Dev-Menü, Panel-Größen nach Reload, Next-Wave-Button, Header-Kanten.
- Damage-vs-Armor-Dialog, Esc im Build-Mode schließt nur den Dialog.
- Magic-Orb, Rakete, Muzzle Flash; Pfeile und Raketen zeigen auch bei
  diagonalen Schüssen in Flugrichtung.
- Lightning- und Chain-Tower: Blitze sichtbar, Halos am Treffer, Verdeckung
  durch Gebäude, Draw Calls im Performance-Panel deutlich niedriger.
- Balance: Mid-Game (T3/T4) noch belohnend? Cannon gegen Tanks nötig, gegen
  Schwärme schwach? Leckt ein falsches Roster spürbar, aber verkraftbar? Gold
  bei W30 über 150k oder mehr als 20 Tower? Ab W31 jede fünfte Welle ein Boss.
- Fire-Tower: Reichweite 20 m, Gegner brennen nach dem Kegel noch 3 s nach
  (orange Tint und Zahlen).
- Wallsmasher wechselt zwischen Gehen und Rennen, Füße rutschen nicht.
- Training: Backend starten, DevWorld-Tab, `training-session-*.js` lädt,
  Checkpoint lädt, Dashboard-Header.
- An der Engstelle aus dem 2026-09-10-Playtest: `__routes.describe()`.

## TODO-Stand

Erledigt auf dem Sprint-Branch, nach deinem OK nach DONE.md zu verschieben:

| TODO-Eintrag | Stand | Commits |
|---|---|---|
| 1.0 Stille Höhenänderungen ohne Emit | erledigt | `ef1a1c7` |
| 1.0 Tower-LOS-Recompute pro Slice statt pro Sweep | erledigt | `fac16de`, `e6ed8c2` |
| 1.0 `updateAnimations()` gated den GPU-Flush | erledigt | `3f71c64` |
| 1.0 Weitere LOS-invalidierende Research-Effekte | erledigt, AA-Retrofit-Lücke gefunden | `1b11e46` |
| 1.0 `activeCount` schrumpft nie | erledigt | `a2025b7` |
| 1.0 `ProjectileInstanceManager` ohne Update-Ranges | erledigt | `c6ec30f` |
| 1.0 Health-Bar `instanceMatrix` | erledigt | `27aab53` |
| 1.0 Beam-Fallback-Radius | erledigt | `1e887b4` |
| 1.0 Kleinkram aus dem Review | erledigt | `fd26179`, `b4df1d2`, `65f6b32`, `8e92e9b`, `08ded24` |
| 1.1 Route folgt der Straße nicht | teilweise: Analyse, HQ-Fix, Diagnose; Ursache offen | `fcbe1d8` bis `565b0ca` |
| 1.1 Zellschlüssel floor/`\|0` | erledigt | `333894e` |
| 1.1 Audio-Loop nach Entfernen | erledigt | `aec28d6` |
| 1.1 Wallsmasher-Rush | erledigt (wieder eingebaut, mit Kompensation) | `2d4806d`, `a43fd26` |
| 1.2 `three-tiles-engine.ts` abspecken | erledigt | `04ca3d7` bis `9f1e701` |
| 1.2 `game-sidebar` aufteilen | erledigt | `1162a4c` bis `5041be1` |
| 1.2 `global-route-grid.ts` aufsplitten | erledigt bis auf den LOS-Resolve, der in `global-route-grid.ts` bleibt | `d4c2475` bis `493998b` |
| 1.4 Tower-LOS Zoom-In-Spike | erledigt | `2a9d320` |
| 1.5 P2 Lightning-Bolts instanziert | erledigt, Sichtprüfung offen | `e847bee`, `29b9799` |
| 1.5 G5 Rest Projektil-Pool | erledigt | `c6ec30f` |
| 1.5 Render-Kleinkram | P6, P8, R9 erledigt, G8 ohne `getAllSpawnProxies` (bewusst); R6, R10 als Befund in PERF_BUG_ANALYSIS | `610c22b` bis `e8d2710` |
| 2.1 Upgrade-Skalierung, Cannon, Matrix-Spreizung | umgesetzt, Balance-Playtest offen | `04f3d4d`, `90662f0`, `401c6a1`, `5b3102e` |
| 2.2 Boss-Frequenz ab W31 | umgesetzt | `9e46b11` |
| 3.1 Muzzle Flash feintunen | im Code erledigt (nur Schusswaffen, Größe, Dauer, Licht je Tower), Sichtprüfung offen | `574ce33` |
| 3.1 Grid-Cell-Farben | erledigt | `5472a8f`, `e151a70` |
| 3.1 Kampfzonen untersuchen | Studie erledigt | `45db221` |
| 3.1 Magic-Geschoss | erledigt | `c91a011` |
| 3.1 Rocket Geschoss, Schweif, Sound | Optik erledigt, Sound offen (Asset fehlt) | `e59383e` |
| 3.1 Turmdrehung, Color Grading | Diskussionsnotizen, Entscheidung offen | `bb3b185` |
| 3.3 Globale Damage-Matrix-Übersicht | erledigt | `46c350d` bis `324ca45` |
| 3.3 `burn` totlegen oder bauen | erledigt (gebaut) | `9c01a1d` |
| 3.4 Build Configuration | erledigt per Lazy-Loading statt fileReplacements | `85d8402`, `ab6a7c1`, `88ddc55` |
| 3.5 Dashboard-Header | erledigt | `c2ee884` |
| 3.7 Debug-Menü, Panels resizable, Next-Wave-Button, Header, deutsche Texte | erledigt | `6fa7913`, `25ff7d4`, `2562bbf`, `9720314`, `cb2162a` |
| Backlog training-backend Struktur | erledigt | `058df7a` |
| Backlog FPS-Limit | erledigt | `f7a207b`, `797a56f` |
| Backlog Preview-Drosselung | erledigt | `01780f5` |
| Backlog Bot-Snapshots lazy | war schon umgesetzt, Tests ergänzt | `f3b0c79` |
| Backlog ARIA-Labels | Spiel-UI erledigt, elf Debug-Buttons offen | `f9dfc48` |
| Backlog OSM bridge/tunnel | Tags werden gespeichert, Nutzung offen | `03ffd7b` |
| Backlog Konzept "Spieler aktiver" | Konzept erledigt | `03bbe96` |

Neue Befunde, die offen bleiben, stehen in TODO.md unter 1.6.
