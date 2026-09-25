# Coop: zwei bis vier Spieler gegen dieselben Wellen, Lockstep über einen Relay

**Stand:** 2026-09-24 · Branch `coop` · Status: C0 bis C4c und C5a gebaut, C5b, C4d, C6 und C7 offen · Grundlage: [MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md) Teil IV
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
| D29 | Gemischte Browser | Electron ist primär; die Abweichung Chrome gegen Firefox ist ein Randthema, erst eingrenzen, später entscheiden (User, 2026-09-24, TODO E28) |
| D30 | Allein starten | Nein: ein Coop-Raum startet erst mit einem zweiten Spieler (User, 2026-09-24) |
| D31 | Freier Spawn | Ein neuer Raum hat von selbst einen freien Spawn für den zweiten Spieler; kein ständiger Extra-Spawn (User, 2026-09-24) |
| D32 | Tempo und Pause | Das Tempo setzt nur der Host, pausieren und weiterlaufen lassen darf jeder (User, 2026-09-24) |
| D33 | Cheats | Der Relay entscheidet: `npm run coop-server` erlaubt sie zum Entwickeln, `--no-cheats` verbietet sie (User, 2026-09-24) |
| D34 | Lobby | Das Raum-Panel dockt vor dem Start links an, ohne Schleier; die Karte bleibt bedienbar. Im Spiel ist es ein Dialog. Der Coop-Knopf sitzt im Kopf (User, 2026-09-24) |
| D35 | Karte in der Lobby | Der Host darf Spawns setzen, versetzen (Move je Lane, Menü am Flaggen-Knopf bei mehr als einem Spawn), hinzufügen und den Ort wechseln. Die Karte geht von selbst an den Raum; Gäste behalten ihre Lane, die Bereitschaft verfällt, bei einem neuen Ort laden sie neu und kommen in denselben Raum zurück (User, 2026-09-24) |
| D36 | Anzeige in der Lobby | Je Lane Länge in Metern, Balken zur längsten und Laufzeit eines Zombies; je Spieler der Ping (zum Relay, zu Mitspielern geschätzt über den Relay) (User, 2026-09-24) |
| D37 | Design-Handover | Coop-UI nach `tmp/coop-design/test3.zip` (README, `3dtd-coop.html`), in unseren Tokens und Rezepten; Lane-Farben bleiben `SPAWN_COLORS` wie auf der Karte (User, 2026-09-25) |
| D38 | Raum-Optionen | Echt jetzt: Cheats (Off / Host only / Everyone, nur wo der Relay sie erlaubt), Pause (Host only / Anyone / Off), Next wave (All ready / Host starts / Auto 10 s). Standard: Cheats off, Pause Host only, All ready. Eine Änderung setzt die Bereitschaft der Gäste zurück und schreibt eine Systemzeile. Credits, Difficulty, Drop-Regel später (User, 2026-09-25) |
| D39 | Spielmodus | Umschalter PvE Coop (aktiv) und Versus (ausgegraut, SOON) (User, 2026-09-25) |
| D40 | Host bereit | Der Host ist in der Lobby immer bereit; Start geht, sobald alle Gäste bereit sind (User, 2026-09-25) |
| D41 | Dock | Rechts neben der Fähigkeitenleiste, oben unter der FPS-Anzeige, bis über die Logo-Zeile, 440 px; in Lobby und Spiel dasselbe Dock ohne Schleier, im Spiel Optionen nur zum Lesen (User, 2026-09-25) |
| D42 | Taste Raum | Tab öffnet und schließt das Dock (User, 2026-09-25) |
| D43 | Meldungen | Alle Coop-Meldungen (Beitritt, Abgang, Host, Gold, Verbindung, Einstellungen) sind Systemzeilen im Chat; Warnungen zusätzlich im Fuß der Squad-Box (User, 2026-09-25) |
| D44 | Auto-Welle | Countdown 10 s nach Wellenende im Wellen-Knopf; sind vorher alle bereit, startet sie sofort (User, 2026-09-25) |
| D45 | Squad-Zustände | Jetzt Lag (> 160 ms). Dropped/Reconnect, Offline mit Retry, Left mit „Take over lane“ und Desync-Resync sind vorgesehen, nicht gebaut (User, 2026-09-25) |
| D47 | Zustand des Gasts | Jeder Client meldet dem Raum, was er in der Lobby tut: Kartenschlüssel, Karte laden, für einen neuen Ort neu laden, Karte steht (`status`, Protokoll 7). Die Spielerzeile und die Statuszeile zeigen es, der Chat sagt es; ein Neuladen gilt nicht als „left“. Per Einladungslink tritt der Gast sofort bei und lädt danach (User, 2026-09-25) |
| D46 | Schriften | Keine Cinzel: Überschriften in Inter Tight. JetBrains Mono wird selbst gehostet (`@fontsource`), weil `--td-font-mono` sie nennt und bisher auf Consolas fiel (User, 2026-09-25) |

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

**C2b gebaut (2026-09-24):** Forschung je Spieler (D20).

- Die Klasse `ResearchManager` ist die Forschung eines Spielers (`owner`); der `GameStateManager` hält eine je
  Spieler in Roster-Reihenfolge, jede mit ihrem Gold für die Warteschlange (`researchSeats`). `researchOf(player)`
  für die Simulation, `researchManager` ist die des Spielers an diesem Client (UI).
- Wirkung beim Besitzer: freigeschaltete Tower beim Bauenden, Upgrade-Stufen und Luftziele beim Besitzer des
  Towers (`SimResearch.airTargetingFor(ownerId)` in Kampf, Splash und Sichtlinie), die Luft-Nachrüstung nur für
  dessen Tower. Forschungszentrum und Silo sind eins je Spieler statt eins je Karte; die Bau-Karte sperrt nur das
  eigene.
- `research:*`-Ereignisse tragen `playerId` und `local`; Store, Run-Log und Onboarding hören nur die eigene
  Forschung. `TowerManager.placeTower` setzt den Besitzer vor `tower:placed`.
- Snapshot mit `researchByPlayer` (optional, ältere laden weiter).
- Abnahme: jeder baut ein eigenes Zentrum, A forscht, nur A zahlt und hat die Forschung, nur A darf den
  freigeschalteten Tower bauen; jeder Client zeigt die eigene Forschung; beide Clients mit gleicher Prüfsumme.

**C2c gebaut (2026-09-24):** Held, Fähigkeiten, Silo und bemannter Tower je Spieler (D10 bis D12).

- `PlayerOwner` (`managers/game-state/player-owner.ts`) für alles, was einem Spieler gehört; Forschung,
  Fähigkeiten und Held tragen ihn, ihre Ereignisse `playerId` und `local`, die UI hört nur die eigenen.
- Fähigkeiten: ein `AbilityManager` je Spieler (`abilityOf`), Startplatz ist das eigene Silo, Freischaltung durch
  die eigene Forschung, Kills mit `ownerId`.
- Held: ein `HeroManager` je Spieler (`heroOf`) mit eigener `heroId` (`hero` im Einzelspieler, `hero:<spieler>` im
  Coop); Schüsse und `hero:kill` tragen sie, das Kill-Gold geht an ihren Besitzer. Das Modell nimmt nirgends an,
  dass ein Spieler nur einen Helden hat. Gezeichnet wird vorerst nur der eigene (Renderer für mehrere: C6).
- Bemannter Tower: einer je Spieler (`TowerLifecycle.mannedTowers`), `tower:manned` mit Spieler; ein Tower, in dem
  schon jemand sitzt, nimmt keinen zweiten. Das Fadenkreuz liest das Ziel seines eigenen Towers.
- Prüfsumme über alle Helden; im Einzelspieler bit-gleich wie vorher. Snapshot mit `abilitiesByPlayer`,
  `heroesByPlayer`, `mannedByPlayer` (optional).
- Abnahme: jeder heuert seinen Helden an, A setzt eine Fähigkeit ein, B behält seine Ladung; das Kill-Gold je
  Spieler ist die Summe der Kills seiner Tower, seines Helden und seiner Fähigkeiten. Beide sitzen gleichzeitig in
  ihren Towern, B kommt nicht in A's Tower, jeder zielt für sich.

**C2d gebaut (2026-09-24):** Lanes und Bereitschaft (D1, D13, D15, D27).

- `GameStateManager.setLanes(spieler → spawn)`: Jede Welle läuft einmal je Lane (`laneSchedule` in
  `wave.manager.ts`): jeder Eintrag auf jedem Lane-Spawn, die Kopien direkt nacheinander, der Abstand danach wie
  vorher; aus dem Spawn-Strom wird so oft gezogen wie ohne Lanes. Jede Lane bekommt die ganze Welle, auch ihren
  Boss. `SpawnEntry.spawnPointId` legt den Spawn fest; eine schon verteilte Welle (Replay) wird nicht noch einmal
  verteilt.
- `command:set-ready`, `setReady`, `allReady`, Ereignis `coop:ready-changed` (mit `allReady`); ein Wellenstart
  löscht die Bereitschaft. Den Start selbst schickt der Host, sobald alle bereit sind (C4, er hält die Wellenquelle
  in der Facade).
- Abnahme: zwei Lanes, eine Welle aus der Wellenquelle, jede Lane bekommt alle Gegner an ihrem Spawn; Bereitschaft
  wird erst mit dem zweiten Spieler „alle bereit“ und ist nach dem Start weg. `lane-schedule.spec.ts` prüft
  Verteilung, Abstände und Zufallszüge.

**Plan von C2 (so gebaut):**

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

### C3 Sicht vom Host (gebaut 2026-09-24)

So gebaut:

- Auch der Host wendet eine selbst gerechnete Sichtlinie nicht sofort an: Sonst wäre ein neuer Tower bei ihm früher
  schussbereit als bei den anderen. `TowerLosRegistry.setCoopRole('host' | 'guest')`: Bau, Upgrade und
  Luft-Nachrüstung setzen den Tower auf „wartet auf Sicht“ (auf jedem Client gleich, die Simulation fragt). Ein
  neuer Tower ist bis dahin nicht bereit, ein aufgerüsteter behält seine alten Antworten.
- Nur der Host rechnet nach dem Frame auf der GPU (einer je Frame), kodiert die Maske, stellt Zellen und Tower
  wieder so her, wie alle anderen sie haben, und schickt `command:los-mask`. Alle wenden sie am Tick an
  (`applyCoopMask`); ein zweites Senden verhindert `sent`.
- Hostwechsel (D22): Die Warteliste ist auf allen Clients gleich, ein neuer Host rechnet, was offen ist.
- Die GPU-Rechnung steckt in `resolveOnGpu`, die Einzelspieler und Host teilen; der Einzelspieler rechnet wie
  vorher sofort.
- Abnahme: `tower-los-registry.spec.ts` (Gast rechnet nichts, Host rechnet einmal und stellt zurück, Anwenden am
  Tick, Upgrade behält alte Antworten, Nachrüstung wartet) und in der Lockstep-Spec ein Tower, den B mitten in der
  Welle baut: Die Maske kommt vom Host, steht in beiden Logs am selben Sub-Step, die Prüfsummen bleiben gleich.
- Offen für C5: Die Warteliste gehört in einen Snapshot mitten in der Welle.

Ursprünglicher Plan:

- Im Coop rechnet nur der Host die Sicht eines Towers (Bau, Upgrade, Luft-Nachrüstung) und schickt die Maske als
  Eingabe über den Relay; alle wenden sie am gestempelten Tick an. Das eigene GPU-Ergebnis der anderen wird nicht
  benutzt.
- Ein neuer Tower schießt erst, wenn seine Maske da ist (Verzögerung plus ein Frame beim Host). Das ist das Verhalten
  von heute, nur später.
- Abnahme: C0-Spec, in der nur eine Seite Masken liefert.

### C4 Relay und Lobby

**C4a gebaut (2026-09-24):** das Relay.

- `coop-server/` (TypeScript, Node führt es direkt aus, `erasableSyntaxOnly`), `npm run coop-server [-- --port N]`,
  Standard-Port 3003. `room.ts` sind die Regeln (rein, ohne Sockets), `server.ts` verbindet Sockets und Uhr,
  `main.ts` ist der Einstieg für npm; die Desktop-App bekommt ihren in C4d.
- Protokoll `src/app/coop/protocol.ts` (nur Typen und zwei Konstanten, das Relay importiert es als Typ):
  hello, create/join, world, pick, ready, start, cmd, speed (0 hält an), chat, ping; zurück welcome, refused,
  room, world, started, tick, speed, chat, ping, left, host.
- Raum: höchstens vier (D16), Beitritt nur vor dem Start (D23) und nur mit gleicher Spielversion und Balance,
  jede Lane einmal, bereit nur mit Lane, Start nur durch den Host und nur wenn alle bereit sind. Ticks schließen
  nach Spielzeit im Tempo des Raums, Befehle in Ankunftsreihenfolge in den nächsten offenen Tick. Wer im Spiel geht,
  bekommt ein `command:leave-game` in den nächsten Tick (seine Lane schließt bei allen gleich); der Host geht an
  den nächsten in Beitrittsreihenfolge (D22).
- Tests: `room.spec.ts` (Regeln, Takt, Tempo, Verlassen), `server.spec.ts` (zwei echte Sockets vom Anlegen bis zu
  den Ticks, Hostwechsel).

**C4b gebaut (2026-09-24):** die Client-Seite ohne Spiel.

- `coop/coop-session.ts`: `CoopSession` (verbinden, Raum anlegen oder beitreten, Welt, Lane, bereit, Start, Tempo,
  Chat, Ping, Hostwechsel; Ablehnung als `CoopRefusedError`) und `WebSocketLink`, der `LockstepLink` über den
  Socket. Frei von Angular, der Socket ist austauschbar.
- Test `coop-server/src/session.spec.ts`: zwei Sitzungen gegen das echte Relay von der Lobby bis zum gemeinsamen
  Tick, Ablehnung, Hostwechsel.

**C4c gebaut (2026-09-24):** Coop im Spiel, mit C1b. Noch nicht im Browser gespielt.

- `services/coop.service.ts` (`CoopService`, im Scope der Spielkomponente, optional über das Token `COOP`):
  Raum öffnen mit dem geladenen Ort (Host schickt das Welt-Paket), beitreten, Lane, bereit, Start. Beim Start setzt
  jeder Client den Lauf mit dem Seed des Raums zurück (`GameStateManager.reset(seed)`), setzt Spieler, Lanes,
  Sicht-Rolle und den Link.
- Beitritt (C1b): Steht hier ein anderer Ort als der des Hosts, lädt die Seite den Ort des Hosts mit `?room=` in der
  URL neu und tritt danach von selbst bei; das ist zugleich der Einladungslink. Steht der Ort, übernimmt der
  Beitretende Routen (`PathAndRouteService.adoptPaths`), Wave-Pipeline, Zellen und Höhen (`restoreHeights` jetzt
  exakt: Zellen ohne Höhe beim Host haben auch hier keine) und prüft den Welt-Schlüssel. Der eigene Korridor-Bau
  läuft dabei einmal umsonst mit; Messpunkt für die Ladezeit.
- Wellenstart (D15): Im Coop ist der Wellenknopf „bereit“; der Host startet die Welle, sobald alle bereit sind.
  Keine Auto-Welle im Coop.
- Tempo und Pause (D15): Eine Änderung im Store, per Knopf oder Taste, geht beim Host als `speed` ans Relay, beim
  Gast wird sie zurückgenommen; die Antwort des Raums setzt den Store.
- Verlassen: `command:leave-game` (das Relay legt es in den nächsten Tick) schließt die Lane, der Spieler zählt als
  bereit, seine Tower bleiben. Hostwechsel: der neue Host übernimmt die Sichtlinien.
- Wellenplanung: Der Director liest im Coop nur, was alle Clients gleich haben (Luftziele, wenn irgendein Spieler sie
  hat; der erste angeheuerte Held; die Summe aller Konten), sonst liefe der Strom `director` auseinander. Der
  Forschungs-Teil des Snapshots kommt weiter aus dem eigenen Store; er ist nur Rückfall, wenn die Verteidigung
  keine Fähigkeiten nennt, und `analyzeDefense` nennt sie immer.
- Relay-Adresse: `coopRelay` in `runtime-config.json`, sonst `ws://localhost:3003`.
- UI: Knopf „Coop“ in der Seitenleiste, Dialog `components/coop-dialog/` (Name, Raum öffnen oder beitreten,
  Einladungslink, Spieler, Lanes in Spawn-Farbe, bereit, Start; im Spiel Chat). Mit Einladungslink öffnet er sich,
  sobald die Karte des Hosts steht.
- Abnahme per Spec: Verlassen in der Lockstep-Spec. Der Browser-Test mit zwei Fenstern steht aus.

**Nach dem ersten Browser-Test (2026-09-24):**

- Der Einladungslink trägt den Ort des Hosts (HQ, Spawns) und den Raum: Der Gast lädt einmal die richtige Karte
  und tritt bei, sobald sie steht. Eine Seite, die doch neu laden muss, verlässt vorher den Raum; das Relay prüft
  alle 3 s per Herzschlag und wirft stumme Clients hinaus (der Browser schließt den Socket einer verlassenen Seite
  spät). Gleiche Namen bekommen eine Nummer.
- Spawns: Bisher setzte die Flagge nur den einen Spawn neu. Neu ist der Knopf „+“ in der Kopfleiste (ein weiterer
  Spawn, bis vier, `MapRelocationService.applySpawnAdded`), und im Coop füllt der Host fehlende Lanes selbst auf
  (D26, `addRandomSpawn`: acht Straßenpunkte 500 bis 1000 m vom HQ, der mit dem größten Winkelabstand zu den
  anderen Spawns gewinnt), dann schickt er die Karte neu. Der Gast setzt die neuen Spawns bei sich dazu, ohne neu zu
  laden, und übernimmt dann das Paket.
- Zweiter Browser-Test (User, 2026-09-24): zwei Fenster auf einem Rechner, Link, Lobby, zwei Lanes, Start: klappt
  grundsätzlich.

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

**C5a gebaut (2026-09-24):** Abweichung erkennen, Diagnose am Relay.

- `coop/hash-check.ts`: `HashCheck` vergleicht die Prüfsummen eines Ticks und meldet den ersten Tick mit zwei
  verschiedenen einmal; Relay und `LocalRelay` teilen ihn. `HASH_EVERY_TICKS = 15` (eine Spielsekunde).
- `LockstepLink.reportHash`: Der `GameStateManager` meldet am Rand jedes 15. Ticks, vor dessen Befehlen, die
  Prüfsumme (`StateHasher`). Protokoll 2: `hash` vom Client, `desync` an alle (erster Tick, Spieler und Prüfsumme).
- Client: `CoopSession.onDesync`, `CoopService.desync`, Warnung in der Konsole mit den Prüfsummen, Hinweis im
  Coop-Dialog. Eine Anzeige im Spiel kommt mit der Spieler-Leiste (Wunsch A).
- Relay-Diagnose: jede Raum-Zeile mit Uhrzeit und `[CODE]` (Anlegen, Beitritt, Austritt mit Grund Schließen oder
  Herzschlag, Welt mit Größe und Spawns, Lanes, Bereit, Start mit Seed und Lanes, Tempo, Hostwechsel, erste
  Abweichung, Ende mit Dauer, Ticks, Befehlen); alle 10 s je laufendem Raum Tick, Tempo, Befehle je Sekunde, je
  Spieler Ping-Laufzeit des Herzschlags und letzte Prüfsumme. Statusseite `http://<relay>/` (Text) und `/status`
  (JSON). `npm run coop-server` schreibt zusätzlich nach `logs/coop_<Start>.log`.
- Abnahme: Lockstep-Spec (B verfälscht sein Gold, der Relay meldet es spätestens 15 Ticks später; der lange
  Zwei-Spieler-Lauf endet ohne Meldung), `room.spec.ts`, `server.spec.ts` (Abweichung über Sockets, Log mit Code,
  Statusseite), `session.spec.ts`.
- Gemessen (User, 2026-09-24, Relay-Log): Chrome gegen Chrome bis W10, rund 66 Spielminuten, ohne Abweichung.
  Chrome gegen Firefox weicht bei Tick 210 ab (14 Spielsekunden nach dem Start) und bleibt abweichend. Ursache
  unbelegt; Eingrenzen per zerlegter Prüfsumme ist TODO E28, Randthema (D29).

**C5b offen:** Wiedereinstieg und Resync.

- Jeder Client meldet alle N Ticks seine Prüfsumme (`StateHasher`); der Relay vergleicht.
- Wiedereinstieg und Beitritt mitten in der Welle: Snapshot vom Wellenstart plus Befehlslog seitdem, vorspulen.
  Das gibt es schon (Neu-Simulation) und trägt, solange die Browser gleich rechnen.
- Divergenz (anderer Browser, Float): zuerst nur erkennen und anzeigen, und messen, wie oft es passiert
  (Chrome gegen Firefox, Windows gegen Linux). Danach entscheiden:
  - Resync: Host schickt den vollen Zustand. Braucht den Snapshot mitten in der Welle.
  - Hart machen: Trigonometrie aus dem Sim-Pfad, lokale Ebenen-Projektion statt Haversine.
- Abnahme: absichtlich verfälschter Zustand auf einer Seite wird innerhalb von N Ticks gemeldet.
- Diagnose am Relay (User, 2026-09-24), gehört zu C5, weil die Abweichungssuche davon lebt:
  - Log je Raum mit Uhrzeit und Raum-Code: Anlegen, Beitritt und Austritt (mit Name, Grund: Schließen oder
    Herzschlag), Welt empfangen (Größe, Spawns), Lanes, Bereit, Start (Seed, Roster), Tempo, Hostwechsel, Ende.
  - Regelmäßige Zeile je laufendem Raum: Tick, Befehle je Sekunde, Spieler mit Ping-Laufzeit, letzte Prüfsummen.
  - Statusseite des Relays (HTTP GET, JSON und lesbar): offene Räume, Spieler, Zustand, Tick, Alter.
  - Log zusätzlich in eine Datei (`logs/coop_*.log`), damit ein Lauf danach nachlesbar ist.

### Nach C5: Wünsche aus dem Browser-Test (User, 2026-09-24)

Reihenfolge nach Priorität (A zuerst):

| Prio | Punkt |
|------|-------|
| A | In der Lobby kann jeder seinen Namen ändern, bevor es losgeht (heute nur vor dem Beitritt; braucht eine Nachricht `rename` am Relay) **Gebaut 2026-09-24.** |
| A | Klickt ein Spieler auf „Starte Welle“ (heißt im Coop „bereit“), sehen die anderen das **Gebaut 2026-09-24.** |
| A | Eine kleine dauerhafte Anzeige im Spiel mit allen Spielern, Namen und Zustand; der Coop-Dialog allein reicht nicht **Gebaut 2026-09-24.** |
| A-B | Gold an einen Mitspieler senden, im Spiel (User, 2026-09-24). Ein Befehl wie `command:give-credits` mit Empfänger und Betrag, der über den Relay läuft und im Ledger vom einen Konto aufs andere bucht **Gebaut 2026-09-24.** |
| A-B | Die Lobby zeigt je Spieler, womit er spielt: Engine (Chrome, Firefox, Electron-Build), deren Versionsnummer, Spielversion, Betriebssystem (User, 2026-09-24). Kommt mit `hello` zum Relay, steht auch in dessen Log und Statusseite; bei verschiedenen Engines ein Hinweis in der Lobby, weil gemischte Browser auseinanderlaufen (C5, D29, TODO E28) **Gebaut 2026-09-24.** |
| B | Beim Gast schließt sich der Coop-Dialog beim Start nicht von selbst (beim Host schon, weil sein Start-Knopf ihn schließt) **Gebaut 2026-09-24.** |
| C | Chat im Spiel unten links, ähnlich wie Minecraft, mit einer Taste zum Schreiben |

So gebaut (2026-09-24), Nachtest in [PLAYTEST.md](PLAYTEST.md) T:

- Name: Nachricht `rename` am Relay, nur in der Lobby, gleiche Namen bekommen eine Nummer; Feld „Your name“ im Dialog.
- Spieler-Leiste `components/coop-players/` oben mittig unter dem Tempo: je Spieler Lane-Farbe, Name, Gold, zwischen
  den Wellen „ready“ oder „building“, Gegangene durchgestrichen; „Waiting for …“, sobald man selbst bereit ist.
  Gelesen aus der Simulation (`coop:ready-changed`, `credits:changed`, `coop:player-left`), auf allen Clients gleich.
- Gold senden: `command:give-credits` (Empfänger, Betrag), `GameStateManager.giveCredits`: nur ganze Beträge, nur was
  der Geber hat, nur an einen Mitspieler im Spiel; Buchungsquelle `gift`, Ereignis `coop:credits-given`. In der
  Leiste der Knopf neben einem Mitspieler, Beträge 50, 100, 250, 500; beim Empfänger „X sent you N gold“.
- Engine: `coop/client-info.ts` liest aus dem User-Agent Browser oder Electron (mit Chromium-Version), Version,
  Engine-Familie und System. Kommt mit `hello`, steht in der Lobby, im Relay-Log beim Beitritt und auf der
  Statusseite. Hinweis in der Lobby bei mehr als einer Engine-Familie (Blink, Gecko, WebKit). Die Spielversion steht
  nicht je Spieler da: Das Relay lässt ohnehin nur dieselbe in den Raum.
- Dialog: schließt sich beim Start für alle, nicht nur beim Host.

### Review 2026-09-24: was noch dazugehört

Durchsicht von Relay, Session, `CoopService`, Dialog und Spieler-Leiste nach dem UI-Umbau. Reihenfolge je Gruppe
nach Gewicht. Aus dem Code belegt, nicht im Browser nachgestellt, wo nicht anders gesagt.

**Fehler (vor dem nächsten längeren Test)**

- R1 **Neustart im Coop läuft auseinander.** „Play again“ schickt `command:restart-game` über das Relay; jeder Client
  ruft `reset()` ohne Seed und zieht einen eigenen aus `Math.random`. Lösung: Neustart nur durch den Host, Seed im
  Befehl (oder vom Relay), Spieler und Lanes danach wieder setzen. **Gebaut 2026-09-24: `command:restart-game` mit Seed, nur der Host (Gast sieht „The host starts the next run“); im Lockstep beginnt die neue Runde am nächsten Relay-Tick (`lockstepTickBase`), wer ging, bleibt weg.**
- R2 **Ein Client hinter dem Relay holt nie auf.** Das Relay schließt Ticks nach Wanduhr, die Uhr des Clients läuft
  aber nur in Raumtempo (`GameClock.MAX_CATCHUP_MS`). Nach einem Ruckler oder einem Hintergrund-Tab bleibt der
  Rückstand für immer; im Test vom 2026-09-24 lag das zweite Fenster konstant rund 75 Ticks (5 Spielsekunden)
  zurück. Lösung: im Lockstep bis zum bestätigten Tick nachlaufen (begrenzt, etwa bis 4×), und das Relay läuft
  höchstens K Ticks vor dem langsamsten Client (der meldet, bis wohin er ist; die Prüfsummen tun das schon). **Gebaut 2026-09-24 (Client-Seite): im Lockstep läuft die Uhr bis 4× schneller, solange mehr als 3 Ticks offen sind (`lockstepCatchUp`). Das Relay wartet weiterhin auf niemanden; ein Deckel „höchstens K Ticks vor dem Langsamsten“ bleibt offen.** **Gebaut 2026-09-25: der Relay läuft höchstens 3 Spielsekunden vor der letzten Prüfsumme des Langsamsten und meldet `waiting`; dazu hält jeder Client einen Tick Vorrat (Tempo ±10 %), ein Tick sind jetzt 2 Sub-Steps (Protokoll 5), ein bemannter Tower zeigt Schuss, Ton und Rückstoß sofort beim Klick.**
- R3 **Debug-Befehle laufen im Coop durch.** `debug:add-credits`, `debug:kill-all` usw. gehen über das Relay und
  wirken bei allen. Plan (C6) sagt „im Coop aus“. Lösung: Relay verwirft `debug:*`, die Simulation ignoriert sie bei
  mehr als einem Spieler (auf allen Clients gleich). **Gebaut 2026-09-24: Relay nimmt nur `command:*`, die Simulation ignoriert `debug:*` bei `cheatsBlocked` (setzt jeder Client beim Start).** Nach dem Playtest geändert: Der Relay entscheidet (`npm run coop-server` erlaubt Cheats zum Entwickeln, `--no-cheats` verbietet sie, der Raum meldet `cheats`). Kill all, Gegner-Spawn und Gegner-Entfernen laufen seitdem als Kommando, vorher wirkten sie nur im eigenen Fenster.
- R4 **Ortswechsel und Replay im Coop.** Für HQ versetzen, Spawn neu setzen, Stadt wechseln und die Replay-Leiste
  fand ich keine Sperre im laufenden Coop-Spiel; jede davon baut Welt oder Simulation nur lokal um. Im Spiel sperren
  (Knopf aus, Tooltip „not in a coop game“). **Gebaut 2026-09-24: `UIStore.coopMapLocked` (im Spiel, und für Gäste in der Lobby) sperrt Ortsdialog, Würfel, Favoriten, HQ, Spawns und Replay.**
- R5 **Tempo beim Gast.** Der Knopf nimmt Klicks an und springt zurück. Beim Gast ausgegraut mit Tooltip „the host
  sets the speed“. **Gebaut 2026-09-24: beim Gast ausgegraut mit Tooltip, Klick tut nichts.**

**Zusammenfinden**

- R6 Relay-Adresse, siehe unten; bisher `coopRelay` in `runtime-config.json`, sonst `ws://localhost:3003`. **Gebaut 2026-09-24: `coop/relay-address.ts`, Reihenfolge wie unten.**
- R7 Einladungslink trägt die Relay-Adresse mit (`&relay=`), sonst landet ein Gast mit anderer Konfiguration auf
  einem anderen Server und findet den Raum nicht. **Gebaut 2026-09-24: `&relay=` im Link, außer bei localhost; bleibt beim Neuladen auf die Karte des Hosts erhalten.**
- R8 Beitritt ohne eigenen Tiles-Token (D19): Token-Dialog vor dem Laden der Karte, mit Satz, warum. **Gebaut 2026-09-25: Token-Bildschirm nennt den Raum, der Beitritt wartet ohne Limit auf Schlüssel und Engine.**
- R9 Host: Spieler aus der Lobby entfernen, Raum schließen für weitere Beitritte. **Gebaut 2026-09-25: `kick`, `lock`.**
- R10 Wiedereinstieg nach Verbindungsabbruch (C5b). Bis dahin: nach Abbruch „Continue alone“ (Lockstep aus, das
  Spiel läuft als Einzelspieler weiter) statt stehenzubleiben. **Gebaut 2026-09-25: „Continue alone“ unter der Spieler-Leiste; C5b offen.**
- R11 Raumcode ohne Link eintippen geht nur, wenn der Gast dieselbe Karte schon geladen hat oder neu lädt; klappt,
  aber der Dialog sagt nicht, dass die Seite gleich neu lädt. **Gebaut 2026-09-25: Hinweis unter dem Feld.**

**Im Spiel**

- R12 Chat unten links mit Taste (Wunsch C); heute nur im Dialog, eingehende Zeilen stehen unter der Leiste. **Gebaut 2026-09-25: Enter öffnet, `coop-chat`.**
- R13 Karten-Ping (D25): Protokoll hat `ping`, es gibt keine Oberfläche. **Gebaut 2026-09-25: X plus Klick, Name in Lane-Farbe, Ton.**
- R14 Tower des Partners erkennbar machen (Farbring in Lane-Farbe, Tooltip „Bob's tower“); heute ist er nur nicht
  auswählbar, ohne Grund. **Gebaut 2026-09-25: Ring in Lane-Farbe, Klick sagt „That is Bob's tower“.**
- R15 Lane-Druck je Spieler (Lecks je Lane), Anzeige wer gerade bremst (R2), Held des Partners sichtbar (heute nur
  der eigene gezeichnet, C2c). **Gebaut 2026-09-25: Lecks je Lane in Leiste und Game-over-Tabelle, Bremser über R2; Held des Partners offen.**
- R16 Game over im Coop: Zusammenfassung je Spieler (Kills, Gold, Lecks je Lane); Run-Log markiert Coop-Läufe, damit
  sie nicht in Einzelspieler-Rekorde und Mittelwerte fallen. **Gebaut 2026-09-25: Tabelle je Spieler, `head.coop`, keine Ortsrekorde.**

**Relay**

- R17 `maxPayload` am WebSocket-Server setzen (Standard 100 MB; das Weltpaket hat rund 300 kB), Nachrichten je
  Sekunde und Verbindung begrenzen, Chatlänge ist schon begrenzt. **Gebaut 2026-09-24: `maxPayload` 4 MB, 120 Nachrichten je Sekunde und Verbindung, darüber verworfen und einmal geloggt.**
- R18 Leere oder verwaiste Räume nach Zeit schließen (Lobby ohne Start nach 1 h), Obergrenze an Räumen. **Gebaut 2026-09-25: 1 h, 200 Räume.**
- R19 `wss://` und Herkunftsprüfung (`Origin`) fürs Netz (C7).
- R20 Electron: Relay im Main-Prozess, „LAN-Spiel hosten“, eigene IP im Dialog anzeigen (C4d).

**Tests**

- R21 `CoopService` hat keine eigene Spec (automatische Lane, Start mit Bereit, Meldungen, Abbruch). **Gebaut 2026-09-25: `coop.service.scenario.spec.ts` über echten Relay.**

#### Woher das Spiel den Relay kennt

Die Adresse soll nicht fest im Code stehen. Möglichkeiten, von oben nach unten gefragt, die erste mit Antwort gilt:

So gebaut (2026-09-24), `coop/relay-address.ts`; eine der Stellen 1 bis 3 wird allein versucht, die automatischen
der Reihe nach (je 5 s):

1. **Einladungslink** `&relay=wss://…`: Der Gast nimmt den Server des Hosts, ohne etwas einzustellen (R7).
2. **Eigene Einstellung** im Coop-Dialog („Server“, klappbar unter „Advanced“), in `localStorage` wie der
   Tiles-Token: für LAN und selbst betriebene Server.
3. **`runtime-config.json`** `coopRelay` (gibt es): Die Webseite liefert ihren Standard-Server mit, änderbar ohne
   neuen Build; auch eine Liste wäre möglich, der Client nimmt den mit der kleinsten Laufzeit.
4. **Gleiche Herkunft**: Läuft die Seite über `https://host/play/`, versucht der Client `wss://host/coop` (Reverse
   Proxy vor dem Relay). Keine Konfiguration nötig, sobald die Seite und der Relay hinter derselben Domain stehen.
   Über `http://<LAN-IP>` versucht er `ws://<LAN-IP>:3003`.
5. **Entwicklung**: `ws://localhost:3003`.

Electron: Der Host startet den Relay im Main-Prozess; im LAN findet der Gast ihn über den Link (IP des Hosts) oder
eine Suche im Main-Prozess (mDNS oder UDP-Broadcast, im Browser nicht möglich). Ein Link mit fremdem Relay sollte im
Dialog dessen Host anzeigen, damit niemand unbemerkt auf einem fremden Server landet. Ein fremder Relay erfährt Name
und Browser; das Weltpaket von dort prüft `readWorldPackage` auf Format, Spielversion und Balance.

#### Schutz gegen Schummeln

Was Lockstep schon leistet: Jeder Client rechnet alles selbst und prüft jeden Befehl nach denselben Regeln
(Gold reicht, Tower gehört dir, Lane gehört dir). Ein verbotener Befehl tut überall nichts. Wer seinen eigenen
Zustand verändert (Gold, HP), weicht ab und fällt über die Prüfsumme auf (C5a); den anderen schadet er damit nicht.
Wer wer ist, stempelt das Relay aus der Verbindung, niemand kann für einen anderen Befehle schicken.

Offene Stellen, nach Gewicht:

- S1 **Debug-Befehle** gehen durch (R3): der einzige Weg, heute ohne Umbau am Client zu schummeln. **Gebaut 2026-09-24 (R3).**
- S2 **Host-Vertrauen**: Sichtlinien-Masken (C3) und das Weltpaket kommen nur vom Host. Ein manipulierter Host kann
  Tower durch Wände schießen lassen. Im Coop ist das der eigene Mitspieler; bei öffentlichen Räumen wäre der Ausweg,
  dass ein zweiter Client Stichproben der Masken nachrechnet.
- S3 **Wer hat recht bei einer Abweichung**: Mit drei oder mehr Spielern entscheidet die Mehrheit, der Abweichler
  bekommt den Hinweis (und später den Resync, C5b). Mit zweien bleibt es offen.
- S4 **Befehle auf Plausibilität prüfen**, die heute nur die UI begrenzt: Wertebereiche (`tower-aim`, Positionen im
  Gelände, Beträge), Rate je Spieler am Relay (R17). **Rate und Größe gebaut (R17); Gold senden prüft Betrag und
  Konto, die Wertebereiche der übrigen Befehle sind offen.** **Gebaut 2026-09-25: `coop/command-guard.ts` prüft alle Befehle.**
- S5 **Selbst gemeldete Version und Balance** beim Beitritt: ein veränderter Client lügt dort; die Prüfsumme fängt
  jede Regeländerung, die den Zustand betrifft, spätestens nach einer Spielsekunde.
- S6 **Rekorde**: Coop-Läufe gehen nicht in Einzelspieler-Rekorde (R16). Eine Online-Rangliste gibt es nicht; käme
  eine, wäre ein Lauf erst glaubhaft, wenn der Server das Befehlslog selbst nachrechnet (die Neu-Simulation dafür
  existiert).

Für ein Koop-Spiel unter Freunden reicht S1 plus S4; S2, S3 und S6 werden wichtig, sobald fremde Leute in
öffentliche Räume kommen.

### C6 Coop-Oberfläche

- Lane-Druck je Spieler (Lecks, HP-Anteil), Besitz an Towern (Farbe), Gold der Mitspieler, Bereit-Knopf vor dem
  Wellenstart, Meldung bei Abbruch und Divergenz.
- Beitritt ohne eigenen Tiles-Token (D19): der Token-Dialog öffnet sich vor dem Beitritt, mit Erklärung.
- Ping (Taste plus Klick, Marke und Ton in der Spielerfarbe) und ein kleines Chatfenster (D25).
- Debug-Befehle und Cheats sind im Coop aus. Bots als Mitspieler nur im Dev-Modus zum Testen (D24): ihre Befehle
  gehen wie die eines Spielers über den Relay.

### C8 Design-Handover (gebaut 2026-09-25)

Aus dem Handover abgeleitet (D37 bis D46). Alte Teile gehen mit dem Umbau (Spieler-Leiste, Chat-Zeilenkästen,
Meldungsliste, modaler Raum-Dialog), nichts läuft doppelt.

- **Relay und Protokoll 6:** Raum-Optionen `options {cheats, pause, wave}` in der Rauminfo und im `started`, Host setzt
  sie mit `{t:'options'}` nur in der Lobby; die Bereitschaft der Gäste fällt dabei. Start prüft nur die Gäste (D40).
  Pause nach `options.pause`; Cheats nach `options.cheats` und Absender, dazu der Schalter des Relays.
- **Simulation:** die Cheat-Regel steht bei allen Clients gleich fest (Modus und Host-Id vom Start), damit ein
  Host-Cheat nirgends verworfen wird. Next wave: „Host starts“ startet ohne Bereitschaft, „Auto 10 s“ zählt nach
  Wellenende und startet früher, wenn alle bereit sind; gestartet wird wie bisher vom Host-Client.
- **Chat-Modell:** Zeilen mit Zeit und Absender oder `system`; die Meldungen werden Systemzeilen (D43).
- **Dock** (ersetzt den Raum-Dialog): Einstieg (Name, Karten Host/Join, Server), Beitritt als Schrittliste mit
  Fortschritt der Karte, Lobby mit Raumcode (Code und Einladung kopieren, Sperre), Statuszeile, Spieler (Lane-Balken,
  Tags, Bereit-Pille, Ping-Balken, Kick), Lanes (frei nehmen, hinfliegen, entfernen), Mode & options (Chips zu,
  Segmente auf), Chat gruppiert, Fuß (Leave, ⋯ Resend map, Start match oder Ready up).
- **Squad-Box und Chat** unten links (ersetzen Spieler-Leiste und Chat): Kopf mit Code, CHEATS ON, Einklappen; Zeilen
  mit Lane-Balken, Tags, Zustand, Credits, Ping, Bereit-Häkchen bzw. Gold senden; Fuß sagt, auf wen die Welle
  wartet. Lag, Aufholen, Lecks, Abgang, Divergenz und Verbindungsverlust („Continue alone“) in diesem Rahmen.
- **Kopf:** Raum-Chip mit Code, einem Quadrat je Spieler und n/max; Klick oder Tab öffnet das Dock.
- **Sidebar:** der Wellen-Knopf zeigt „Ready for wave N · 1/2 ready“ bzw. den Auto-Countdown.
- **Bausteine einmal:** Ping-Balken als Component, Coop-Rezepte (Knöpfe, Segment, Tag, Pille, Abschnittskopf) als
  Sass-Mixins neben `_td-mixins.scss`, Farben nur aus `td-theme.ts`.

**Gebaut 2026-09-25:** Protokoll 6 mit `options` (`coop/room-options.ts`, geteilt von Relay und Client); der Relay setzt
Pause- und Cheat-Regel durch, die Simulation die Cheat-Regel über `GameStateManager.setCheatRule` gleich auf allen
Clients; „Host starts“ und „Auto 10 s“ (Countdown auf der Spieluhr, gestartet vom Host-Client) über
`waveButtonAction`/`startsWhenAllReady`. Chat mit Systemzeilen (`CoopChatLine`, `notify`), Lag über 160 ms
(`LAG_MS`). Dock `components/coop-dock/`, Squad `components/coop-squad/`, Chat `components/coop-chat/`, Bausteine
`components/coop-ui/`; `coop-dialog/` und `coop-players/` sind weg, mit ihnen der Sonderweg für angedockte Dialoge.
JetBrains Mono selbst gehostet. Nachtest PLAYTEST T54 ff.

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
