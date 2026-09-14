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
| L4 | LOW (informativ) | `movement.component.ts:254-255` | **`freeze`-Effekt halb verdrahtet:** setzt `isSlowed=true` (Frost-Tint), lässt aber `slowMultiplier=1.0` → eingefrorener Gegner bewegt sich mit voller Geschwindigkeit. Laut `docs/STATUS_EFFECTS.md:249` ist Freeze aktuell RESERVIERT/ungenutzt → **kein Live-Bug**, aber Falle für spätere Aktivierung (`move()`/`getSlowMultiplier` müssten `freeze`→0 behandeln). Nachtrag: Freeze ist seit 2026-09-14 der Stopp der Frostbombe, siehe STATUS_EFFECTS.md |

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

---

## Umsetzungsstand (2026-05-29)

Implementiert und committet auf `claude/3d-engine-performance-analysis-NHoDA` (Tests 885/885 grün, Typecheck sauber):

**Bugs (alle):** B1 (Worker-Race-Null-Deref), B2 (rAF-Cleanup in dispose), B3 (disposeAll in 3 Subscribe-Pfaden), B4 (Wave/Enemy-Manager Ctor-Subs), B5 (Audio-One-Shot-Timer), C8 (EventBus shift→index-walk), L1 (Splash-on-targetLost + Regressionstest), L2 (Air-LOS bei Akquise), L4 (Freeze→Stillstand defensiv).

**Performance:** R2, R3, R4 (powerPreference/stencil — logDepth bewusst behalten), R5 (Bloom/Grading pass.enabled verdrahtet), R7, R8 · G1 (Bounding-Box-Tower-Reg), G2 (6 Cube-Face-Readbacks statt ~1.400), G3 (geteilter Health-Bar-Matrix-Buffer), G4 (const Light-Dirs), G5 (Anim-Frame change-gate), G6 (Heading-Quat-Cache) · C1 (Candidate-Scratch-Buffer), C2 (geoToLocalSimpleInto), C3 (cos/sqrt eliminiert, squared-Vergleich), C4 (Prefix-Summen), C5 (LoS-Vector3-Scratch), C6 (Cone-Scratch), C7 (flache Komponentenliste) · P1 (Trail-Material-Sharing 360→6), P3 (Euler-Scratch), P4 (activeIndices ohne Spread), P5 (Flame-Spawn-Cap).

**Bewusst aufgeschoben** (messgestützte Render-Folgerunde / Balance-Entscheidung — Begründung jeweils im Finding):
- **R1** (`scene.matrixWorldAutoUpdate` global) — braucht Per-Subtree-Audit + Frame-Time-Messung; Risiko für dynamische Transforms.
- **R4-Experiment** (`logarithmicDepthBuffer` entfernen) — Z-Fighting-Risiko, nur mit visueller Messung; sichere Teilmaßnahme erledigt.
- **R6** (Empty-Frame-Guards) — `commitToGPU` ist bereits No-op, `updateShaderUniforms` minimal; breiter Eingriff über 6 Renderer für geringen Idle-Gewinn.
- **R9/R10** (Skybox-Cubemap, Licht reduzieren) — rein visuelle Änderungen.
- **G3-Vollausbau** (Billboard im Vertex-Shader), **G5-`addUpdateRange`** (partielle Uploads), **P2** (Lightning→InstancedMesh) — größere Shader-/Buffer-Umbauten mit Regressionsrisiko, ohne Headless-/GPU-Verifikation hier nicht sicher prüfbar; sichere Teilvarianten (G3-Buffer-Sharing, G5-change-gate) sind drin.
- **G8, P6, P8** — LOW; P8 referenziert eine API, die im betroffenen Renderer nicht existiert (Pool-Flush liegt zentral) → erst Mechanismus verifizieren.
- **L3** (3D-Range für Air) — balance-relevant; als horizontale Reichweite dokumentiert statt Air-Türme zu nerfen.

**Nachtrag 2026-09-11, P2:** `LightningBoltRenderer` zeichnet alle Bolts als Instanzen
eines Quad-Strips (ein `Mesh` über `InstancedBufferGeometry`, ein `ShaderMaterial`).
Pro Bolt ein Slot aus dem `InstanceSlotAllocator`, Instanzdaten (`aStart`, `aEnd`,
`aTiming`, `aShape`) in einem Interleaved-Buffer, `uTime` und die Farben bleiben
Uniforms. Bis zu 192 Draw Calls und 192 Materialien werden zu einem. Frame-Time-Messung
im echten Render steht noch aus.

---

## Nachtrag 2026-09-11: Render-Kleinkram (TODO 1.5)

Ohne Browser bearbeitet, Frame-Time ist nicht gemessen. Umgesetzt ist nur, was sich per Test oder three-Quelltext belegen lässt.

- **P8 erledigt.** Der Flush liegt zentral in `ParticlePoolManager.updateBuffers()`, `markPoolDirty()` gibt es dort. `EnvironmentEffectsRenderer.update()` belebt Tower-Fire-Partikel aber an `getInactiveParticle()` vorbei und hat den Pool dabei nie markiert. Der Randfall ist real: Im normalen Spiel steht rAF im verdeckten Tab still, das erste dt danach ist die ganze Pause und im visuellen Pfad nicht begrenzt. Alle Partikel sterben in diesem Frame, der Pool fällt in den Idle-Skip und bleibt dort, bis ein anderes Tower-Fire spawnt. Respawns markieren den Pool jetzt (Test war vor dem Fix rot). Die Feuer im `ParticleEffectsRenderer` betrifft das nicht, sie beleben im selben Frame wieder, in dem ein Partikel stirbt.
- **P6 erledigt.** Der Fade läuft in `DecalInstanceManager.updateFades()`. Der Manager merkt sich den frühesten ausstehenden Fade-Start und kehrt davor sofort zurück. Blut wartet 20 s, Eis 4 s, die Schleife läuft also nur, solange etwas ausblendet.
- **G8 erledigt für Decals und Marker.** `getAllInstances()` ist weg, Fade und `removeOldest()` laufen direkt über die Map. `MarkerInstanceManager.update()` gibt ein wiederverwendetes Array zurück statt pro Frame ein neues. `getAllSpawnProxies()` bleibt: Es läuft nur beim Aufbau eines Standorts, und `PathRouteService` behält das Array, ein geteilter Cache wäre dort eine Falle.
- **R6 Befund, auf der JS-Seite nichts zu tun.** Die Updates in `ThreeTilesEngine.update()` laufen im Leerlauf über leere Maps oder sind schon abgesichert (Projektil-`flush()` und Enemy-Flush per Dirty-Flag, Partikel-Pools per `isPoolActive()`, Floating-Text und Health-Bars per `size === 0`). Was bleibt, liegt in three: Ein `InstancedMesh` mit `count 0` und `Points` mit `drawRange 0` kommen trotzdem in die Render-Liste und durchlaufen `setProgram()` und das VAO-Setup, erst `renderInstances()` bricht bei 0 Instanzen ab. Zwischen den Wellen sind das gut zwei Dutzend Objekte (Projektil-Pools, ein Pool je Gegnertyp, Partikel-Pools, Health-Bars). Abhilfe wäre `visible = count > 0`, verknüpft mit den Debug-Schaltern. Bewusst nicht umgesetzt: Ein verstecktes Mesh kompiliert sein Programm erst im ersten sichtbaren Frame, der Shader-Compile wanderte vom Spielstart in die erste Welle. Nur zusammen mit einem Warm-up (`compileAsync()` mit sichtbar erzwungenen Pools) und Frame-Time-Messung.
- **R9 erledigt (Speicher), der Kern des Findings gilt nicht mehr.** three r186 rechnet ein Equirect-`scene.background` einmal in ein Cube-Render-Target um (`WebGLEnvironments.getCube()`, Kantenlänge gleich Bildhöhe) und zeichnet eine Box mit Cube-Lookup, `atan/asin` pro Pixel gibt es nicht. Übrig war Speicher: `day.webp` ist 4096×2048, das Cube-RT hat 6 × 2048² RGBA8 mit Mips (etwa 134 MB), und die Equirect-Quelle blieb daneben im VRAM (etwa 34 MB, ohne Mips, weil die Umrechnung `minFilter` kurz auf `LinearFilter` setzt), obwohl sie danach niemand mehr liest. Jetzt ruft `setupSky()` selbst `new WebGLCubeRenderTarget(image.height).fromEquirectangularTexture(renderer, texture)` auf, setzt die RT-Textur als Background und disposed die Quelle, `dispose()` gibt das RT frei. Laut three-Quelltext ist das derselbe Pfad wie intern (gleiche Funktion, Größe und Filter, RT-Cube ohne x-Flip in beiden Fällen), also pixelgleich. Im Browser nicht geprüft. `night.webp` liegt im Asset-Ordner, wird aber nirgends geladen, einen Tag/Nacht-Wechsel gibt es nicht. Eine 1024er-Cube spart weitere 100 MB, macht den Himmel aber weicher, also nur mit Playtest.
- **R10 Befund.** Szenenlichter aus `setupLighting()`: Hemisphere (1.5), Sonne und Fill (Directional 3.0 und 1.5), Ambient (0.8), dazu das Mündungsfeuer-`PointLight`, das dauerhaft in der Szene bleibt (Intensität 0 zwischen Schüssen). Licht rechnen nur Materialien mit `lights`, vor allem Tower-GLTFs und Bosse (klassischer Renderer; heute laufen auch die Bosse instanziert über den VAT-Shader). VAT-Gegner, Partikel, Decals, Marker und Health-Bars sind `ShaderMaterial` ohne `lights`, der VAT-Shader hat das 4-Licht-Setup fest eingebaut. Auf den Photoreal-Tiles bewirken dynamische Lichter sichtbar nichts (Lightning-Halos, COMBAT_HEATMAP_STUDY 1.5). Ob die Tile-Materialien die Lichter trotzdem im Shader rechnen (`MeshStandardMaterial`) oder unlit sind (`MeshBasicMaterial` über `KHR_materials_unlit`), lässt sich ohne Browser nicht klären. Ein Log der Materialtypen im `load-model`-Event beantwortet es. Sind sie unlit, kosten die Lichter nur auf Towern und Bossen, weniger Lichter bringen dann kaum etwas. Rechnen sie Licht, ist der Hebel ein unlit-Material für die Tiles (ändert die Optik), nicht die Zahl der Lichter. Fill ins Hemisphere zu falten ändert `NUM_DIR_LIGHTS` (einmaliger Programmwechsel aller beleuchteten Materialien) und die Tower-Schattierung, der VAT-Shader müsste nachziehen. Die Zahl der PointLights bleibt bei 1.

---

## Nachtrag 2026-09-12: R6, Shader-Warm-up, R10-Log, Raycast-Messung

Ohne Browser umgesetzt, nichts davon ist gemessen. Die Logs und der Konsolen-Hook sind dafür da, dass der Playtest die Zahlen liefert.

- **R6 erledigt.** Leere Pools stehen nicht mehr in der Render-Liste. Jeder Pool hat ein `DrawGate` (`renderers/draw-gate.ts`), das `visible` dort umschaltet, wo sich die Zeichenzahl ändert, und nur beim Wechsel zwischen leer und nicht leer. Einen zusätzlichen Pass pro Frame gibt es nicht. Betroffen: ein `InstancedMesh` je Gegnertyp, beide Health-Bar-Passes, die sieben Projektil-Pools (heute neun), Blut- und Eis-Decals, die drei Partikel-Pools (`Points` mit Draw-Range), Floating Text und der Lightning-Bolt-Mesh. Trail-Streaks und Lightning-Halos waren schon vorher unsichtbar, solange sie frei sind. Die Debug-Schalter für Gegner und Health-Bars laufen über `DrawGate.setShown()` (ebenso `FloatingTextInstanceManager.setVisible()`, das derzeit niemand aufruft). Ein Gegner-Pool, der erst nach "Gegner ausblenden" gebacken wird, startet jetzt ebenfalls versteckt, vorher war er sichtbar. `frustumCulled` bleibt überall aus. Der LOS-Cube-Render ist nicht betroffen: Er versteckt für seinen eigenen Render alle sichtbaren Scene-Kinder außer der Tiles-Group und stellt genau diese wieder her, die Pools gehören nicht zu dem, was er zeichnen muss.
- **Shader-Warm-up.** Nach dem Modell-Preload ruft `ThreeTilesEngine.preloadModels()` `warmUpScene()` auf (`three-engine/scene-warmup.ts`): `renderer.compileAsync(scene, camera)` über die ganze Szene. Die Annahme aus dem R6-Befund, dass versteckte Meshes dabei übersprungen werden, stimmt für three r186 nicht: `compile()` sammelt nur die Lichter über `traverseVisible`, die Materialien über `scene.traverse`. Was ein verstecktes Objekt tatsächlich verpasst, sind die Uploads: Buffer, VAT-Texturen und VAO kommen erst im ersten Frame, der es zeichnet. Deshalb öffnet der Warm-up nach dem Compile alle Gates, bis ein Frame gezeichnet ist (höchstens 1 s, im Headless-Modus sofort), und schließt sie dann wieder. Der Arrow-Pool lädt sein Modell selbst, der Warm-up wartet darauf. Das Log `[Warmup] N new shader programs, compile X ms on the main thread, ready after Y ms; P empty pools drawn for one frame (Z ms)` zeigt, was der Schritt kostet. `preloadModels()` wird beim Laden nicht abgewartet, der Ladebildschirm wartet also nicht auf den Warm-up. Die X ms sind aber eine Blockade des Main-Threads, und der Upload-Frame ist ein Frame mit allen Uploads auf einmal.
- **R10 Log.** Beim `load-model` des TilesRenderer schreibt `three-engine/tile-material-log.ts` jeden Materialtyp einmal: `[Tiles] material type: MeshBasicMaterial x3 in the first tile that has it (unlit, ignores the scene lights)` bzw. `(lit, runs the scene lights)`. Steht dort nur `MeshBasicMaterial`, kosten die Lichter auf den Tiles nichts, und weniger Lichter lohnen sich kaum. Die Beleuchtung ist unverändert, die Zahl der PointLights bleibt 1.
- **Raycasts gegen die Tiles messen (BVH-Entscheidung).** `instrumentRaycasts()` (`utils/raycast-stats.ts`) umhüllt `tilesRenderer.group.raycast` einmal. Damit ist jeder Ray in die Tiles erfasst, auch die der Kamera-Steuerung. Aufrufer benennen sich mit `raycastStats.enter()`/`exit()`, der äußerste gewinnt. Die Liste der Aufrufer stand hier mit dem Stand vom 2026-09-12, darunter `towerRange` und `heightAtLocal`, die es nicht mehr gibt; die aktuelle Liste steht in [ARCHITECTURE.md](ARCHITECTURE.md#raycast-messung-__raycaststats). Ohne Aufrufer landet ein Ray unter `unscoped`. Treffer im Spalten-Cache kosten keinen Ray und tauchen nicht auf. In der Konsole gibt `__raycastStats()` pro Aufrufer Aufrufe, Summe, Mittel, Maximum, den längsten Burst (Rays mit weniger als 4 ms Abstand, also eine Schleife am Stück) und Treffer pro Ray aus, `__raycastStats(true)` setzt danach zurück. Kosten ohne Abfrage: zwei `performance.now()` und ein Map-Zugriff pro Ray.

## Nachtrag 2026-09-14: Kamera-Raycast-Cache, Benchmarks

- **Kamera-Raycast-Cache.** Die GlobeControls casten auch bei ruhender Kamera jeden Frame zwei Strahlen unter die Kamera in die Tiles (`EnvironmentControls.update()` und `adjustCamera()`, mit leicht verschiedenem Up-Vektor). Playtest 254 (`REVIEW_SPRINT_2026-09-13.md`) maß ohne Kameraberührung 0,27 ms je Strahl. `GroundPickRoot` beantwortet einen wiederholten Strahl jetzt aus einem Cache mit vier Einträgen, solange sich das Tile-Set nicht ändert; die Regeln stehen in ARCHITECTURE.md (Zeile `ground-pick-root.ts`). Ein Cache-Treffer kostet in Node 0,09 µs, derselbe Strahl gegen eine einzelne Ebene 0,43 µs (`tools/bench/ground-pick.bench.ts`). Im Browser nicht gemessen. Erwartet: in Ruhe fast keine Aufrufe mehr in der Zeile `cameraControls` von `__raycastStats()`, beim Bewegen der Kamera und während Tiles streamen so viele wie vorher.
- **Benchmarks** in `tools/bench/*.bench.ts`, Aufruf `npm run bench`, eine Datei per Filter (`npm run bench -- offscreen`). Vitest 5 führt Benchmarks als eigenes Projekt über `benchmark.include` aus (Default `**/*.bench.ts`), `bench` kommt aus dem Test-Kontext; `npm test` läuft sie nicht mit. Bedingungen aller Zahlen: Node 24.21, kein DOM, kein Rendern, keine Game-Loop, zwei Läufe am 2026-09-14 auf dem Windows-Rechner des Projekts, angegeben ist die Spanne der Mittelwerte. Vitest meldet, dass die Getter des Module-Runners für `isOffscreenThreat` und `METERS_PER_DEGREE_LAT` mitgemessen werden. Im gebündelten Spiel fallen sie weg, dort sind die Zahlen eher Obergrenzen.

**Offscreen-Pfeile** (`offscreen-indicators.bench.ts`): das echte `tick()` und `scan()` der Komponente auf einem Ersatz-`this`, 20.000 echte `Enemy` (10 Bosse), echte `EllipsoidSync`, Kamera wie beim Spielstart (400 m über dem HQ, Blick nach Norden, 1920 x 1080). Der Tick läuft mit 8 Hz.

| Welle | Bedrohungen | Tick in der Welle | Tick pausiert (nur Projektion) | nur Scan | pro Sekunde |
|-------|-------------|-------------------|--------------------------------|----------|-------------|
| entlang der Route verteilt | 3.023 | 0,89 bis 1,25 ms | 0,23 bis 0,29 ms | 0,59 bis 0,93 ms | 7 bis 10 ms |
| alle auf den letzten 15 % | 20.000 | 2,1 bis 3,5 ms | 1,2 bis 1,6 ms | 0,65 bis 1,1 ms | 17 bis 28 ms |

Gegner, die mit 0,5 bis 4 KB Füllmüll dazwischen über den Heap verstreut angelegt sind, unterscheiden sich von kompakt angelegten weniger als zwei Läufe untereinander. Ob der Tick im Spiel mit kaltem Heap teurer ist, zeigt nur ein Chrome-Trace. Im schlechtesten Fall (eine ganze Welle kurz vor dem HQ) blockiert ein Tick den Main-Thread alle 125 ms für 2 bis 3,5 ms, p99 bis 7,5 ms. Nicht geändert: Einen offensichtlich billigen Gewinn gibt es nicht. Die Projektion rechnet pro Punkt zwei Matrizen; eine kombinierte View-Projection-Matrix wäre ein Umbau der Projektionsrechnung, dessen Nutzen erst ein Trace belegen müsste.

**Hover-Pick der Tower** (`hover-pick.bench.ts`): das echte `ScreenPicker.raycastTowers()` gegen die echten Tower-GLBs (ohne Texturen), geklont, skaliert und gedreht wie in `ThreeTowerRenderer.create()`, auf einem 20-m-Raster um das HQ.

| Tower | Zeiger über dem Himmel | Zeiger auf dem Boden zwischen Towern | Zeiger auf dem zuletzt gesetzten Tower |
|-------|------------------------|--------------------------------------|----------------------------------------|
| 20 | 1,7 µs | 1,7 µs | 0,82 bis 0,88 ms |
| 80 | 7,8 µs | 7,7 µs | 0,74 bis 0,77 ms |

Der Pick testet nur Tower-Meshes, die Zahl der Gegner geht nicht ein. Ohne Treffer weisen die Bounding-Spheres jeden Tower ab; Zeit kostet nur der Treffer mit den Dreiecken des getroffenen Modells. Bei höchstens 10 Picks pro Sekunde sind das unter 9 ms pro Sekunde, und nur solange sich der Zeiger über Towern bewegt. Nebenbefund, nicht geändert und nicht nachgestellt: `raycastTowers()` gibt den ersten getroffenen Tower in Einfügereihenfolge zurück, nicht den nächsten zur Kamera. Stehen zwei Tower auf dem Schirm hintereinander, kann der hintere gewinnen. **Nachtrag:** behoben in `57858cb0` (2026-09-14), heute gewinnt der vorderste Treffer (`three-engine/screen-picker.ts`).
