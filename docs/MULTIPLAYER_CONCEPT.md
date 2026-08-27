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

> **Entscheidung gefallen (2026-08-26): Die Simulation bleibt vollstaendig im
> Client.** Der Server vermittelt, verwaltet und ueberwacht — er rechnet nicht.
> Damit sind die Stufen S3/S4 aus Abschnitt 13 **verworfen**, und die
> Occlusion-Grundsatzfrage aus 11.2 ist **nicht mehr blockierend** (siehe
> Teil III, Abschnitt 21). Teil II bleibt als Bewertung der verworfenen
> Alternative stehen — die Aufwandsgegenueberstellung ist weiterhin die
> Begruendung fuer die Entscheidung.


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

---

# Teil III — Der Server, den wir tatsaechlich bauen

> **Praemisse:** Die Simulation laeuft auf jedem Client. Der Server ist
> Vermittlung, Matchmaking, Verwaltung und Ueberwachung — **niemals Rechner**.
> Das entspricht S1+S2 aus Abschnitt 13, ohne S3/S4.

Der Leitsatz dahinter: **Der Server ist das Gedaechtnis des Matches, nicht sein
Gehirn.** Er ordnet, speichert und verteilt — und genau daraus ergeben sich
Faehigkeiten, die ein reiner Weiterleiter nicht haette (Host-Migration,
Rejoin, Replays, Desync-Forensik).

---

## 14. Rollenverteilung

Drei Rollen, klar getrennt. "Host" ist **ein Client mit Sonderaufgaben**, kein
Serverprozess.

| | **Server** | **Host-Client** | **Peer-Client** |
|---|---|---|---|
| Simulation | — | ja (wie alle) | ja |
| Rendering | — | ja | ja |
| Command-Reihenfolge & Tick-Nummern | **besitzt** | — | — |
| RNG-Seed, Match-ID | **besitzt** | — | — |
| World-Snapshot (Strassen, Routen, World Seal) | speichert & verteilt | **erzeugt** | laedt |
| LOS-Masken beim Turmbau | speichert & verteilt | **rechnet (GPU)** | uebernimmt |
| Wave-Schedule (ONNX oder Curriculum) | speichert & verteilt | **rechnet** | uebernimmt |
| Regelpruefung der Commands | **fuehrt aus** | — | — |
| Checksum-Sammlung & Quorum | **fuehrt aus** | meldet | meldet |
| Match-Ergebnis, Ladder | **besitzt** | meldet | meldet |

Der Host ist damit die einzige Stelle, an der GPU-abhaengige Groessen entstehen —
und weil der Server **jede** davon zwischenspeichert, sind sie ab dem Moment der
Verteilung serverseitige Wahrheit. Das ist der Trick, der die
Determinismus-Blocker aus Teil I entschaerft, ohne dass der Server rechnen muss.

---

## 15. Server-Komponenten

Acht Bausteine. Die ersten vier sind das Minimum fuer ein spielbares Match, die
letzten vier machen daraus einen Dienst.

### 15.1 Gateway & Session (Minimum)
- Verbindungsannahme, Auth-Token, Heartbeat, Reconnect-Fenster.
- **Versions-Gate:** Client-Build-Hash **und** `balanceHash` (Fingerprint ueber
  `configs/`) muessen zum Room passen. Ein Client mit abweichenden
  Tower-/Enemy-Configs divergiert sofort — hier abzulehnen ist billiger als
  jede spaetere Desync-Analyse.
- *Macht nicht:* eigene Passwoerter. OAuth (Google/Discord) oder in v1 gar
  nichts ausser einem anonymen Gast-Token.

### 15.2 Room-Service (Minimum)
- Room anlegen/beitreten per Code, Spielerliste, Ready-States, Modusauswahl,
  Kick, Room-Lifecycle.
- Haelt die Host-Zuweisung und faellt bei Host-Verlust auf einen Peer zurueck
  (siehe 19).

### 15.3 Tick-Relay (Minimum, das Herzstueck)
- Nimmt Commands entgegen, stempelt `(netTick, playerId, seq)`, ordnet
  **deterministisch** (stabil nach `playerId`, dann `seq`) und faechert an alle
  aus — inklusive an den Absender.
- Verwaltet den Input-Delay (Default 3 Net-Ticks ≈ 200 ms) und passt ihn an den
  schlechtesten RTT im Raum an.
- Sammelt leere Tick-Bestaetigungen, erkennt haengende Clients, setzt
  Stall-Warnungen ab und dropt nach Schwellwert.
- *Macht nicht:* Spiellogik. Er weiss, dass ein `place-tower` durchgeht, nicht
  ob der Turm dort sinnvoll steht.

### 15.4 Artefakt-Store (Minimum)
- Nimmt vom Host `WorldSnapshot`, LOS-Masken und Wave-Schedules entgegen,
  speichert sie unter der Match-ID und liefert sie an Joiner, Rejoiner und
  neue Hosts aus.
- Groessenordnung pro Match: Snapshot 15–30 KB gzip, Masken einige hundert Byte
  pro Turm, Schedules ein paar KB. **Ein Match passt bequem in ein einzelnes
  Objekt von unter einem Megabyte.**

### 15.5 Validator ("Ueberwachung", Stufe S2)
Fuehrt ein **schlankes Spiegelmodell** des Matchzustands — Turmliste mit
Besitzer und Level, Research-Stand, Gold-Ledger pro Spieler, Wellennummer,
Phase. Das ist Buchhaltung, keine Simulation: es aktualisiert sich bei
Command-Events (wenige pro Minute), nicht pro Frame.

Damit pruefbar:
- Existiert der Turm? Gehoert er dem Absender? (`sell`, `upgrade`)
- Stimmt der Preis gegen die Server-Config? Reicht das gebuchte Gold?
- Ist das Upgrade-Tier per Research freigeschaltet? (Spiegel der Tier-Logik aus
  `game-commands.handler.ts`)
- Sind Research-Voraussetzungen erfuellt, laeuft schon eine Forschung?
- Passt der Bauplatz in den Room-Snapshot (Zelle existiert, nicht belegt)?
- Plausibilitaets- und Rate-Limits: Commands pro Sekunde, Tuerme pro Welle.

Nicht pruefbar (und das ehrlich benennen): alles, was aus der Sim kommt —
Reichweite, Sichtlinie, Schaden, Kill-Zuordnung. **Und damit auch die
Gold-Einnahmen**, denn die entstehen aus Kills. Der Server kennt Ausgaben
exakt, Einnahmen nur aus Client-Meldungen. Dagegen hilft nur 15.6.

### 15.6 Desync-Waechter (Ueberwachung, Teil 2)
- Sammelt alle 30 Net-Ticks die Client-Checksums (Abschnitt 4.5).
- **Ab drei Spielern echte Autoritaet per Quorum:** Wenn 3 von 4 uebereinstimmen,
  ist der Ausreisser falsch — der Server ordnet einen Snapshot-Reload an, im
  Wiederholungsfall Kick. Damit bekommt Coop echte Cheat-Resistenz, **ohne dass
  der Server simuliert.**
- Bei zwei Spielern gibt es kein Quorum: dann entscheidet der Host, und das
  Match wird als "unverifiziert" markiert.
- Jede Divergenz zieht automatisch beide Command-Logs und den Snapshot in die
  Forensik-Ablage. Das ist gleichzeitig **das Debugging-Werkzeug** fuer den
  gesamten Determinismus-Umbau.

### 15.7 Matchmaking & Ladder (Dienst)
- Queue pro Modus, Rating (Glicko-2), Regionswahl, Party-Handling,
  Reconnect-Vorrang.
- Ergebnisannahme: Wer hat gewonnen, wie viele Leaks, welche Welle. Bei
  Ranked-Modi nur akzeptieren, wenn der Desync-Waechter das Match als sauber
  markiert hat.

### 15.8 Telemetrie & Ops (Dienst)
- Metriken: Ticks/s pro Room, Stall-Haeufigkeit, RTT-Verteilung, Desync-Rate
  pro Client-Version, Abbruchgruende.
- Admin-Sicht auf laufende Rooms — im Kern dasselbe wie das bestehende
  Training-Dashboard.
- Alerting auf Desync-Rate: Ein Anstieg nach einem Deploy bedeutet fast immer,
  dass eine Balance- oder Sim-Aenderung den Determinismus gebrochen hat.

---

## 16. Protokoll

Ein einziger WebSocket pro Client. JSON reicht — das Volumen ist winzig; Binaer
nur fuer Masken und Snapshot (als separater HTTP-Download, nicht durch den
Socket).

| Richtung | Nachricht | Inhalt |
|----------|-----------|--------|
| C→S | `hello` | Token, Client-Build-Hash, `balanceHash`, Region |
| C→S | `room:create` / `room:join` / `room:leave` / `room:ready` | Modus, Room-Code |
| C→S | `world:publish` | *(nur Host)* Snapshot-Upload → gibt Artefakt-URL zurueck |
| C→S | `command` | Command-Typ + Payload (die 7 aus `game-event-bus.ts`) |
| C→S | `tick:ack` | Net-Tick bestaetigt, auch ohne Input |
| C→S | `los:publish` | *(nur Host)* Turm-ID + Masken-Blob |
| C→S | `wave:publish` | *(nur Host)* Wellennummer + Spawn-Schedule |
| C→S | `checksum` | Net-Tick + Hash |
| C→S | `result` | Ergebnis am Matchende |
| S→C | `room:state` | Spielerliste, Host, Ready-States, Modus |
| S→C | `match:start` | Match-ID, Seed, Artefakt-URLs, Startzeitpunkt, Input-Delay |
| S→C | `tick` | Net-Tick + geordnete Commandliste (leer, wenn nichts passiert) |
| S→C | `los` / `wave` | Weitergereichte Host-Artefakte |
| S→C | `stall` | Wer haengt, wie lange |
| S→C | `desync` | Snapshot-Reload angeordnet, Grund |
| S→C | `host:changed` | Neuer Host, ab welchem Tick |
| S→C | `error` | Command abgelehnt + Grund (Validator) |

Ein abgelehntes Command ist **kein Fehlerfall im Client, sondern der Normalfall
bei Latenz** (zwei Spieler kaufen gleichzeitig, das Gold reicht nur einmal). Die
UI muss das als "Kauf fehlgeschlagen" darstellen koennen, nicht als Absturz.

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

Command-Log + Seed + Snapshot-Referenz sind zusammen **das vollstaendige
Match**. Bei Lockstep faellt das ohne Zusatzaufwand an — es ist derselbe Strom,
den das Relay ohnehin durchreicht.

Was daraus wird, kann spaeter entschieden werden:
- **Replay-Wiedergabe** im Client (kostet nur UI).
- **Zuschauermodus** — ein Client, der den Tick-Strom live mitliest.
- **Nachtraegliche Verifikation** fuer Ranked: Ein Verifizierer spielt den Log
  nach und vergleicht das Ergebnis. Das braucht irgendwann doch eine
  headless-faehige Sim — aber **asynchron, ausserhalb des Matches, nur fuer die
  Spitze der Ladder**, und ohne dass ein Live-Server je simulieren muesste.
- **Balance-Analyse** ueber echte Matches statt nur ueber Bot-Laeufe.

**Deshalb: den Log von Tag eins an speichern, auch wenn ihn zunaechst niemand
liest.** Er kostet Kilobytes und haelt jede dieser Optionen offen. Nachtraeglich
laesst sich das nicht rekonstruieren.

---

## 19. Host-Migration

Weil der Server jede Host-Ausgabe zwischenspeichert (Snapshot, alle bisherigen
LOS-Masken, alle Wave-Schedules), ist der Host austauschbar:

1. Host-Verbindung bricht ab.
2. Relay pausiert den Tick-Vorlauf.
3. Server ernennt den Peer mit der besten Verbindung, sendet `host:changed`.
4. Der neue Host uebernimmt ab dem naechsten Bau-/Wellen-Event; alle bereits
   verteilten Artefakte bleiben gueltig.

Einschraenkung, die man kennen muss: Der neue Host rechnet kuenftige LOS-Masken
auf **seiner** GPU mit **seinem** Tile-Ladezustand. Die Masken aus der ersten
Haelfte des Matches stammen also von einer anderen Maschine als die aus der
zweiten. Fuer die Konsistenz zwischen Clients ist das egal — alle bekommen
dieselben Masken. Es kann nur bedeuten, dass zwei baugleiche Tuerme
unterschiedlich sehen, je nachdem wann sie gebaut wurden. Fuer Coop
verschmerzbar, fuer Ranked-PvP ein Argument, den Host dort nicht zu wechseln
sondern das Match abzubrechen.

---

## 20. Technik und Betrieb

**Sprache: TypeScript**, obwohl Python im Projekt etabliert ist
(`training-backend/server.py`, 1041 Zeilen, mit Multi-Client-Handling und
Broadcast — die Vorlage waere da).

Der Grund ist nicht Geschmack, sondern **geteilte Typen**: Das Relay muss die
`GameEvent`-Union und die Config-Werte kennen, um Commands zu validieren
(15.5). In TypeScript ist das ein Import aus dem bestehenden Code; in Python
ist es eine handgepflegte Zweitfassung, die bei jeder Balance-Aenderung still
auseinanderlaeuft — und genau das ist die Fehlerklasse, die Desyncs erzeugt.

| Aspekt | Empfehlung |
|--------|-----------|
| Runtime | Node oder Bun + `ws`, ein Prozess, Rooms im Speicher |
| Alternative | Cloudflare Durable Objects / PartyKit — Room-Modell und Persistenz eingebaut, bei kleiner Nutzerzahl praktisch kostenlos, kein Betrieb |
| DB | Postgres, erst ab Matchmaking noetig — v1 laeuft ohne |
| Storage | S3-kompatibel (R2 ist am guenstigsten) |
| Region | EU zuerst; ein zweiter Standort erst bei echtem Bedarf |
| Deploy | Container, Graceful Drain (laufende Matches nicht mittendrin kappen) |
| Lasttest | **`StrategyBot` als synthetischer Spieler** — der Lastgenerator existiert bereits |

**Ressourcenbedarf:** Ein Room kostet ein paar Kilobyte Speicher und
Nachrichten-Fan-out im niedrigen zweistelligen Hertz-Bereich. Kein Rechnen,
keine GPU, kein Zustand pro Frame. Hunderte gleichzeitige Matches auf einer
kleinen Instanz sind realistisch — der begrenzende Faktor wird lange die
Anzahl offener Sockets sein, nicht CPU.

---

## 21. Was durch diese Entscheidung wegfaellt

Gegenueber Teil II entfaellt ersatzlos:

- Der Headless-Refactor der Sim (Angular-DI, Turret-Aim aus dem Renderer,
  plattformneutrales `sim/`-Paket).
- **Der Zwang zum OSM-Gebaeudemodell.** Die Occlusion-Frage aus 11.2 war nur
  deshalb blockierend, weil ein Server ohne GPU LOS rechnen muesste. Da der
  Host-Client eine GPU hat, bleibt die bestehende Cubemap-Pipeline die
  Gameplay-Wahrheit — sie wird nur einmal statt N-mal ausgewertet. Der
  Design-Preis (Sichtlinie passt nicht mehr zum Stadtbild) entfaellt damit.
- GPU-Instanzen, Sim-Kosten pro Match, Server-Tickrate als Skalierungsgrenze.

Bestehen bleibt aus Teil I unveraendert:
- Seeded RNG (2.3) — der Seed kommt jetzt vom Server statt vom Host.
- World Seal (2.2) — erzeugt vom Host, verteilt vom Server.
- Tick-Barriere im Sub-Step-Loop (4.2).
- Per-Spieler-Oekonomie und `Tower.ownerId` (Abschnitt 6, Punkte 10–11).

---

## 22. Reihenfolge

| Stufe | Server-Umfang | Client-Umfang | Ergebnis |
|-------|---------------|---------------|----------|
| **1** | Gateway, Room-Service, Artefakt-Store | Lobby-UI, Snapshot-Publish/Load | Zwei Clients in derselben Welt — **Versus Race spielbar** |
| **2** | Tick-Relay, Checksum-Sammlung | Netzwerk-Interceptor, Tick-Barriere, seeded RNG | Lockstep laeuft — **Coop spielbar** |
| **3** | Validator, Desync-Waechter, Host-Migration | Rejoin-Flow, abgelehnte Commands in der UI | Robust und cheat-resistent genug fuer Oeffentlichkeit |
| **4** | Matchmaking, Ladder, Persistenz, Telemetrie | Profil, Queue-UI, Replay-Ansicht | Dienst |

Stufe 1 ist erstaunlich klein: Room-Verwaltung plus Dateiablage, **kein Relay,
kein Determinismus**. Und sie liefert bereits einen vollstaendig spielbaren
PvP-Modus.

---

# Teil IV — Die zwei Zielmodi

> Zwei konkrete Modi, durchentworfen. **Modus B ist netzwerktechnisch fast
> geschenkt, Modus A ist der teure** — und zwar nicht wegen der Netzwerktechnik,
> sondern wegen der Renderlast.

---

## 23. Modus A — "Vier Tore": eigene Lane, gemeinsames HQ

### 23.1 Der Kernbefund: die Lane existiert bereits

Das ist kein neues Konzept, sondern eine Zuordnung:

| Vorhandenes Bauteil | Fundstelle | Wird zu |
|---------------------|-----------|---------|
| `SpawnPoint[]` mit eigener Route je Spawn | `wave.manager.ts:68`, `path-route.service.ts:206` | **die Lane** |
| `selectSpawnPoint('each' \| 'random')` | `wave.manager.ts:302` | Verteilung der Welle auf Lanes |
| `SPAWN_COLORS` — **exakt vier Farben** | `configs/map-constants.config.ts:27` | Spielerfarben |
| `MIN/MAX_SPAWN_DISTANCE` 500–1000 m | ebenda | Lane-Laenge und -Abstand |
| Route-Berechnung pro Spawn zum HQ | `path-route.service.ts` | Lane-Geometrie |

Die Engine ist also bereits fuer bis zu vier farblich getrennte Lanes gebaut,
die alle auf ein HQ zulaufen. **Die Mechanik von Modus A ist im Kern eine
Zuordnung `playerId ↔ spawnPointId`** — plus die Regeln drumherum.

### 23.2 Spielregeln

| Frage | Entscheidung | Warum |
|-------|-------------|-------|
| Lane-Zuweisung | Ein Spawn pro Spieler, Farbe = Spielerfarbe | Bereits im Renderer vorhanden |
| HQ-Leben | **geteilt** | Der Coop-Kern: dein Leak tut mir weh |
| Gold | **getrennt** | Siehe unten — das ist die wichtigste Entscheidung |
| Bauen in fremder Lane | **erlaubt** | Helfen wird dadurch zum echten Opfer, nicht zur Geste |
| Turm verkaufen | nur Besitzer | Kein Griefing |
| Turm upgraden | jeder, mit eigenem Gold | Gemeinsames Aufruesten eines Schluesselturms |
| Research | **geteilt**, Kosten beim Ausloeser | Der Tech-Tree ist global; erzeugt natuerlichen Rollen-Split |
| Wellennummer | **global** | `checkWaveComplete()` ist heute schon global |
| Wellen-Schedule | **pro Lane**, aus demselben Seed, gleiche Staerke | "Meine Lane, mein Problem" |
| Wellenstart | alle muessen bereit sein | Nutzt `command:start-wave` unveraendert |

**Getrenntes Gold plus Bauen-ueberall ist der interessanteste Hebel im ganzen
Modus.** Es erzeugt Carry-Dynamik ohne eine einzige Sonderregel: Wer gut steht,
kann sein Gold in die Lane des Schwaechsten stecken — und zahlt dafuer mit der
eigenen Verteidigung. Ein geteilter Goldpool haette diese Entscheidung
wegoptimiert.

### 23.3 Die konvergierende Zone — bewusst gestalten

Alle Lanes laufen auf dasselbe HQ zu, also ueberlappen sich die letzten ~100 m.
Ein Turm dort deckt **alle** Lanes ab. Das ist keine Panne, sondern der
interessanteste Ort der Karte — aber es braucht eine Regel, sonst baut einer
den Kern voll und die anderen fahren Trittbrett:

- **Empfehlung:** Der Kernbereich ist eine ausgewiesene Zone mit eigenem
  Bau-Limit (z. B. maximal N Tuerme, unabhaengig vom Besitzer). Damit wird er
  zur knappen gemeinsamen Ressource, ueber die das Team verhandeln muss.
- Alternative (langweiliger): Bauverbot im Kernradius, jede Lane muss allein
  halten.

### 23.4 Skalierung mit der Spielerzahl

Naiv waere "HQ-HP × Spielerzahl" — das macht das Spiel **leichter**, weil vier
Verteidiger mehr leisten als einer. Vorschlag stattdessen:

- HQ-HP bleibt konstant, Leak-Schaden pro Gegner bleibt konstant.
- Wellenstaerke **pro Lane** bleibt ebenfalls konstant.
- Ergebnis: Mehr Spieler = mehr gleichzeitige Fronten = mehr Leak-Gelegenheiten
  bei gleichem HQ-Puffer. Vier Spieler ist die harte Variante, nicht die
  leichte.
- Balance-Regler, falls das zu hart ist: Leak-Schaden ÷ Spielerzahl.

### 23.5 Der Schwachstellen-Spieler

Der offensichtliche Frust-Modus: Ein Spieler leakt dauernd und kostet dem Team
das HQ. Drei Gegenmittel, alle billig:

1. **Lane-Kollaps statt Matchende beim Disconnect.** Geht ein Spieler,
   wird seine Lane geschlossen (kein Spawn mehr) statt das Match zu beenden.
   Das ist gleichzeitig die saubere Antwort auf Verbindungsabbrueche — der
   Rest spielt weiter.
2. **Gold-Transfer** zwischen Spielern erlauben (eigener Command).
3. **Lane-Druck-HUD**: Alle sehen die HP-Summe und Leak-Rate jeder Lane. Ein
   Problem sichtbar zu machen ist billiger, als es zu regulieren.

### 23.6 Netzwerk: volles Lockstep, kein Weg drumherum

Gemeinsames HQ = gemeinsamer Zustand = alle Clients muessen sich ueber jeden
Leak einig sein. Damit gilt das komplette Programm aus Teil I und III:
Tick-Relay, Tick-Barriere, seeded RNG, World Seal, Host-LOS-Masken,
Checksum-Quorum.

Immerhin: **Ab drei Spielern liefert das Quorum aus 15.6 echte Autoritaet.**
Modus A ist damit der Modus, der am meisten von der Serverarchitektur
profitiert.

### 23.7 Performance — der eigentliche Engpass

**Das ist die zentrale Erkenntnis fuer Modus A: Die Grenze ist nicht das
Netzwerk, sondern der Renderer.**

Vier Lanes bedeuten die vierfache Gegnerzahl **in jedem einzelnen Client**.
Gemessener Ist-Stand (`docs/INSTANCED_ENEMY_RENDERING.md:325`):

> 5000 Enemies @ 67 FPS · 500 Enemies ≈ 1,3 ms JS-Zeit, linear skalierend

Daraus folgt das Budget direkt: **bei vier Spielern rund 1200 Gegner pro Lane**,
wenn 5000 die Obergrenze bleiben soll. Die JS-Sim-Zeit liegt bei 5000 Gegnern
schon bei grob 13 ms — also **nicht** vernachlaessigbar, die Sim ist bei vier
Lanes selbst ein Frame-Budget-Posten.

Fuenf Hebel, nach Wirkung sortiert:

1. **Hartes Lane-Enemy-Budget.** Bei hoher Spielerzahl setzen die Wellen auf
   Staerke statt Masse. Das ist eine **Balance-Entscheidung, keine
   Technikaufgabe** — und die Wave-Curriculum-Config ist der richtige Ort dafuer.
2. **Per-Instance-Culling pruefen.** Die Kamera haengt ueber der eigenen Lane,
   die anderen sind 500–1000 m entfernt und meist ausserhalb des Frustums.
   Aber: `InstancedMesh` mit `frustumCulled = false` rendert trotzdem alles.
   **Konkreter Pruefpunkt im Instanced-Renderer** — hier liegt vermutlich der
   groesste einzelne Gewinn.
3. **Distanz-LOD fuer fremde Lanes.** Jenseits X Meter: VAT-Animation aus,
   Health-Bars aus, Partikel aus. Die Toggles existieren teilweise schon
   (`_showAnimations`, `_showEnemies`).
4. **Spatial-Grid pro Lane.** Existiert (`spatial-grid.service.ts`); Lanes sind
   raeumlich sauber getrennt, das Grid profitiert automatisch.
5. **Tick-Barriere-Realitaet:** Der langsamste Client bestimmt das Tempo
   **aller**. Bei heterogener Hardware ist das der spuerbarste Effekt im ganzen
   Modus.

### 23.8 Lobby-Benchmark

Aus Punkt 5 folgt eine Massnahme, die ich fuer wichtiger halte als sie klingt:
**Der Client misst beim Laden seine eigene Kapazitaet und meldet sie.**

Das Werkzeug existiert: Der Bot-Modus mit `trainingTimescale` und
`renderingEnabled` spielt in Sekunden ein Referenzszenario und der
`PerformanceProfilerService` liefert die Zahlen. Der Server kann daraufhin
warnen ("dieser Spieler wird das Match ausbremsen"), das Lane-Budget senken
oder die Spielerzahl begrenzen.

Nebeneffekt: Dasselbe Messergebnis taugt im Singleplayer als
Auto-Qualitaetsstufe.

---

## 24. Modus B — "Rush": Wellen kaufen, Defense halten

### 24.1 Der Kernbefund: kostenlos in jeder Hinsicht

Zwei getrennte Spielfelder, verbunden durch einen duennen Ereignisstrom.
Daraus folgt:

- **Kein Lockstep.** Jeder simuliert nur sein eigenes Brett.
- **Kein Determinismus noetig.** Divergenz zwischen den Clients ist
  bedeutungslos, weil es nichts Gemeinsames gibt.
- **Keine zusaetzliche Renderlast.** Ein Brett = Singleplayer-Kosten.
- **Kein World Seal, keine LOS-Masken, keine Checksums.**

Modus B laeuft damit auf **Server-Stufe 1** aus Teil III (Rooms +
Artefakt-Store), plus einem Ereigniskanal. Er ist vor allen
Determinismus-Arbeiten spielbar.

Einzige Fairness-Anforderung: **dieselbe Stadt und dieselbe Lane-Geometrie fuer
beide**, sonst sind die Ergebnisse nicht vergleichbar. Derselbe Seed sorgt
zusaetzlich dafuer, dass ein gekaufter Angriff bei beiden gleich ausfaellt.

### 24.2 Die Oekonomie ist der Modus

Zwei Waehrungen, klassisch und erprobt:

- **Gold** — aus Kills, fuer Tuerme und fuer Angriffe.
- **Einkommen** — passiver Zufluss pro Intervall. **Steigt dauerhaft, wenn man
  Gegner schickt.**

Daraus entsteht die zentrale Spannung des Modus:

```
Gegner schicken  →  kostet Gold jetzt
                 →  erhoeht Einkommen dauerhaft      (Investition)
                 →  setzt den Gegner unter Druck     (Angriff)
                 →  fuettert den Gegner mit Kill-Gold (Risiko)

Nur bauen    → sicher, aber wirtschaftlich abgehaengt
Nur schicken → reich und tot
```

Der dritte Pfeil ist der wichtige: **Ein Send gibt dem Gegner Kill-Gold.** Das
ist der Regler, der "einfach dauernd schicken" ausbalanciert, und er laesst sich
pro Gegnertyp feinjustieren.

### 24.3 Kaufen und Upgraden — beide Achsen

Der Nutzer-Wunsch "kauf- oder upgradebar" wird zu zwei getrennten Systemen:

**Kaufen — der Send-Katalog.** Pro Gegnertyp aus den bestehenden Enemy-Configs:
Preis, Einkommens-Ertrag, Kill-Gold fuer den Gegner, Spawn-Anzahl. Der Katalog
ist eine Config-Datei, keine Mechanik.

**Upgraden — Tier-Tracks pro Gegnertyp.** Analog zu den Tower-Upgrades
(25 Level in 5er-Baendern, `game-commands.handler.ts`). Ein Tier-Upgrade
verstaerkt alle kuenftigen Sends dieses Typs. Zwei Gruende, das genau so zu
bauen:

1. Die Mechanik ist im Code etabliert und den Spielern bereits vertraut.
2. **Die Wave-Curriculum-Config liefert schon Skalierungskurven fuer
   Gegnerstaerke** — die Tier-Werte muessen nicht neu erfunden werden.

Damit hat der Angreifer dieselbe Entscheidungstiefe wie der Verteidiger:
Breite (viele Typen) gegen Tiefe (ein Typ hochgezogen), und beides gegen
Einkommen.

### 24.4 Das Anti-Cheat-Geschenk

Hier faellt etwas ab, das in einem Client-Sim-Modell sonst unerreichbar ist:

**Der Server sieht jeden Send. Das Einkommen ist eine reine Funktion der
Sends. Also kann der Server das Einkommen jedes Spielers exakt nachrechnen —
ohne zu simulieren.**

Und weiter: Kill-Gold entsteht nur aus Gegnern, die geschickt wurden — und die
kennt der Server ebenfalls. Er kann damit eine **exakte Obergrenze fuer das Gold
jedes Spielers** fuehren und jeden Kauf dagegen pruefen.

Das ist praktisch vollstaendiger Wirtschafts-Anti-Cheat ohne eine Zeile
Simulation auf dem Server. Modus B ist damit **der Modus, der sich am besten
fuer Ranked eignet** — und das ist genau umgekehrt zu dem, was man erwarten
wuerde.

Was offen bleibt: Reichweiten- und Schadensmanipulation auf dem eigenen Brett.
Dagegen hilft nur der Replay-Log aus Abschnitt 18 — asynchron, spaeter, fuer die
Ladder-Spitze.

### 24.5 Was der Gegner sieht

Das gegnerische Brett mitzusimulieren wuerde die Kosten verdoppeln und den
groessten Vorteil des Modus wegwerfen. Stattdessen gestaffelt:

- **Immer:** HUD mit HQ-HP, Einkommen, Wellennummer, Leaks, Turmzahl. Kostet
  ein paar Byte pro Sekunde.
- **Auf Wunsch ("Peek"):** Low-Rate-Zustandsschnappschuss, ~5 Hz, ein paar
  hundert Positionen — grob 20 KB/s, und nur solange jemand hinsieht.
- **Bewusst nicht:** Vollwertiger Zuschauermodus. Der braucht die zweite Sim.
  Fuer Zuschauer gibt es das Replay.

### 24.6 Matchende

Erster mit HQ ≤ 0 verliert. Gegen Endlospartien ein Sudden-Death-Regler: ab
Minute X eine automatisch eskalierende Grundwelle fuer beide, oder ein
Einkommens-Deckel. Ohne so einen Regler enden zwei gleich starke, defensive
Spieler nie.

---

## 25. Leichtes Setup — ein eigenes Problem

Die groesste UX-Gefahr ist nicht die Netzwerktechnik, sondern die **Ladezeit vor
dem Match**: Overpass-Abfrage, Routenberechnung, Tile-Streaming,
Hoehen-Sampling. Fuenf Massnahmen, in dieser Reihenfolge:

1. **Kuratierter Kartenpool mit vorgebackenen Snapshots.** Matchmaking waehlt
   nur aus geprueften Karten, deren `WorldSnapshot` fertig im Storage liegt.
   Kein Overpass, keine Routenberechnung, kein Warten. **Freie Staedte bleiben
   privaten Raeumen vorbehalten** — dort darf es dauern.
2. **Laden beginnt beim Room-Join, nicht beim Match-Start.** Das Ready-Gate
   greift erst, wenn geladen ist. Die Lobby-Zeit wird zur Ladezeit.
3. **Snapshot statt Fremd-API** (Abschnitt 4.4) — spart den Overpass-Roundtrip
   und dessen Rate-Limits gleich mit.
4. **Join per Link:** `?room=ABC123`. Die URL-Location-Mechanik existiert
   bereits (`services/location/url-location.service.ts`).
5. **Match startet, waehrend Tiles noch streamen.** Tiles sind das langsamste
   Element und lassen sich nicht vorbacken — aber nach dem World Seal haengt
   **kein Gameplay** mehr an ihnen. Was als Determinismus-Massnahme gedacht war,
   wird hier zum Ladezeit-Feature.

---

## 26. Servertechnologie fuer genau diese zwei Modi

| | **Modus B (Rush)** | **Modus A (Vier Tore)** |
|---|---|---|
| Serverrolle | Rooms + Send-Relay + Ergebnis | Voller Tick-Relay + Quorum |
| Nachrichtenrate | ein paar Events pro Minute | 15 Hz Fan-out pro Room |
| Zustand pro Room | Send-Historie, Gold-Obergrenze | + Command-Log, Checksums, Artefakte |
| Passende Technik | **Cloudflare Durable Objects / PartyKit** — ein Objekt pro Match, Persistenz eingebaut, bei kleiner Nutzerzahl praktisch kostenlos | **Node/Bun + `ws`** — Tick-Ordnung und Stall-Handling sind in einem klassischen Prozess einfacher zu debuggen |
| Matchmaking | Glicko-2, Kartenpool, Sekunden | Lobby-Browser + Quick-Join, **kein Rating noetig** |

Beides bleibt **ein TypeScript-Codebase** (Begruendung in Abschnitt 20:
geteilte Typen mit den Client-Configs). Ob am Ende zwei Deploy-Ziele oder ein
Node-Prozess fuer beide Modi stehen, ist eine Betriebsentscheidung, keine
Architekturfrage.

Pragmatischer Start: **Node/Bun fuer beides.** Ein Prozess, zwei Room-Typen,
ein Deployment. Die Aufspaltung lohnt erst, wenn Modus B nennenswerte Last
erzeugt.

---

## 27. Was dabei sonst noch abfaellt

Der Teil, der ueber die zwei Modi hinaus Wert schafft:

1. **Bots fuellen leere Plaetze.** Der `StrategyBot` existiert und ist
   sofort einsetzbar: leere Lanes im Coop, Trainingsgegner in PvP. Damit
   funktioniert Modus A auch zu zweit plus zwei Bots — **die wichtigste
   einzelne Massnahme fuer "leichtes Setup"**, weil sie das
   Vier-Spieler-Problem aufloest.
2. **Menschliche Sends als Trainingsdaten.** Der Wave-Director trainiert heute
   gegen Bots. Modus B produziert echte menschliche Angriffsentscheidungen im
   selben Aktionsraum — deutlich besseres Trainingsmaterial, und es faellt im
   Betrieb an.
3. **Der AI-Director als PvP-Gegner** (Teil I, Modus C) — dieselbe UI, dieselbe
   Aktionsraum-Anbindung wie der menschliche Angreifer in Modus B.
4. **Replays** aus dem Command-Log — beide Modi, ohne Zusatzaufwand.
5. **Determinismus-Arbeit zahlt auf Singleplayer ein:** reproduzierbare Bugs,
   deterministisches AI-Training, Save/Load.
6. **Der Lobby-Benchmark** wird im Singleplayer zur Auto-Qualitaetsstufe.
7. **Per-Instance-Culling und Lane-LOD** (23.7) verbessern auch die
   Singleplayer-Performance bei grossen Wellen.

---

## 28. Reihenfolge

| Schritt | Inhalt | Vorbedingung |
|---------|--------|--------------|
| **1** | Server-Stufe 1 (Rooms, Artefakt-Store), Lobby, Join-per-Link | — |
| **2** | **Modus B komplett** — Send-Katalog, Zwei-Waehrungs-Oekonomie, Tier-Upgrades, Gegner-HUD | Schritt 1. **Kein Determinismus noetig** |
| **3** | Gold-Obergrenzen-Validator + Ladder fuer Modus B | Schritt 2 |
| **4** | Determinismus-Fundament (seeded RNG, World Seal, Serializer, Checksums) | — |
| **5** | Tick-Relay, Tick-Barriere, Per-Spieler-Oekonomie, `Tower.ownerId` | Schritt 4 |
| **6** | **Modus A** — Lane-Zuweisung, geteiltes HQ, Kernzonen-Regel, Lane-Kollaps | Schritt 5 |
| **7** | Renderlast-Arbeit: Per-Instance-Culling, Lane-LOD, Lane-Budget, Lobby-Benchmark | parallel zu 6, **bestimmt die Spielerzahl** |

**Modus B kommt zuerst — nicht weil er einfacher zu entwerfen ist, sondern weil
er keinen einzigen der Determinismus-Blocker beruehrt.** Er ist spielbar,
bevor irgendetwas an der Sim angefasst wurde, und er ist gleichzeitig der
Modus mit dem besseren Anti-Cheat-Profil.

---

## 29. FAQ

**Warum nicht Modus A zuerst? Coop klingt doch harmloser als PvP.**
Umgekehrt. Coop teilt ein HQ, also teilt es Zustand, also braucht es Lockstep
und damit alle drei Determinismus-Blocker. Modus B teilt nichts ausser einem
Ereignisstrom.

**Wie viele Spieler gehen in Modus A?**
Vier ist die Obergrenze — und zwar durch drei unabhaengige Dinge, die alle bei
vier landen: `SPAWN_COLORS` hat vier Eintraege, die Tick-Barriere macht jeden
weiteren Client zum Risiko, und das Renderbudget von ~5000 Gegnern ergibt bei
vier Lanes noch spielbare ~1200 pro Lane. Zwei bis drei duerfte der
angenehmere Bereich sein.

**Was passiert, wenn in Modus A jemand rausfliegt?**
Seine Lane schliesst, das Match laeuft weiter (23.5). Das ist bewusst kein
Pausieren und kein Abbruch — bei vier Leuten faellt sonst zu oft jemand aus.

**Und in Modus B?**
Verbindungsverlust ist eine Niederlage nach Reconnect-Frist. Weil jeder sein
eigenes Brett simuliert, gibt es nichts zu synchronisieren — der Rejoin laedt
den eigenen Zustand aus dem letzten Snapshot plus die verpassten Sends.

**Kann ich in Modus B sehen, was der Gegner baut?**
HUD immer, Peek auf Wunsch, voller Zuschauermodus nie (24.5). Letzterer
kostet eine zweite Simulation und damit den Hauptvorteil des Modus.

**Was hindert jemanden daran, in Modus B sein Gold zu manipulieren?**
Der Server rechnet die Obergrenze exakt mit (24.4). Manipulation an Reichweite
oder Schaden auf dem eigenen Brett bleibt moeglich und wird erst durch
nachtraegliche Replay-Verifikation gefasst — bewusst nur fuer die Ladder-Spitze.

**Brauchen beide Spieler denselben Google-API-Key oder dieselben Tiles?**
Jeder laedt Tiles selbst; sie sind nach dem World Seal rein optisch. Die
Kostenfrage pro Client-Session bleibt die groesste ungeklaerte
Aussenabhaengigkeit (Abschnitt 9, Punkt 2).

**Muss das Match warten, bis alle Tiles geladen sind?**
Nein — genau das ist der Nebeneffekt des World Seal (25.5). Gameplay haengt
nach dem Seal nicht mehr an der Optik.

**Kann man Modus A allein oder zu zweit spielen?**
Ja, mit Bots auf den freien Lanes (27.1). Der `StrategyBot` existiert bereits;
das ist die guenstigste Massnahme im ganzen Konzept.

**Lohnt sich Matchmaking ueberhaupt bei kleiner Spielerzahl?**
Fuer Modus A nein — Lobby-Browser plus Join-Link reicht und ist ein Bruchteil
der Arbeit. Fuer Modus B ja, sobald es eine Ladder gibt, weil ungleiche
Paarungen dort direkt den Spass kosten.

**Was ist der groesste unterschaetzte Aufwandsposten?**
Die Renderlast in Modus A (23.7). Die Netzwerkarbeit ist absehbar, die
Balance-Arbeit auch — aber "vier Lanes gleichzeitig fluessig darstellen" ist
eine offene Optimierungsaufgabe, deren Ergebnis die Spielerzahl bestimmt.
