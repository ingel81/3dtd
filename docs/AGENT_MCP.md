# KI-Agent baut Karten über MCP

Stand 2026-10-15, Teil 1 und 2 von TODO E171. Ein KI-Agent (ein MCP-Client wie Claude Code) baut oder ändert in der
Desktop-App die Karte, die im Editor offen ist, öffnet und legt Karten an; ein Mensch kann zusehen und ihn anhalten. Nur
Desktop-App: die Webversion hat weder Server noch Schalter, Agent-Knopf und Band.

## Einschalten und verbinden

1. Schalter **Allow AI agents to edit maps** (Standard aus): in den Einstellungen, Reiter **Privacy**, oder im Editor
   hinter dem Knopf **Agent** (Kopfleiste der Karte und der Kartenliste). Beide schalten denselben Server; der Schalter
   steht in `userData/agent-mcp.json` und gilt beim nächsten Start weiter.
2. Darunter erscheint die Adresse, Standard `http://127.0.0.1:47171/mcp` (ist der Port belegt, nimmt der Server den
   nächsten freien der folgenden zehn und merkt ihn sich), mit Knopf **Copy address**.
3. Im Agenten eintragen, für Claude Code:

   ```bash
   claude mcp add --transport http 3dtd http://127.0.0.1:47171/mcp
   ```

4. Im Spiel den Editor öffnen (Hauptmenü, Map editor). Eine Karte öffnet der Agent selbst (`open_map`, `create_map`)
   oder der Mensch. Ohne offenen Editor antwortet jedes Werkzeug mit dem Hinweis, ihn zu öffnen.

## Entscheidungen (E171)

- Der Server läuft in der Desktop-App am offenen Editor, damit ein Mensch zusehen kann.
- Freigabe: ein Schalter, standardmäßig aus. Eingeschaltet darf jedes Programm auf diesem Rechner ran, ohne Token
  (Entscheidung des Users). Webseiten nicht, siehe Sicherheit.
- Reichweite: geändert wird nur die offene Karte. Alle Karten (eigene und mitgelieferte) darf der Agent lesen, als neue
  eigene Karte kopieren und öffnen; eine mitgelieferte öffnet sich wie beim Menschen als eigene Kopie. Löschen und
  Umbenennen anderer Karten gibt es nicht.
- Teil 2 (Entscheidung des Users 2026-10-15): Statusanzeige, Schalter im Editor, Agenten-Band mit Stopp, voller
  Werkzeugkasten wie für Menschen, Karten selbst öffnen und anlegen. Nicht gewählt (später): Probewelle oder Bot-Test als
  Rückmeldung, Werkzeuge ohne offenen Editor, Fortschritt und Abbruch langer Skripte durch den Agenten.
- Jeder ändernde Aufruf ist ein Undo-Schritt, Name beginnt mit `Agent: `; `undo_last` nimmt nur einen solchen zurück.
- Hauptweg ist `run_script`: der Engpass ist der Denkschritt des Agenten, nicht die App. Einzelwerkzeuge sind für den
  Feinschliff.

## Werkzeuge

| Werkzeug | Liest/ändert | Was |
|----------|--------------|-----|
| `map_summary` | liest | Größe, Höhen, Bodenschichten, Wasser, Straßen, Spawns mit Spurlänge, HQ, Objekte je Kategorie, Szenenkosten, Himmel, Regeln, Verlauf |
| `map_heights` | liest | Höhen in einem Rechteck, auf höchstens 128 Werte je Seite verkleinert, Dezimeter |
| `map_objects` | liest | Objekte in einem Rechteck (oder alle), optional eines Assets, höchstens 1000 |
| `check_map` | liest | Prüfen des Editors als Daten (öffnet auch das Prüf-Panel für den Menschen) |
| `catalog` | liest | Materialien, Objekt-Assets, Biome, Generator-Vorlagen, Landformen. Ohne Filter nur die Ids nach Kategorie (alles mit Zeilen wären rund 80 KB); mit category (Objekt-Kategorie oder `Materials`), tag oder search die vollen Zeilen (Größe, Tags, blockiert Bauen); eine unbekannte Kategorie nennt die vorhandenen. Ohne geladenen Katalog ein Fehler |
| `script_api` | liest | Befehle und Lesefunktionen von `map` für Skripte (aus `SCRIPT_OPS`) |
| `view_picture` | liest | Bild des App-Fensters (`webContents.capturePage`, JPEG, höchstens 1600 px breit) |
| `top_down_picture` | liest | Karte von oben, Norden oben, höchstens 1024 px (JPEG), mit Straßen, Spawns und HQ darüber und Relief-Schattierung (Licht aus Nordwest, `agent/relief-shade.ts`): flach von oben beleuchtet war ein Hügel von 13 m nicht zu sehen |
| `list_maps` | liest | eigene und mitgelieferte Karten, welche offen ist |
| `read_map` | liest | Zusammenfassung, Höhen oder Objekte einer beliebigen Karte, ohne sie zu öffnen |
| `open_map` | öffnet | eine Karte im Editor; eine mitgelieferte als eigene Kopie; die offene wird vorher gespeichert |
| `create_map` | legt an | neue eigene Karte (Name, Breite, Tiefe 64 bis 8192 m, Vorlage oder Generator mit Seed und Stärke) und öffnet sie |
| `save_map`, `close_map` | speichert | jetzt speichern (mit Vorschaubild); speichern und zurück zur Kartenliste |
| `run_script` | ändert | Skript gegen die offene Karte, ein Undo-Schritt, animiert abgespielt |
| `move_marker` | ändert | HQ (`hq`) oder einen Spawn (Id oder Name) versetzen |
| `place_object`, `move_object`, `delete_objects` | ändert | einzelne Objekte; eine Straßen-Id in `delete_objects` verweist auf `map.removeRoads` |
| `set_rules` | ändert | Regeln (`gameplay`), verworfen, wenn die Karte so nicht speicherbar wäre; unbekannte Schlüssel und `waves` in falscher Form (es gibt keine Wellenzahl) mit Beispiel abgelehnt (`checkRules`, auch für `map.gameplay`) |
| `set_sky` | ändert | Himmel und Luft (`environment`), nur bekannte Schlüssel und Werte |
| `set_map_info` | ändert | Name und Beschreibung der offenen Karte (Id und Datei bleiben), ein Schritt |
| `erode_map` | ändert | Erosion der ganzen Karte wie im Map-Panel, im Terrain-Worker, sichtbar während sie läuft |
| `resize_map` | ändert | Größe ändern oder beschneiden um die Mitte, wie im Map-Panel |
| `increase_detail` | ändert | grobes Gelände alter Karten auf 2 m verfeinern |
| `import_heightmap` | ändert | Höhen aus einer 16-Bit-PNG- oder RAW-Datei (base64), schwarz `low`, weiß `high` |
| `list_stamps`, `save_stamp` | liest, legt an | Stempel des Menschen; ein Rechteck der offenen oder einer anderen Karte als Stempel behalten |
| `paste_stamp` | ändert | Stempel (Id oder Name) oder ein Rechteck aus der offenen oder einer anderen Karte einsetzen: gedreht, Rand weich, Teile wählbar |
| `list_versions`, `restore_version` | liest, ändert | gespeicherte Versionen der offenen Karte; eine als Undo-Schritt zurückholen |
| `undo_last` | ändert | letzten Schritt des Agenten zurücknehmen |
| `copy_map` | legt an | beliebige Karte als neue eigene Karte kopieren; mit `open: true` gleich öffnen |

Jedes Werkzeug, das die Karte ändert (außer `undo_last`), nimmt `dry_run: true`: siehe Probelauf.

Die Beschreibungen und Eingabeschemata (zod) stehen in `desktop/src/agent-mcp.js` (`TOOLS`); dort prüft das SDK die
Argumente, bevor der Editor sie sieht. Die Serveranweisung (`instructions`) sagt dem Agenten: Koordinaten in Metern,
x Ost, y Nord, (0, 0) Kartenmitte; wenige Skripte mit vielen Befehlen, Striche statt Tupfer; danach `check_map`,
Bilder sparsam; ohne offene Karte `list_maps`, dann `open_map` oder `create_map`; `dry_run` vor dem Ändern; nach Stopp
warten.

### Voller Werkzeugkasten

Was der Mensch mit den Werkzeugen des Editors kann, kann der Agent auch, als Skriptbefehl (deterministisch, in der Sandbox
geprüft, beim Abspielen sichtbar) oder als eigenes Werkzeug, wo es einen Worker braucht oder die Karte als Ganzes
betrifft:

| Werkzeug des Editors | Für den Agenten |
|----------------------|-----------------|
| Map: Generator mit Neubemalen, Spiegeln jetzt, Größe, Detail, Erosion der Karte, Höhen-Import, Versionen | `map.generate(..., add, repaint)`, `map.mirrorMap(mode, from)`, `resize_map`, `increase_detail`, `erode_map`, `import_heightmap`, `list_versions`/`restore_version` |
| Landscape: Biome, Formen, Risse, Klippenfelsen, Erosion, Fluss, Straße, Klippenkante | `map.biome`, `form`, `cracks`, `cliffRocks`, `erode`, `river`, `road`, `cliff` |
| Terrain, Paint | Pinsel wie bisher; `map.removeLayer(material)` |
| Water: Füllen, Gießen, See, Malen, Meer, Fluss bearbeiten | `map.fill`, `pour(at, kind)`, `lake`, `waterMask`, `sea`; `moveRiverPoint`, `addRiverPoint`, `removeRiverPoint`, `riverWidth`, `riverKind`, `simplifyRiver`, `carveRiverBed`, `removeRiver` (das Bett folgt wie im Water-Panel, `relayRiver`) |
| Objects: Setzen, Streuen, Linie (auch Mauer-Kits), Auswahl bearbeiten, Duplizieren, Gruppen, Hangneigung | `map.place`, `scatter`, `line(asset, line, { spacing, offset, bothSides, turn, corners, front, alignToSlope })`, `changeObjects(ids, patch)`, `duplicate`, `group`/`ungroup`, `alignToSlope`, `removeObjects` |
| Roads: Zeichnen und Bearbeiten | `map.path`, `walk`; `moveNode`, `splitRoad`, `mergeNodes`, `removeNode`, `dissolveNode`, `connectNodes`, `editRoads(ids, { width, kind, style })`, `smoothRoad`, `straightenRoad` (eine von der Straßenbürste gebaute Straße wird neu gelegt, `editRoads` aus dem Paths-Tool) |
| Spawns und HQ | `map.spawn`, `moveSpawn`, `renameSpawn`, `removeSpawn`, `hq`; `move_marker` |
| Copy and stamps | `map.copyArea(rect, to, { rotation, feather, parts })`; `save_stamp`, `paste_stamp` (auch aus anderen Karten) |
| Sky and weather, Rules, Map details | `set_sky`, `set_rules`, `set_map_info`; `map.environment`, `map.gameplay` |

Lesefunktionen dazu: `map.roads()` mit den Knoten `a`, `b` jeder Straße, `map.nodes()` (Id, Lage, Straßen),
`map.rivers()` (Punkte mit Breite und Höhe). Nicht über MCP: Probewelle, Bot-Test, Test im Spiel (nicht gewählt), Messen
(der Agent rechnet selbst), Kamera und Ansicht (`view_picture` und `top_down_picture` reichen).

### Probelauf (`dry_run`)

`dry_run: true` führt denselben Code wie der echte Aufruf aus, aber gegen einen Wirt mit einer Kopie der offenen Karte
in einem eigenen `EditorDocument` (`DryHost` in `editor-agent.ts`): keine Ansicht, kein Verlauf, nichts gespeichert;
Katalog, Stempel und Versionen kommen vom echten Wirt. Die Antwort: `{ dryRun, ok, answer, changes, check }`, `answer`
ist, was der echte Aufruf geantwortet hätte, `changes` der Unterschied der Kopie zur Karte (`mapDiff` in
`agent-reads.ts`: verschobene Höhenpunkte mit größtem Heben und Senken und Rechteck, Farbe, Wasser, Objekte neu,
weg, geändert je Asset, Straßen, Spawns, HQ, Himmel, Regeln, Name, Größe), `check` die Befunde des Prüfens der Kopie.
Ein abgelehnter Aufruf antwortet wie ohne `dry_run`. `run_script` spielt im Probelauf auf der Kopie ab (ohne Animation),
statt wie bis Teil 1 nur die Sandbox laufen zu lassen; die Erosion läuft im eigenen Terrain-Worker auf den Höhen der
Kopie.

## Im Editor: Agent-Knopf und Agenten-Band

- **Agent** (Kopfleiste des Editors und der Kartenliste, `agent-control.component.ts`): Etikett mit dem Zustand (Off,
  On, Connected, Working, Stopped, Not started) und ein Feld mit Schalter, Adresse mit Copy, Name des Agenten und letzter
  Aufruf. Zustände aus `agent-state.ts`: verbunden heißt, die letzte Anfrage kam vor weniger als fünf Minuten
  (`AGENT_CONNECTED_MS`; das SDK läuft zustandslos, ein „Verbunden“ gibt es im Protokoll nicht).
- **Agenten-Band** (unten mittig über der Ansicht, in der Kartenliste unten, `agent-band.component.ts`): zeigt sich,
  solange der Agent arbeitet, gestoppt ist oder in den letzten fünf Minuten kam. Darin Name (der `clientInfo.name` aus
  dessen `initialize`), was er tut („runs the script "hill" | 4 s“, „opens "demo-valley"“, Wortlaut aus
  `describeCall` im Hauptprozess), bei Skript oder Erosion ein Balken, und **Stop**.
- **Stop**: der Aufruf, der läuft, endet; ein Skript in der Sandbox wird beendet (`signal` an `runScriptInSandbox`),
  ein spielendes Skript und die Erosion brechen ab und die Karte geht auf den Stand vor dem Aufruf zurück
  (`EditorAgent.stop`, `cancelAgentJob`). Der Hauptprozess beantwortet den wartenden Aufruf sofort mit „The player
  pressed Stop …“ und lehnt jeden weiteren ab, ohne den Editor zu fragen, auch `view_picture` (`held`). Im Band steht
  dann **Let it go on**; der Agent ruft wieder auf. Schalter aus und wieder an setzt alles zurück. Was der Agent vor dem
  laufenden Aufruf schon geändert hat, bleibt als eigene Schritte im Verlauf (Ctrl+Z).
- Der Hauptprozess schickt den Status bei jeder Änderung an das Fenster (`desktop:agent-status-changed`: `enabled`,
  `url`, `error`, `held`, `client`, `current`, `last`); das Preload hält den letzten für spätere Hörer
  (`agent.onStatus`).

## Karten öffnen und anlegen

`open_map`, `create_map`, `close_map` und `copy_map` mit `open` gehen über die Seite (`EditorSession.navigator`, gesetzt
von `EditorPageComponent`), wie die Knöpfe des Menschen: die Adresse (`?map=`) folgt, die offene Karte wird vorher
gespeichert, eine mitgelieferte öffnet als eigene Kopie (`EditorSession.open`). Läuft gerade ein Job oder ein Strich,
lehnt der Agent ab. `create_map` legt die Karte wie der Dialog „New map“ an (Starter-Straße, Spawn, HQ; Vorlage aus
`MAP_TEMPLATES`, die `catalog` als `mapTemplates` nennt, sonst Generator, Boden `grass`).

## Skripte (`run_script`)

Ein Skript ist schlichtes JavaScript (kein `import`, kein `await`) gegen `map`. Die Befehle sind die des Map-Kits
(`src/app/editor/ops/map-kit.ts`, dieselben Operationen, mit denen `tools/maps/levels/` die mitgelieferten Karten
baut): Generator, Landschaftsstriche (Biome, Formen, Klippen, Erosion, Fluss, Straße), Terrain-, Paint- und
Wasserpinsel entlang Punkten, Objekte setzen, streuen, in Reihen, Wege, Spawns, HQ, Symmetrie, Himmel, Regeln, Leben
(`map.lifeArea(kind, punkte, optionen)`, `map.lifeRoute`, `map.lifeSettings`, `map.removeLife`; Arten und Optionen wie im
Werkzeug Life, LEVEL_EDITOR.md; mit `map.symmetry` entstehen die Bilder mit, die Id ist die des gezeichneten; eine
unbekannte Option, Art oder zu wenige Punkte brechen mit Grund ab).
Lesen: `map.h(x, y)`, `map.slope`, `map.noise`, `map.ridged`, `map.objects(rect)`, `map.markers()`, `map.roads()`,
`map.layers()`, `map.waterBodies()`, `map.lanes()`, `map.issues()`, `map.life()`. `map_summary` nennt unter `life` die
Schalter, die Dichte, den Umgebungston und die Bereiche (Id, Art, Form, Punkte, Dichte). Dazu `rng(seed)`, `facing(a, b)`, `log(...)`. Die volle
Liste mit Argumenten liefert `script_api` (`scriptReference()` aus `SCRIPT_OPS` in `agent/map-script.ts`).

```js
const h = map.half;
map.generate('hills', 7, 0.5);
map.road([{ x: -h + 10, y: 0 }, { x: -40, y: 30 }, { x: 0, y: 0 }], { width: 8 });
map.spawn('West', -h + 10, 0);
map.hq(0, 0);
map.biome('forest', [{ x: -100, y: 120 }, { x: 100, y: 140 }], { radius: 40 });
map.raise({ x: 0, y: 0 }, { radius: 20 }, 2);
log('HQ ground', map.h(0, 0));
return map.lanes();
```

Ablauf:

1. **Sandbox**: der Editor schickt eine Kopie der offenen Karte und den Katalog an einen frischen Worker
   (`public/agent/script-worker.js`). Dort läuft das Skript gegen ein `MapKit` auf der Kopie. Jeder Aufruf wird
   geprüft (Befehl bekannt, Argumente reine Daten: Zahlen endlich, Punkte, Optionen, keine Funktionen; Auswahlwerte
   wie Biom oder Wasserart aus ihren Listen; Bereiche wie `hold` oder `rounds` begrenzt; höchstens 2000 Punkte je Linie
   und 6000 Tupfer je Strich), ausgeführt und als Daten behalten. Lesefunktionen sehen die Kopie, wie das Skript sie
   bis dahin verändert hat, und geben Kopien zurück, nie Teile der Karte. Am Ende prüft `validateMapDocument`, ob die
   Karte speicherbar bliebe.
2. **Abspielen**: der Editor spielt die behaltenen Befehle mit demselben Seed durch sein eigenes `MapKit` auf der
   offenen Karte (`agent/script-playback.ts`). Terrain-, Paint- und Wasserpinsel laufen in Läufen zu sechs Tupfern,
   als würden sie gezogen; Landschaftsstriche, Straßen und Flüsse landen je als ein Schritt. Animiert dauert ein
   Skript 140 ms je Schritt, höchstens 8 s (`animate: false` so schnell, wie die Bilder es zulassen). Die Ansicht
   bekommt nach jedem Schritt mit, was sich änderte.
3. **Ein Undo-Schritt**: `EditorSession.agentEdit` hält den Ablauf wie einen Geländejob (Ansicht gesperrt, Job mit
   Cancel im Map-Panel, Speichern und Undo warten). Fertig wird vorher und nachher zu einem `SnapshotCommand`
   (Gelände, Objekte, Wege, Spawns, HQ, Himmel, Regeln, Leben). Bei Fehler oder Cancel geht die Karte auf den Stand davor
   zurück.
4. **Antwort**: Zahl der Befehle und Schritte, Logzeilen, Rückgabewert, Befunde des Prüfens, und `sameAsSandbox`:
   ein Fingerabdruck der Karte nach dem Abspielen gegen den der Kopie (gleicher Code, gleicher Seed; anders nur, wenn
   der Mensch die Karte inzwischen änderte).

Ein Skript, das scheitert, ändert nichts; die Antwort nennt Fehler und Zeile. Ein Skript, dessen Befehle die Karte so
lassen, wie sie war (Fingerabdruck gleich), wird nicht abgespielt und macht keinen Undo-Schritt (`changed: false`).
Mit `dry_run: true` läuft es nur in der Sandbox: Logzeilen, Rückgabewert und Zahl der Befehle, die Karte bleibt.

Höhenraster: `map.heightGrid(origin, step, rows, { blend, edge })` setzt den Boden in einem Befehl auf ein Raster von
Höhen (Zeilen von Süd nach Nord, bilinear dazwischen, außerhalb unberührt, am Rand über `edge` Meter eingeblendet,
höchstens 257 je Seite). Vorher baute ein Agent eine Insel aus 4082 einzelnen `level`-Tupfern und lief zuerst in die
Grenze von 5000 Befehlen.

Namen: Befehl und Lesefunktion heißen nie gleich (`scriptMap` bricht sonst ab). Bis 2026-10-15 verdeckte die
Lesefunktion `map.water()` den Befehl `map.water(level, kind)`, ein Agent bekam statt neuen Wassers dessen Liste; die
Lesefunktion heißt jetzt `map.waterBodies()`. Ein optionales Argument darf `null` sein (wie ausgelassen), spätere
zählen weiter nach Stelle. `map.removeObjects` und `map.removeRoads` brechen bei unbekannten Ids ab statt still nichts
zu tun; eine Straßen-Id in `removeObjects` nennt `removeRoads`. Ein unbekanntes Material oder Asset nennt nahe Ids aus
dem Katalog.

Katalog: Ist er nicht geladen (die Kartendaten waren nicht erreichbar, `MapAssetLibrary.catalog` gibt dann einen
leeren), antworten `catalog`, `place_object` und jedes Skript mit Befehlen aus `ASSET_OPS` (Biome, Malen, Objekte)
mit einem Fehler, der das sagt, statt mit leeren Listen. Formen, Wasser, Straßen, Marker, Himmel und Regeln gehen
weiter. Die Desktop-App aus einem Checkout (nicht gepackt) liefert die Kartendaten aus `public/maps` selbst aus
(`localMapDataRoot` in `desktop/src/main.js`); die gepackte App lädt sie wie die Webversion vom Webserver (E134).

## Sicherheit

- **Nur 127.0.0.1**, nie im Netz (Test: `listens on loopback only`).
- **Webseiten abweisen** (`checkRequest`): Host muss `127.0.0.1:<port>` oder `localhost:<port>` sein (fängt DNS
  Rebinding ab), ein `Origin`-Kopf wird immer abgewiesen (Browser schicken ihn bei jedem POST von fremder Seite, auch
  von `localhost`), ebenso `Sec-Fetch-Site` außer `none`. Abgewiesen wird vor jeder Verarbeitung (403).
- **Kein Token**: jedes Programm auf dem Rechner darf, solange der Schalter an ist (Entscheidung E171).
- **Sandbox**: das Skript läuft in einem eigenen Worker mit fester Adresse `agent/script-worker.js`, gebaut von
  `tools/agent/build-script-worker.mjs` (postinstall, `npm start`, `npm run build`). Die Desktop-App liefert ihn mit
  eigener Policy aus (`AGENT_WORKER_POLICY` in `desktop/src/protocol.js`, für die Webversion gleichlautend in
  `public/.htaccess`):
  `default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'; worker-src 'none'`. Er darf Strings auswerten
  und sonst nichts: keine Verbindung, kein Skript nachladen, kein Worker. Zusätzlich nimmt `sandbox-lockdown.ts` dem
  Worker-Scope vor dem ersten Skript `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`,
  `indexedDB`, `caches`, Timer, `postMessage` und mehr (eigene undefinierte Eigenschaften, auch über
  `({}).constructor.constructor('return this')()` nicht erreichbar); fehlt das, läuft kein Skript. Im Skript selbst
  verdecken Parameter dieselben Namen. Je Skript ein frischer Worker, nach 30 s beendet. Die Seite selbst darf weiter
  nichts auswerten.
- Geprüft im echten Chromium (headless, 2026-10-14): im Worker mit dieser Policy klappen `new Function`, aber
  `fetch`, `importScripts`, WebSocket und ein weiterer Worker werden blockiert; der gebaute Sandbox-Worker meldet
  alle gesperrten Namen als `undefined`.
- **IPC**: Antworten nimmt der Hauptprozess nur vom eigenen Fenster und unter der Id seiner Anfrage
  (`desktop:agent-reply`); Schalter, Status, Stop und Weiter nur von der App-Seite (`isAppSender`).
- **Stop** des Menschen sperrt jeden weiteren Aufruf im Hauptprozess, bevor der Editor ihn sieht.
- **Grenzen**: ein Befehl, der in der Sandbox länger als 3 s braucht, wird abgelehnt (der Editor spielt ihn in einem
  Bild ab); höchstens 5000 Befehle je Skript; Anfragen bis 2 MB. Den Speicher eines Skripts begrenzt nichts eigens, nur das Zeitlimit.

## Aufbau

```
desktop/src/agent-mcp.js          MCP-Server (SDK @modelcontextprotocol/server 2.0.0, Streamable HTTP), Host/Origin-Prüfung,
                                  Werkzeuge (zod), IPC zum Fenster, view_picture, Schalter (userData/agent-mcp.json)
desktop/src/preload.js            window.desktop.agent: onCall, status, setEnabled, onStatus, stop, resume; ohne offenen Editor antwortet er selbst
src/app/core/desktop-bridge.ts    AgentBridge, AgentCall, AgentAnswer, AgentStatus, readAgentBridge
src/app/editor/agent/
  editor-agent.ts                 Werkzeuge gegen die offene Karte (EditorSession als AgentHost), DryHost, Stop
  map-script.ts                   Befehlsliste SCRIPT_OPS, Prüfen, runMapScript, Referenztext
  script-playback.ts              Abspielen mit Animation, Änderungen an die Ansicht
  script-sandbox.ts               Worker starten, Zeitlimit; script-sandbox.worker.ts dessen Einstieg
  sandbox-lockdown.ts             Worker-Scope sperren
  agent-reads.ts                  Zusammenfassung, Höhen, Objekte, Katalog, Befunde, Fingerabdruck, mapDiff
src/app/editor/ui/agent/          Agent-Knopf, Agenten-Band, agent-state.ts (Zustand, Zeilen)
src/app/editor/ops/map-kit.ts     MapKit (vorher Kern von LevelKit); tools/maps/levels/kit.ts ist die dünne Hülle
tools/agent/                      Bau des Sandbox-Workers und sein Test
```

Der Editor meldet sich in `EditorSession` an (`readAgentBridge()?.onCall`), beim Verlassen ab. Er antwortet über den
Rückruf `reply(answer)`, den das Preload ihm mitgibt, nicht über den Rückgabewert: ein Promise der Seite ist unter
zone.js nicht das native und kommt über die contextBridge als Objekt ohne `then` an, die Antwort ging verloren (jedes
Werkzeug außer `view_picture` lieferte leeren Text, gefunden 2026-10-15). Das Preload schickt je Aufruf genau eine
Antwort und nur als reine Daten (Text, Bild, Fehler); eine Antwort ohne Text wird zum Fehler „The editor gave no
answer“, im Hauptprozess ebenso. Einstellungs-Schalter: `settings-sections.component` (Reiter Privacy, nur mit
Bridge).

## Tests

- `desktop/test/agent-mcp.test.js`: Host- und Origin-Prüfung, Einstellungen, Server über echtes HTTP (initialize,
  tools/list, tools/call, Bild, Argumentprüfung vor dem Editor, 403 für Webseite und fremden Host, 404 für anderen
  Pfad, nicht im Netz erreichbar), `setUpAgentMcp` mit falschem IPC (aus, an, Antwort über die Seite, Schalter
  gemerkt, fremder Absender, Start mit gemerktem Schalter, Fenster zu).
- `desktop/test/preload.test.js`: das Preload gegen ein falsches `electron`: Antwort aus `reply`, nicht aus dem
  Rückgabewert (ein Objekt wie ein Zone-Promise nach der Bridge), jedes Werkzeug von `TOOLS` unter seiner Id, Bild
  bleibt, eine Antwort je Aufruf, Antwort ohne Text und Wurf werden Fehler, ohne Editor der Hinweis.
- `desktop/test/protocol.test.js`: Policy des Sandbox-Workers; `tools/web-csp/web-csp.spec.ts`: dieselbe in
  `.htaccess`.
- `src/app/editor/agent/map-script.spec.ts`: Befehle behalten, Lesen nach Ändern, Abspielen ergibt denselben
  Fingerabdruck (Generator, Straße, Farbe in Läufen, Biom, Streuen), Ablehnungen mit Zeile, verdeckte Namen,
  Rückgaben ohne Durchgriff auf die Karte, Spawn-Ids, Referenz vollständig; `map.water` macht Wasser und
  `waterBodies` liest es, `removeRoads` und Ablehnung unbekannter Ids, `null` als ausgelassen, nahe Ids bei unbekanntem
  Material oder Asset, Katalog nicht geladen.
- `tools/agent/script-worker.spec.ts`: der gebaute Worker in eigenem Realm: Sperre vor dem Skript, auch über den
  Function-Konstruktor, eine Antwort je Worker.
- `src/app/editor/ui/editor-session.spec.ts` (AI agent): ein Skript ist ein Undo-Schritt und Undo nimmt alles zurück;
  gescheitertes Skript ändert nichts; Cancel stellt die Karte wieder her und ein zweiter Aufruf wartet; direkte
  Werkzeuge je ein Schritt, `undo_last` nur für eigene Schritte; Lesen, Kopieren, keine offene Karte; jedes Werkzeug
  über die Bridge mit `reply` als klonbare Antwort mit Text, Abmelden beim Verlassen; Fehler statt leerer Listen ohne
  Katalog, knapper Katalog ohne Filter, `dry_run` und kein Undo-Schritt ohne Änderung, Straße über `removeRoads`.
- `desktop/test/protocol.test.js` (map data of a checkout): Kartendatei aus `public/maps`, nur unter `maps/`.
- `settings-sections.scenario.spec.ts`: Schalter, Adresse, nicht in der Webversion.
- Teil 2: `desktop/test/agent-mcp.test.js` (Client-Name aus `initialize`, laufender und letzter Aufruf im Status, Stop
  beendet den wartenden Aufruf und sperrt die nächsten samt `view_picture`, Weiter, fremder Absender, `dry_run` an jedem
  ändernden Werkzeug, `describeCall`); `desktop/test/preload.test.js` (Status sofort und bei jedem Push, Stop, Weiter);
  `map-script.spec.ts` (alle neuen Befehle in einem Skript, Abspielen ergibt denselben Fingerabdruck; Ablehnungen mit
  den vorhandenen Ids; Lesen von Knoten und Flüssen); `editor-session.spec.ts` (Probelauf jedes ändernden Werkzeugs
  ohne Änderung der Karte und des Verlaufs, Erosion, Größe, Detail, Heightmap, Stempel aus Karte und Bibliothek,
  Öffnen, Anlegen, Speichern, Schließen, über die Seite, Stop in der Sandbox und beim Abspielen, Versionen);
  `agent-band.component.spec.ts` (Zustände, Zeilen, Band mit Balken, Stop und Weiter, Knopf mit Schalter).

## Von Hand testen (Desktop-App)

1. `npm --prefix desktop install` (neue Abhängigkeiten), dann `npm --prefix desktop run dev` oder ein Build.
2. Einstellungen, Privacy, **Allow AI agents to edit maps** an: die Adresse erscheint, Copy kopiert sie.
3. In einem Terminal `claude mcp add --transport http 3dtd <Adresse>`, Claude Code starten, `/mcp` zeigt `3dtd`
   verbunden mit 20 Werkzeugen.
4. Im Spiel Hauptmenü, Map editor, eine Karte öffnen.
5. Claude bitten: „Lies die Karte und baue im Nordosten einen bewaldeten Hügel mit einem Weg zum HQ.“ Erwartung: der
   Agent ruft `map_summary`, `script_api`, dann `run_script`; im Editor wächst der Hügel in Schritten, das Map-Panel
   zeigt den Job mit Cancel, danach steht im Verlauf ein Schritt `Agent: …`; Ctrl+Z nimmt ihn ganz zurück.
6. Während ein Skript spielt, im Map-Panel Cancel: die Karte ist wie vorher, der Agent bekommt die Meldung.
7. Bei eingeschaltetem Server im Browser aus einer beliebigen Seite `fetch('http://127.0.0.1:47171/mcp', { method:
   'POST', body: '{}' })`: die Seite sieht einen Fehler, `main.log` zeigt `[agent] refused a request: Requests from web
   pages are refused`.
8. Schalter aus: der Agent bekommt keine Verbindung mehr.
9. Teil 2: Knopf **Agent** in der Kopfleiste zeigt Off; Schalter darin an: On, Adresse. Agent verbinden und rufen
   lassen: Connected, das Band unten erscheint mit Name und letztem Aufruf; während eines Skripts Working mit Balken.
   **Stop** im Band: das Skript hört auf, die Karte ist wie vorher, der Agent bekommt „pressed Stop“; **Let it go on**.
10. Agent bitten: „Leg eine neue Karte Ash Isle an, 768 m, Vorlage woods, und öffne danach Demo Valley.“ Erwartung:
    Editor öffnet die neue Karte, dann eine eigene Kopie von Demo Valley; das Original bleibt.

## Offen (später, nicht gewählt)

- Probewelle und Bot-Test als Rückmeldung (Trial wave, Bot test).
- Werkzeuge auch ohne offenen Editor (list_maps, read_map, catalog): heute antwortet nur die Editor-Seite.
- Fortschritt (MCP progress) während langer Skripte; Abbruch eines Aufrufs durch den Agenten.
- Regeln und Wellen einer anderen Karte als eigener Befehl (heute über `read_map` lesen und `set_rules` setzen).
