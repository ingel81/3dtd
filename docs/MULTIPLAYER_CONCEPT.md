# Multiplayer-Konzept: PvE-Coop & PvP

> **Status:** Konzept / Entscheidungsvorlage, noch kein Code.
> **2026-09-24:** PvP ist gestrichen, weiter geht es nur mit Coop "Vier Tore"; Plan in [COOP_PLAN.md](COOP_PLAN.md).
> **Stand:** 2026-08-26 · Branch `claude/multiplayer-pve-pvp-architecture-amu0x7`;
> Commands, Korridor und Stellen im Code nachgeführt 2026-09-15; Bezug zum Balancing-Plan 2026-09-19
>
> Bewertet den Ist-Zustand der Engine gegen die Anforderungen von
> Netzwerk-Multiplayer und schlägt eine Architektur plus Ausbaureihenfolge vor.

---

## TL;DR

**Empfehlung: Deterministisches Lockstep mit Command-Relay**, nicht State-Replication.
Der Grund ist Entity-Scale: bei 10k+ Gegnern ist Zustandsübertragung
bandbreitentechnisch tot (~3 MB/s), während das gesamte Spieler-Input-Volumen
aus **14 Command-Events** besteht und pro Match unter 100 KB bleibt.

**Drei harte Blocker** stehen dem heute im Weg: alle lösbar, aber keiner trivial:

1. **Tower-LOS kommt aus GPU-Readbacks gegen gestreamte 3D-Tiles.** Zwei Clients
   sind sich nicht einig, was ein Turm sieht. → Host-autoritative LOS-Masken.
2. **Terrain-Höhen kommen aus Raycasts gegen dieselben Tiles bei variabler LOD.**
   → World-Snapshot mit eingefrorenem Höhenfeld ("World Seal").
3. **Ungeseedete `Math.random()` in fünf Gameplay-Dateien.** → Seeded RNG.
   *(Der Wave-Director stand hier ursprünglich mit drin. Seit dem Wechsel auf
   `director-rules.ts` ist er reines TypeScript und nimmt seine Zufallsquelle
   bereits als Parameter, siehe 2.3.)*

**Günstigster erster Modus ist nicht Coop, sondern "Versus Race"** (beide
verteidigen die *gleiche* Stadt gegen die *gleiche* Welle in getrennten Sims,
verglichen wird nur Leak/Score). Der braucht **kein** Lockstep und umgeht damit
alle drei Blocker: nur World-Snapshot und Wave-Schedule-Sharing.

---

## Stand Determinismus (2026-09-24)

Auf dem Branch `simulator` ist das Determinismus-Fundament für einen Rechner gebaut ([SIMULATOR_PLAN.md](SIMULATOR_PLAN.md),
Abnahme per Spec: eine Welle rechnet bit-genau nach, auch aus einer Datei in einem frisch gestarteten Spiel):

- **Befehle:** wirken nur an Sub-Step-Grenzen, stehen mit Sub-Step und `playerId` im `CommandLog` (4.3, 18).
- **Sichtlinie (2.1):** das Ergebnis eines Towers ist eine `LosMask` (2 Bit je Zelle, rund 100 bis 750 B), steht mit
  im Log und wird beim Nachrechnen angewendet statt gerechnet. Das ist die Host-Maske, die im Coop über das Netz ginge.
  Der Kampf raycastet nicht mehr gegen Live-Tiles.
- **Turmdrehung** ist Simulationszustand, nicht mehr Renderer-Zustand.
- **Zellhöhen (2.2):** eingefroren; ein Welt-Schlüssel (`GameStateManager.worldKey`) prüft, dass zwei Seiten dieselbe
  Welt haben. Die Höhen selbst zu übertragen (World Seal über das Netz) fehlt noch.
- **RNG (2.3):** geseedete Ströme mit lesbarem und setzbarem Zustand.
- **Snapshot und Prüfsumme (4.5):** `SimSnapshot` zwischen den Wellen, `StateHasher` jede Spielsekunde, solange eine
  Welle mit Snapshot läuft oder nachgerechnet wird. Ein Rejoin
  mitten in einer Welle bräuchte einen Snapshot mit Gegnern und Projektilen; den gibt es nicht.
- **Match-Log (18):** die Replay-Datei (`simulator/replay-file.ts`).
- **Offen:** Netz, Relay, Tick-Barriere, Gold je Spieler, Tower-Besitz, Trigonometrie über Browser hinweg (2.4).

## Bezug zum Balancing-Plan (2026-09-19)

Eingeordnet mit dem User am 2026-09-19, rein zur Orientierung; entschieden ist für Multiplayer nichts. Der
[Balancing-Plan](BALANCING_PLAN.md) legt Teile des Determinismus-Fundaments (Abschnitt 6, Punkte 1 und 4) ohnehin:

- **Schon heute:** Die Höhen der Korridorzellen frieren nach dem Korridor-Bau ein; danach verändert kein Tile-Load
  sie mehr. Vom World Seal (2.2) fehlt damit nur noch das Serialisieren und Übernehmen der Host-Höhen.
- **Aus dem Plan zuerst:** 1c (geseedete Zufallsströme, fortlaufender Sub-Step-Zähler als späterer Tick) und 1a
  (eine Wellenquelle, der Director im Spiel). Der adaptive Director (D8 im Plan) ist im Coop kein Problem: Er liest
  die eine gemeinsame Verteidigung und rechnet auf jedem Client gleich. Im Versus bekämen zwei Spieler dagegen
  verschiedene Wellen; dort braucht es feste Wellen oder einen Host, der sie verteilt.
- **Befehle vollständig:** Bots setzen und verkaufen Tower heute direkt am `GameStateManager` vorbei. Im Plan laufen
  alle Aktionen über `command:*`; das ist die Voraussetzung für die Command-Pipeline (4.3).
- **Gold-Ledger nur einmal umbauen:** Der Plan gibt jeder Buchung in `CreditsLedger` eine Quelle, Coop braucht Gold
  je Spieler (Modus B). Beides in einem Umbau planen.
- **Config-Hash** im Kopf des Run-Logs taugt für den Balance-Hash-Check der Lobby (Punkt 14).
- **Sichtlinie hängt am Frame, auch in DevWorld:** Wann ein Tower nach dem Bau schießen darf, entscheidet der
  GPU-Readback. Mit der Turmdrehung im Renderer (11.1, Punkt 2) ist das der Kern von Stufe 2.
- **Abnahme im Einzelspieler:** Spielt ein aufgezeichneter Lauf lokal als Neu-Simulation (E2, [REPLAY.md](REPLAY.md))
  bit-genau nach, ist die Simulation auf einem Rechner lockstep-fähig. Das liefert zugleich Replay und
  reproduzierbare Bugs, bevor ein Netz-Layer existiert.
- **Reihenfolge, falls Coop zuerst käme:** Plan 1a und 1c mit vollständigen Befehlen, dann Determinismus im
  Einzelspieler mit E2 als Abnahme, dann Sichtlinie vom Host, Welt teilen und Resync, zuletzt Netz, Lobby, Gold je
  Spieler und Tower-Besitz.
- **Vorher offen, nicht technisch:** Backend ja oder nein (9.1) und Kosten und Nutzungsbedingungen der 3D-Tiles bei
  mehreren Clients (9.2).

---

## 1. Was die Engine heute schon mitbringt

Das ist überraschend viel. Der Umbau ist deutlich kleiner als bei einer
typischen Singleplayer-Codebase.

| Asset | Fundstelle | Warum es zählt |
|-------|-----------|-----------------|
| **Fixed-Timestep-Sub-Step-Loop** | `managers/game-state/game-clock.ts`: `GameClock.FIXED_STEP_MS = 16.667` | Die wichtigste Voraussetzung für Lockstep ist schon da. Gameplay läuft bereits in festen Game-Time-Schritten, unabhängig von der Framerate. |
| **Command-Bus mit 15 Player-Commands** | `game-event-bus.ts` + `game-commands.handler.ts` | Tower: `place-tower`, `sell-tower`, `upgrade-tower`, `set-targeting`, `set-hold-fire`; Welle und Spiel: `start-wave`, `restart-game`; Forschung: `start-research`, `cancel-research`, `queue-research`, `unqueue-research`; Fähigkeiten: `use-ability`; Held: `hire-hero`, `hero-move`, `hero-ammo` (beim Schreiben des Konzepts waren es sieben). Das ist die *komplette* Input-Oberfläche: genau das, was über die Leitung muss. |
| **Command-Handler ist bereits vom Game-Loop-Owner getrennt** | `game-commands.handler.ts` | Der Netzwerk-Layer hängt sich zwischen Bus und Handler, ohne Manager anzufassen. |
| **WebSocket-Client-Präzedenz** | `bots/bot-session.ts` | Reconnect, Message-Typing, Lifecycle: als Vorlage für den Netzwerk-Client wiederverwendbar. |
| **Deterministische Bewegung** | `movement.component.ts` | Gegner folgen vorberechneten Geo-Pfaden mit Prefix-Summen. Gleicher Pfad + gleicher Step = gleiche Position. |
| **Timescale-Konzept** | `trainingTimescale` | Muss im MP auf 1.0 gepinnt (oder mitsynchronisiert) werden: der Hebel dafür existiert. |

---

## 2. Die drei Determinismus-Blocker

### 2.1 Tower-LOS ist GPU-abhängig (der schwerste)

`global-route-grid.ts` füllt `cell.towerVisibility` / `cell.airVisibility` über
einen `readRenderTargetPixels`-Pass gegen die Tower-Shadow-Cubemap
(`TowerShadowMapper`, gelesen über `sampleCubeAtPoint` in `utils/gpu-cube-resolve.ts`, siehe [LOS_PIPELINE.md](LOS_PIPELINE.md)). Der Combat-Hot-Path liest daraus
O(1), also entscheidet ein **GPU-Roundtrip gegen gerade geladene Tile-Geometrie**
darüber, ob ein Turm schießen darf.

Das ist pro Client verschieden: andere GPU, andere Tile-LOD zum Zeitpunkt des
Placements, andere Streaming-Reihenfolge. Zwei Clients simulieren garantiert
auseinander.

**Lösung: Host-autoritative LOS-Masken.**
Beim `place-tower`-Command rechnet **nur der Host** die Cubemap + Readback und
schickt die resultierende Maske mit dem bestätigten Command mit. Alle Clients
übernehmen sie, statt lokal zu samplen. Die lokale Preview beim Bauen bleibt
erlaubt: sie ist unverbindlich.

Bandbreite: Ein Turm mit 100 m Range deckt im 2-m-Grid (`CELL_SIZE = 2`,
Korridor je Seite bis 7 m, `maxHalfWidth`) größenordnungsmäßig ein paar tausend Zellen ab, 2 Bit
pro Zelle (Ground + Air) → **unter 1 KB roh, komprimiert ein paar hundert Byte**,
und das nur bei einem Bau-Event. Vollkommen unkritisch.

### 2.2 Terrain-Höhen sind zeit- und LOD-abhängig

`sampleCellY` schreibt `cell.terrainHeight` aus Terrain-Raycasts und verbessert
sie nach, wenn bessere Tile-LOD nachlädt (`CellSample.tileDepth` /
`tileGeometricError`). Höhen sind gameplay-relevant: Air-Targets sitzen bei
`terrainHeight + airSampleYOffset`, LOS hängt daran, Routen ebenso.

**Lösung: World Seal.**
Der Host wartet vor Match-Start, bis das Sampling stabil ist, serialisiert
`terrainHeight` pro Zelle in den World-Snapshot und friert danach die
Gameplay-Höhen ein. Nachladende Tiles dürfen weiter die *Optik* verbessern,
aber nicht mehr die Simulation.

Größe: 3 km Route × bis 14 m Korridor (je Seite bis 7 m, gemessen, siehe
[ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md)) / 4 m² ≈ bis 10k Korridorzellen, plus
Tower-Radius-Zellen: realistisch 20–50k Zellen. Als Int16-Delta in cm:
**40–100 KB roh, gzip ~15–30 KB.** Einmaliger Download beim Join.

Netter Nebeneffekt: Das entschärft die in `TODO.md` gelisteten
Stale-LOS-Bugs, weil Höhen nach dem Seal nicht mehr still wandern.

### 2.3 RNG und Wave-Director

> **Stand 2026-09-07: Dieser Blocker ist weitgehend entfallen.** Der
> Wave-Director ist seit dem Wechsel auf `director/sources/adaptive/director-rules.ts` kein
> neuronales Netz mehr, sondern eine Regelfunktion: reines TypeScript, keine
> WASM-Backends, keine Float-Divergenz zwischen Clients. Der ursprüngliche Text
> steht darunter, weil die Begründung für den Command-Broadcast weiterhin
> stichhaltig ist, nur nicht mehr zwingend.

Gameplay-relevante `Math.random()`-Aufrufe (der Rest ist VFX und darf bleiben):

| Datei | Stelle | Wofür |
|-------|--------|--------|
| `managers/enemy.manager.ts` | `spawnOne` | Seitenversatz (`lateralSpread`), Höhenvarianz der Luftgegner |
| `managers/wave.manager.ts` | `selectSpawnPoint` | Spawn-Point-Auswahl |
| `entities/enemy.entity.ts` | `scheduleNextRandomSound`, `playRandomSound`, `refillRandomSoundsQueue`, `scheduleNextPoolSound` | Audio-Timing, Shuffle |
| `director/spawn-schedule-builder.ts` | `getDelay` (`delayVariation`), `buildRandom` | Delay-Jitter, Shuffle |
| `director/sources/adaptive/director-rules.ts` | `decideWave().decide` | Template-Wahl und Faktor-Jitter |
| `director/leak-controller.ts` | – | keiner: rein arithmetisch, kein RNG |

**Lösung:** Ein `DeterministicRng` (mulberry32/xorshift128, seed pro Match aus
dem Room) wird injiziert; VFX/Audio behalten `Math.random()`.

Für den Director ist das bereits vorbereitet: `decideWave().decide()` nimmt die
Zufallsquelle als vierten Parameter (`random: () => number = Math.random`), weil
die Tests sie ohnehin ersetzen müssen. Für den Mehrspielerbetrieb genügt es,
dort dieselbe geseedete Quelle zu übergeben wie überall sonst. Der
`LeakController` braucht gar nichts: er rechnet nur mit der Leak-Quote
vergangener Wellen, ist also deterministisch, sobald diese Wellen es sind.

**Der ONNX-Pfad** ist am 2026-09-20 entfallen
([BALANCING_PLAN.md](BALANCING_PLAN.md), Phase 1a); es gibt nur noch den
Regel-Director. Käme je wieder ein Modell dazu, wäre es nicht synchronisierbar
(WASM- und WebGPU-Backend liefern unterschiedliche Floats), und es gälte die
alte Lösung: der Host läuft die Inferenz und broadcastet den fertigen
Spawn-Schedule als Command.

### 2.4 Restrisiko: Float-Determinismus über Browser hinweg

`+ - * /` und `sqrt` sind IEEE-754-exakt, aber `Math.sin/cos/atan2/pow` sind
implementierungsabhängig. `haversineDistance` und Heading-Berechnung in
`geo-utils` / `movement.component.ts` nutzen Trigonometrie im Hot-Path.

Zwei Wege:
- **Sauber:** Gameplay-Distanzen auf die lokale Ebenen-Projektion umstellen
  (`METERS_PER_DEGREE_LAT` ist teilweise schon da) und Trig aus dem Sim-Pfad
  verbannen.
- **Pragmatisch (Empfehlung für v1):** "Soft Lockstep": Divergenz per
  Checksum erkennen und mit einem Host-Snapshot korrigieren, statt sie
  auszuschließen. Bei einem TD fällt eine 5-cm-Abweichung niemandem auf,
  solange sie nicht kumuliert.

---

## 3. Warum Lockstep und nicht State-Replication

| | Lockstep (Command-Relay) | State-Replication (Host schickt Entities) |
|---|---|---|
| Bandbreite bei 10k Gegnern | ~0 (nur bei Spieleraktion) | 10k × 16 B × 20 Hz ≈ **3,2 MB/s** |
| Latenz-Toleranz | Hoch (TD ist kein Twitch-Game, 150 ms Input-Delay unsichtbar) | Braucht Interpolation/Prediction |
| Determinismus nötig | **Ja**: die drei Blocker oben | Nein |
| Cheat-Resistenz v1 | Schwach (Divergenz-Detection fängt naive Cheats) | Ebenfalls schwach ohne echten Server |
| Rejoin | Braucht Full-State-Snapshot | Kommt gratis |

Bei diesem Entity-Scale gibt es faktisch keine Wahl. State-Replication scheidet
aus, sobald eine Welle vierstellig wird.

---

## 4. Netzwerk-Architektur

### 4.1 Tick-Modell

```
Sub-Step (16,667 ms, existiert)  ──┐
                                   ├─ 4 Sub-Steps = 1 Net-Tick (≈ 66,7 ms, 15 Hz)
Net-Tick                         ──┘

Command von Spieler A zum Zeitpunkt T
  → Relay stempelt (netTick = T_now + 3, playerId, seq)
  → Broadcast an alle
  → Ausführung bei allen exakt an netTick T+3   (≈ 200 ms Input-Delay)
```

200 ms Verzögerung beim Turmbau ist in einem TD nicht wahrnehmbar: die
Bauanimation kaschiert es vollständig. Der Delay kann dynamisch an den
schlechtesten RTT im Raum angepasst werden.

### 4.2 Tick-Barriere

Die Sub-Step-Schleife in `GameStateManager.update()` läuft heute frei bis
`MAX_SUBSTEPS_PER_FRAME`. Jeden Schritt gibt `GameClock.nextSubStep()` frei
(`managers/game-state/game-clock.ts`), dort braucht sie ein Gate:

```ts
nextSubStep(): boolean {
  if (this.net?.mustStallAt(this.currentNetTick)) return false;  // NEU
  if (this.pendingMs >= FIXED_STEP_MS && this._stepsThisFrame < MAX) { ... return true; }
  return false;
}
```

`mustStallAt` ist `true`, solange nicht alle Peers ihre Inputs (auch leere) für
den nächsten Net-Tick bestätigt haben. Ein hängender Client bremst damit den
Raum: deshalb: Host darf nach Schwellwert (z. B. 3 s) droppen, Rejoin über
Full-Snapshot.

### 4.3 Command-Pipeline

```
UI / Bot
   │  eventBus.emit('command:place-tower', …)
   ▼
NetworkCommandInterceptor        ← NEU, hängt vor GameCommandsHandler
   │  im MP: NICHT lokal ausführen, sondern an Relay senden
   ▼
Relay-Server (Room)
   │  stempelt netTick + seq, ordnet deterministisch (playerId, seq)
   ▼
alle Clients: NetworkCommandQueue
   │  führt an netTick T aus, in stabiler Reihenfolge
   ▼
GameCommandsHandler  (unverändert)
```

Wichtig: Auch der lokale Spieler geht durch den Relay ("delayed input"). Nur so
sind alle Clients in derselben Ausführungsreihenfolge: Client-Side-Prediction
für Bauplatzierung lohnt den Aufwand hier nicht.

### 4.4 World-Snapshot ("Room-Welt")

Beim Room-Erstellen produziert der Host ein Paket, das alle Joiner laden,
statt selbst Overpass/Nominatim zu fragen (Overpass liefert nicht garantiert
identische Daten, und die Rate-Limits werden mit mehreren Clients unangenehm):

```
WorldSnapshot {
  version, seed, createdAt
  hq: LocationConfig, spawnPoints: LocationConfig[]
  streetNetwork: SerializedStreetNetwork      // Format noch zu definieren
  routes: GeoPosition[][]                      // vorberechnete Pfade
  routeGrid: { cellKeys: Int32Array, heights: Int16Array }   // World Seal
  balanceHash: string                          // Config-Fingerprint
}
```

`balanceHash` ist wichtig: Ein Client mit anderer Version der Tower-/Enemy-Configs
divergiert sofort. Beim Join gegen den Room-Hash prüfen, sonst ablehnen.

Google-3D-Tiles lädt jeder Client selbst: rein visuell, kein Gameplay-Input
(nach dem World Seal). API-Key-Nutzung pro Client ist hier der zu klärende
Kosten-/ToS-Punkt, kein technischer.

### 4.5 Divergenz-Erkennung und Resync

Alle N Net-Ticks (z. B. 30 ≈ alle 2 s) sendet jeder Client eine Checksumme:

```
hash( gameTick, credits[], baseHealth, towerCount,
      Σ enemy.id ⊕ quantize(lat,lon,hp), waveNumber, rngState )
```

Bei Abweichung: Host schickt Full-State-Snapshot, abweichender Client lädt neu.
Das ist gleichzeitig **das Debug-Werkzeug**, das die ganze Umstellung überhaupt
handhabbar macht: ohne Checksums sucht man Divergenzen blind.

---

## 5. Spielmodi

### Modus A: "Versus Race" (PvP, gespiegelt) · **billigster Einstieg**

Beide Spieler verteidigen dieselbe Stadt gegen denselben Wellen-Schedule, aber
in **getrennten lokalen Simulationen**. Verglichen wird nur: wer hält länger,
wer leakt weniger, wer hat mehr Score.

- **Kein Lockstep, keine Tick-Barriere, keine Checksums.** Divergenz ist egal:
  niemand sieht die Sim des anderen.
- Braucht nur: World-Snapshot-Sharing + gemeinsamer Wave-Schedule + Score-Kanal.
- Umgeht **alle drei Determinismus-Blocker.**
- Ausbaustufe: **"Send a Rush"**: Gold ausgeben, um eine Extra-Gruppe in die
  Welle des Gegners zu injizieren (Klassiker aus TD-Wars). Kommt als
  zusätzlicher Command-Typ durch denselben Kanal.
- Optional: kleines "Ghost"-Overlay mit HQ-HP und Wave des Gegners.

Das ist der Modus, den man zuerst baut. Er ist spielbar, bevor irgendein
Determinismus-Umbau angefasst wurde.

### Modus B: Coop-PvE (2–4 Spieler, geteilte Karte)

Alle bauen auf derselben Stadt, gemeinsames HQ.

Design-Entscheidungen (Vorschlag):

| Frage | Empfehlung | Begründung |
|-------|-----------|-------------|
| Gold | **pro Spieler getrennt** | Verhindert Griefing und Leerkaufen; erzwingt Rollenbildung |
| HQ-Leben | **geteilt** | Das ist der Coop-Kern |
| Turm-Besitz | `Tower.ownerId`; **Verkaufen nur Besitzer**, Upgraden für alle (mit eigenem Gold) | Kein Griefing, trotzdem Kooperation möglich |
| Research | **geteilt**, Kosten vom Auslöser | Der Tech-Tree ist global; Doppelforschung wäre Unsinn |
| Wave-Start | jeder darf, aber **Bestätigung** oder Countdown | Sonst startet einer vorzeitig |
| Kill-Credit | Schaden-anteilig | Sonst gewinnt der Splash-Turm alles |

Braucht das volle Lockstep-Programm aus Abschnitt 4.

Großer Refactor-Punkt: `credits` ist heute ein einzelnes Signal in
`CreditsLedger` (`managers/game-state/credits-ledger.ts`), der einzigen Stelle, die
Credits bucht. Muss zu `players: Map<PlayerId, PlayerEconomy>`
werden, wobei Singleplayer schlicht ein Spieler mit `localPlayerId` ist.

### Modus C: Asymmetrisch: Angreifer vs. Verteidiger · **das eigentlich spannende**

Ein Spieler baut Türme. Der andere **ist der Wave-Director**: kauft von einem
Angriffsbudget Gegnergruppen, wählt Zusammensetzung, Spawn-Punkt und Timing.

Der Clou: **Die Action-Space dafür existiert bereits.** Der Wave-Director
arbeitet in `director/` (`director-rules.ts`, Templates, `spawn-schedule-builder.ts`) genau mit diesen Größen (Range-Based Templates,
Spawn-Schedules, Constraints, siehe `docs/archive/PHASE_5.11_RANGES.md`). Ein
Angreifer-UI ist im Kern ein Human-Frontend für die gleiche Action-Space, mit
den gleichen Constraints als Balance-Leitplanke.

Nebeneffekt: Der Director wird zum **Bot-Gegner** für diesen Modus und zum
Balance-Maßstab ("schlägst du die AI auf Level 5?"). Seit 2026-09-07 ist das der
Regel-Director; das trainierte Modell ist nur noch ein Opt-in im Debug-Fenster
([WAVE_DIRECTOR.md](WAVE_DIRECTOR.md)).

Netzwerktechnisch ist das der einfachste PvP-Modus überhaupt: der Angreifer
schickt Wave-Schedules, ansonsten läuft eine einzige Sim beim Verteidiger.
Der Angreifer ist ein Zuschauer mit Kaufmenü. Kein Lockstep nötig, wenn der
Verteidiger-Client autoritativ ist.

---

## 6. Konkrete Code-Änderungen

Grob nach Aufwand sortiert, mit Dateibezug:

**Determinismus-Fundament (nutzt auch Singleplayer: Replays per Re-Simulation, Bug-Repro, AI-Training)**

Das heute gebaute Replay der letzten Welle ist eine Präsentations-Aufnahme, keine
Re-Simulation, und braucht nichts davon ([REPLAY.md](REPLAY.md)).

1. `DeterministicRng` + Injection in die Gameplay-Dateien aus 2.3
2. World Seal: `terrainHeight`-Freeze + Serialisierung: `utils/global-route-grid.ts`
3. Voller Game-State-Serializer (für Rejoin/Resync), fällt mit Save/Load zusammen
4. Checksum-Funktion + Divergenz-Log

**Netzwerk-Layer (neu, `src/app/net/`)**
5. `NetworkClient` (WS, Reconnect), Vorlage: `bots/bot-session.ts`
6. `NetworkCommandInterceptor` + `NetworkCommandQueue` (Tick-Stempel, stabile Ordnung)
7. Tick-Barriere in `GameClock.nextSubStep()` (`managers/game-state/game-clock.ts`)
8. `WorldSnapshot`-Serializer/Loader
9. Host-LOS-Masken-Pfad in `services/tower-placement.service.ts` + `global-route-grid.ts`

**Gameplay-Umbau**
10. Per-Spieler-Ökonomie: `credits`-Signal → `Map<PlayerId, PlayerEconomy>`
11. `Tower.ownerId` + Besitzregeln in `TowerLifecycle` (`sell`, `upgrade`)
12. Wave-Schedule als Command statt lokaler Berechnung *(entschärft: der Regel-Director ist deterministisch, sobald er die geseedete Quelle bekommt)*
13. `trainingTimescale` im MP pinnen

**UI**
14. Lobby (Room-Code, Spielerliste, Ready-State, Balance-Hash-Check)
15. Besitzer-Färbung, Spieler-HUD, Ping/Marker, minimaler Chat
16. Verbindungs-Status, Desync-Feedback, Rejoin-Screen

**Backend (neu, `multiplayer-server/`)**
17. Relay: Rooms, Tick-Broadcast, Snapshot-Ablage. **In v1 ohne Spiellogik.**

---

## 7. Infrastruktur

| Baustein | Empfehlung | Alternative |
|----------|-----------|-------------|
| Transport | **WebSocket-Relay** | WebRTC DataChannel: spart Server-Traffic, braucht aber trotzdem Signaling **und** TURN: mehr Teile, nicht weniger |
| Server | Node/Bun + `ws`, ~500 LOC für v1 | Cloudflare Durable Objects / PartyKit: Room-Modell out of the box, praktisch kostenlos bei kleiner Nutzerzahl |
| Snapshot-Ablage | Über den Room-Server (ein paar zehn KB) | Object-Storage bei größeren Welten |
| Identität | **Room-Code, keine Accounts** in v1 | Persistente Profile/Ranglisten brauchen echtes Backend + DSGVO-Betrachtung |
| Anti-Cheat | v1: Vertrauen + Divergenz-Detection | Echter Schutz erst mit server-autoritativer Sim: bewusst out of scope |

Das kollidiert mit "kein Backend im Spiel-Client" aus `CLAUDE.md`: das ist die
grundlegende Architekturentscheidung, die hier bewusst getroffen werden muss.
Der Relay bleibt aber logikfrei: Das Spiel läuft weiterhin komplett im Client.

---

## 8. Vorgeschlagene Reihenfolge

| Phase | Inhalt | Liefert | Grober Aufwand |
|-------|--------|---------|----------------|
| **0** | Relay-Server, Lobby, World-Snapshot-Sharing | Zwei Clients in derselben Welt | S–M |
| **1** | **Versus Race** + Send-a-Rush | Erster spielbarer PvP-Modus, ohne Determinismus-Umbau | S |
| **2** | Determinismus-Fundament (RNG, World Seal, Serializer, Checksums) | Auch SP-Gewinn: Replays, reproduzierbare Bugs, sauberes AI-Training | **L, das Herzstück** |
| **3** | Lockstep + Per-Spieler-Ökonomie + Besitz → **Coop-PvE** | Der Modus, den die meisten erwarten | L |
| **4** | **Angreifer vs. Verteidiger** über die Wave-Director-Action-Space | Der eigenständigste Modus, hohe Wiederverwendung | M |

Phase 2 ist der eigentliche Brocken, und der einzige Teil, der sich auch dann
lohnt, wenn Multiplayer nie kommt.

---

## 9. Offene Entscheidungen

1. **Backend ja/nein**: kippt eine Kernprämisse des Projekts (siehe 7).
2. **Google-3D-Tiles-Kosten und ToS** bei mehreren gleichzeitigen Clients pro
   Match. Rein wirtschaftlich/rechtlich, nicht technisch.
3. **Wie streng?** Hartes Lockstep (Trig aus dem Sim-Pfad verbannen) vs. Soft
   Lockstep mit Resync. Empfehlung: soft starten, bei Bedarf härten.
4. **Spielerzahl-Obergrenze im Coop**: die Tick-Barriere macht jeden zusätzlichen
   Spieler zu einem potenziellen Bremsklotz. 4 ist ein vernünftiges Limit.
5. **Wave-Director im MP:** *entschieden durch den Wechsel auf den Regel-Director*:
   er läuft auf jedem Client identisch, sobald er die geseedete Zufallsquelle
   bekommt.
6. **Performance-Budget:** Der Client rendert heute schon am Limit. Ein zweiter
   Spieler bringt kaum Sim-Kosten (Lockstep), aber Tick-Stalls machen
   Frame-Drops beim Peer sichtbar.

---

## 10. Empfehlung in einem Satz

Mit **Phase 0 + 1 (Versus Race)** anfangen: das ist in überschaubarer Zeit
spielbar, beweist die Infrastruktur und braucht keinen der drei
Determinismus-Blocker gelöst. **Phase 2** danach als eigenständiges
Engine-Projekt fahren, weil es unabhängig vom Multiplayer wertvoll ist. Coop
erst, wenn Checksums grün bleiben.

---

# Teil II: Das volle Programm: echter Server

> **Entscheidung gefallen (2026-08-26): Die Simulation bleibt vollständig im
> Client.** Der Server vermittelt, verwaltet und überwacht: er rechnet nicht.
> Damit sind die Stufen S3/S4 aus Abschnitt 13 **verworfen**, und die
> Occlusion-Grundsatzfrage aus 11.2 ist **nicht mehr blockierend** (siehe
> Teil III, Abschnitt 21). Teil II bleibt als Bewertung der verworfenen
> Alternative stehen: die Aufwandsgegenüberstellung ist weiterhin die
> Begründung für die Entscheidung.


> Nachtrag zur Frage "was bräuchte man für einen richtigen Server?".
> Abschnitt 7 hatte server-autoritative Simulation bewusst ausgeklammert:
> hier steht, was sie tatsächlich kostet.

"Server" meint zwei unabhängige Dinge, die oft vermischt werden:

- **A, autoritative Simulation:** Der Server rechnet das Spiel und ist die
  Wahrheit. Löst Cheating.
- **B, Online-Dienst:** Accounts, Matchmaking, Ladder, Replays, Live-Ops,
  Betrieb. Löst "es fühlt sich nach Produkt an".

Man braucht beides für das volle Programm, aber sie sind getrennt baubar und
unterschiedlich teuer. B ist mehr Arbeit als A, und vor allem **dauerhafte**
Arbeit.

---

## 11. Teil A: Headless-Simulation

### 11.1 Die gute Nachricht

Die Sim ist deutlich näher an lauffähig-in-Node als erwartet:

| Schicht | Kopplung | Bewertung |
|---------|----------|-----------|
| `entities/`, `game-components/` | **keine** Three.js-Importe | läuft sofort in Node |
| `managers/enemy|tower|projectile` | nur `Vector3` aus three | reine Mathe, kein WebGL nötig |
| `managers/*` | nur `signal` aus `@angular/core` | funktioniert in Node; sauberer wäre ein 30-Zeilen-Signal-Shim |
| `game-state.manager.ts` | `Injectable`/`inject`/`effect` | einziger echter DI-Knoten: auf Konstruktor-Injektion umbauen |
| `utils/global-route-grid.ts` | `CoordinateSync`, `ColumnSampler`, `gpu-cube-resolve` | **die Bruchstelle** |

Es blockieren also drei konkrete Dinge, nicht "das ganze Rendering":

1. **Angular-DI im `GameStateManager`** → Plain-TS-Konstruktor mit expliziter
   Verdrahtung. Der Client injiziert weiterhin per DI, der Server konstruiert
   direkt.
2. **`tilesEngine`-Aufrufe**: schon `| null`. Die Turmdrehung, die das Feuern
   freigibt, ist seit 2026-09-24 Simulationszustand (`Tower.aim`, je Sub-Step in
   `GameStateManager.runSubStep`); der Renderer liest sie nur noch ab.
3. **Occlusion**, siehe 11.2. Das ist die eigentliche Entscheidung.

Struktureller Umbau: ein plattformneutrales `src/app/sim/` (oder eigenes
Workspace-Paket), das Client **und** Server konsumieren. Kein Angular, kein
Three außer Vektor-Mathe, keine Browser-APIs.

### 11.2 Der Kern: Occlusion ohne GPU

Der Server hat keine 3D-Tiles und keine GPU. Damit fällt die heutige
LOS-Pipeline weg. Drei Wege:

**Weg 1: OSM-Gebäudemodell als Gameplay-Wahrheit** ← Empfehlung

`BuildingFootprint { id, type, levels, nodes }` wird **bereits geholt**
(`services/location/osm-street.service.ts`) und gerendert
(`services/world/building-rendering.service.ts`, `levels × METERS_PER_LEVEL`).
Daraus lässt sich ein CPU-Occlusion-Modell bauen: extrudierte Polygonprismen,
LOS als Segment-vs-Prisma-Test, Bodenhöhe aus grobem DEM oder aus dem
Straßennetz interpoliert.

- Deterministisch, serverfähig, versionierbar, klein (ein paar hundert KB pro
  Stadt), CPU-günstig mit einem 2D-Index über die Grundrisse.
- Löst gleichzeitig **alle drei Determinismus-Blocker aus Teil I**: der
  World Seal wird zum bloßen Ausliefern des Gebäudemodells.
- **Preis:** Gameplay-Sichtlinie weicht sichtbar von der Optik ab. Bäume,
  Brückenkonstruktionen, unregelmäßige Dächer, alles was OSM nicht kennt,
  blockt dann nicht mehr, und `building:levels` fehlt in vielen Gegenden
  (Default 2 im Code) und ist ohnehin nur eine Näherung.

Das ist ein **Game-Design-Preis, kein technischer**: Man tauscht "Sichtlinie
stimmt exakt mit dem Bild" gegen "Sichtlinie ist erklärbar, fair und überall
gleich". Für kompetitives PvP ist das ohnehin die richtige Richtung: heute
kann derselbe Turm bei zwei Spielern unterschiedlich schießen, je nachdem
welche Tile-LOD beim Bauen geladen war.

**Weg 2: Server rendert mit** (Headless-GL, SwiftShader oder GPU-Instanz)

Technisch machbar, aber: Tiles-Traffic pro Match auf Serverseite,
Google-ToS-Frage, GPU-Instanzen kosten ein Vielfaches, und die
LOD-Nichtdeterminismus-Frage kommt durch die Hintertür zurück. **Nicht
empfohlen.**

**Weg 3: Precompute-Service (Bake-Pipeline)**

Ein Batch-Job baked pro Stadt einmal ein Höhen- und Occlusion-Feld aus den
3D-Tiles und legt es in Object Storage. Server und Clients laden dasselbe
Artefakt. Exakt passend zur Optik, deterministisch, ohne GPU zur Laufzeit.
Kosten: Bake-Pipeline, Storage, Invalidierung bei Tile-Updates, und ein Match
in einer ungebakten Stadt muss warten oder auf Weg 1 zurückfallen.

**Realistischer Pfad: Weg 1 jetzt, Weg 3 später für Ranked-Karten.**

### 11.3 Was der Server repliziert, nicht Entities

Volle Entity-Replikation bleibt bei 10k Gegnern tot (Rechnung in Abschnitt 3).
Der autoritative Server ist deshalb kein State-Broadcaster, sondern ein
**autoritativer Lockstep-Peer**:

- Er ordnet Commands, vergibt Tick-Nummern, hält den RNG-Seed, rechnet
  Wave-Schedules, verteilt LOS-Masken.
- Er läuft dieselbe Sim als **Schattenrechnung** und vergleicht Checksums.
- Clients simulieren und rendern weiterhin selbst.
- Nur bei Divergenz: Full-Snapshot-Korrektur, im Wiederholungsfall Kick.

Cheat-Erkennung heißt dann "Client weicht von der Serverwahrheit ab", und das
fängt genau die Klasse, die zählt: Gold, Baukosten, Platzierungsregeln,
Reichweiten, Wellenmanipulation. Was es **nicht** fängt, sind reine
Informations-Cheats (Wallhack-Äquivalente), weil jeder Client ohnehin den
vollen Zustand kennt. Bei einem TD ist das akzeptabel.

### 11.4 Serverkosten der Sim: eine Mess-, keine Schätzaufgabe

Die Sim ist single-threaded und läuft mit 60 Hz Game-Time. Ein Node-
Worker-Thread pro Match, Matches pro vCPU muss **gemessen** werden. Die
Werkzeuge dafür existieren bereits im Repo:

- `PerformanceProfilerService` misst die Sub-Step-Anteile getrennt
  (`GameStateManager.stepTimings`: `tProjectile`, `tCombat`, `tEvents`).
- Der Bot-Modus mit `trainingTimescale` spielt ganze Matches im Zeitraffer:
  ein 20-Minuten-Match bei 75× dauert 16 Sekunden.
- `renderingEnabled = false` (Phase 5.14) trennt Sim-Zeit von Render-Zeit
  bereits sauber.

Wichtig für die Erwartungshaltung: Der Client ist heute **GPU-limitiert, nicht
sim-limitiert**. Ohne Rendering ist ein Match erheblich billiger, als das
Spielgefühl vermuten lässt.

---

## 12. Teil B: Der Dienst drumherum

| Baustein | Was konkret | Aufwand |
|----------|-------------|---------|
| **Identität** | OAuth über Google/Discord statt eigener Passwörter: spart Sicherheits- und DSGVO-Aufwand erheblich | S |
| **Persistenz** | Postgres (Profile, Matches, Ladder, Freunde), Object Storage (Snapshots, Replays) | M |
| **Matchmaking** | Queue, ELO/Glicko, Regionswahl, Party-Handling | M |
| **Replays** | Command-Log + Seed + Snapshot-Referenz = vollständiges Replay. **Fällt bei Lockstep gratis ab** und ist gleichzeitig Anti-Cheat-Beweismittel und Balance-Werkzeug | S |
| **Live-Ops** | Balance-Configs serverseitig ausliefern, `balanceHash` erzwingen, Versions-Gate, Wartungsfenster | M |
| **Observability** | Ticks/s, Desync-Rate, RTT-Verteilung, strukturierte Logs, Alerting, automatischer Replay-Upload bei Divergenz | M |
| **Skalierung** | Room-Allocator, Autoscaling, Region-Auswahl (EU zuerst), Session-Affinität | M |
| **Ausfallsicherheit** | Reconnect-Fenster, Match-Wiederaufnahme, Graceful Drain beim Deploy | M |
| **Sicherheit** | Token-Rotation, Rate-Limits, serverseitige Input-Validierung, DDoS-Schutz vor dem Room-Server | M |
| **Recht & Betrieb** | DSGVO (AVV, Löschkonzept, Datenschutzerklärung), ToS, Namens-/Chat-Moderation | M, läuft nie aus |
| **Google-3D-Tiles** | Kosten pro Client-Session und ToS in einem kommerziellen Multiplayer-Dienst | **größte unbekannte Außenabhängigkeit** |
| **CI/CD & Lasttest** | Server-Pipeline, Staging, synthetische Last: **der `StrategyBot` ist bereits ein fertiger Lastgenerator** | S–M |

### Der ehrliche Teil

Teil B ist kein Feature, sondern Dauerbetrieb. Nach dem Launch frisst er
kontinuierlich Zeit (Deploys, Missbrauch, Support, Kostenkontrolle), während
am Spiel selbst nichts vorangeht. Das ist die eigentliche Entscheidung, nicht
die Technikwahl.

---

## 13. Staffelung: vier Server-Stufen

| Stufe | Was der Server tut | Cheat-Schutz | Aufwand |
|-------|--------------------|--------------|---------|
| **S1: Relay** (Teil I) | Nur Weiterleiten, Rooms, Tick-Stempel | keiner | S |
| **S2: Validierend** | Keine Sim, aber Regelprüfung: Gold, Baukosten, Cooldowns, Platzierungsregeln. Plus Seed, Wave-Schedules, LOS-Masken | **fängt naives Cheating fast vollständig** | M |
| **S3: Schatten-Sim** | Volle Sim als Wahrheit, Checksum-Vergleich, Snapshot-Korrektur | echte Autorität | L, **braucht die Occlusion-Entscheidung** |
| **S4: Voller Dienst** | Accounts, Ladder, Replays, Live-Ops, Betrieb | – | L, dauerhaft |

**S2 ist das beste Preis-Leistungs-Verhältnis im ganzen Konzept:** rund
90 % des realistischen Cheatings zu einem Bruchteil der Kosten einer
Server-Sim, ohne dass irgendetwas headless laufen muss. Wer nicht Ranked-PvP
mit Preisgeld plant, kann bei S2 stehenbleiben.

**Der eigentliche Fork im Projekt ist 11.2:** OSM-Gebäudemodell statt
GPU-Occlusion als Gameplay-Wahrheit. Diese Entscheidung fällt einmal und
bestimmt danach, ob S3 überhaupt erreichbar ist: sie ist gleichzeitig die
Lösung für alle drei Determinismus-Blocker aus Teil I und für die
Stale-LOS-Bugs in der `TODO.md`. Sie kostet aber die exakte Übereinstimmung
von Sichtlinie und Stadtbild.

---

# Teil III: Der Server, den wir tatsächlich bauen

> **Prämisse:** Die Simulation läuft auf jedem Client. Der Server ist
> Vermittlung, Matchmaking, Verwaltung und Überwachung: **niemals Rechner**.
> Das entspricht S1+S2 aus Abschnitt 13, ohne S3/S4.

Der Leitsatz dahinter: **Der Server ist das Gedächtnis des Matches, nicht sein
Gehirn.** Er ordnet, speichert und verteilt, und genau daraus ergeben sich
Fähigkeiten, die ein reiner Weiterleiter nicht hätte (Host-Migration,
Rejoin, Replays, Desync-Forensik).

---

## 14. Rollenverteilung

Drei Rollen, klar getrennt. "Host" ist **ein Client mit Sonderaufgaben**, kein
Serverprozess.

| | **Server** | **Host-Client** | **Peer-Client** |
|---|---|---|---|
| Simulation | – | ja (wie alle) | ja |
| Rendering | – | ja | ja |
| Command-Reihenfolge & Tick-Nummern | **besitzt** | – | – |
| RNG-Seed, Match-ID | **besitzt** | – | – |
| World-Snapshot (Straßen, Routen, World Seal) | speichert & verteilt | **erzeugt** | lädt |
| LOS-Masken beim Turmbau | speichert & verteilt | **rechnet (GPU)** | übernimmt |
| Wave-Schedule (Regel-Director oder Kampagne) | speichert & verteilt | **rechnet** | übernimmt |
| Regelprüfung der Commands | **führt aus** | – | – |
| Checksum-Sammlung & Quorum | **führt aus** | meldet | meldet |
| Match-Ergebnis, Ladder | **besitzt** | meldet | meldet |

Der Host ist damit die einzige Stelle, an der GPU-abhängige Größen entstehen,
und weil der Server **jede** davon zwischenspeichert, sind sie ab dem Moment der
Verteilung serverseitige Wahrheit. Das ist der Trick, der die
Determinismus-Blocker aus Teil I entschärft, ohne dass der Server rechnen muss.

---

## 15. Server-Komponenten

Acht Bausteine. Die ersten vier sind das Minimum für ein spielbares Match, die
letzten vier machen daraus einen Dienst.

### 15.1 Gateway & Session (Minimum)
- Verbindungsannahme, Auth-Token, Heartbeat, Reconnect-Fenster.
- **Versions-Gate:** Client-Build-Hash **und** `balanceHash` (Fingerprint über
  `configs/`) müssen zum Room passen. Ein Client mit abweichenden
  Tower-/Enemy-Configs divergiert sofort: hier abzulehnen ist billiger als
  jede spätere Desync-Analyse.
- *Macht nicht:* eigene Passwörter. OAuth (Google/Discord) oder in v1 gar
  nichts außer einem anonymen Gast-Token.

### 15.2 Room-Service (Minimum)
- Room anlegen/beitreten per Code, Spielerliste, Ready-States, Modusauswahl,
  Kick, Room-Lifecycle.
- Hält die Host-Zuweisung und fällt bei Host-Verlust auf einen Peer zurück
  (siehe 19).

### 15.3 Tick-Relay (Minimum, das Herzstück)
- Nimmt Commands entgegen, stempelt `(netTick, playerId, seq)`, ordnet
  **deterministisch** (stabil nach `playerId`, dann `seq`) und fächert an alle
  aus, inklusive an den Absender.
- Verwaltet den Input-Delay (Default 3 Net-Ticks ≈ 200 ms) und passt ihn an den
  schlechtesten RTT im Raum an.
- Sammelt leere Tick-Bestätigungen, erkennt hängende Clients, setzt
  Stall-Warnungen ab und dropt nach Schwellwert.
- *Macht nicht:* Spiellogik. Er weiß, dass ein `place-tower` durchgeht, nicht
  ob der Turm dort sinnvoll steht.

### 15.4 Artefakt-Store (Minimum)
- Nimmt vom Host `WorldSnapshot`, LOS-Masken und Wave-Schedules entgegen,
  speichert sie unter der Match-ID und liefert sie an Joiner, Rejoiner und
  neue Hosts aus.
- Größenordnung pro Match: Snapshot 15–30 KB gzip, Masken einige hundert Byte
  pro Turm, Schedules ein paar KB. **Ein Match passt bequem in ein einzelnes
  Objekt von unter einem Megabyte.**

### 15.5 Validator ("Überwachung", Stufe S2)
Führt ein **schlankes Spiegelmodell** des Matchzustands: Turmliste mit
Besitzer und Level, Research-Stand, Gold-Ledger pro Spieler, Wellennummer,
Phase. Das ist Buchhaltung, keine Simulation: es aktualisiert sich bei
Command-Events (wenige pro Minute), nicht pro Frame.

Damit prüfbar:
- Existiert der Turm? Gehört er dem Absender? (`sell`, `upgrade`)
- Stimmt der Preis gegen die Server-Config? Reicht das gebuchte Gold?
- Ist das Upgrade-Tier per Research freigeschaltet? (Spiegel der Tier-Logik aus
  `TowerLifecycle.upgrade()`, `managers/game-state/tower-lifecycle.ts`)
- Sind Research-Voraussetzungen erfüllt, läuft schon eine Forschung?
- Passt der Bauplatz in den Room-Snapshot (Zelle existiert, nicht belegt)?
- Plausibilitäts- und Rate-Limits: Commands pro Sekunde, Türme pro Welle.
- Noch nicht mitgedacht (seit dem Konzept dazugekommen): `use-ability`
  (Freischaltung per Forschung, Ladungen je Welle) und die Held-Commands
  (Anheuern gegen Credits, Befehl, Munition). Beide wären ebenso Buchhaltung.

Nicht prüfbar (und das ehrlich benennen): alles, was aus der Sim kommt:
Reichweite, Sichtlinie, Schaden, Kill-Zuordnung. **Und damit auch die
Gold-Einnahmen**, denn die entstehen aus Kills. Der Server kennt Ausgaben
exakt, Einnahmen nur aus Client-Meldungen. Dagegen hilft nur 15.6.

### 15.6 Desync-Wächter (Überwachung, Teil 2)
- Sammelt alle 30 Net-Ticks die Client-Checksums (Abschnitt 4.5).
- **Ab drei Spielern echte Autorität per Quorum:** Wenn 3 von 4 übereinstimmen,
  ist der Ausreisser falsch: der Server ordnet einen Snapshot-Reload an, im
  Wiederholungsfall Kick. Damit bekommt Coop echte Cheat-Resistenz, **ohne dass
  der Server simuliert.**
- Bei zwei Spielern gibt es kein Quorum: dann entscheidet der Host, und das
  Match wird als "unverifiziert" markiert.
- Jede Divergenz zieht automatisch beide Command-Logs und den Snapshot in die
  Forensik-Ablage. Das ist gleichzeitig **das Debugging-Werkzeug** für den
  gesamten Determinismus-Umbau.

### 15.7 Matchmaking & Ladder (Dienst)
- Queue pro Modus, Rating (Glicko-2), Regionswahl, Party-Handling,
  Reconnect-Vorrang.
- Ergebnisannahme: Wer hat gewonnen, wie viele Leaks, welche Welle. Bei
  Ranked-Modi nur akzeptieren, wenn der Desync-Wächter das Match als sauber
  markiert hat.

### 15.8 Telemetrie & Ops (Dienst)
- Metriken: Ticks/s pro Room, Stall-Häufigkeit, RTT-Verteilung, Desync-Rate
  pro Client-Version, Abbruchgründe.
- Admin-Sicht auf laufende Rooms: im Kern dasselbe wie das bestehende
  Training-Dashboard.
- Alerting auf Desync-Rate: Ein Anstieg nach einem Deploy bedeutet fast immer,
  dass eine Balance- oder Sim-Änderung den Determinismus gebrochen hat.

---

## 16. Protokoll

Ein einziger WebSocket pro Client. JSON reicht: das Volumen ist winzig; Binär
nur für Masken und Snapshot (als separater HTTP-Download, nicht durch den
Socket).

| Richtung | Nachricht | Inhalt |
|----------|-----------|--------|
| C→S | `hello` | Token, Client-Build-Hash, `balanceHash`, Region |
| C→S | `room:create` / `room:join` / `room:leave` / `room:ready` | Modus, Room-Code |
| C→S | `world:publish` | *(nur Host)* Snapshot-Upload → gibt Artefakt-URL zurück |
| C→S | `command` | Command-Typ + Payload (die 14 `command:*` aus `game-event-bus.ts`) |
| C→S | `tick:ack` | Net-Tick bestätigt, auch ohne Input |
| C→S | `los:publish` | *(nur Host)* Turm-ID + Masken-Blob |
| C→S | `wave:publish` | *(nur Host)* Wellennummer + Spawn-Schedule |
| C→S | `checksum` | Net-Tick + Hash |
| C→S | `result` | Ergebnis am Matchende |
| S→C | `room:state` | Spielerliste, Host, Ready-States, Modus |
| S→C | `match:start` | Match-ID, Seed, Artefakt-URLs, Startzeitpunkt, Input-Delay |
| S→C | `tick` | Net-Tick + geordnete Commandliste (leer, wenn nichts passiert) |
| S→C | `los` / `wave` | Weitergereichte Host-Artefakte |
| S→C | `stall` | Wer hängt, wie lange |
| S→C | `desync` | Snapshot-Reload angeordnet, Grund |
| S→C | `host:changed` | Neuer Host, ab welchem Tick |
| S→C | `error` | Command abgelehnt + Grund (Validator) |

Ein abgelehntes Command ist **kein Fehlerfall im Client, sondern der Normalfall
bei Latenz** (zwei Spieler kaufen gleichzeitig, das Gold reicht nur einmal). Die
UI muss das als "Kauf fehlgeschlagen" darstellen können, nicht als Absturz.

---

## 17. Was persistiert wird

| Datum | Ablage | Aufbewahrung |
|-------|--------|--------------|
| Profile, Rating, Freunde | Postgres | dauerhaft |
| Matchergebnisse | Postgres | dauerhaft |
| WorldSnapshot pro Match | Object Storage | Tage bis Wochen |
| **Command-Log + Seed** | Object Storage | siehe 18 |
| Desync-Forensik (Logs + Checksums) | Object Storage | Wochen |

---

## 18. Der Command-Log ist die wichtigste Entscheidung

Command-Log + Seed + Snapshot-Referenz sind zusammen **das vollständige
Match**. Bei Lockstep fällt das ohne Zusatzaufwand an: es ist derselbe Strom,
den das Relay ohnehin durchreicht.

Was daraus wird, kann später entschieden werden:
- **Replay-Wiedergabe** im Client (kostet nur UI). Das heute gebaute Replay der
  letzten Welle ist eine Präsentations-Aufnahme ohne Nachrechnen
  ([REPLAY.md](REPLAY.md)), keine Wiedergabe aus dem Command-Log.
- **Zuschauermodus**: ein Client, der den Tick-Strom live mitliest.
- **Nachträgliche Verifikation** für Ranked: Ein Verifizierer spielt den Log
  nach und vergleicht das Ergebnis. Das braucht irgendwann doch eine
  headless-fähige Sim, aber **asynchron, außerhalb des Matches, nur für die
  Spitze der Ladder**, und ohne dass ein Live-Server je simulieren müsste.
- **Balance-Analyse** über echte Matches statt nur über Bot-Läufe.

**Deshalb: den Log von Tag eins an speichern, auch wenn ihn zunächst niemand
liest.** Er kostet Kilobytes und hält jede dieser Optionen offen. Nachträglich
lässt sich das nicht rekonstruieren.

---

## 19. Host-Migration

Weil der Server jede Host-Ausgabe zwischenspeichert (Snapshot, alle bisherigen
LOS-Masken, alle Wave-Schedules), ist der Host austauschbar:

1. Host-Verbindung bricht ab.
2. Relay pausiert den Tick-Vorlauf.
3. Server ernennt den Peer mit der besten Verbindung, sendet `host:changed`.
4. Der neue Host übernimmt ab dem nächsten Bau-/Wellen-Event; alle bereits
   verteilten Artefakte bleiben gültig.

Einschränkung, die man kennen muss: Der neue Host rechnet künftige LOS-Masken
auf **seiner** GPU mit **seinem** Tile-Ladezustand. Die Masken aus der ersten
Hälfte des Matches stammen also von einer anderen Maschine als die aus der
zweiten. Für die Konsistenz zwischen Clients ist das egal: alle bekommen
dieselben Masken. Es kann nur bedeuten, dass zwei baugleiche Türme
unterschiedlich sehen, je nachdem wann sie gebaut wurden. Für Coop
verschmerzbar, für Ranked-PvP ein Argument, den Host dort nicht zu wechseln
sondern das Match abzubrechen.

---

## 20. Technik und Betrieb

**Sprache: TypeScript**, obwohl Python im Projekt etabliert ist
(`bot-server/server.py`, mit Multi-Client-Handling und
Broadcast: die Vorlage wäre da).

Der Grund ist nicht Geschmack, sondern **geteilte Typen**: Das Relay muss die
`GameEvent`-Union und die Config-Werte kennen, um Commands zu validieren
(15.5). In TypeScript ist das ein Import aus dem bestehenden Code; in Python
ist es eine handgepflegte Zweitfassung, die bei jeder Balance-Änderung still
auseinanderläuft, und genau das ist die Fehlerklasse, die Desyncs erzeugt.

| Aspekt | Empfehlung |
|--------|-----------|
| Runtime | Node oder Bun + `ws`, ein Prozess, Rooms im Speicher |
| Alternative | Cloudflare Durable Objects / PartyKit: Room-Modell und Persistenz eingebaut, bei kleiner Nutzerzahl praktisch kostenlos, kein Betrieb |
| DB | Postgres, erst ab Matchmaking nötig: v1 läuft ohne |
| Storage | S3-kompatibel (R2 ist am günstigsten) |
| Region | EU zuerst; ein zweiter Standort erst bei echtem Bedarf |
| Deploy | Container, Graceful Drain (laufende Matches nicht mittendrin kappen) |
| Lasttest | **`StrategyBot` als synthetischer Spieler**: der Lastgenerator existiert bereits |

**Ressourcenbedarf:** Ein Room kostet ein paar Kilobyte Speicher und
Nachrichten-Fan-out im niedrigen zweistelligen Hertz-Bereich. Kein Rechnen,
keine GPU, kein Zustand pro Frame. Hunderte gleichzeitige Matches auf einer
kleinen Instanz sind realistisch: der begrenzende Faktor wird lange die
Anzahl offener Sockets sein, nicht CPU.

---

## 21. Was durch diese Entscheidung wegfällt

Gegenüber Teil II entfällt ersatzlos:

- Der Headless-Refactor der Sim (Angular-DI, Turret-Aim aus dem Renderer,
  plattformneutrales `sim/`-Paket).
- **Der Zwang zum OSM-Gebäudemodell.** Die Occlusion-Frage aus 11.2 war nur
  deshalb blockierend, weil ein Server ohne GPU LOS rechnen müsste. Da der
  Host-Client eine GPU hat, bleibt die bestehende Cubemap-Pipeline die
  Gameplay-Wahrheit: sie wird nur einmal statt N-mal ausgewertet. Der
  Design-Preis (Sichtlinie passt nicht mehr zum Stadtbild) entfällt damit.
- GPU-Instanzen, Sim-Kosten pro Match, Server-Tickrate als Skalierungsgrenze.

Bestehen bleibt aus Teil I unverändert:
- Seeded RNG (2.3): der Seed kommt jetzt vom Server statt vom Host.
- World Seal (2.2): erzeugt vom Host, verteilt vom Server.
- Tick-Barriere im Sub-Step-Loop (4.2).
- Per-Spieler-Ökonomie und `Tower.ownerId` (Abschnitt 6, Punkte 10–11).

---

## 22. Reihenfolge

| Stufe | Server-Umfang | Client-Umfang | Ergebnis |
|-------|---------------|---------------|----------|
| **1** | Gateway, Room-Service, Artefakt-Store | Lobby-UI, Snapshot-Publish/Load | Zwei Clients in derselben Welt: **Versus Race spielbar** |
| **2** | Tick-Relay, Checksum-Sammlung | Netzwerk-Interceptor, Tick-Barriere, seeded RNG | Lockstep läuft: **Coop spielbar** |
| **3** | Validator, Desync-Wächter, Host-Migration | Rejoin-Flow, abgelehnte Commands in der UI | Robust und cheat-resistent genug für Öffentlichkeit |
| **4** | Matchmaking, Ladder, Persistenz, Telemetrie | Profil, Queue-UI, Replay-Ansicht | Dienst |

Stufe 1 ist erstaunlich klein: Room-Verwaltung plus Dateiablage, **kein Relay,
kein Determinismus**. Und sie liefert bereits einen vollständig spielbaren
PvP-Modus.

---

# Teil IV: Die zwei Zielmodi

> Zwei konkrete Modi, durchentworfen. **Modus B ist netzwerktechnisch fast
> geschenkt, Modus A ist der teure**, und zwar nicht wegen der Netzwerktechnik,
> sondern wegen der Renderlast.

---

## 23. Modus A: "Vier Tore": eigene Lane, gemeinsames HQ

### 23.1 Der Kernbefund: die Lane existiert bereits

Das ist kein neues Konzept, sondern eine Zuordnung:

| Vorhandenes Bauteil | Fundstelle | Wird zu |
|---------------------|-----------|---------|
| `SpawnPoint[]` mit eigener Route je Spawn | `WaveManager.spawnPoints`, Routen-Cache im `PathAndRouteService` | **die Lane** |
| `selectSpawnPoint('each' \| 'random')` | `WaveManager.selectSpawnPoint` | Verteilung der Welle auf Lanes |
| `SPAWN_COLORS`: **exakt vier Farben** | `configs/map-constants.config.ts` | Spielerfarben |
| `MIN/MAX_SPAWN_DISTANCE` 500–1000 m | ebenda | Lane-Länge und -Abstand |
| Route-Berechnung pro Spawn zum HQ | `path-route.service.ts` | Lane-Geometrie |

Die Engine ist also bereits für bis zu vier farblich getrennte Lanes gebaut,
die alle auf ein HQ zulaufen. **Die Mechanik von Modus A ist im Kern eine
Zuordnung `playerId ↔ spawnPointId`**: plus die Regeln drumherum.

### 23.2 Spielregeln

| Frage | Entscheidung | Warum |
|-------|-------------|-------|
| Lane-Zuweisung | Ein Spawn pro Spieler, Farbe = Spielerfarbe | Bereits im Renderer vorhanden |
| HQ-Leben | **geteilt** | Der Coop-Kern: dein Leak tut mir weh |
| Gold | **getrennt** | Siehe unten: das ist die wichtigste Entscheidung |
| Bauen in fremder Lane | **erlaubt** | Helfen wird dadurch zum echten Opfer, nicht zur Geste |
| Turm verkaufen | nur Besitzer | Kein Griefing |
| Turm upgraden | jeder, mit eigenem Gold | Gemeinsames Aufrüsten eines Schlüsselturms |
| Research | **geteilt**, Kosten beim Auslöser | Der Tech-Tree ist global; erzeugt natürlichen Rollen-Split |
| Wellennummer | **global** | `checkWaveComplete()` ist heute schon global |
| Wellen-Schedule | **pro Lane**, aus demselben Seed, gleiche Stärke | "Meine Lane, mein Problem" |
| Wellenstart | alle müssen bereit sein | Nutzt `command:start-wave` unverändert |

**Getrenntes Gold plus Bauen-überall ist der interessanteste Hebel im ganzen
Modus.** Es erzeugt Carry-Dynamik ohne eine einzige Sonderregel: Wer gut steht,
kann sein Gold in die Lane des Schwächsten stecken, und zahlt dafür mit der
eigenen Verteidigung. Ein geteilter Goldpool hätte diese Entscheidung
wegoptimiert.

### 23.3 Die konvergierende Zone: bewusst gestalten

Alle Lanes laufen auf dasselbe HQ zu, also überlappen sich die letzten ~100 m.
Ein Turm dort deckt **alle** Lanes ab. Das ist keine Panne, sondern der
interessanteste Ort der Karte, aber es braucht eine Regel, sonst baut einer
den Kern voll und die anderen fahren Trittbrett:

- **Empfehlung:** Der Kernbereich ist eine ausgewiesene Zone mit eigenem
  Bau-Limit (z. B. maximal N Türme, unabhängig vom Besitzer). Damit wird er
  zur knappen gemeinsamen Ressource, über die das Team verhandeln muss.
- Alternative (langweiliger): Bauverbot im Kernradius, jede Lane muss allein
  halten.

### 23.4 Skalierung mit der Spielerzahl

Naiv wäre "HQ-HP × Spielerzahl": das macht das Spiel **leichter**, weil vier
Verteidiger mehr leisten als einer. Vorschlag stattdessen:

- HQ-HP bleibt konstant, Leak-Schaden pro Gegner bleibt konstant.
- Wellenstärke **pro Lane** bleibt ebenfalls konstant.
- Ergebnis: Mehr Spieler = mehr gleichzeitige Fronten = mehr Leak-Gelegenheiten
  bei gleichem HQ-Puffer. Vier Spieler ist die harte Variante, nicht die
  leichte.
- Balance-Regler, falls das zu hart ist: Leak-Schaden ÷ Spielerzahl.

### 23.5 Der Schwachstellen-Spieler

Der offensichtliche Frust-Modus: Ein Spieler leakt dauernd und kostet dem Team
das HQ. Drei Gegenmittel, alle billig:

1. **Lane-Kollaps statt Matchende beim Disconnect.** Geht ein Spieler,
   wird seine Lane geschlossen (kein Spawn mehr) statt das Match zu beenden.
   Das ist gleichzeitig die saubere Antwort auf Verbindungsabbrüche: der
   Rest spielt weiter.
2. **Gold-Transfer** zwischen Spielern erlauben (eigener Command).
3. **Lane-Druck-HUD**: Alle sehen die HP-Summe und Leak-Rate jeder Lane. Ein
   Problem sichtbar zu machen ist billiger, als es zu regulieren.

### 23.6 Netzwerk: volles Lockstep, kein Weg drumherum

Gemeinsames HQ = gemeinsamer Zustand = alle Clients müssen sich über jeden
Leak einig sein. Damit gilt das komplette Programm aus Teil I und III:
Tick-Relay, Tick-Barriere, seeded RNG, World Seal, Host-LOS-Masken,
Checksum-Quorum.

Immerhin: **Ab drei Spielern liefert das Quorum aus 15.6 echte Autorität.**
Modus A ist damit der Modus, der am meisten von der Serverarchitektur
profitiert.

### 23.7 Performance: der eigentliche Engpass

**Das ist die zentrale Erkenntnis für Modus A: Die Grenze ist nicht das
Netzwerk, sondern der Renderer.**

Vier Lanes bedeuten die vierfache Gegnerzahl **in jedem einzelnen Client**.
Ist-Stand laut [INSTANCED_ENEMY_RENDERING.md](INSTANCED_ENEMY_RENDERING.md):

> 5000 Enemies @ 67 FPS · 500 Enemies ≈ 1,3 ms JS-Zeit, linear skalierend

Daraus folgt das Budget direkt: **bei vier Spielern rund 1200 Gegner pro Lane**,
wenn 5000 die Obergrenze bleiben soll. Die JS-Sim-Zeit liegt bei 5000 Gegnern
schon bei grob 13 ms, also **nicht** vernachlässigbar, die Sim ist bei vier
Lanes selbst ein Frame-Budget-Posten.

Fünf Hebel, nach Wirkung sortiert:

1. **Hartes Lane-Enemy-Budget.** Bei hoher Spielerzahl setzen die Wellen auf
   Stärke statt Masse. Das ist eine **Balance-Entscheidung, keine
   Technikaufgabe**, und die Wave-Kampagne-Config ist der richtige Ort dafür.
2. **Per-Instance-Culling prüfen.** Die Kamera hängt über der eigenen Lane,
   die anderen sind 500–1000 m entfernt und meist außerhalb des Frustums.
   Aber: `InstancedMesh` mit `frustumCulled = false` rendert trotzdem alles.
   **Konkreter Prüfpunkt im Instanced-Renderer**: hier liegt vermutlich der
   größte einzelne Gewinn.
3. **Distanz-LOD für fremde Lanes.** Jenseits X Meter: VAT-Animation aus,
   Health-Bars aus, Partikel aus. Die Toggles existieren teilweise schon
   (`_showAnimations`, `_showEnemies`).
4. **Spatial-Grid pro Lane.** Existiert (`services/world/spatial-grid.service.ts`); Lanes sind
   räumlich sauber getrennt, das Grid profitiert automatisch.
5. **Tick-Barriere-Realität:** Der langsamste Client bestimmt das Tempo
   **aller**. Bei heterogener Hardware ist das der spürbarste Effekt im ganzen
   Modus.

### 23.8 Lobby-Benchmark

Aus Punkt 5 folgt eine Maßnahme, die ich für wichtiger halte als sie klingt:
**Der Client misst beim Laden seine eigene Kapazität und meldet sie.**

Das Werkzeug existiert: Der Bot-Modus mit `trainingTimescale` und
`renderingEnabled` spielt in Sekunden ein Referenzszenario und der
`PerformanceProfilerService` liefert die Zahlen. Der Server kann daraufhin
warnen ("dieser Spieler wird das Match ausbremsen"), das Lane-Budget senken
oder die Spielerzahl begrenzen.

Nebeneffekt: Dasselbe Messergebnis taugt im Singleplayer als
Auto-Qualitätsstufe.

---

## 24. Modus B: "Rush": Wellen kaufen, Defense halten

### 24.1 Der Kernbefund: kostenlos in jeder Hinsicht

Zwei getrennte Spielfelder, verbunden durch einen dünnen Ereignisstrom.
Daraus folgt:

- **Kein Lockstep.** Jeder simuliert nur sein eigenes Brett.
- **Kein Determinismus nötig.** Divergenz zwischen den Clients ist
  bedeutungslos, weil es nichts Gemeinsames gibt.
- **Keine zusätzliche Renderlast.** Ein Brett = Singleplayer-Kosten.
- **Kein World Seal, keine LOS-Masken, keine Checksums.**

Modus B läuft damit auf **Server-Stufe 1** aus Teil III (Rooms +
Artefakt-Store), plus einem Ereigniskanal. Er ist vor allen
Determinismus-Arbeiten spielbar.

Einzige Fairness-Anforderung: **dieselbe Stadt und dieselbe Lane-Geometrie für
beide**, sonst sind die Ergebnisse nicht vergleichbar. Derselbe Seed sorgt
zusätzlich dafür, dass ein gekaufter Angriff bei beiden gleich ausfällt.

### 24.2 Die Ökonomie ist der Modus

Zwei Währungen, klassisch und erprobt:

- **Gold**: aus Kills, für Türme und für Angriffe.
- **Einkommen**: passiver Zufluss pro Intervall. **Steigt dauerhaft, wenn man
  Gegner schickt.**

Daraus entsteht die zentrale Spannung des Modus:

```
Gegner schicken  →  kostet Gold jetzt
                 →  erhöht Einkommen dauerhaft      (Investition)
                 →  setzt den Gegner unter Druck     (Angriff)
                 →  füttert den Gegner mit Kill-Gold (Risiko)

Nur bauen    → sicher, aber wirtschaftlich abgehängt
Nur schicken → reich und tot
```

Der dritte Pfeil ist der wichtige: **Ein Send gibt dem Gegner Kill-Gold.** Das
ist der Regler, der "einfach dauernd schicken" ausbalanciert, und er lässt sich
pro Gegnertyp feinjustieren.

### 24.3 Kaufen und Upgraden: beide Achsen

Der Nutzer-Wunsch "kauf- oder upgradebar" wird zu zwei getrennten Systemen:

**Kaufen: der Send-Katalog.** Pro Gegnertyp aus den bestehenden Enemy-Configs:
Preis, Einkommens-Ertrag, Kill-Gold für den Gegner, Spawn-Anzahl. Der Katalog
ist eine Config-Datei, keine Mechanik.

**Upgraden: Tier-Tracks pro Gegnertyp.** Analog zu den Tower-Upgrades
(25 Level in 5er-Bändern, durchgesetzt in `TowerLifecycle.upgrade()`). Ein Tier-Upgrade
verstärkt alle künftigen Sends dieses Typs. Zwei Gründe, das genau so zu
bauen:

1. Die Mechanik ist im Code etabliert und den Spielern bereits vertraut.
2. **Die Wave-Kampagne-Config liefert schon Skalierungskurven für
   Gegnerstärke**: die Tier-Werte müssen nicht neu erfunden werden.

Damit hat der Angreifer dieselbe Entscheidungstiefe wie der Verteidiger:
Breite (viele Typen) gegen Tiefe (ein Typ hochgezogen), und beides gegen
Einkommen.

### 24.4 Das Anti-Cheat-Geschenk

Hier fällt etwas ab, das in einem Client-Sim-Modell sonst unerreichbar ist:

**Der Server sieht jeden Send. Das Einkommen ist eine reine Funktion der
Sends. Also kann der Server das Einkommen jedes Spielers exakt nachrechnen,
ohne zu simulieren.**

Und weiter: Kill-Gold entsteht nur aus Gegnern, die geschickt wurden, und die
kennt der Server ebenfalls. Er kann damit eine **exakte Obergrenze für das Gold
jedes Spielers** führen und jeden Kauf dagegen prüfen.

Das ist praktisch vollständiger Wirtschafts-Anti-Cheat ohne eine Zeile
Simulation auf dem Server. Modus B ist damit **der Modus, der sich am besten
für Ranked eignet**, und das ist genau umgekehrt zu dem, was man erwarten
würde.

Was offen bleibt: Reichweiten- und Schadensmanipulation auf dem eigenen Brett.
Dagegen hilft nur der Replay-Log aus Abschnitt 18: asynchron, später, für die
Ladder-Spitze.

### 24.5 Was der Gegner sieht

Das gegnerische Brett mitzusimulieren würde die Kosten verdoppeln und den
größten Vorteil des Modus wegwerfen. Stattdessen gestaffelt:

- **Immer:** HUD mit HQ-HP, Einkommen, Wellennummer, Leaks, Turmzahl. Kostet
  ein paar Byte pro Sekunde.
- **Auf Wunsch ("Peek"):** Low-Rate-Zustandsschnappschuss, ~5 Hz, ein paar
  hundert Positionen: grob 20 KB/s, und nur solange jemand hinsieht.
- **Bewusst nicht:** Vollwertiger Zuschauermodus. Der braucht die zweite Sim.
  Für Zuschauer gibt es das Replay.

### 24.6 Matchende

Erster mit HQ ≤ 0 verliert. Gegen Endlospartien ein Sudden-Death-Regler: ab
Minute X eine automatisch eskalierende Grundwelle für beide, oder ein
Einkommens-Deckel. Ohne so einen Regler enden zwei gleich starke, defensive
Spieler nie.

---

## 25. Leichtes Setup: ein eigenes Problem

Die größte UX-Gefahr ist nicht die Netzwerktechnik, sondern die **Ladezeit vor
dem Match**: Overpass-Abfrage, Routenberechnung, Tile-Streaming,
Höhen-Sampling. Fünf Maßnahmen, in dieser Reihenfolge:

1. **Kuratierter Kartenpool mit vorgebackenen Snapshots.** Matchmaking wählt
   nur aus geprüften Karten, deren `WorldSnapshot` fertig im Storage liegt.
   Kein Overpass, keine Routenberechnung, kein Warten. **Freie Städte bleiben
   privaten Räumen vorbehalten**, dort darf es dauern.
2. **Laden beginnt beim Room-Join, nicht beim Match-Start.** Das Ready-Gate
   greift erst, wenn geladen ist. Die Lobby-Zeit wird zur Ladezeit.
3. **Snapshot statt Fremd-API** (Abschnitt 4.4): spart den Overpass-Roundtrip
   und dessen Rate-Limits gleich mit.
4. **Join per Link:** `?room=ABC123`. Die URL-Location-Mechanik existiert
   bereits (`services/location/url-location.service.ts`).
5. **Match startet, während Tiles noch streamen.** Tiles sind das langsamste
   Element und lassen sich nicht vorbacken, aber nach dem World Seal hängt
   **kein Gameplay** mehr an ihnen. Was als Determinismus-Maßnahme gedacht war,
   wird hier zum Ladezeit-Feature.

---

## 26. Servertechnologie für genau diese zwei Modi

| | **Modus B (Rush)** | **Modus A (Vier Tore)** |
|---|---|---|
| Serverrolle | Rooms + Send-Relay + Ergebnis | Voller Tick-Relay + Quorum |
| Nachrichtenrate | ein paar Events pro Minute | 15 Hz Fan-out pro Room |
| Zustand pro Room | Send-Historie, Gold-Obergrenze | + Command-Log, Checksums, Artefakte |
| Passende Technik | **Cloudflare Durable Objects / PartyKit**: ein Objekt pro Match, Persistenz eingebaut, bei kleiner Nutzerzahl praktisch kostenlos | **Node/Bun + `ws`**: Tick-Ordnung und Stall-Handling sind in einem klassischen Prozess einfacher zu debuggen |
| Matchmaking | Glicko-2, Kartenpool, Sekunden | Lobby-Browser + Quick-Join, **kein Rating nötig** |

Beides bleibt **ein TypeScript-Codebase** (Begründung in Abschnitt 20:
geteilte Typen mit den Client-Configs). Ob am Ende zwei Deploy-Ziele oder ein
Node-Prozess für beide Modi stehen, ist eine Betriebsentscheidung, keine
Architekturfrage.

Pragmatischer Start: **Node/Bun für beides.** Ein Prozess, zwei Room-Typen,
ein Deployment. Die Aufspaltung lohnt erst, wenn Modus B nennenswerte Last
erzeugt.

---

## 27. Was dabei sonst noch abfällt

Der Teil, der über die zwei Modi hinaus Wert schafft:

1. **Bots füllen leere Plätze.** Der `StrategyBot` existiert und ist
   sofort einsetzbar: leere Lanes im Coop, Trainingsgegner in PvP. Damit
   funktioniert Modus A auch zu zweit plus zwei Bots: **die wichtigste
   einzelne Maßnahme für "leichtes Setup"**, weil sie das
   Vier-Spieler-Problem auflöst.
2. **Menschliche Sends als Trainingsdaten.** Der Wave-Director trainierte gegen
   Bots. Modus B produziert echte menschliche Angriffsentscheidungen im selben
   Aktionsraum, und es fällt im Betrieb an.

   *Nachtrag 2026-09-07: Dieser Punkt ist inzwischen belegt, nicht mehr nur
   plausibel.* Ein A/B-Lauf mit vier Wave-Designern gegen dieselben Bots ergab,
   dass das trainierte Netz dreimal statistisch nicht von uniformem Zufall zu
   unterscheiden war; es wurde deshalb durch den Regel-Director ersetzt. Ein
   Grund liegt im Aktionsraum (Kampagne und Überlebbarkeits-Deckel gaben fast alles
   vor), der andere ist genau dieser: Wer gegen einen einzigen scripted Bot
   trainiert, lernt dessen Schwächen, und die hat ein Mensch nicht. Menschliche
   Sends sind damit nicht bloß besseres Material, sondern die Vorbedingung
   dafür, dass sich ein gelerntes Modell hier überhaupt lohnt. Siehe
   `docs/archive/HANDOVER_RULE_DIRECTOR.md`.
3. **Der AI-Director als PvP-Gegner** (Teil I, Modus C): dieselbe UI, dieselbe
   Aktionsraum-Anbindung wie der menschliche Angreifer in Modus B.
4. **Replays** aus dem Command-Log: beide Modi, ohne Zusatzaufwand.
5. **Determinismus-Arbeit zahlt auf Singleplayer ein:** reproduzierbare Bugs,
   deterministisches AI-Training, Save/Load.
6. **Der Lobby-Benchmark** wird im Singleplayer zur Auto-Qualitätsstufe.
7. **Per-Instance-Culling und Lane-LOD** (23.7) verbessern auch die
   Singleplayer-Performance bei großen Wellen.

---

## 28. Reihenfolge

| Schritt | Inhalt | Vorbedingung |
|---------|--------|--------------|
| **1** | Server-Stufe 1 (Rooms, Artefakt-Store), Lobby, Join-per-Link | – |
| **2** | **Modus B komplett**: Send-Katalog, Zwei-Währungs-Ökonomie, Tier-Upgrades, Gegner-HUD | Schritt 1. **Kein Determinismus nötig** |
| **3** | Gold-Obergrenzen-Validator + Ladder für Modus B | Schritt 2 |
| **4** | Determinismus-Fundament (seeded RNG, World Seal, Serializer, Checksums) | – |
| **5** | Tick-Relay, Tick-Barriere, Per-Spieler-Ökonomie, `Tower.ownerId` | Schritt 4 |
| **6** | **Modus A**: Lane-Zuweisung, geteiltes HQ, Kernzonen-Regel, Lane-Kollaps | Schritt 5 |
| **7** | Renderlast-Arbeit: Per-Instance-Culling, Lane-LOD, Lane-Budget, Lobby-Benchmark | parallel zu 6, **bestimmt die Spielerzahl** |

**Modus B kommt zuerst, nicht weil er einfacher zu entwerfen ist, sondern weil
er keinen einzigen der Determinismus-Blocker berührt.** Er ist spielbar,
bevor irgendetwas an der Sim angefasst wurde, und er ist gleichzeitig der
Modus mit dem besseren Anti-Cheat-Profil.

---

## 29. FAQ

**Warum nicht Modus A zuerst? Coop klingt doch harmloser als PvP.**
Umgekehrt. Coop teilt ein HQ, also teilt es Zustand, also braucht es Lockstep
und damit alle drei Determinismus-Blocker. Modus B teilt nichts außer einem
Ereignisstrom.

**Wie viele Spieler gehen in Modus A?**
Vier ist die Obergrenze, und zwar durch drei unabhängige Dinge, die alle bei
vier landen: `SPAWN_COLORS` hat vier Einträge, die Tick-Barriere macht jeden
weiteren Client zum Risiko, und das Renderbudget von ~5000 Gegnern ergibt bei
vier Lanes noch spielbare ~1200 pro Lane. Zwei bis drei dürfte der
angenehmere Bereich sein.

**Was passiert, wenn in Modus A jemand rausfliegt?**
Seine Lane schließt, das Match läuft weiter (23.5). Das ist bewusst kein
Pausieren und kein Abbruch: bei vier Leuten fällt sonst zu oft jemand aus.

**Und in Modus B?**
Verbindungsverlust ist eine Niederlage nach Reconnect-Frist. Weil jeder sein
eigenes Brett simuliert, gibt es nichts zu synchronisieren: der Rejoin lädt
den eigenen Zustand aus dem letzten Snapshot plus die verpassten Sends.

**Kann ich in Modus B sehen, was der Gegner baut?**
HUD immer, Peek auf Wunsch, voller Zuschauermodus nie (24.5). Letzterer
kostet eine zweite Simulation und damit den Hauptvorteil des Modus.

**Was hindert jemanden daran, in Modus B sein Gold zu manipulieren?**
Der Server rechnet die Obergrenze exakt mit (24.4). Manipulation an Reichweite
oder Schaden auf dem eigenen Brett bleibt möglich und wird erst durch
nachträgliche Replay-Verifikation gefasst: bewusst nur für die Ladder-Spitze.

**Brauchen beide Spieler denselben Google-API-Key oder dieselben Tiles?**
Jeder lädt Tiles selbst; sie sind nach dem World Seal rein optisch. Die
Kostenfrage pro Client-Session bleibt die größte ungeklärte
Außenabhängigkeit (Abschnitt 9, Punkt 2).

**Muss das Match warten, bis alle Tiles geladen sind?**
Nein, genau das ist der Nebeneffekt des World Seal (25.5). Gameplay hängt
nach dem Seal nicht mehr an der Optik.

**Kann man Modus A allein oder zu zweit spielen?**
Ja, mit Bots auf den freien Lanes (27.1). Der `StrategyBot` existiert bereits;
das ist die günstigste Maßnahme im ganzen Konzept.

**Lohnt sich Matchmaking überhaupt bei kleiner Spielerzahl?**
Für Modus A nein: Lobby-Browser plus Join-Link reicht und ist ein Bruchteil
der Arbeit. Für Modus B ja, sobald es eine Ladder gibt, weil ungleiche
Paarungen dort direkt den Spaß kosten.

**Was ist der größte unterschätzte Aufwandsposten?**
Die Renderlast in Modus A (23.7). Die Netzwerkarbeit ist absehbar, die
Balance-Arbeit auch, aber "vier Lanes gleichzeitig flüssig darstellen" ist
eine offene Optimierungsaufgabe, deren Ergebnis die Spielerzahl bestimmt.
