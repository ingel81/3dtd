# 3D-Engine Performance & Bug Deep-Dive — 2026-05-28

> Analyse-Stand auf Basis von `main` (Branch `claude/3d-engine-performance-analysis-NHoDA`,
> synchron mit `origin/main` @ `eb315c0`). Sechs parallele Deep-Dive-Analysen:
> Render-Loop, Instancing/GPU-LOS, Partikel/VFX, Game-Loop-Hot-Path, Bug-Hunt
> (Leaks/Lifecycle/State) und Bug-Hunt (Spiel-Logik).
>
> **Wichtig:** Bereits erledigte Optimierungen (Phase 1+2 Engine-Perf, CPU-Hot-Path-Pass
> 2026-05-11, VAT-Instancing, Tower-Frustum-Culling, SpatialGrid, move-gated Cubemap,
> incremental LOS-Annulus, gepoolte Partikel/Decals/FloatingText) sind in `DONE.md`
> geprüft und hier **ausgeklammert**. Alle Findings sind **neu**.

---

## TL;DR — Empfohlene Reihenfolge (größter Hebel zuerst)

### Performance — die 5 dicksten Bretter
1. **LOS-Readback batchen** — `gpu-cube-resolve.ts:95`: bis zu **1.400 einzelne `readRenderTargetPixels`-GPU-Stalls pro Tower-Build** → 6 Full-Face-Readbacks. Größter Einzel-Win gegen den Build-Spike.
2. **`registerTower` Bounding-Box statt Voll-Iteration** — `global-route-grid.ts:1094/1173`: iteriert **alle** (zehntausende) Grid-Zellen statt nur die im Radius. Cell-Key-Index existiert bereits, wird hier nicht genutzt.
3. **`scene.matrixWorldAutoUpdate` für statische Subtrees abschalten** — `three-tiles-engine.ts:317`: gesamter Szenengraph (hunderte/tausende Overlay-Objekte) wird jeden Frame durchmultipliziert.
4. **Health-Bar-Billboard in den Shader** — `health-bar-instance.manager.ts:265`: pro Frame 2× volle Matrix-Compose + 2× Full-Buffer-Upload für **alle** lebenden Gegner.
5. **Targeting-Trig eliminieren** — `tower.entity.ts:466`: `Math.cos` + `Math.sqrt` pro Enemy × Kandidaten × Tower × bis zu 600 Sub-Steps; Distanz wird doppelt berechnet.

### Bugs — die wichtigsten
1. **MEDIUM:** Splash/AoE verpufft komplett, wenn das Primärziel im Flug stirbt — `projectile.manager.ts:144-153`. Trifft Cannon/Rocket/Ice/Poison genau in dichten Pulks.
2. **MEDIUM:** Pathfinding-Worker Init-Timeout vs. verspätete Antwort → `TypeError` (Null-Deref) — `pathfinding-worker.service.ts:98-122`.
3. **MEDIUM:** Ungetrackte rAF-Konvergenz-Schleife läuft nach `dispose()` auf abgebautem Grid weiter — `visualization-facade.service.ts:679-697`.

### Querschnitt-Beobachtung
**Kein einziger Renderer/Manager nutzt `BufferAttribute.addUpdateRange()`** für partielle GPU-Uploads. Jedes `needsUpdate = true` lädt den vollen Buffer bis `count` hoch (Enemy 20k, Health-Bar 20k, FloatingText 2k). Ein gemeinsames dirty-min/max-Pattern wäre eine systematische Folge-Optimierung über alle Pools.

---

## 1. Render-Loop & Kern-Engine

| # | Sev | Datei:Zeile | Kern | Fix |
|---|-----|-------------|------|-----|
| R1 | HIGH | `three-tiles-engine.ts:317` (global) | `scene.matrixWorldAutoUpdate=true` → ganzer Graph wird pro Frame neu durchmultipliziert; statische Overlays (Straßen, Decals, Marker) ändern Transform nie | Statische Subtree-Roots `matrixWorldAutoUpdate=false`, einmalig `updateMatrixWorld(true)`; dynamische Türme/Rings bleiben auto |
| R2 | HIGH | `three-tiles-engine.ts:1833-1834` | `tilesRenderer.setResolutionFromRenderer` + `setCamera` **jeden Frame** im `render()`-Hot-Path | Nur in `resize()` (`:1051`) + einmalig in `initialize()` aufrufen |
| R3 | MEDIUM | `three-tiles-engine.ts:1853` | `group.position.clone().sub(...)` allokiert `Vector3` pro Frame (60/s) | Persistenter `private _deltaPos = new Vector3()`, `.copy().sub()` |
| R4 | MEDIUM | `three-tiles-engine.ts:299-303` | `logarithmicDepthBuffer:true` schreibt `gl_FragDepth` → deaktiviert Early-Z auf vielen GPUs über die gesamte (dominante) Tile-Geometrie; kein `powerPreference` | `powerPreference:'high-performance', stencil:false` ergänzen (sofort). Experiment: logDepth entfernen + `camera.near` 1→5-10 anheben (Spiel-Skala ~150m, Fern-Z-Fighting im Fog unsichtbar). **Potenziell größter Tile-Render-Win** — messbar via Frame-Time |
| R5 | MEDIUM | `post-processing-pipeline.ts:32-55` | `UnrealBloomPass` (5 Mip-RTs) immer im Ctor erzeugt; Color-Grading = eigener Composer-Roundtrip auch wenn nur LUT aktiv | Bloom lazy bei Erst-Aktivierung; Color-Grading in `OutputPass`/`onBeforeCompile` mergen statt Extra-Pass. (Greift nur im aktivierten Zustand — Default ist schneller Direktpfad) |
| R6 | MEDIUM | `three-tiles-engine.ts:1905-1920` | `effects/flameBeams/tentacles/trailStreaks/lightningBolts/projectiles`-`update()` laufen jeden Frame auch bei 0 aktiven Instanzen (Funktions-Overhead, ggf. needsUpdate/uniform-Sets in „ruhigen" Frames zwischen Waves) | `isEmpty()`/count-cache → früher `return` |
| R7 | LOW-MED | `three-tower.renderer.ts:915` | `new Vector3` pro Tower mit Debug-Aim-Arrow pro Frame | statisches `_aimDir`-Scratch |
| R8 | LOW | `three-tiles-engine.ts:1980` | FPS-Limiter koppelt an rAF-Rate → 45fps-Limit kann zu 30fps werden | `lastTime += interval` statt `= currentTime` |
| R9 | LOW | `three-tiles-engine.ts:872-888` | Equirect-Skybox als `scene.background` → Fullscreen `atan/asin`-Lookup pro Pixel, Kamera schaut meist nach unten | CubeTexture statt Equirect, oder Background weglassen (Fog blendet Fern aus) |
| R10 | LOW | `three-tiles-engine.ts:845-867` | 4 Lichtquellen (2 Directional + Hemisphere + Ambient) ohne Schatten in PBR-Shader-Loop über gesamte Tile-Geometrie | Fill-Light entfernen/ins Hemisphere mergen |

> **Positiv (kein Handlungsbedarf):** `ellipsoid-sync.ts` allokationsarm (`geoToLocalSimpleInto`), `tower-shadow-mapper.ts` move-gated + version-cached, Headless-Modus (`_renderingEnabled`) überspringt korrekt visuelle Arbeit.

---

## 2. Instancing & GPU-LOS

| # | Sev | Datei:Zeile | Kern | Fix |
|---|-----|-------------|------|-----|
| G1 | HIGH | `gpu-cube-resolve.ts:95` (Aufrufer `global-route-grid.ts:1115/1127/1201/1219`) | 1×1-`readRenderTargetPixels` **pro Zelle** (Ground+Air = 2×) → bis zu 1.400 synchrone GPU↔CPU-Stalls/Build | 6 Cube-Faces **einmal** komplett in `Uint8Array` lesen, `sampleCubeAtPoint` per Index aus CPU-Buffer → 6 statt 1.400 Readbacks |
| G2 | HIGH | `global-route-grid.ts:1094/1173` | `registerTower`/`registerTowerIncremental` iterieren **die ganze `cells`-Map** (zehntausende), ~99% verworfen; Tower deckt ~700 Zellen | Bounding-Box über `intCellKey(gx,gz)` iterieren (Index existiert). Gleiches auf `refineCellsInRadius:1033`, `refineCellHeightsInRadius:1007` |
| G3 | HIGH | `health-bar-instance.manager.ts:265-284` | Pro Frame für **jeden** Gegner: `compose()` (Quat→Matrix) + 2× `setMatrixAt` (BG+FG identische Matrix) + 2× **Full-Buffer-Upload** | FG-Buffer referenzieren statt zweitem compose; Billboard in Vertex-Shader (`uCameraRight/uCameraUp` wie FloatingText `:197`) → pro Frame nur 2 Uniform-Sets statt Matrix-Uploads |
| G4 | MEDIUM | `vat-material.ts:166-207` | Fragment-Shader: 4-Licht-Beleuchtung + ACES-Tonemapping + `normalize()` auf compile-time-Konstanten — pro Fragment, pro Gegner | Light-Dirs als vorab-normalisierte `const vec3`; per-Vertex-Lighting (Gouraud) für Low-Poly-Enemies; doppeltes ACES prüfen (Renderer macht Tonemapping global) |
| G5 | MEDIUM | `enemy-instance.manager.ts:406-449` | `aAnimFrame` wird für jeden Gegner jeden Frame geschrieben + Full-Upload, obwohl Integer-Frame-Index sich nur ~jeden 2. Frame ändert | change-gate (`state.lastFrame`) + `addUpdateRange` für geändertes Fenster |
| G6 | MEDIUM | `enemy-instance.manager.ts:578-611` | `setFromAxisAngle` (sin/cos) + voller `compose` pro Gegner/Frame, obwohl Scale konstant & Heading oft unverändert | heading-gated Quat-Cache (`state.lastHeading`); bei reiner Translation nur Translation-Spalte schreiben |
| G7 | MEDIUM | `global-route-grid.ts:1141/1231` | `refreshAggregateVizPositions()` läuft nach **jedem** Tower-Build, auch wenn Debug-Viz aus | `if (visualization?.visible \|\| airVisualization?.visible)` gaten |
| G8 | LOW | `marker-instance.manager.ts:310`, `decal-instance.manager.ts:148`, `marker-instance.manager.ts:349` | `getAllInstances()`/`getAllSpawnProxies()` allokieren neues Array pro Aufruf (ggf. per-Frame bei Decal-Fade) | gecachtes Array mit Null-Invalidierung (wie `cachedAllIds` im EnemyInstanceManager) |
| G9 | LOW | `floating-text-instance.manager.ts:245-289` | `recomputeMaxIndex`/`sweepExpired` iterieren alle aktiven Instanzen (sweep-gated, akzeptabel) | nur falls FloatingText-Counts massiv steigen |

---

## 3. Partikel / VFX / Projektile

| # | Sev | Datei:Zeile | Kern | Fix |
|---|-----|-------------|------|-----|
| P1 | HIGH | `trail-streak.renderer.ts:414,245` | 60 × 6 Typen = **360 eigenständige `ShaderMaterial`** dauerhaft in der Szene; einzige Variation `uEmissiveIntensity` (konstant pro Typ) | 1 geteiltes Material **pro Typ** (6 statt 360); Geometrie bleibt pro Trail |
| P2 | HIGH | `lightning-bolt.renderer.ts:252,154` | **192 Mesh + 192 ShaderMaterial** dauerhaft in Szene; Geometrie im Shader aus `uStart/uEnd/uSeed` → für alle identisch; jeder aktive Bolt = 1 Draw Call | Auf **InstancedMesh** umbauen (Per-Instance `aStart/aEnd/aSeed/...`, globale `uTime/uColor`) → 1 Draw Call + 1 Material statt bis zu 192. Folgt bestehendem Enemy/Decal/FloatingText-Muster |
| P3 | MEDIUM | `three-projectile.renderer.ts:471` | `directionToEuler` allokiert `new Euler()` pro homing/arc-Projektil pro Frame + redundanter Euler↔Quat-Roundtrip | statisches `_tempEuler`; besser: Quaternion-Variante von `update` (spart Konvertierung ganz) |
| P4 | MEDIUM | `lightning-bolt.renderer.ts:355` | `[...this.activeIndices]`-Spread allokiert pro Frame neues Array (Idle-Crackle hält `activeIndices` nie leer) | Vorab-allokiertes `_expiredScratch`-Array |
| P5 | MEDIUM | `three-flame-beam.renderer.ts:28,128` | 120 Partikel/s/Beam ohne Frame-Cap/LOD → bei mehreren Flame-Towern Starvation des gemeinsamen `trailAdditive`-Pools (3000), andere Effekte verschwinden sichtbar | `particlesToSpawn` pro Frame cappen + Distanz-LOD; ggf. dedizierter Flame-Pool |
| P6 | LOW | `particle-effects-renderer.ts:1140` | Decal-Fade ruft `getAllInstances()` jeden Frame für beide Manager ohne Idle-Skip | `hasFadingDecals`-Flag → Schleife skippen wenn 0 Decals |
| P7 | LOW | `particle-effects-renderer.ts:330,351,505`, `environment-effects-renderer.ts:171` | `new Vector3` + `.clone()` in Spawn-Pfaden (event-getrieben, aber Bursts bei HQ-Explosion) | Scratch-Vector / Pool nur falls Spikes auffallen |
| P8 | LOW (Korrektheit) | `environment-effects-renderer.ts:330-365` | Tower-Fire-Respawn ohne `markPoolDirty('towerFire')` — Edge-Case wenn alle Partikel im selben Frame sterben → Pool reaktiviert nicht | `markPoolDirty` im Respawn-Zweig (defensiv) |

---

## 4. Game-Loop Hot-Path (CPU / GC)

> Multiplikator-Kontext: Die Sub-Step-Schleife (`game-state.manager.ts:351-383`) ruft pro Frame bis zu
> **`MAX_SUBSTEPS_PER_FRAME = 600`** mal alle 4 Combat-Methoden über die komplette Tower-Liste auf
> (primär AI-Training-Timescale). Jede Pro-Tower-Pro-Sub-Step-Allokation wird dort massiv multipliziert.

| # | Sev | Datei:Zeile | Kern | Fix |
|---|-----|-------------|------|-----|
| C1 | HIGH | `global-route-grid.ts:1305,1361` (Aufrufer `tower-combat.service.ts`) | `getEnemiesForTower`/`getEnemiesInRadius` bauen **frisches `Enemy[]`** pro Tower × Methode × Sub-Step | `...Into(out[])`-Variante mit Service-Scratch-Array (`.length=0` + refill) |
| C2 | HIGH | `global-route-grid.ts:1390` | `geoToLocalSimple` → `new Vector3` pro Enemy im Radius-Fallback (frische Türme, Melee/Chain) | nur x/z gebraucht → inline 2 Multiplikationen mit gecachten Origin-Werten (kein Objekt) |
| C3 | HIGH | `tower.entity.ts:466-474` | `calculateDistanceFast`: `Math.sqrt` (unnötig, nur Range-Vergleich) + `Math.cos(lat)` (Tower-Lat ist konstant!) pro Enemy; `'closest'` rechnet Distanz **doppelt** (`:213` + `:245`) | `_mPerDegLon` im Ctor cachen (analog `rangeSquaredGeo:102`); `...FastSq()` ohne sqrt; Single-Pick-Strategien als best-so-far direkt im Filter-Loop (spart `candidates`-Array + 2. Pass) |
| C4 | MEDIUM | `movement.component.ts:158` | `getPathProgress()` summiert `segmentLengths[0..currentIndex]` pro Aufruf → O(n) pro Kandidat im `'first'`-Targeting | Prefix-Summen-Array `cumulativeLength[i]` (O(1)); oder `(currentIndex, progress)`-Tupel-Vergleich ganz ohne Summe |
| C5 | MEDIUM | `tower-combat.service.ts:65-104` | `buildLosCheck` erzeugt **neue Closure + `Vector3`** pro Tower × Methode × Sub-Step, auch wenn Fast-Path-Target-Cache greift | Service-`tempLosPos`-Scratch + Methode statt Closure; Mindestmaßnahme: Closure nur im Slow-Path lazy |
| C6 | MEDIUM | `tower-combat.service.ts:476,494,501` | `getEnemiesInCone` allokiert Result-Array + `geoToLocalSimple`-Vector3 pro Enemy pro Beam-Tower/Sub-Step | `geoToLocalSimpleInto` + wiederverwendetes `coneScratch` |
| C7 | MEDIUM | `game-object.ts:65-71` (`enemy.manager.ts:345`) | `enemy.update()` iteriert `components.values()`-Map + megamorpher `component.update`-Dispatch pro Enemy/Sub-Step, obwohl Movement/StatusEffects bereits separat getickt werden (`:347-348`) | vorab gefiltertes `updatableComponents: Component[]`-Array statt Map; oder leere Komponenten gar nicht ticken |
| C8 | LOW | `game-event-bus.ts:560-563` | `processQueue` nutzt `Array.shift()` (O(n)) → O(n²) bei großen Deferred-Queues | Index-Pointer oder Double-Buffer-Swap (nur falls Queues wachsen) |

> **Positiv (gründlich optimiert, kein Hebel):** EnemyManager/ProjectileManager `update`, MovementComponent `move`/`updateStatusEffects`, SpatialGrid, GameEventBus `emit`, Pathfinding-Worker (postet nur bei Routenaufbau).

---

## 5. Bugs — Memory-Leaks / Lifecycle / Race Conditions

| # | Sev | Datei:Zeile | Klasse | Beschreibung & Fix |
|---|-----|-------------|--------|--------------------|
| B1 | MEDIUM | `pathfinding-worker.service.ts:98-122` | Race / async | Init-Handler (`:102/:107`) setzt `this.worker!.onmessage` — wenn der 5s-Timeout (`:116`) vorher `handleWorkerFailure()→worker=null` setzt und die Worker-Antwort verspätet eintrifft: `TypeError: Cannot set property 'onmessage' of null` (`!` maskiert es). Trigger: langsame Worker-Init (große StreetNetworks, Background-Tab-Throttling >5s). **Fix:** Null-Guard in beiden Pfaden + `workerReady`-Flag für gegenseitigen Ausschluss |
| B2 | MEDIUM | `visualization-facade.service.ts:679-697` | Race / Cleanup | rAF-Konvergenz-Schleife (`scheduleRouteGridConvergence`, bis 120 Frames) wird in `dispose()` (`:113`) **nicht** abgebrochen (keine rAF-ID gespeichert). Bei Location-Wechsel direkt nach Spielstart tickt sie weiter auf bereits via `engine.dispose()` abgebautem Grid. **Fix:** rAF-ID halten, in `dispose()` `cancelAnimationFrame` + Grid-Guard im tick |
| B3 | LOW | `visualization-facade.service.ts:152`, `game-loop-facade.service.ts:175`, `game-state-sync.service.ts:33` | Lifecycle | `subscribeToEventBus`/`initialize` rufen — anders als das etablierte Muster (`combat-effect.service.ts:58` etc.) — **kein** `disposeAll()` am Anfang. Aktuell harmlos (Re-Init-Pfad ruft sie nicht erneut), aber latente Doppel-Subscription sobald eine zweite Aufruf-Stelle entsteht. **Fix:** `this.eventBusSubs.disposeAll()` voranstellen |
| B4 | LOW | `wave.manager.ts:106,113,143` (`destroy():461`), `enemy.manager.ts:83-98` (`destroy():685`) | Leak / Fragilität | Ctor-`eventBus.on(...)`-Handler werden nicht gespeichert/abgemeldet. Kein Live-Leak (teilen Lebenszyklus mit `GameStateManager.eventBus`), aber bricht bei separater Instanziierung. **Fix:** `SubscriptionBag` + `disposeAll()` in `destroy()` |
| B5 | LOW | `spatial-audio-playback.ts:351-353` | Cleanup | `playGlobal` plant ungetracktes `setTimeout(()=>audio.disconnect())`; bei Dispose während One-Shot feuert es später auf ggf. verworfenem Node (vs. `playAt()` `:298` getrackt). **Fix:** Timer tracken + in `dispose`/`stopAllOneShots` clearen |

> **Geprüft & sauber (kein Bug):** `three-effects.renderer.ts:636` (keine eigenen GPU-Ressourcen), `three-tiles-engine.ts:513/518` (tilesRenderer.dispose räumt mit), Entity-Iteration (gecachtes Snapshot + `toRemove`), background-music/hq-damage/muzzleFlash/model-preview/height-update/debug-services (alle getrackt), Component-`effect()`s (Injection-Context). `resetAll()` reset Research nicht — aber dormant (nur Tests; Live-Pfad `game:reset→resetGameState` ist korrekt).

---

## 6. Bugs — Spiel-Logik / Korrektheit

| # | Sev | Datei:Zeile | Beschreibung & Fix |
|---|-----|-------------|--------------------|
| L1 | MEDIUM | `projectile.manager.ts:144-153` + `combat-effect.service.ts:82-143` | **Splash/AoE entfällt komplett, wenn das Primärziel im Flug stirbt.** `projectile:hit` wird nur bei `!targetLost` emittiert → kein `applySplashDamage`. Bei Cannon/Rocket/Ice/Poison verpufft die gesamte Flächenwirkung, sobald ein zweiter Turm das Ziel killt während der Splash-Schuss fliegt — visuell wird trotzdem eine Explosion gezeigt (`vfx:projectile-impact targetLost:true`). Genau in dichten Pulks, wo Splash am wertvollsten ist. **Fix:** Für `splashRadius>0` auch im `targetLost`-Fall Splash an `lastTargetPosition` auslösen (eigenes Flag „nur Splash, kein Direktschaden") |
| L2 | LOW | `tower.entity.ts:217-218` vs. `tower-combat.service.ts:240-254` | **Air-Ziele werden bei der Akquise nicht LOS-geprüft, beim Recheck aber schon.** `findTarget` skippt LOS für Air (`!isAirEnemy`), der ~333ms-Recheck prüft Air-LOS aber. → Turm kann Luftziel hinter Hochhaus akquirieren und feuern bevor der erste Recheck es droppt. Inkonsistent mit erklärter Intention. **Fix:** `!isAirEnemy`-Ausnahme in `findTarget` entfernen |
| L3 | LOW | `tower.entity.ts:466-474` | **Range-Check ist rein 2D**, auch für Luft-Units (fliegen auf `terrainHeight+heightOffset` ≈15-20m, `enemy.manager.ts:411`). Turm „erreicht" horizontal knapp in Range liegende Air-Ziele, die in echter 3D-Distanz weiter weg sind. **Fix:** 3D-Distanz (inkl. heightOffset) für Air — oder dokumentieren falls horizontale Reichweite intendiert |
| L4 | LOW (informativ) | `movement.component.ts:254-255` | **`freeze`-Effekt halb verdrahtet:** setzt `isSlowed=true` (Frost-Tint), lässt aber `slowMultiplier=1.0` → eingefrorener Gegner bewegt sich mit voller Geschwindigkeit. Laut `docs/STATUS_EFFECTS.md:249` ist Freeze aktuell RESERVIERT/ungenutzt → **kein Live-Bug**, aber Falle für spätere Aktivierung (`move()`/`getSlowMultiplier` müssten `freeze`→0 behandeln) |

> **Geprüft & korrekt (kein Bug):** Damage-Matrix-Indizierung `[damageType][armorType]`, Multiplikator-Reihenfolge, Heal-Overflow (`Math.min`), negative HP (`Math.max(0,…)`), Gold-Negativität (`spendCredits` prüft vorab), Double-Spend (synchron, kein await), Sell-Ratio 75%, Upgrade-Kosten `1.25^level`, Research-Effekte/Reset, Chain-Falloff `pow(falloff,i)`, Poison-DOT, Slow/Poison-No-Stacking (Doc-konform), Kill-Reentrancy-Guard, WAVE_CURRICULUM=STATIC_PROFILES=30 (kein Loop-Versatz), Boss-Wellen-HP-Ramp. `WaveManager.beginWave()` (expectedEnemyCount=0) ist im Normalspiel unerreichbar (Facade emittiert immer mit config).

---

## Anhang — Empfohlene erste Umsetzungs-Batch (risikoarm, hoher Hebel)

Falls eine konkrete Umsetzungsrunde gewünscht ist, bieten sich diese als kohärentes erstes Paket an (alle isoliert testbar, geringes Regressionsrisiko):

1. **R2 + R3** — `setResolutionFromRenderer`/`setCamera` aus `render()` raus + `_deltaPos`-Scratch. Reine Streichung von Per-Frame-Arbeit.
2. **G2** — `refreshAggregateVizPositions` gaten. Ein `if`.
3. **G1** — LOS-Readback batchen (6 statt 1.400). Größter Build-Spike-Win, lokal in `gpu-cube-resolve.ts`.
4. **G2/Grid → C1/C2/C3** — Hot-Path-Allokationen im Targeting (Scratch-Buffer, inline x/z, sqrt/cos eliminieren). Spürbar im AI-Training-Timescale.
5. **L1** — Splash-on-targetLost. Echter Gameplay-Bug mit klarem Fix.
6. **B1 + B2** — Worker-Null-Guard + rAF-Cleanup. Defensive Stabilität.

P1/P2 (Trail/Lightning-Material-Sharing bzw. -Instancing) und R1 (matrixWorldAutoUpdate) sind größere Hebel, aber breitere Eingriffe → eigene Runde mit Frame-Time-Messung davor/danach.
