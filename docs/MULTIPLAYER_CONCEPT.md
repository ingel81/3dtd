# Multiplayer-Konzept: PvE-Coop & PvP

> **Status:** Konzept / Entscheidungsvorlage — noch kein Code.
> **Stand:** 2026-08-26 · Branch `claude/multiplayer-pve-pvp-architecture-amu0x7`
>
> Bewertet den Ist-Zustand der Engine gegen die Anforderungen von
> Netzwerk-Multiplayer und schlaegt eine Architektur plus Ausbaureihenfolge vor.

---

## TL;DR

**Empfehlung: Deterministisches Lockstep mit Command-Relay** — nicht State-Replication.
Der Grund ist Entity-Scale: bei 10k+ Gegnern ist Zustandsuebertragung
bandbreitentechnisch tot (~3 MB/s), waehrend das gesamte Spieler-Input-Volumen
aus **7 Command-Events** besteht und pro Match unter 100 KB bleibt.

**Drei harte Blocker** stehen dem heute im Weg — alle loesbar, aber keiner trivial:

1. **Tower-LOS kommt aus GPU-Readbacks gegen gestreamte 3D-Tiles.** Zwei Clients
   sind sich nicht einig, was ein Turm sieht. → Host-autoritative LOS-Masken.
2. **Terrain-Hoehen kommen aus Raycasts gegen dieselben Tiles bei variabler LOD.**
   → World-Snapshot mit eingefrorenem Hoehenfeld ("World Seal").
3. **Ungeseedete `Math.random()` in ~6 Gameplay-Pfaden** plus ONNX-Wave-Director.
   → Seeded RNG + Wave-Schedules als Netzwerk-Command statt lokaler Berechnung.

**Guenstigster erster Modus ist nicht Coop, sondern "Versus Race"** (beide
verteidigen die *gleiche* Stadt gegen die *gleiche* Welle in getrennten Sims,
verglichen wird nur Leak/Score). Der braucht **kein** Lockstep und umgeht damit
alle drei Blocker — nur World-Snapshot und Wave-Schedule-Sharing.

---

## 1. Was die Engine heute schon mitbringt

Das ist ueberraschend viel. Der Umbau ist deutlich kleiner als bei einer
typischen Singleplayer-Codebase.

| Asset | Fundstelle | Warum es zaehlt |
|-------|-----------|-----------------|
| **Fixed-Timestep-Sub-Step-Loop** | `game-state.manager.ts:358` — `FIXED_STEP_MS = 16.667` | Die wichtigste Voraussetzung fuer Lockstep ist schon da. Gameplay laeuft bereits in festen Game-Time-Schritten, unabhaengig von der Framerate. |
| **Command-Bus mit exakt 7 Player-Commands** | `game-event-bus.ts` + `game-commands.handler.ts` | `place-tower`, `sell-tower`, `upgrade-tower`, `start-wave`, `start-research`, `cancel-research`, `restart-game`. Das ist die *komplette* Input-Oberflaeche — genau das, was ueber die Leitung muss. |
| **Command-Handler ist bereits vom Game-Loop-Owner getrennt** | `game-commands.handler.ts` | Der Netzwerk-Layer haengt sich zwischen Bus und Handler, ohne Manager anzufassen. |
| **Serialisierbares Strassennetz** | `pathfinding.worker.ts` — `SerializedStreetNetwork` | Das Format fuer den World-Snapshot existiert schon, inklusive Tests. |
| **WebSocket-Client-Praezedenz** | `ai/training/training-client.service.ts` | Reconnect, Message-Typing, Lifecycle — als Vorlage fuer den Netzwerk-Client wiederverwendbar. |
| **Deterministische Bewegung** | `movement.component.ts` | Gegner folgen vorberechneten Geo-Pfaden mit Prefix-Summen. Gleicher Pfad + gleicher Step = gleiche Position. |
| **Timescale-Konzept** | `trainingTimescale` | Muss im MP auf 1.0 gepinnt (oder mitsynchronisiert) werden — der Hebel dafuer existiert. |

---

## 2. Die drei Determinismus-Blocker

### 2.1 Tower-LOS ist GPU-abhaengig (der schwerste)

`global-route-grid.ts` fuellt `cell.towerVisibility` / `cell.airVisibility` ueber
einen `readRenderTargetPixels`-Pass gegen die Tower-Shadow-Cubemap
(`three-engine/tower-shadow-mapper.ts:360`). Der Combat-Hot-Path liest daraus
O(1) — also entscheidet ein **GPU-Roundtrip gegen gerade geladene Tile-Geometrie**
darueber, ob ein Turm schiessen darf.

Das ist pro Client verschieden: andere GPU, andere Tile-LOD zum Zeitpunkt des
Placements, andere Streaming-Reihenfolge. Zwei Clients simulieren garantiert
auseinander.

**Loesung: Host-autoritative LOS-Masken.**
Beim `place-tower`-Command rechnet **nur der Host** die Cubemap + Readback und
schickt die resultierende Maske mit dem bestaetigten Command mit. Alle Clients
uebernehmen sie, statt lokal zu samplen. Die lokale Preview beim Bauen bleibt
erlaubt — sie ist unverbindlich.

Bandbreite: Ein Turm mit 100 m Range deckt im 2-m-Grid (`CELL_SIZE = 2`,
`CORRIDOR_WIDTH = 7`) groessenordnungsmaessig ein paar tausend Zellen ab, 2 Bit
pro Zelle (Ground + Air) → **unter 1 KB roh, komprimiert ein paar hundert Byte**,
und das nur bei einem Bau-Event. Vollkommen unkritisch.

### 2.2 Terrain-Hoehen sind zeit- und LOD-abhaengig

`sampleCellY` schreibt `cell.terrainHeight` aus Terrain-Raycasts und verbessert
sie nach, wenn bessere Tile-LOD nachlaedt (`CellSample.tileDepth` /
`tileGeometricError`). Hoehen sind gameplay-relevant: Air-Targets sitzen bei
`terrainHeight + airSampleYOffset`, LOS haengt daran, Routen ebenso.

**Loesung: World Seal.**
Der Host wartet vor Match-Start, bis das Sampling stabil ist, serialisiert
`terrainHeight` pro Zelle in den World-Snapshot und friert danach die
Gameplay-Hoehen ein. Nachladende Tiles duerfen weiter die *Optik* verbessern,
aber nicht mehr die Simulation.

Groesse: 3 km Route × 7 m Korridor / 4 m² ≈ 5–6k Korridorzellen, plus
Tower-Radius-Zellen — realistisch 20–50k Zellen. Als Int16-Delta in cm:
**40–100 KB roh, gzip ~15–30 KB.** Einmaliger Download beim Join.

Netter Nebeneffekt: Das entschaerft die in `TODO.md` gelisteten
Stale-LOS-Bugs, weil Hoehen nach dem Seal nicht mehr still wandern.

### 2.3 RNG und ONNX

Gameplay-relevante `Math.random()`-Aufrufe (der Rest ist VFX und darf bleiben):

| Datei | Zeile | Wofuer |
|-------|-------|--------|
| `managers/enemy.manager.ts` | 169, 176 | Lateral-Offset, Speed-Varianz |
| `managers/wave.manager.ts` | 306 | Spawn-Point-Auswahl |
| `entities/enemy.entity.ts` | 197, 213, 246, 268 | Audio-Timing, Shuffle |
| `ai/core/spawn-schedule-builder.ts` | 81, 157 | Count-Jitter, Shuffle |

**Loesung:** Ein `DeterministicRng` (mulberry32/xorshift128, seed pro Match aus
dem Room) wird injiziert; VFX/Audio behalten `Math.random()`.

Der **ONNX-Wave-Director** ist prinzipiell nicht synchronisierbar (WASM- vs.
WebGPU-Backend liefern unterschiedliche Floats). **Loesung: Der Host laeuft die
Inferenz und broadcastet den fertigen Spawn-Schedule als Command.** Damit ist
der Director im MP automatisch konsistent — und PvP-Modus 3 (unten) faellt fast
als Nebenprodukt ab.

### 2.4 Restrisiko: Float-Determinismus ueber Browser hinweg

`+ - * /` und `sqrt` sind IEEE-754-exakt, aber `Math.sin/cos/atan2/pow` sind
implementierungsabhaengig. `haversineDistance` und Heading-Berechnung in
`geo-utils` / `movement.component.ts` nutzen Trigonometrie im Hot-Path.

Zwei Wege:
- **Sauber:** Gameplay-Distanzen auf die lokale Ebenen-Projektion umstellen
  (`METERS_PER_DEGREE_LAT` ist teilweise schon da) und Trig aus dem Sim-Pfad
  verbannen.
- **Pragmatisch (Empfehlung fuer v1):** "Soft Lockstep" — Divergenz per
  Checksum erkennen und mit einem Host-Snapshot korrigieren, statt sie
  auszuschliessen. Bei einem TD faellt eine 5-cm-Abweichung niemandem auf,
  solange sie nicht kumuliert.

---

## 3. Warum Lockstep und nicht State-Replication

| | Lockstep (Command-Relay) | State-Replication (Host schickt Entities) |
|---|---|---|
| Bandbreite bei 10k Gegnern | ~0 (nur bei Spieleraktion) | 10k × 16 B × 20 Hz ≈ **3,2 MB/s** |
| Latenz-Toleranz | Hoch (TD ist kein Twitch-Game, 150 ms Input-Delay unsichtbar) | Braucht Interpolation/Prediction |
| Determinismus noetig | **Ja** — die drei Blocker oben | Nein |
| Cheat-Resistenz v1 | Schwach (Divergenz-Detection faengt naive Cheats) | Ebenfalls schwach ohne echten Server |
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
  → Ausfuehrung bei allen exakt an netTick T+3   (≈ 200 ms Input-Delay)
```

200 ms Verzoegerung beim Turmbau ist in einem TD nicht wahrnehmbar — die
Bauanimation kaschiert es vollstaendig. Der Delay kann dynamisch an den
schlechtesten RTT im Raum angepasst werden.

### 4.2 Tick-Barriere

Die Sub-Step-Schleife in `game-state.manager.ts:404` laeuft heute frei bis
`MAX_SUBSTEPS_PER_FRAME`. Sie braucht ein Gate:

```ts
while (pendingMs >= FIXED_STEP_MS && steps < MAX) {
  if (this.net?.mustStallAt(this.currentNetTick)) break;  // NEU
  ...
}
```

`mustStallAt` ist `true`, solange nicht alle Peers ihre Inputs (auch leere) fuer
den naechsten Net-Tick bestaetigt haben. Ein haengender Client bremst damit den
Raum — deshalb: Host darf nach Schwellwert (z. B. 3 s) droppen, Rejoin ueber
Full-Snapshot.

### 4.3 Command-Pipeline

```
UI / Bot
   │  eventBus.emit('command:place-tower', …)
   ▼
NetworkCommandInterceptor        ← NEU, haengt vor GameCommandsHandler
   │  im MP: NICHT lokal ausfuehren, sondern an Relay senden
   ▼
Relay-Server (Room)
   │  stempelt netTick + seq, ordnet deterministisch (playerId, seq)
   ▼
alle Clients: NetworkCommandQueue
   │  fuehrt an netTick T aus, in stabiler Reihenfolge
   ▼
GameCommandsHandler  (unveraendert)
```

Wichtig: Auch der lokale Spieler geht durch den Relay ("delayed input"). Nur so
sind alle Clients in derselben Ausfuehrungsreihenfolge — Client-Side-Prediction
fuer Bauplatzierung lohnt den Aufwand hier nicht.

### 4.4 World-Snapshot ("Room-Welt")

Beim Room-Erstellen produziert der Host ein Paket, das alle Joiner laden —
statt selbst Overpass/Nominatim zu fragen (Overpass liefert nicht garantiert
identische Daten, und die Rate-Limits werden mit mehreren Clients unangenehm):

```
WorldSnapshot {
  version, seed, createdAt
  hq: LocationConfig, spawnPoints: LocationConfig[]
  streetNetwork: SerializedStreetNetwork      // Format existiert
  routes: GeoPosition[][]                      // vorberechnete Pfade
  routeGrid: { cellKeys: Int32Array, heights: Int16Array }   // World Seal
  balanceHash: string                          // Config-Fingerprint
}
```

`balanceHash` ist wichtig: Ein Client mit anderer Version der Tower-/Enemy-Configs
divergiert sofort. Beim Join gegen den Room-Hash pruefen, sonst ablehnen.

Google-3D-Tiles laedt jeder Client selbst — rein visuell, kein Gameplay-Input
(nach dem World Seal). API-Key-Nutzung pro Client ist hier der zu klaerende
Kosten-/ToS-Punkt, kein technischer.

### 4.5 Divergenz-Erkennung und Resync

Alle N Net-Ticks (z. B. 30 ≈ alle 2 s) sendet jeder Client eine Checksumme:

```
hash( gameTick, credits[], baseHealth, towerCount,
      Σ enemy.id ⊕ quantize(lat,lon,hp), waveNumber, rngState )
```

Bei Abweichung: Host schickt Full-State-Snapshot, abweichender Client laedt neu.
Das ist gleichzeitig **das Debug-Werkzeug**, das die ganze Umstellung ueberhaupt
handhabbar macht — ohne Checksums sucht man Divergenzen blind.

---

## 5. Spielmodi

### Modus A — "Versus Race" (PvP, gespiegelt) · **billigster Einstieg**

Beide Spieler verteidigen dieselbe Stadt gegen denselben Wellen-Schedule, aber
in **getrennten lokalen Simulationen**. Verglichen wird nur: wer haelt laenger,
wer leakt weniger, wer hat mehr Score.

- **Kein Lockstep, keine Tick-Barriere, keine Checksums.** Divergenz ist egal —
  niemand sieht die Sim des anderen.
- Braucht nur: World-Snapshot-Sharing + gemeinsamer Wave-Schedule + Score-Kanal.
- Umgeht **alle drei Determinismus-Blocker.**
- Ausbaustufe: **"Send a Rush"** — Gold ausgeben, um eine Extra-Gruppe in die
  Welle des Gegners zu injizieren (Klassiker aus TD-Wars). Kommt als
  zusaetzlicher Command-Typ durch denselben Kanal.
- Optional: kleines "Ghost"-Overlay mit HQ-HP und Wave des Gegners.

Das ist der Modus, den man zuerst baut. Er ist spielbar, bevor irgendein
Determinismus-Umbau angefasst wurde.

### Modus B — Coop-PvE (2–4 Spieler, geteilte Karte)

Alle bauen auf derselben Stadt, gemeinsames HQ.

Design-Entscheidungen (Vorschlag):

| Frage | Empfehlung | Begruendung |
|-------|-----------|-------------|
| Gold | **pro Spieler getrennt** | Verhindert Griefing und Leerkaufen; erzwingt Rollenbildung |
| HQ-Leben | **geteilt** | Das ist der Coop-Kern |
| Turm-Besitz | `Tower.ownerId`; **Verkaufen nur Besitzer**, Upgraden fuer alle (mit eigenem Gold) | Kein Griefing, trotzdem Kooperation moeglich |
| Research | **geteilt**, Kosten vom Ausloeser | Der Tech-Tree ist global; Doppelforschung waere Unsinn |
| Wave-Start | jeder darf, aber **Bestaetigung** oder Countdown | Sonst startet einer vorzeitig |
| Kill-Credit | Schaden-anteilig | Sonst gewinnt der Splash-Turm alles |

Braucht das volle Lockstep-Programm aus Abschnitt 4.

Grosser Refactor-Punkt: `credits` ist heute ein einzelnes Signal in
`game-state.manager.ts:105`. Muss zu `players: Map<PlayerId, PlayerEconomy>`
werden, wobei Singleplayer schlicht ein Spieler mit `localPlayerId` ist.

### Modus C — Asymmetrisch: Angreifer vs. Verteidiger · **das eigentlich spannende**

Ein Spieler baut Tuerme. Der andere **ist der Wave-Director**: kauft von einem
Angriffsbudget Gegnergruppen, waehlt Zusammensetzung, Spawn-Punkt und Timing.

Der Clou: **Die Action-Space dafuer existiert bereits.** Der ONNX-Wave-Director
arbeitet in `ai/wave-director/` genau mit diesen Groessen (Range-Based Templates,
Spawn-Schedules, Constraints — siehe `docs/PHASE_5.11_RANGES.md`). Ein
Angreifer-UI ist im Kern ein Human-Frontend fuer die gleiche Action-Space, mit
den gleichen Constraints als Balance-Leitplanke.

Nebeneffekt: Das trainierte Modell wird zum **Bot-Gegner** fuer diesen Modus und
zum Balance-Massstab ("schlaegst du die AI auf Level 5?").

Netzwerktechnisch ist das der einfachste PvP-Modus ueberhaupt — der Angreifer
schickt Wave-Schedules, ansonsten laeuft eine einzige Sim beim Verteidiger.
Der Angreifer ist ein Zuschauer mit Kaufmenue. Kein Lockstep noetig, wenn der
Verteidiger-Client autoritativ ist.

---

## 6. Konkrete Code-Aenderungen

Grob nach Aufwand sortiert, mit Dateibezug:

**Determinismus-Fundament (nutzt auch Singleplayer: Replays, Bug-Repro, AI-Training)**
1. `DeterministicRng` + Injection in die 4 Gameplay-Dateien aus 2.3
2. World Seal: `terrainHeight`-Freeze + Serialisierung — `utils/global-route-grid.ts`
3. Voller Game-State-Serializer (fuer Rejoin/Resync) — faellt mit Save/Load zusammen
4. Checksum-Funktion + Divergenz-Log

**Netzwerk-Layer (neu, `src/app/net/`)**
5. `NetworkClient` (WS, Reconnect) — Vorlage: `ai/training/training-client.service.ts`
6. `NetworkCommandInterceptor` + `NetworkCommandQueue` (Tick-Stempel, stabile Ordnung)
7. Tick-Barriere in `game-state.manager.ts:404`
8. `WorldSnapshot`-Serializer/Loader
9. Host-LOS-Masken-Pfad in `services/tower-placement.service.ts` + `global-route-grid.ts`

**Gameplay-Umbau**
10. Per-Spieler-Oekonomie: `credits`-Signal → `Map<PlayerId, PlayerEconomy>`
11. `Tower.ownerId` + Besitzregeln im `GameCommandsHandler`
12. Wave-Schedule als Command statt lokaler ONNX-Inferenz
13. `trainingTimescale` im MP pinnen

**UI**
14. Lobby (Room-Code, Spielerliste, Ready-State, Balance-Hash-Check)
15. Besitzer-Faerbung, Spieler-HUD, Ping/Marker, minimaler Chat
16. Verbindungs-Status, Desync-Feedback, Rejoin-Screen

**Backend (neu, `multiplayer-server/`)**
17. Relay: Rooms, Tick-Broadcast, Snapshot-Ablage. **In v1 ohne Spiellogik.**

---

## 7. Infrastruktur

| Baustein | Empfehlung | Alternative |
|----------|-----------|-------------|
| Transport | **WebSocket-Relay** | WebRTC DataChannel: spart Server-Traffic, braucht aber trotzdem Signaling **und** TURN — mehr Teile, nicht weniger |
| Server | Node/Bun + `ws`, ~500 LOC fuer v1 | Cloudflare Durable Objects / PartyKit: Room-Modell out of the box, praktisch kostenlos bei kleiner Nutzerzahl |
| Snapshot-Ablage | Ueber den Room-Server (ein paar zehn KB) | Object-Storage bei groesseren Welten |
| Identitaet | **Room-Code, keine Accounts** in v1 | Persistente Profile/Ranglisten brauchen echtes Backend + DSGVO-Betrachtung |
| Anti-Cheat | v1: Vertrauen + Divergenz-Detection | Echter Schutz erst mit server-autoritativer Sim — bewusst out of scope |

Das kollidiert mit "kein Backend im Spiel-Client" aus `CLAUDE.md` — das ist die
grundlegende Architekturentscheidung, die hier bewusst getroffen werden muss.
Der Relay bleibt aber logikfrei: Das Spiel laeuft weiterhin komplett im Client.

---

## 8. Vorgeschlagene Reihenfolge

| Phase | Inhalt | Liefert | Grober Aufwand |
|-------|--------|---------|----------------|
| **0** | Relay-Server, Lobby, World-Snapshot-Sharing | Zwei Clients in derselben Welt | S–M |
| **1** | **Versus Race** + Send-a-Rush | Erster spielbarer PvP-Modus, ohne Determinismus-Umbau | S |
| **2** | Determinismus-Fundament (RNG, World Seal, Serializer, Checksums) | Auch SP-Gewinn: Replays, reproduzierbare Bugs, sauberes AI-Training | **L — das Herzstueck** |
| **3** | Lockstep + Per-Spieler-Oekonomie + Besitz → **Coop-PvE** | Der Modus, den die meisten erwarten | L |
| **4** | **Angreifer vs. Verteidiger** ueber die Wave-Director-Action-Space | Der eigenstaendigste Modus, hohe Wiederverwendung | M |

Phase 2 ist der eigentliche Brocken — und der einzige Teil, der sich auch dann
lohnt, wenn Multiplayer nie kommt.

---

## 9. Offene Entscheidungen

1. **Backend ja/nein** — kippt eine Kernpraemisse des Projekts (siehe 7).
2. **Google-3D-Tiles-Kosten und ToS** bei mehreren gleichzeitigen Clients pro
   Match. Rein wirtschaftlich/rechtlich, nicht technisch.
3. **Wie streng?** Hartes Lockstep (Trig aus dem Sim-Pfad verbannen) vs. Soft
   Lockstep mit Resync. Empfehlung: soft starten, bei Bedarf haerten.
4. **Spielerzahl-Obergrenze im Coop** — die Tick-Barriere macht jeden zusaetzlichen
   Spieler zu einem potenziellen Bremsklotz. 4 ist ein vernuenftiges Limit.
5. **Wave-Director im MP:** Host-Inferenz oder statisches Curriculum
   (`configs/wave-curriculum.config.ts`)? Statisch ist fairer und einfacher,
   Host-Inferenz ist interessanter.
6. **Performance-Budget:** Der Client rendert heute schon am Limit. Ein zweiter
   Spieler bringt kaum Sim-Kosten (Lockstep), aber Tick-Stalls machen
   Frame-Drops beim Peer sichtbar.

---

## 10. Empfehlung in einem Satz

Mit **Phase 0 + 1 (Versus Race)** anfangen — das ist in ueberschaubarer Zeit
spielbar, beweist die Infrastruktur und braucht keinen der drei
Determinismus-Blocker geloest. **Phase 2** danach als eigenstaendiges
Engine-Projekt fahren, weil es unabhaengig vom Multiplayer wertvoll ist. Coop
erst, wenn Checksums gruen bleiben.

---

# Teil II — Das volle Programm: echter Server

> Nachtrag zur Frage "was braeuchte man fuer einen richtigen Server?".
> Abschnitt 7 hatte server-autoritative Simulation bewusst ausgeklammert —
> hier steht, was sie tatsaechlich kostet.

"Server" meint zwei unabhaengige Dinge, die oft vermischt werden:

- **A — Autoritative Simulation:** Der Server rechnet das Spiel und ist die
  Wahrheit. Loest Cheating.
- **B — Online-Dienst:** Accounts, Matchmaking, Ladder, Replays, Live-Ops,
  Betrieb. Loest "es fuehlt sich nach Produkt an".

Man braucht beides fuer das volle Programm, aber sie sind getrennt baubar und
unterschiedlich teuer. B ist mehr Arbeit als A — und vor allem **dauerhafte**
Arbeit.

---

## 11. Teil A — Headless-Simulation

### 11.1 Die gute Nachricht

Die Sim ist deutlich naeher an lauffaehig-in-Node als erwartet:

| Schicht | Kopplung | Bewertung |
|---------|----------|-----------|
| `entities/`, `game-components/` | **keine** Three.js-Importe | laeuft sofort in Node |
| `managers/enemy|tower|projectile` | nur `Vector3` aus three | reine Mathe, kein WebGL noetig |
| `managers/*` | nur `signal` aus `@angular/core` | funktioniert in Node; sauberer waere ein 30-Zeilen-Signal-Shim |
| `game-state.manager.ts` | `Injectable`/`inject`/`effect` | einziger echter DI-Knoten — auf Konstruktor-Injektion umbauen |
| `utils/global-route-grid.ts` | `CoordinateSync`, `ColumnSampler`, `gpu-cube-resolve` | **die Bruchstelle** |

Es blockieren also drei konkrete Dinge, nicht "das ganze Rendering":

1. **Angular-DI im `GameStateManager`** → Plain-TS-Konstruktor mit expliziter
   Verdrahtung. Der Client injiziert weiterhin per DI, der Server konstruiert
   direkt.
2. **`tilesEngine`-Aufrufe** — schon `| null`, aber `advanceTurretAim()` ist
   gameplay-relevant (Turret-Alignment gated das Feuern, siehe
   `game-loop-facade.service.ts:454`). Muss aus dem Renderer in die Sim-Schicht
   wandern; der Renderer liest die Rotation dann nur noch ab.
3. **Occlusion** — siehe 11.2. Das ist die eigentliche Entscheidung.

Struktureller Umbau: ein plattformneutrales `src/app/sim/` (oder eigenes
Workspace-Paket), das Client **und** Server konsumieren. Kein Angular, kein
Three ausser Vektor-Mathe, keine Browser-APIs.

### 11.2 Der Kern: Occlusion ohne GPU

Der Server hat keine 3D-Tiles und keine GPU. Damit faellt die heutige
LOS-Pipeline weg. Drei Wege:

**Weg 1 — OSM-Gebaeudemodell als Gameplay-Wahrheit** ← Empfehlung

`BuildingFootprint { id, type, levels, nodes }` wird **bereits geholt**
(`services/location/osm-street.service.ts:30`) und gerendert
(`services/world/building-rendering.service.ts`, `levels × METERS_PER_LEVEL`).
Daraus laesst sich ein CPU-Occlusion-Modell bauen: extrudierte Polygonprismen,
LOS als Segment-vs-Prisma-Test, Bodenhoehe aus grobem DEM oder aus dem
Strassennetz interpoliert.

- Deterministisch, serverfaehig, versionierbar, klein (ein paar hundert KB pro
  Stadt), CPU-guenstig mit einem 2D-Index ueber die Grundrisse.
- Loest gleichzeitig **alle drei Determinismus-Blocker aus Teil I** — der
  World Seal wird zum blossen Ausliefern des Gebaeudemodells.
- **Preis:** Gameplay-Sichtlinie weicht sichtbar von der Optik ab. Baeume,
  Brueckenkonstruktionen, unregelmaessige Daecher, alles was OSM nicht kennt,
  blockt dann nicht mehr — und `building:levels` fehlt in vielen Gegenden
  (Default 2 im Code) und ist ohnehin nur eine Naeherung.

Das ist ein **Game-Design-Preis, kein technischer**: Man tauscht "Sichtlinie
stimmt exakt mit dem Bild" gegen "Sichtlinie ist erklaerbar, fair und ueberall
gleich". Fuer kompetitives PvP ist das ohnehin die richtige Richtung — heute
kann derselbe Turm bei zwei Spielern unterschiedlich schiessen, je nachdem
welche Tile-LOD beim Bauen geladen war.

**Weg 2 — Server rendert mit** (Headless-GL, SwiftShader oder GPU-Instanz)

Technisch machbar, aber: Tiles-Traffic pro Match auf Serverseite,
Google-ToS-Frage, GPU-Instanzen kosten ein Vielfaches, und die
LOD-Nichtdeterminismus-Frage kommt durch die Hintertuer zurueck. **Nicht
empfohlen.**

**Weg 3 — Precompute-Service (Bake-Pipeline)**

Ein Batch-Job baked pro Stadt einmal ein Hoehen- und Occlusion-Feld aus den
3D-Tiles und legt es in Object Storage. Server und Clients laden dasselbe
Artefakt. Exakt passend zur Optik, deterministisch, ohne GPU zur Laufzeit.
Kosten: Bake-Pipeline, Storage, Invalidierung bei Tile-Updates — und ein Match
in einer ungebakten Stadt muss warten oder auf Weg 1 zurueckfallen.

**Realistischer Pfad: Weg 1 jetzt, Weg 3 spaeter fuer Ranked-Karten.**

### 11.3 Was der Server repliziert — nicht Entities

Volle Entity-Replikation bleibt bei 10k Gegnern tot (Rechnung in Abschnitt 3).
Der autoritative Server ist deshalb kein State-Broadcaster, sondern ein
**autoritativer Lockstep-Peer**:

- Er ordnet Commands, vergibt Tick-Nummern, haelt den RNG-Seed, rechnet
  Wave-Schedules, verteilt LOS-Masken.
- Er laeuft dieselbe Sim als **Schattenrechnung** und vergleicht Checksums.
- Clients simulieren und rendern weiterhin selbst.
- Nur bei Divergenz: Full-Snapshot-Korrektur, im Wiederholungsfall Kick.

Cheat-Erkennung heisst dann "Client weicht von der Serverwahrheit ab" — und das
faengt genau die Klasse, die zaehlt: Gold, Baukosten, Platzierungsregeln,
Reichweiten, Wellenmanipulation. Was es **nicht** faengt, sind reine
Informations-Cheats (Wallhack-Aequivalente), weil jeder Client ohnehin den
vollen Zustand kennt. Bei einem TD ist das akzeptabel.

### 11.4 Serverkosten der Sim — eine Mess-, keine Schaetzaufgabe

Die Sim ist single-threaded und laeuft mit 60 Hz Game-Time. Ein Node-
Worker-Thread pro Match, Matches pro vCPU muss **gemessen** werden. Die
Werkzeuge dafuer existieren bereits im Repo:

- `PerformanceProfilerService` misst die Sub-Step-Anteile getrennt
  (`tProjectile`, `tCombat`, `tEvents`, `tTower`).
- Der Bot-Modus mit `trainingTimescale` spielt ganze Matches im Zeitraffer —
  ein 20-Minuten-Match bei 75× dauert 16 Sekunden.
- `renderingEnabled = false` (Phase 5.14) trennt Sim-Zeit von Render-Zeit
  bereits sauber.

Wichtig fuer die Erwartungshaltung: Der Client ist heute **GPU-limitiert, nicht
sim-limitiert**. Ohne Rendering ist ein Match erheblich billiger, als das
Spielgefuehl vermuten laesst.

---

## 12. Teil B — Der Dienst drumherum

| Baustein | Was konkret | Aufwand |
|----------|-------------|---------|
| **Identitaet** | OAuth ueber Google/Discord statt eigener Passwoerter — spart Sicherheits- und DSGVO-Aufwand erheblich | S |
| **Persistenz** | Postgres (Profile, Matches, Ladder, Freunde), Object Storage (Snapshots, Replays) | M |
| **Matchmaking** | Queue, ELO/Glicko, Regionswahl, Party-Handling | M |
| **Replays** | Command-Log + Seed + Snapshot-Referenz = vollstaendiges Replay. **Faellt bei Lockstep gratis ab** und ist gleichzeitig Anti-Cheat-Beweismittel und Balance-Werkzeug | S |
| **Live-Ops** | Balance-Configs serverseitig ausliefern, `balanceHash` erzwingen, Versions-Gate, Wartungsfenster | M |
| **Observability** | Ticks/s, Desync-Rate, RTT-Verteilung, strukturierte Logs, Alerting, automatischer Replay-Upload bei Divergenz | M |
| **Skalierung** | Room-Allocator, Autoscaling, Region-Auswahl (EU zuerst), Session-Affinitaet | M |
| **Ausfallsicherheit** | Reconnect-Fenster, Match-Wiederaufnahme, Graceful Drain beim Deploy | M |
| **Sicherheit** | Token-Rotation, Rate-Limits, serverseitige Input-Validierung, DDoS-Schutz vor dem Room-Server | M |
| **Recht & Betrieb** | DSGVO (AVV, Loeschkonzept, Datenschutzerklaerung), ToS, Namens-/Chat-Moderation | M, laeuft nie aus |
| **Google-3D-Tiles** | Kosten pro Client-Session und ToS in einem kommerziellen Multiplayer-Dienst | **groesste unbekannte Aussenabhaengigkeit** |
| **CI/CD & Lasttest** | Server-Pipeline, Staging, synthetische Last — **der `StrategyBot` ist bereits ein fertiger Lastgenerator** | S–M |

### Der ehrliche Teil

Teil B ist kein Feature, sondern Dauerbetrieb. Nach dem Launch frisst er
kontinuierlich Zeit — Deploys, Missbrauch, Support, Kostenkontrolle — waehrend
am Spiel selbst nichts vorangeht. Das ist die eigentliche Entscheidung, nicht
die Technikwahl.

---

## 13. Staffelung: vier Server-Stufen

| Stufe | Was der Server tut | Cheat-Schutz | Aufwand |
|-------|--------------------|--------------|---------|
| **S1 — Relay** (Teil I) | Nur Weiterleiten, Rooms, Tick-Stempel | keiner | S |
| **S2 — Validierend** | Keine Sim, aber Regelpruefung: Gold, Baukosten, Cooldowns, Platzierungsregeln. Plus Seed, Wave-Schedules, LOS-Masken | **faengt naives Cheating fast vollstaendig** | M |
| **S3 — Schatten-Sim** | Volle Sim als Wahrheit, Checksum-Vergleich, Snapshot-Korrektur | echte Autoritaet | L, **braucht die Occlusion-Entscheidung** |
| **S4 — Voller Dienst** | Accounts, Ladder, Replays, Live-Ops, Betrieb | — | L, dauerhaft |

**S2 ist das beste Preis-Leistungs-Verhaeltnis im ganzen Konzept:** rund
90 % des realistischen Cheatings zu einem Bruchteil der Kosten einer
Server-Sim, ohne dass irgendetwas headless laufen muss. Wer nicht Ranked-PvP
mit Preisgeld plant, kann bei S2 stehenbleiben.

**Der eigentliche Fork im Projekt ist 11.2:** OSM-Gebaeudemodell statt
GPU-Occlusion als Gameplay-Wahrheit. Diese Entscheidung faellt einmal und
bestimmt danach, ob S3 ueberhaupt erreichbar ist — sie ist gleichzeitig die
Loesung fuer alle drei Determinismus-Blocker aus Teil I und fuer die
Stale-LOS-Bugs in der `TODO.md`. Sie kostet aber die exakte Uebereinstimmung
von Sichtlinie und Stadtbild.
