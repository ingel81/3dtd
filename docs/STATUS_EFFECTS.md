# Status Effects System

**Stand:** 2026-09-14

Dokumentation des Status-Effekt-Systems für Debuffs und Buffs auf Enemies.

---

## Übersicht

Das Status-Effekt-System ermöglicht es Towern, temporäre Effekte auf Enemies anzuwenden (Verlangsamung, DoT, etc.). Effekte werden auf der `MovementComponent` jedes Enemies gespeichert und vom `StatusEffectService` (Angular `@Injectable`, in `services/combat/status-effect.service.ts`) angewendet.

**Aktuell implementiert:**
- **Slow** (Verlangsamung) — Ice Tower, Splash
- **Poison** (DoT) — Poison Tower, Splash
- **Burn** (DoT) — Fire Tower, jeder Gegner im Flammenkegel
- **Freeze** (Stopp) — Mechanik und Darstellung fertig, noch ohne Quelle
- **Stun** (Stopp, elektrisch) — wie Freeze mit eigener Darstellung, noch ohne Quelle

Status-Effekte hängen am Projektiltyp (`ice-shard`, `poison-glob`) bzw. am Fire-Beam, nicht am
Schadenstyp. Der Chaos Tower (Schadenstyp `chaos`, 1,0 gegen jede Rüstung) legt keinen Effekt.

> **Wichtig — Game-Time statt Wall-Clock:** Seit dem Sub-Step-Refactor laufen Status-Effekt-Timer **in Game-Time-Millisekunden** (deterministisch, unabhängig vom Speed-Multiplier). `effect.startTime` wird über einen `gameClockProvider` aus dem `GameStateManager` bezogen — kein `performance.now()` mehr.

---

## Architektur

### Status Effect Interface

```typescript
// models/status-effects.ts

export type StatusEffectType = 'slow' | 'freeze' | 'burn' | 'poison';

export interface StatusEffect {
  type: StatusEffectType;
  value: number;        // Effekt-Stärke (z.B. 0.5 = 50% slow, oder 8 = 8 DPS bei poison)
  duration: number;     // Dauer in Game-Time ms
  /** GameStateManager.gameTimeMs zum Zeitpunkt des Anwendens. */
  startTime: number;
  sourceId?: string;    // Tower ID für Refresh-Logik
  /** Nur DoT (poison, burn): Game-Time ms seit dem letzten Tick, überlebt Refreshes. */
  tickAccumMs?: number;
}
```

### StatusEffectService

```typescript
// services/combat/status-effect.service.ts

@Injectable({ providedIn: 'root' })
export class StatusEffectService {
  setGameClockProvider(provider: () => number): void;
  applySlow(enemy: Enemy, slowAmount: number, duration: number, sourceId: string): void;
  applyPoison(enemy: Enemy, dotDps: number, duration: number, sourceId: string): void;
  applyBurn(enemy: Enemy, dotDps: number, duration: number, sourceId: string): void; // In-place-Refresh
  applyFreeze(enemy: Enemy, duration: number, sourceId: string): void;
  applyStun(enemy: Enemy, duration: number, sourceId: string): void;
  applyEffect(enemy: Enemy, type: StatusEffectType, value: number, duration: number, sourceId: string): void;
  removeExpired(enemy: Enemy): void;
  hasActiveEffect(enemy: Enemy, type: StatusEffectType): boolean;
}
```

`setGameClockProvider()` wird einmal beim `GameStateManager.initialize()` aufgerufen. Vermeidet zirkuläre DI (CombatEffectService → StatusEffectService → GameStateManager → CombatEffectService).

### Component-Integration

Status-Effekte werden im `MovementComponent` gespeichert:

```typescript
// game-components/movement.component.ts

export class MovementComponent extends Component {
  statusEffects: StatusEffect[] = [];

  applyStatusEffect(effect: StatusEffect): void;
  /** Gleiche Slot-Regel, schreibt aber in den vorhandenen Eintrag (keine Allokation). */
  refreshStatusEffect(type, value, duration, startTime, sourceId): void;
  /** Single-Pass Update: entfernt abgelaufene Effekte + gibt aktive Flags zurück. */
  updateStatusEffects(gameTimeMs: number): {
    isSlowed: boolean; isPoisoned: boolean; isBurning: boolean;
    isFrozen: boolean; isStunned: boolean; isHalted: boolean; slowMultiplier: number;
  };
  removeExpiredEffects(gameTimeMs: number): void;
  getSlowMultiplier(gameTimeMs: number): number;
  getEffectiveSpeed(gameTimeMs: number): number;
  isSlowed(gameTimeMs: number): boolean;   // nur Slow, ein Freeze zählt nicht
  isFrozen(gameTimeMs: number): boolean;
  isStunned(gameTimeMs: number): boolean;
  isHalted(gameTimeMs: number): boolean;   // Freeze oder Stun
  isPoisoned(gameTimeMs: number): boolean;
  isBurning(gameTimeMs: number): boolean;
}
```

---

## Slow Effect (Verlangsamung)

### Funktionsweise

Slow-Effekte reduzieren die Bewegungsgeschwindigkeit von Enemies:

```typescript
effectiveSpeed = baseSpeed × speedMultiplier × slowMultiplier
```

**Beispiel:**
- Base Speed: 5 m/s
- Speed Multiplier: 1.0 (Walk) oder 2.5 (Run)
- Slow Multiplier: 0.5 (50% Verlangsamung)
- **Effective Speed:** 5 × 1.0 × 0.5 = 2.5 m/s

### Slow Multiplier Berechnung

```typescript
getSlowMultiplier(gameTimeMs: number): number {
  for (const effect of this.statusEffects) {
    if (effect.type === 'slow' && gameTimeMs - effect.startTime < effect.duration) {
      return 1 - effect.value;
    }
  }
  return 1.0; // Not slowed
}
```

**Wichtig:** `effect.duration` ist Game-Time ms. Da Movement und Effekt-Timer beide in Game-Time laufen, ist keine `timescale`-Kompensation mehr nötig.

### Kein Stacking

Slow-Effekte **stacken nicht** - es kann nur ein Slow gleichzeitig aktiv sein. Jeder neue Slow ersetzt den vorherigen (unabhängig von Source):

| Situation | Ergebnis |
|-----------|----------|
| Ice Tower A trifft → 50% slow | 50% langsamer |
| Ice Tower B trifft danach → 50% slow | Ersetzt vorherigen, weiterhin 50% langsamer (Timer reset) |

**Warum kein Stacking?**
- Einfachere Balance
- Verhindert dass Enemy komplett stoppt
- Ein Slow-Effekt pro Enemy reicht für klare Spielmechanik

### Anwendung

Slow wird via `StatusEffectService` angewendet. `CombatEffectService` reagiert auf `projectile:hit` Events und delegiert an `StatusEffectService`:

```typescript
// In StatusEffectService (services/combat/status-effect.service.ts)
applySlow(enemy: Enemy, slowAmount: number, duration: number, sourceId: string): void {
  enemy.movement.applyStatusEffect({
    type: 'slow',
    value: slowAmount,           // aus GAME_BALANCE.effects.ice.slowAmount (0.5)
    duration,                    // aus GAME_BALANCE.effects.ice.duration (3000ms)
    startTime: this.gameClockProvider(),
    sourceId,
  });
}

// Aufruf aus CombatEffectService:
// this.statusEffectService.applySlow(enemy, slowAmount, duration, projectile.sourceTowerId);
```

### Refresh-Logik

`slow` und `poison` werden **immer ersetzt** — es gibt kein Stacking. Jeder neue Effekt dieses Typs ersetzt den vorherigen, unabhängig von der Source.
Andere Effekttypen (`burn`, `freeze`) werden pro `(type, sourceId)` deduplikiert (gleiche Quelle = Refresh, andere Quelle = neuer Eintrag).
Ein ersetzter Eintrag gibt seine DoT-Tick-Phase (`tickAccumMs`) an den neuen weiter.

```typescript
applyStatusEffect(effect: StatusEffect): void {
  const idx = this.findEffectSlot(effect.type, effect.sourceId);
  if (idx < 0) {
    this.statusEffects.push(effect);
    return;
  }
  effect.tickAccumMs = this.statusEffects[idx].tickAccumMs;
  this.statusEffects[idx] = effect;
}

// slow/poison: Slot pro Typ; alle anderen: Slot pro Typ + Source
private findEffectSlot(type, sourceId): number { /* ... */ }
```

`refreshStatusEffect(type, value, duration, startTime, sourceId)` nutzt dieselbe Slot-Regel, schreibt aber in den vorhandenen Eintrag. Das ist für Quellen gedacht, die jeden Sub-Step neu anwenden (Fire-Beam): allokiert wird nur, wenn der Effekt beginnt.

**Beispiel:**
- Ice Tower A trifft Enemy → 50% slow, 3s
- Nach 1s: Ice Tower A trifft erneut → Timer wird auf 3s zurückgesetzt
- Nach 2s: Ice Tower B trifft Enemy → Ersetzt Slow von Tower A (weiterhin 50%, Timer reset)

### Cleanup

Abgelaufene Effekte werden im Single-Pass `updateStatusEffects(gameTimeMs)` entfernt (in-place Compact, keine Array-Allokation). Game-Time skaliert automatisch mit dem Timescale-Multiplier — bei 2× Speed läuft die Game-Clock doppelt so schnell, also auch die Effekt-Timer:

```typescript
// In EnemyManager (Sub-Step Loop)
const status = enemy.movement.updateStatusEffects(gameTimeMs);
// status.isSlowed, status.isPoisoned, status.slowMultiplier können direkt
// für Movement und DoT-Tick weiterverwendet werden.

// In MovementComponent
removeExpiredEffects(gameTimeMs: number): void {
  let writeIdx = 0;
  for (let i = 0; i < this.statusEffects.length; i++) {
    const e = this.statusEffects[i];
    if (gameTimeMs - e.startTime < e.duration) {
      this.statusEffects[writeIdx++] = e;
    }
  }
  this.statusEffects.length = writeIdx; // In-place, no allocation
}
```

---

## Poison Effect (DoT)

**Status:** Aktiv — vom Poison Tower und dessen Splash angewendet.

### Funktionsweise

```typescript
{
  type: 'poison',
  value: 8,                          // DPS, Basis GAME_BALANCE.effects.poison.dotDamagePerSecond
  duration: 4000,                    // 4 Sekunden Game-Time
  startTime: gameClockProvider(),
  sourceId: projectile.sourceTowerId,
}
```

Die Gift-DPS wächst mit dem Damage-Upgrade: `CombatEffectService.poisonDotDps()` rechnet
`8 × projectile.damage / TOWER_TYPES.poison.damage` (Basisschaden des Poison Tower, derzeit 5).
Hauptziel und Splash-Opfer bekommen denselben Wert.

**Implementierung:**
- DoT-Tick im Enemy-Sub-Step-Loop (`EnemyManager.tickDamageOverTime`): Game-Time-Akkumulator `tickAccumMs` auf dem Effekt, alle `COMBAT_TUNING.poisonTickIntervalMs` (500 ms) ein `dot:damage` mit `value × 0,5`.
- Kein Stacking — neuer Poison ersetzt den vorherigen (Timer-Refresh, Tick-Phase bleibt).
- `updateStatusEffects()` setzt `isPoisoned: true` als aktiver Flag.
- Tötet ein Tick, bekommt der Quell-Tower den Kill gutgeschrieben (`sourceId`).

### Anwendung (StatusEffectService)

```typescript
applyPoison(enemy: Enemy, dotDps: number, duration: number, sourceId: string): void {
  enemy.movement.applyStatusEffect({
    type: 'poison',
    value: dotDps,
    duration,
    startTime: this.gameClockProvider(),
    sourceId,
  });
}
```

---

## Burn Effect (DoT)

**Status:** Aktiv — vom Fire Tower auf jeden Gegner im Flammenkegel angewendet (seit 2026-09-11).

Design-Vorgabe ([MASTER_GAME_DESIGN.md §2.4](game-design/MASTER_GAME_DESIGN.md)): „X DPS, verhindert Regen, 3 s, Gegenmittel `immuneToBurn`". Umgesetzt ist der DoT. Regen gibt es im Spiel nicht, `immuneToBurn` ist noch nicht umgesetzt.

### Werte

Der Beam behält seine gesamte DPS (`damagePerSecond`, inkl. Damage-Upgrades). Ein Anteil davon läuft als Burn statt direkt:

```typescript
// GAME_BALANCE.effects.burn
beamDpsShare: 0.2,   // 20 % der effektiven Beam-DPS werden Burn-DPS
duration: 3000,      // Game-Time ms, bei jedem Sub-Step im Kegel erneuert

// TowerCombatService.updateBeamTowers
const burnDps = dps * beamDpsShare;          // 35 DPS Basis → 7 Burn-DPS
const damageThisFrame = (dps - burnDps) * dt; // 28 DPS direkt
```

Im Kegel nimmt ein Gegner damit dieselbe Summe wie vorher; verlässt er ihn, brennt er bis zu 3 s nach (Basis: bis zu 6 Ticks à 3,5 Schaden). Schadenstyp ist `fire`, die Damage-Matrix greift pro Tick wie beim Beam.

### Stacking

Burn wird **pro Source** geführt (allgemeine Regel, siehe Refresh-Logik): derselbe Fire Tower erneuert seinen Eintrag, ein zweiter Fire Tower legt einen eigenen daneben. So addieren sich zwei Burns wie ihre Beams, und der Split bleibt auch bei überlappenden Türmen neutral. Poison und Burn sind getrennte Effekte und wirken gleichzeitig.

### Tick

Wie Poison im Enemy-Sub-Step (`EnemyManager.tickDamageOverTime`), aber je Burn-Eintrag mit eigenem Akkumulator: alle `COMBAT_TUNING.burnTickIntervalMs` (500 ms) ein `dot:damage` mit `effectType: 'burn'`, `damageType: 'fire'` und der Tower-ID als `sourceId`. Da der Beam per `refreshStatusEffect` in den Eintrag schreibt, läuft die Tick-Phase durch, solange der Gegner im Kegel steht; nach dem Ablauf beginnt ein neuer Burn bei 0.

---

## Freeze (Stopp)

**Status:** Mechanik und Darstellung seit 2026-09-14; eine Quelle gibt es noch nicht.

Ein eingefrorener Gegner **hält an**, solange der Effekt läuft (`MovementComponent.isHalted()`):

- keine Bewegung: `slowMultiplier` 0, in `updateStatusEffects()` und `getSlowMultiplier()` gleich und unabhängig von der Reihenfolge der Einträge. Ein gleichzeitiger Slow ist wirkungslos, nach dem Auftauen gilt sein Rest wieder.
- kein Laufzyklus: das Renderer-Tempo folgt der Geschwindigkeit, bei 0 steht die VAT-Animation.
- kein Wechsel zwischen Gehen und Rennen: `EnemyManager.update` tickt `enemy.rush` nicht, solange `isHalted` gilt.
- Gegner greifen im Spiel nichts an. Ein späteres Angriffssystem fragt `isHalted()`.
- Schaden über Zeit läuft weiter, Tower zielen und treffen wie sonst. Ein Freeze ist kein Slow: `isSlowed()` meldet nur den Slow des Ice Towers.

`value` wird nicht gelesen (der Service schreibt 1). Freeze wird pro Quelle geführt wie Burn: dieselbe Quelle erneuert ihren Eintrag, und damit ihre Dauer ab jetzt. Die Dauer läuft in Spielzeit, der Timer steht in der Pause.

```typescript
this.statusEffectService.applyFreeze(enemy, 3000, 'ability:frost-bomb');
```

## Stun (Stopp, elektrisch)

**Status:** seit 2026-09-14, eine Quelle gibt es noch nicht.

Derselbe Stopp wie Freeze (`isHalted()`, Multiplikator 0, kein Laufzyklus, kein Gehen/Rennen-Wechsel), als eigener Typ, damit Darstellung und Quelle ihn auseinanderhalten: `isStunned()`, `applyStun(enemy, durationMs, sourceId)`, pro Quelle geführt. Ein Gegner kann gleichzeitig eingefroren und betäubt sein; er steht, bis beides abgelaufen ist.

---

## Ice Tower Integration (Slow Example)

Der Ice Tower wendet Slow auf das Hauptziel und alle Splash-Opfer an (8 m, Luft und Boden). Die Logik liegt im `CombatEffectService`, der event-driven auf `projectile:hit` Events reagiert:

```typescript
// In CombatEffectService.handleProjectileHit() (via projectile:hit Event)
const isIceShard = projectile.typeConfig.id === 'ice-shard';

// Eis-Burst und Frost-Decals am Treffer
if (hasSplash && isIceShard) this.vfx.emitIceExplosion(enemy);

if (!targetLost) {
  // Schaden auf Hauptziel (ohne Blut bei Ice und Poison)
  this.damageService.applyDamage(this.vfx, enemy, projectile.damage, damageType,
    projectile.sourceTowerId, false, suppressBlood);

  // Slow auf Hauptziel
  if (isIceShard) {
    this.statusEffectService.applySlow(
      enemy,
      GAME_BALANCE.effects.ice.slowAmount,  // 0.5
      GAME_BALANCE.effects.ice.duration,    // 3000ms
      projectile.sourceTowerId
    );
  }
}

// Splash, auch wenn das Hauptziel im Flug starb (dann um den Einschlagpunkt)
if (hasSplash) {
  this.applySplashDamage(projectile, originPos, excludeId, splashRadius, damageType, isIceShard, isPoisonGlob);
}

// applySplashDamage(): Kandidaten aus globalRouteGrid.getEnemiesInRadiusGeo(), nur auf
// Ebenen, die der Quell-Tower anvisieren darf, höchstens splashMaxTargets (nächste zuerst).
// Pro Opfer Splash-Schaden mit Distance-Falloff, beim Ice Shard dazu applySlow() und
// ein Frost-Decal.
```

**Konfiguration** (aus `configs/game-balance.config.ts`):
```typescript
effects: {
  ice: {
    slowAmount: 0.5,   // 50% Verlangsamung
    duration: 3000,     // 3 Sekunden
  },
}
```

---

## Visuelle Effekte

### Slow Effect (Ice Tower)

**Aktuell implementiert:**
- Eis-Explosion (Partikel) am Einschlagort (`spawnIceExplosionAtGeo`)
- Eis-Decals auf dem Boden (nur bei Ground Units, `spawnIceDecal`)
- Zusätzliche kleinere Decals im Umkreis
- Blauer Tint auf der Instanz und Frost-Aura, solange der Slow wirkt (`setFreezeVisual`, `spawnFrostAura`), flankengesteuert in `EnemyManager.presentFrame()`
- Langsamere Bewegung des Enemies

**Geplant:**
- Blauer Glow um Enemy
- Icon über Health Bar

### Freeze Effect

**Aktuell implementiert** (flankengesteuert in `EnemyManager.presentFrame()`, wie Slow):
- Weiß-cyaner Tint (`setIcedVisual`, Tint `0.9, 0.97, 1.0`), Priorität direkt nach dem Hit-Flash und vor dem Slow-Tint. Er gilt auch mit ausgeschaltetem Freeze Tint (VFX-Einstellung): der Schalter betrifft den Slow, der Stopp soll lesbar bleiben.
- Vier stille Eiskristalle um den Körper (`spawnIceCrystals` im `AuraRenderer`, additive Partikel aus dem Trail-Pool, feste Plätze, keine Bahn), höchstens auf `ICE_CRYSTAL_CAP` (48) Gegnern gleichzeitig; darüber nur der Tint.
- Der Laufzyklus steht (siehe oben).

### Stun Effect

**Aktuell implementiert** (in `EnemyManager.presentFrame()`):
- Violett-blauer Tint (`setStunVisual`, `0.6, 0.5, 1.0`), Priorität nach dem Eis-Tint.
- Funken: ein Spark-Burst (`BURST_PALETTES.stun`, 5 Partikel, 1,6 m über den Füßen) je betäubtem Gegner alle 400 ms Spielzeit (`STUN_SPARKS`), höchstens 8 Bursts pro gerendertem Frame, die übrigen im nächsten. In der Pause kommen keine neuen dazu. Pool und Schalter der Impact-Bursts: mit Impact Effects aus keine Funken.

### Poison Effect

**Aktuell implementiert:**
- Grüner Tint auf der Instanz und Gift-Aura (`setPoisonVisual`, `spawnPoisonAura`), flankengesteuert in `EnemyManager.presentFrame()`
- Grüne Schadenszahlen pro Tick

### Burn Effect

**Aktuell implementiert:**
- Oranger Tint auf der Instanz (`setBurnVisual`, Priorität: Hit-Flash > Freeze (Stopp) > Stun > Slow > Burn > Poison), flankengesteuert in `EnemyManager.presentFrame()`
- Orange Schadenszahlen pro Tick

### Ooze (Körper entlang der Route)

Die Ooze ist ein Gegner mit einem HP-Pool; jeder Effekt wirkt auf das Ganze. Slow
verlangsamt die Spitze, der Schwanz folgt ihr, und an der HQ fließt der Körper
langsamer hinein. Statt Instanz-Tint und Aura tönt `OozeBandRenderer` das Band: Slow
blau, Poison dunkler, Burn glüht orange (`OOZE_LOOK`). DoT-Zahlen erscheinen am Punkt
des letzten Treffers (ENEMY_CREATION.md, Körper entlang der Route).

**Geplant:**
- Feuer-Partikel am brennenden Gegner (ähnlich wie HQ Fire)
- Rauch-Partikel

---

## Performance-Überlegungen

### Status Effect Array

- Pro Enemy: 0-5 Effekte (typisch 0-2)
- Update pro Sub-Step: ein Durchlauf mit In-place-Compaction (`updateStatusEffects`), O(n) mit n = Anzahl Effekte, keine Allokation
- Kein Problem bei <1000 Enemies

### Optimization Möglichkeiten

1. **Max Effects Limit:**
   ```typescript
   const MAX_EFFECTS = 5;
   if (this.statusEffects.length >= MAX_EFFECTS) {
     this.statusEffects.shift(); // Remove oldest
   }
   this.statusEffects.push(effect);
   ```

2. **Batch Cleanup:**
   ```typescript
   // Nur alle 100ms cleanen statt jedes Frame
   if (now - this.lastCleanup > 100) {
     this.removeExpiredEffects();
     this.lastCleanup = now;
   }
   ```

---

## Erweiterung: Neue Status-Effekte

### 1. Effekt-Typ definieren

```typescript
// models/status-effects.ts
export type StatusEffectType = 'slow' | 'freeze' | 'burn' | 'poison' | 'NEW_EFFECT';
```

### 2. Anwendungs-Logik

```typescript
// Über den StatusEffectService, damit startTime aus der Game-Clock kommt
this.statusEffectService.applyEffect(enemy, 'NEW_EFFECT', 1.0, 5000, tower.id);
```

Ein neuer Typ wird pro Quelle geführt: `findEffectSlot` gibt nur `slow` und `poison` einen Slot pro Typ.

### 3. Effekt-Handling

**Option A: In MovementComponent (für Movement-Effekte)**

```typescript
// movement.component.ts
getNewEffectMultiplier(gameTimeMs: number): number {
  // Ähnlich wie getSlowMultiplier()
}
```

**Option B: In EnemyManager (für Damage-Effekte)**

Neuen DoT-Typ in `EnemyManager.tickDamageOverTime()` eintragen (Tick-Intervall und Schadenstyp), ein Flag in `updateStatusEffects()` ergänzen und den Tick darüber freischalten. Schaden läuft immer über `dot:damage`, nie direkt über `health.takeDamage()`, damit Damage-Matrix, Kill-Gutschrift und Schadenszahlen greifen.

### 4. Visuals (optional)

```typescript
// EnemyManager.presentFrame(), Muster Burn: das Visual nur beim Wechsel schalten
const isBurning = enemy.movement.isBurning(gameTimeMs);
if (isBurning !== this.burnVisualEnemies.has(enemy.id)) {
  engine.enemies.setBurnVisual(enemy.id, isBurning); // Tint-Priorität in EnemyInstanceManager.applyTint()
  // burnVisualEnemies nachführen
}
```

---

## Testing

### Manual Testing

`startTime` muss aus dem Game-Clock kommen (nicht `performance.now()`), sonst läuft der Timer asynchron zur Spiellogik:

```typescript
// In Wave Debug Component
constructor(private statusEffectService: StatusEffectService, ...) {}

testSlowEffect(): void {
  const enemies = this.enemyManager.getAlive();
  for (const enemy of enemies) {
    this.statusEffectService.applyEffect(enemy, 'slow', 0.7, 10000, 'debug');
  }
}
```

### Console Commands

```typescript
// Im Browser Console (ohne Game-Clock-Zugriff): nur grobe Tests, da
// performance.now() vom Game-Clock abweicht. Besser: über DebugFacade einen
// passenden Helper aufrufen.
```

---

## Siehe auch

- [ENEMY_CREATION.md](ENEMY_CREATION.md) - Enemy-Typen erstellen
- [TOWER_CREATION.md](TOWER_CREATION.md) - Tower-Typen erstellen
- [PROJECTILES.md](PROJECTILES.md) - Projektil-System
- [ARCHITECTURE.md](ARCHITECTURE.md) - System-Übersicht
