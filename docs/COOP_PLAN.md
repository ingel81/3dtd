# Coop: zwei bis vier Spieler gegen dieselben Wellen, Lockstep über einen Relay

**Stand:** 2026-09-24 · Branch `coop` · Status: C0, C1a und C2a gebaut, Rest offen · Grundlage: [MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md) Teil IV
Abschnitt 23 ("Vier Tore") und Teil I Abschnitt 4, [SIMULATOR_PLAN.md](SIMULATOR_PLAN.md), [REPLAY.md](REPLAY.md)

Ziel: Zwei bis vier Spieler verteidigen in derselben Stadt ein gemeinsames HQ. Jeder hat einen eigenen Spawn und
damit seine Lane, jeder hat sein eigenes Gold und seine eigenen Tower, gebaut werden darf überall. Jeder Client rechnet die ganze Simulation selbst;
über das Netz gehen nur Befehle und Sicht-Masken (Lockstep). Der Einzelspieler bleibt, wie er ist, und wird nicht
teurer.

PvP (Rush, Versus Race, Angreifer gegen Verteidiger) ist gestrichen (User, 2026-09-24).

## 1. Was schon steht

Aus dem Simulator (Stand `next` = `main` = v0.4.0):

| Baustein | Wo | Für Coop |
|----------|----|----------|
| Befehle wirken nur an Sub-Step-Grenzen | `GameCommandsHandler.beginStep/endStep` | Die Stelle, an der Befehle aus dem Netz eingespeist werden |
| Befehlslog mit Sub-Step und `playerId` | `managers/game-state/command-log.ts` | Match-Log; `playerId` ist heute immer `LOCAL_PLAYER_ID` |
| Sicht als Daten | `LosMask`, `CommandLog.recordLos` | Die Maske, die der Host rechnet und verteilt |
| Zellhöhen eingefroren, Welt-Schlüssel | `GameStateManager.worldKey()` | Prüft, dass alle dieselbe Welt haben |
| Geseedete Zufallsströme mit lesbarem Zustand | `utils/game-rng.ts` (mulberry32, `Math.imul`, über Engines gleich) | Ein Seed je Raum |
| Snapshot zwischen den Wellen | `simulator/sim-snapshot.ts` | Startzustand beim Beitritt zwischen Wellen |
| Prüfsumme je Spielsekunde | `simulator/state-hash.ts` | Divergenz erkennen |
| Neu-Simulation mit Vorspulen | `simulator/resimulation.ts`, 10 800 Sub-Steps in rund 0,6 s | Wiedereinstieg mitten in der Welle (Abschnitt 4, C5) |
| Balance-Hash, Spielversion, Commit | `run-log/config-hash.ts`, Kopf der Replay-Datei | Beitritt nur bei gleichem Stand |
| Mehrere Spawns mit eigener Route, vier Spawn-Farben | `WaveManager.spawnPoints`, `SPAWN_COLORS` | Die Lanes |

Zufall und Uhr hängen am `GameStateManager`, nicht an Modulen: Zwei Simulationen laufen in einem Prozess
nebeneinander. Darauf baut C0. Ausnahme ist der Id-Zähler der `GameObject`s, er ist statisch; im Spiel gibt es eine
Simulation je Prozess, die Spec hält je Simulation ihren eigenen Stand.

## 2. Was fehlt

- **Befehle aus dem Netz.** Ein UI-Befehl zwischen zwei Frames wirkt heute sofort. Im Coop geht jeder Befehl,
  auch der eigene, erst an den Relay und wirkt bei allen am selben Tick.
- **Tempo und Pause** sind UI-Zustand (`GameStore.gameSpeed`, `paused`), kein Befehl. Im Coop gehören sie dem Raum.
- **Welt teilen.** Jeder Client baut seine Welt heute selbst aus Overpass. Overpass liefert nicht garantiert
  dasselbe; der Beitretende muss die Welt des Hosts übernehmen.
- **Spieler im Spiel.** Ein Goldkonto (`CreditsLedger`), Tower ohne Besitzer, ein Held, ein bemannter Tower.
- **Sicht vom Host.** Jeder Client rechnet die Sicht heute selbst auf seiner GPU gegen seine Tiles.
- **Netz:** Relay-Server, Räume, Tick-Barriere, Beitritt per Link.
- **Browserübergreifend bit-gleich** ist die Simulation nicht sicher: `Math.sin`, `cos`, `atan2` stecken im Sim-Pfad
  (`movement.component.ts`, `tower-aim.ts`, `projectile.entity.ts`, `projectile.manager.ts`, `geo-utils.ts`
  `haversineDistance` u. a.) und dürfen zwischen Engines im letzten Bit abweichen. Das betrifft nur gemischte
  Browser: Der Electron-Build bringt genau eine Chromium- und V8-Version mit, zwei PCs mit demselben Build rechnen
  gleich, und der Beitritt verlangt ohnehin dieselbe Spielversion.
- **Snapshot mitten in der Welle** (Gegner, Projektile, Spawner, Statuseffekte, Würmer) gibt es nicht.

## 3. Entscheidungen

| # | Frage | Entscheidung |
|---|-------|--------------|
| D1 | Modus | "Vier Tore": ein Spawn je Spieler, gemeinsames HQ, Gold getrennt, Bauen überall (User, 2026-09-24) |
| D2 | Transport | Eigener Relay, Node oder Bun mit WebSocket, TypeScript mit geteilten Typen (User, 2026-09-24) |
| D3 | Strenge | Erst Soft-Lockstep mit Prüfsumme und Resync, messen, nur bei Bedarf hart machen (User, 2026-09-24) |
| D4 | Vorgehen | Erst dieser Plan, gelesen vom User, dann bauen (User, 2026-09-24) |
| D5 | PvP | Gestrichen (User, 2026-09-24) |
| D6 | Gold | Je Spieler ein eigenes Konto (User, 2026-09-24) |
| D7 | Tower | Jeder Tower hat einen Besitzer. Jeder Spieler wählt, verwaltet und rüstet nur seine eigenen auf. Die Regel steckt an einer Stelle und ist austauschbar, damit sie später gelockert werden kann (User, 2026-09-24) |
| D8 | Plattform | Der Electron-Build ist auf allen PCs dieselbe Engine; gemischte Browser sind der Sonderfall, nicht die Regel (User, 2026-09-24) |
| D9 | Kill-Gold | Der Besitzer des Towers mit dem tödlichen Treffer bekommt das ganze Kopfgeld (User, 2026-09-24) |
| D10 | Held | Einer je Spieler, mit eigenem Gold, nur er steuert ihn. Datenmodell für mehrere Helden je Spieler auslegen (User, 2026-09-24) |
| D11 | Fähigkeiten, Silo | Je Spieler: eigene Ladungen, eigenes Silo (User, 2026-09-24) |
| D12 | Bemannter Tower | Jeder darf gleichzeitig einen eigenen bemannen; Zielen einmal je Netz-Tick über den Relay, lokal weich dargestellt (User, 2026-09-24) |
| D13 | Wellengröße | Jede Lane bekommt die Welle des Einzelspielers, HQ-HP und Leckschaden bleiben; der Director liest die gemeinsame Verteidigung. Späterer Regler: Leckschaden geteilt durch Spielerzahl (User, 2026-09-24) |
| D14 | Kernzone am HQ | Erst keine Regel, im Playtest ansehen (User, 2026-09-24) |
| D15 | Tempo, Pause, Wellenstart | Tempo und Pause nur der Host; die Welle startet, wenn alle bereit sind (User, 2026-09-24) |
| D16 | Spielerzahl | Höchstens vier, als Konstante (User, 2026-09-24) |
| D17 | Ort des Relays | Zuerst ein Prozess auf der Dev-Maschine des Users; später VPS oder eine VM hinter Cloudflare (User, 2026-09-24) |
| D18 | Form des Relays | Ein Relay-Code in `coop-server/` mit zwei Einstiegen: npm-Skript (Dev, VPS, VM) und im Electron-Main über "LAN-Spiel hosten". Keine eigene exe (User, 2026-09-24) |
| D19 | Tiles im Coop | Jeder Spieler bringt seinen eigenen Token (Cesium Ion oder Google) mit (User, 2026-09-24) |
| D20 | Forschung | Je Spieler: eigener Baum, eigene Slots und Warteschlange, eigenes Gold; die Wirkung gilt für die Tower, Helden und Fähigkeiten dieses Spielers (User, 2026-09-24) |
| D21 | Startgold | Jeder startet mit dem Startgold des Einzelspielers (User, 2026-09-24) |
| D22 | Host geht | Der Relay bestimmt den nächsten Host, die Lane des Gegangenen schließt, das Spiel läuft weiter. Beim LAN-Relay im Electron des Hosts endet der Raum mit ihm (User, 2026-09-24) |
| D23 | Beitritt | Nur vor dem Start; im Spiel nur Wiedereinstieg nach einem Abbruch auf die eigene Lane (User, 2026-09-24) |
| D24 | Bots | Als Mitspieler nur zum Testen im Dev-Modus, nicht im Spiel (User, 2026-09-24) |
| D25 | Verständigung | Ping auf der Karte in der Spielerfarbe und ein Text-Chat (User, 2026-09-24) |
| D26 | Spawns | Der Host wählt Stadt, HQ und beliebig viele Spawns, fehlende füllt die Zufallswahl auf. Die Mitspieler suchen sich in der Lobby einen der Spawns aus (User, 2026-09-24) |
| D27 | Bosse | Ein Boss je Lane, folgt aus D13; Intro und Musik einmal (User, 2026-09-24) |
| D28 | Gegnerzahl | Erst ohne Deckel, messen, dann entscheiden (User, 2026-09-24) |

## 4. Pakete

Die Reihenfolge hält jeden Schritt ohne Netz testbar, bis C4 den echten Relay bringt.

### C0 Lockstep im Prozess (gebaut 2026-09-24)

- `coop/lockstep.ts`: `LockstepLink` (das Client-Ende des Relays, egal worüber), `StampedCommand` mit Tick,
  laufender Nummer und `playerId`, `TICK_SUB_STEPS = 4` (rund 67 ms bei Tempo 1).
- `coop/local-relay.ts`: Relay im Prozess für Specs und als Vorbild für C4. Er hält die Ankunftsreihenfolge, legt
  alles Eingegangene in den nächsten Tick, wenn der schließt, und gibt jeden geschlossenen Tick an jeden Link.
- `GameCommandsHandler.setLockstep(link)`: Ein Befehl vom Bus wirkt nicht mehr dort, wo er gegeben wurde, sondern
  geht an den Link; `runTick(tick)` führt die gestempelten Befehle in der Reihenfolge des Relays aus und loggt sie
  mit der `playerId` des Absenders. Auch ein Replay führt einen Eintrag jetzt mit seiner `playerId` aus.
- `GameStateManager.setLockstep(link)` und die Barriere in der Sub-Step-Schleife (`lockstepOpen`): ein Sub-Step
  läuft erst, wenn der Tick der Grenze davor geschlossen und angekommen ist; an der Tick-Grenze laufen zuerst dessen
  Befehle. Im Einzelspieler ist der Link null, der Weg ist derselbe wie vorher.
- Kein fester Eingabe-Versatz wie im Konzept (T+3): Der Relay legt einen Befehl immer in den nächsten offenen Tick.
  Das ist sicher, weil kein Client über einen offenen Tick hinaus rechnen darf. Die Verzögerung ist Laufzeit zum
  Relay und zurück plus höchstens ein Tick.
- **Wellenstart gefunden und behoben:** Die Facade baute den Spawn-Plan der Welle (`adaptDirectorWave`) beim Klick
  und zog dabei aus dem `spawn`-Strom, im Coop also nur beim Klickenden. `command:start-wave` trägt jetzt die Welle
  der Wellenquelle (`director`), gebaut wird der Plan dort, wo der Befehl wirkt. Die Planung selbst hängt schon am
  Wellenende in der Simulation und läuft auf jedem Client gleich. Offen: die Debug-Welle aus dem Wave-Debug-Fenster
  baut weiter beim Klick (im Coop sind Debug-Befehle aus, C6).
- Abnahme `integration/lockstep.scenario.spec.ts`: zwei Simulationen, ein Relay; beide Spieler geben Befehle (Bau,
  Verkauf, Upgrade, Zielwahl, Feuerpause, Gold, eine Welle mit festem Plan, eine aus der Wellenquelle), B hört den
  Relay spät und in Schüben. Die Prüfsumme an jeder gemeinsamen Grenze ist gleich, das Log auch. Dazu: Barriere
  hält, Befehl wirkt am Tick und nicht beim Geben, eine Änderung am Relay vorbei fällt als andere Prüfsumme auf.
- Nach C4 verschoben: Tempo und Pause als Befehle (D15). Das Tempo gibt im Coop der Relay vor, der Client folgt;
  das gehört zum Takt des Relays.
- Offen für C4: Neustart im Coop. `reset()` zieht einen neuen Seed aus `Math.random`; im Raum muss der Seed vom
  Relay kommen.

### C1 Welt teilen

**C1a Paket und Zellen (gebaut 2026-09-24)**

- `coop/world-package.ts`: `WorldPackage` mit Format, Version, Spielversion, Balance-Hash, `worldKey`, Ursprung,
  HQ, Spawns, den Routen, wie der Korridor-Bau sie hinterlässt (Breiten, Brücken, Tunnel, Durchgänge), und den
  Zellhöhen. `readWorldPackage` lehnt fremdes Format, andere Spielversion und andere Balance ab, wie die
  Replay-Datei.
- Aus den Tiles zählt für die Simulation nur das: Die Zellen folgen deterministisch aus den Routen
  (`generateFromRoutes`), die Höhe und der Zustand je Zelle (stable, filled) kommen aus dem Paket.
  `GlobalRouteGrid.exportHeights/restoreHeights`; geschrieben wird über `RouteCellSampler.restore`, der Sampler
  bleibt der einzige, der Höhen schreibt.
- `GameStateManager.worldSource()` liefert, was der Host packt.
- Reihenfolge beim Beitretenden: Zellen erzeugen, Höhen übernehmen, erst dann Tower. Eine Sichtlinie, die auf
  Zellen ohne Höhe eingetragen wird, weicht ab (in der Spec so gefunden).
- Abnahme in `integration/lockstep.scenario.spec.ts`: Host mit Hügeln und einem Streifen ohne Tiles (gefüllte
  Zellen), Paket als Text, Beitretender auf Tiles, die nichts liefern: gleicher `worldKey`, gleiche Zellen und
  Höhen; ohne Höhen ein anderer Schlüssel; beide spielen eine Welle im Lockstep ohne Abweichung.

**C1b Einstieg im Spiel (kommt mit C4)**

- Ein Ort aus dem Paket statt aus Overpass, Routensuche und Korridor-Bau: Ursprung setzen, Marker, Spawns in den
  Store, Routen in den `PathAndRouteService`, Zellen erzeugen und Höhen übernehmen, Korridor als eingefroren
  markieren, Wave-Pipeline neu setzen. Straßen sind nur Bild und dürfen aus Overpass kommen.
- Testbar, sobald die Lobby das Paket liefert; vorher als Export und Import über das Dev-Menü denkbar.
- Tiles lädt jeder selbst, sie sind nach dem Einfrieren nur Bild.

### C2 Spieler im Spiel

**C2a gebaut (2026-09-24):** Spieler, Gold, Tower-Besitz, Kill-Gold.

- `GameStateManager.setPlayers(players, local)`, `players`, `localPlayerId`, `actingPlayerId`, `runAs`. Der
  Einzelspieler ist ein Spieler, `LOCAL_PLAYER_ID`; so startet der Manager. Der Handler führt jeden Befehl mit
  `runAs(playerId)` aus; ein Befehl eines Spielers, der nicht im Lauf ist, steht im Log und tut nichts.
- `CreditsLedger` mit einem Konto je Spieler (`balance`, `addEach` für Wellengold und Wellensprung, `saveAccounts`);
  `credits` bleibt das Konto des Spielers an diesem Client. `credits:changed` trägt `playerId` und `local`; Store
  und Run-Log hören nur das eigene Konto.
- `Tower.ownerId`; bauen, aufrüsten zahlt der handelnde Spieler, der Verkauf erstattet dem Besitzer.
- `coop/tower-policy.ts`: `TowerPolicy.may(playerId, tower, action)`, Standard `OWNER_ONLY`, am Manager als
  `towerPolicy` austauschbar. Die Tower-Befehle prüfen sie (`GameCommandsHandler.towerFor`), die UI wählt über
  `selectableTower` nur, was die Regel erlaubt.
- Kill-Gold an den Besitzer des Towers mit dem tödlichen Treffer. Held, Fähigkeiten und Dev-Werkzeuge buchen bis
  C2c auf den ersten Spieler; ebenso ein Tower, der vor dem Treffer verkauft wurde.
- Snapshot mit `accounts` und `ownerId` je Tower (beide optional, ältere Snapshots laden weiter). Die Prüfsumme
  nimmt alle Konten und den Besitzer, wenn er nicht der Einzelspieler ist: Im Einzelspieler bleibt sie bit-gleich,
  gespeicherte Replays behalten ihre Prüfsummen.
- Abnahme in `integration/lockstep.scenario.spec.ts`: jeder zahlt, was er baut, und besitzt es; der Partner darf
  den Tower weder verkaufen noch anhalten noch auswählen; Kill-Gold je Spieler gleich der Summe der Kills seiner
  Tower; beide Clients mit gleicher Prüfsumme.
- Offen in C2a: Die Forschung zahlt noch der handelnde Spieler und liest dessen Gold, die Warteschlange den ersten
  Spieler; das ersetzt C2b.

**Noch offen in C2 (Plan):**

- `CreditsLedger` wird zu Konten je Spieler (D6); der Einzelspieler ist ein Spieler. Jede Buchung hat Quelle und
  Spieler. Den Ledger nur einmal umbauen.
- `Tower.ownerId` (D7). Was ein Spieler mit einem Tower darf, entscheidet eine Regel an einer Stelle, etwa
  `towerPolicy.may(playerId, tower, action)` mit den Aktionen Auswählen, Aufrüsten, Verkaufen, Zielwahl,
  Feuerpause, Bemannen. Standard: nur der Besitzer. Die Befehle prüfen die Regel in der Simulation (ein verbotener
  Befehl wird abgelehnt und geloggt wie heute), die UI fragt dieselbe Regel, bevor sie einen Tower auswählbar macht.
  Lockern heißt die Regel tauschen, nicht Befehle umbauen. Im Einzelspieler gehört alles dem einen Spieler.
- Kill-Gold an den Besitzer des Towers mit dem tödlichen Treffer (D9). Schaden durch Held oder Fähigkeit bucht auf
  dessen Spieler.
- Forschung je Spieler (D20): der `ResearchManager` hält Baum, Slots und Warteschlange je Spieler. Jede Stelle,
  die heute eine Forschungswirkung liest (Tower-Werte, Freischaltungen, Fähigkeiten, Held), fragt nach dem
  Besitzer. Das ist der breiteste Umbau in C2; vorher die Lesestellen zählen.
- Startgold je Spieler wie im Einzelspieler (D21).
- Held je Spieler (D10): `HeroManager` von einem Helden auf eine Liste mit `ownerId`; nichts im Modell nimmt an,
  dass ein Spieler nur einen hat. Befehle tragen die Held-Id.
- Fähigkeiten und Silo je Spieler (D11): Ladungen je Spieler, das Limit "ein Silo je Karte" wird "eins je Spieler".
- Bemannen (D12): `mannedTowerId` wird je Spieler; `command:tower-aim` sammelt der Client und schickt den letzten
  Stand einmal je Netz-Tick.
- Lane: Zuordnung Spieler zu Spawn, Spielerfarbe = Spawn-Farbe. Jede Lane bekommt die volle Welle des
  Einzelspielers (D13, neuer `spawnMode` neben `each` und `random`); der Director plant einmal und liest die
  gemeinsame Verteidigung.
- Wellenstart (D15): `command:start-wave` erst, wenn alle bereit sind; der Bereit-Stand ist ein Befehl je Spieler.
- Abnahme: Specs je Regel; C0-Spec mit zwei Spielern, die bauen, verkaufen, aufrüsten, Helden anheuern.

### C3 Sicht vom Host

- Im Coop rechnet nur der Host die Sicht eines Towers (Bau, Upgrade, Luft-Nachrüstung) und schickt die Maske als
  Eingabe über den Relay; alle wenden sie am gestempelten Tick an. Das eigene GPU-Ergebnis der anderen wird nicht
  benutzt.
- Ein neuer Tower schießt erst, wenn seine Maske da ist (Verzögerung plus ein Frame beim Host). Das ist das Verhalten
  von heute, nur später.
- Abnahme: C0-Spec, in der nur eine Seite Masken liefert.

### C4 Relay und Lobby

- Neuer Ordner `coop-server/` (TypeScript, Node, `ws`), getrennt vom Python-`bot-server/`. Die Logik ist eine
  Bibliothek mit zwei Einstiegen (D18): ein npm-Skript und der Electron-Main ("LAN-Spiel hosten", Beitritt per IP
  oder Link). Keine eigene exe.
- Räume, Beitritt per Link (`?room=ABC123`, die URL-Mechanik gibt es in `url-location.service.ts`), Bereit-Status,
  Spielerliste mit Farben, Welt-Paket des Hosts durchreichen.
- Tick-Stempel, Reihenfolge, Freigabe der Ticks nach dem Tempo des Raums. Pause hält die Ticks an.
- Ein hängender Client bremst alle; nach einer Schwelle (etwa 3 s) fällt er raus, seine Lane schließt (kein Spawn
  mehr), der Rest spielt weiter. Seine Tower bleiben stehen und schießen weiter.
- Geht der Host, bestimmt der Relay den nächsten (D22); der übernimmt Sichtlinien, Tempo und Pause.
- Beitritt nur in der Lobby (D23), danach nur Wiedereinstieg auf die eigene Lane.
- Lobby (D26): Der Host wählt Stadt, HQ und Spawns, fehlende füllt die Zufallswahl aus dem Straßennetz auf
  (verschiedene Richtungen). Jeder Mitspieler wählt einen freien Spawn als seine Lane. Danach baut der Host den
  Korridor und schickt das Welt-Paket.
- Ping und Chat (D25) gehen über den Relay, aber nicht in die Simulation und nicht an die Tick-Barriere.
- Lokal: ein npm-Skript startet den Relay neben `npm start` (D17); zwei Browserfenster reichen zum Testen.
- Abnahme: zwei Fenster auf einem Rechner spielen eine Welle, Prüfsummen gleich.

### C5 Prüfsumme, Wiedereinstieg, Resync

- Jeder Client meldet alle N Ticks seine Prüfsumme (`StateHasher`); der Relay vergleicht.
- Wiedereinstieg und Beitritt mitten in der Welle: Snapshot vom Wellenstart plus Befehlslog seitdem, vorspulen.
  Das gibt es schon (Neu-Simulation) und trägt, solange die Browser gleich rechnen.
- Divergenz (anderer Browser, Float): zuerst nur erkennen und anzeigen, und messen, wie oft es passiert
  (Chrome gegen Firefox, Windows gegen Linux). Danach entscheiden:
  - Resync: Host schickt den vollen Zustand. Braucht den Snapshot mitten in der Welle.
  - Hart machen: Trigonometrie aus dem Sim-Pfad, lokale Ebenen-Projektion statt Haversine.
- Abnahme: absichtlich verfälschter Zustand auf einer Seite wird innerhalb von N Ticks gemeldet.

### C6 Coop-Oberfläche

- Lane-Druck je Spieler (Lecks, HP-Anteil), Besitz an Towern (Farbe), Gold der Mitspieler, Bereit-Knopf vor dem
  Wellenstart, Meldung bei Abbruch und Divergenz.
- Beitritt ohne eigenen Tiles-Token (D19): der Token-Dialog öffnet sich vor dem Beitritt, mit Erklärung.
- Ping (Taste plus Klick, Marke und Ton in der Spielerfarbe) und ein kleines Chatfenster (D25).
- Debug-Befehle und Cheats sind im Coop aus. Bots als Mitspieler nur im Dev-Modus zum Testen (D24): ihre Befehle
  gehen wie die eines Spielers über den Relay.

### C7 Betrieb

- Erst die Dev-Maschine des Users (D17). Später VPS oder VM hinter Cloudflare, nicht der FTP-Webspace von
  `/play/`; `wss://`, Adresse in `runtime-config.json`.
- Electron: derselbe Client; im LAN hostet ein Spieler selbst. Beim ersten Hosten fragt die Windows-Firewall nach,
  und der Relay endet mit dem Spiel des Hosts.

## 5. Offen

Nichts; alle Fragen der beiden Runden vom 2026-09-24 sind in Abschnitt 3 entschieden. Neue Fragen aus dem Bau kommen hierher.

## 6. Risiken

- **Browser-Floats (D3, D8).** Im Electron-Build kein Thema. Ob Soft-Lockstep für gemischte Browser reicht, zeigt
  erst die Messung in C5. Laufen Chrome und Firefox schon nach Sekunden auseinander, wird "hart" Pflicht, bevor
  Coop über Browser hinweg spielbar ist; bis dahin kann ein Raum gleiche Engine verlangen.
- **Gegnerzahl (D27, D28).** Vier Lanes heißen bis zu viermal so viele Gegner und vier Bosse zugleich. Messen im
  Lobby-Benchmark und Playtest, dann über einen Deckel entscheiden.
- **Tick-Barriere.** Der langsamste Client bestimmt das Tempo. Bei großen Wellen und hohem Tempo auf einem
  schwachen Rechner stockt der Raum.
- **Einzelspieler darf nicht leiden.** Gateway und Barriere kosten im Einzelspieler nichts; Benchmark
  `npm run bench:sim` vor und nach C0.
- **Welt aus dem Paket.** Der Korridor-Bau darf beim Beitretenden nicht neu laufen, sonst weicht der `worldKey`
  ab (siehe REPLAY.md, Grenzen).

## 7. Abnahme

- Zwei Browserfenster auf einem Rechner (Chrome) spielen zusammen bis W10, ohne Divergenz.
- Zwei Rechner mit dem Electron-Build über den Relay im Netz, dasselbe.
- Chrome gegen Firefox: Divergenz gemessen und nach der Entscheidung aus C5 behandelt.
- Einzelspieler: alle Specs, Benchmark ohne Verschlechterung.
