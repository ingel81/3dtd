# Vollstaendiger Balancing-Plan: 3DTD Schwierigkeitsanpassung

> **Status: IMPLEMENTIERT** (2026-01-25)
> Alle Phasen 1-4 wurden umgesetzt. Neues Training erforderlich.

## Executive Summary

Das Spiel ist zu leicht. Ursachen:
1. **Archer extrem OP** (0.80 Cost/DPS vs. 1.80+ bei anderen)
2. **Feste Rewards** skalieren nicht mit AI-generierter Schwierigkeit
3. **Bot spielt zu optimal** (makeSuboptimalAction tut nichts)
4. **Wirtschaft eskaliert zu schnell** (70 Start + 50/Wave)

> **Hinweis:** Dieses Dokument beruecksichtigt die Training-History aus `AI_TRAINING_SESSION_NOTES.md`.
> Riskante Aenderungen (neue Model-Outputs, Architektur-Aenderungen) wurden bewusst vermieden.

---

## Teil 1: Tower Balancing

### 1.1 Aktuelle DPS-Analyse

| Tower | Cost | Damage | FireRate | DPS | Cost/DPS | Problem |
|-------|------|--------|----------|-----|----------|---------|
| **Archer** | 20 | 25 | 1.0 | 25 | **0.80** | MASSIV OP |
| Gatling | 90 | 10 | 5.0 | 50 | 1.80 | OK |
| Magic | 150 | 40 | 1.5 | 60 | 2.50 | Leicht teuer |
| Cannon | 175 | 75 | 0.5 | 37.5 | 4.67 | Zu teuer |
| Rocket | 100 | 40 | 0.5 | 20 | 5.00 | Air-only |
| Ice | 120 | 2 | 0.33 | 0.66 | N/A | Utility |

### 1.2 Upgrade-Analyse (voll aufgeruestet)

| Tower | Base Cost | Upgrade Costs | Total | Max DPS | Final Cost/DPS |
|-------|-----------|---------------|-------|---------|----------------|
| Archer | 20 | 40 | 60 | 50 | **1.20** |
| Gatling | 90 | 1350 | 1440 | 800 | 1.80 |
| Magic | 150 | 671 | 821 | 202.5 | 4.05 |
| Cannon | 175 | 1477 | 1652 | 284.8 | 5.80 |
| Rocket | 100 | 364 | 464 | 80 | 5.80 |

**Problem:** 24 Archer (480 Credits) = 600 DPS. 1 voll upgegradeter Gatling (1440 Credits) = 800 DPS.
Archer-Spam ist IMMER besser.

### 1.3 Vorgeschlagene Tower-Aenderungen

| Tower | Stat | Aktuell | Neu | Begruendung |
|-------|------|---------|-----|-------------|
| **Archer** | cost | 20 | **45** | Cost/DPS 0.80 -> 1.80 |
| **Archer** | sellValue | 12 | **27** | 60% von cost |
| Magic | cost | 150 | **120** | Attraktiver machen |
| Magic | sellValue | 90 | **72** | 60% von cost |
| Cannon | cost | 175 | **140** | Cost/DPS 4.67 -> 3.73 |
| Cannon | sellValue | 120 | **84** | 60% von cost |
| Ice | cost | 120 | **90** | Utility guenstiger |
| Ice | sellValue | 72 | **54** | 60% von cost |
| Rocket | sellValue | 120 | **60** | BUG: War > cost! |

### 1.4 Neue Cost/DPS Ratios

| Tower | Neu Cost | DPS | Neu Cost/DPS | Rolle |
|-------|----------|-----|--------------|-------|
| Archer | 45 | 25 | 1.80 | Einstieg |
| Gatling | 90 | 50 | 1.80 | DPS-Monster |
| Magic | 120 | 60 | 2.00 | Balanced |
| Cannon | 140 | 37.5 | 3.73 | AoE/Range |
| Rocket | 100 | 20 | 5.00 | Anti-Air |
| Ice | 90 | 0.66 | N/A | Utility |

---

## Teil 2: Enemy Rewards (Dynamisch)

### 2.1 Aktuelles Problem

Die AI generiert `healthMultiplier` basierend auf Player-DPS:
```
enemy_hp = player_dps * kill_time
healthMultiplier = enemy_hp / base_hp
```

Aber Rewards sind FIX:
| Enemy | Base HP | Reward | Bei 3x healthMult | HP/Credit |
|-------|---------|--------|-------------------|-----------|
| Zombie | 80 | 1 | 240 HP | 240:1 (unfair!) |
| Tank | 250 | 7 | 750 HP | 107:1 |

### 2.2 Dynamische Reward-Formel (v3.5 - reduziert auf ~1/3)

```typescript
function calculateDynamicReward(enemy: Enemy): number {
  const healthMultiplier = enemy.health.maxHp / enemy.typeConfig.baseHp;
  const effectiveHP = enemy.health.maxHp;
  const speedBonus = Math.floor(enemy.typeConfig.baseSpeed / 10); // War: /5

  // Sublineares Scaling (sqrt) verhindert Inflation
  // 150 HP pro Credit (war 50) - ca. 1/3 der alten Rewards
  const hpReward = Math.floor(effectiveHP / 150);
  const scaleFactor = 1 + Math.sqrt(Math.max(0, healthMultiplier - 1)) * 0.4; // War: 0.6

  const baseReward = Math.max(1, hpReward + speedBonus);
  const dynamicReward = Math.round(baseReward * Math.min(scaleFactor, 2.0)); // War: 2.5

  return Math.min(25, Math.max(1, dynamicReward)); // Cap: 1-25 (war 1-40)
}
```

### 2.3 Reward-Beispiele (v3.5)

| Enemy | healthMult | Actual HP | Speed Bonus | Reward |
|-------|------------|-----------|-------------|--------|
| Zombie | 1.0 | 80 | +0 | 1 |
| Zombie | 2.0 | 160 | +0 | 1 |
| Zombie | 5.0 | 400 | +0 | 3 |
| Tank | 1.0 | 250 | +0 | 1 |
| Tank | 3.0 | 750 | +0 | 6 |
| Bat | 1.0 | 25 | +0 | 1 |
| Bat | 4.0 | 100 | +0 | 1 |
| Penguin | 1.0 | 30 | +0 | 1 |
| Herbert | 2.0 | 1000 | +0 | 8 |
| Herbert | 5.0 | 2500 | +0 | 25 (cap) |

---

## Teil 3: Wirtschaft

### 3.1 Aktuelle Eskalation

| Wave | Credits Vorher | Wave Bonus | Kills (~15) | Total | Kumulativ |
|------|----------------|------------|-------------|-------|-----------|
| Start | - | - | - | 70 | 70 |
| 1 | 70 | 50 | 15 | 65 | 135 |
| 5 | - | 50 | 20 | 70 | ~400 |
| 10 | - | 50 | 25 | 75 | ~775 |

**Problem:** Wave-Bonus (50) dominiert. Kill-Rewards sind irrelevant (~20%).

### 3.2 Neue Wirtschafts-Parameter

| Parameter | Aktuell | Neu | Begruendung |
|-----------|---------|-----|-------------|
| startCredits | 70 | **50** | 1 Archer (45) + Reserve |
| waveBonus | 50 | **35** | Kill-Rewards relevanter |

### 3.3 Neue Progression

| Wave | Start | Bonus | Dyn. Kills | Total | Kumulativ |
|------|-------|-------|------------|-------|-----------|
| Start | 50 | - | - | - | 50 |
| 1 | - | 35 | 20 | 55 | 105 |
| 5 | - | 35 | 40 | 75 | ~350 |
| 10 | - | 35 | 60 | 95 | ~700 |

---

## Teil 4: AI Wave Director Parameter

### 4.1 Bereits optimierte Parameter (v3.4 - NICHT AENDERN)

Diese Parameter wurden in v3.4 nach umfangreichen Tests eingestellt:

| Parameter | Wert | Begruendung |
|-----------|------|-------------|
| ENTROPY_COEF | 0.08 | Verhindert Typ-Spezialisierung |
| TYPE_COOLDOWN_WAVES | 4 | Erzwingt Typ-Diversity |
| REWARD_VARIETY_BONUS | 0.20 | Belohnt verschiedene Typen |
| REWARD_BORING_THRESHOLD | 0.30 | Bestraft zu einfache Wellen |

> **Warnung:** Aenderungen an diesen Parametern haben in der Vergangenheit zu Training-Kollaps gefuehrt.
> Siehe `AI_TRAINING_SESSION_NOTES.md` fuer Details.

### 4.2 Optionale Anpassungen (vorsichtig testen)

| Parameter | Aktuell | Optional | Risiko |
|-----------|---------|----------|--------|
| KILL_TIME_MIN | 1.5s | 2.0s | Niedrig - verhindert instant-kill |
| KILL_TIME_MAX | 4.0s | 5.0s | Niedrig - mehr Range |
| healthMultiplier | unbegrenzt | cap 20.0 | Niedrig - verhindert absurde Werte |

### 4.3 NICHT implementieren: speedMultiplier

~~**Hinzufuegen in model.py:**~~ - GESTRICHEN

> **Grund:** Das Hinzufuegen eines neuen Model-Outputs (5 statt 4 Parameter) wuerde:
> - Bestehende Checkpoints inkompatibel machen
> - Training von Null erfordern
> - Risiko eines erneuten Kollapses (siehe v3.3 -> v3.4 Rollback)
>
> Die Training-History zeigt: Jede Architektur-Aenderung ist hochriskant.

---

## Teil 5: Bot-Anpassungen

### 5.1 Bot-Architektur (Klarstellung)

Es gibt nur **einen Bot** (`StrategyBot`) der verwendet wird:
- Die Factory erstellt `StrategyBot` mit verschiedenen Strategy-Sets
- Die alten Klassen (`StrategistBot`, `BeginnerBot`, etc.) sind **Legacy-Code**
- Die verschiedenen Skill-Level sind Konfigurationen, keine separaten Bots

### 5.2 Identifizierte Probleme

1. **makeSuboptimalAction() tut nichts** - Default-Implementierung gibt Original zurueck
2. **60% Spar-Wahrscheinlichkeit** - Zu geduldig
3. **Kein Archer-Limit** - Bot spammt OP-Tower

### 5.3 Bot-Fixes

**5.3.1 makeSuboptimalAction implementieren (strategy-bot.ts):**

Das Problem ist NICHT der Aufruf (der existiert in `BaseTowerBot.update()`), sondern die leere Implementierung.

```typescript
// In StrategyBot hinzufuegen:
protected override makeSuboptimalAction(
  state: GameStateSnapshot,
  originalAction: TowerAction
): TowerAction {
  // Zufaellig anderen Tower-Typ waehlen
  if (originalAction.type === 'place' && originalAction.towerType) {
    const alternatives = this.config.knownTowerTypes.filter(
      t => t !== originalAction.towerType
    );
    if (alternatives.length > 0 && Math.random() < 0.5) {
      const randomType = alternatives[Math.floor(Math.random() * alternatives.length)];
      return {
        ...originalAction,
        towerType: randomType,
        reason: `Mistake: ${randomType} statt ${originalAction.towerType}`,
        confidence: (originalAction.confidence ?? 0.8) * 0.6,
      };
    }
  }

  // Position leicht verschieben
  if (originalAction.position) {
    return {
      ...originalAction,
      position: {
        x: originalAction.position.x + (Math.random() - 0.5) * 20,
        z: originalAction.position.z + (Math.random() - 0.5) * 20,
      },
      confidence: (originalAction.confidence ?? 0.8) * 0.7,
    };
  }

  return originalAction;
}
```

**5.3.2 Spar-Wahrscheinlichkeit reduzieren (distributed-placement.strategy.ts):**
```typescript
// Zeile ~85: 60% -> 30%
if (Math.random() < 0.30) {  // War: 0.6
  this.savingForType = target;
  return { type: 'wait', reason: `Saving for ${target}` };
}
```

**5.3.3 Archer-Limit (neue Regel):**
```typescript
// Max 4 Archer, dann andere erzwingen
const archerCount = existingTowers.filter(t => t.typeConfig.id === 'archer').length;
if (chosen === 'archer' && archerCount >= 4) {
  const nonArcher = affordable.filter(t => t !== 'archer');
  if (nonArcher.length > 0) {
    chosen = nonArcher[Math.floor(Math.random() * nonArcher.length)];
  }
}
```

---

## Teil 6: Vollstaendige Parameter-Konstellationen

### 6.1 DPS vs. Enemy HP Matrix (kill_time = 2.5s)

| Player DPS | Enemy HP | Zombie Mult | Tank Mult | Penguin Mult |
|------------|----------|-------------|-----------|--------------|
| 50 | 125 | 1.56x | 0.50x | 4.17x |
| 100 | 250 | 3.13x | 1.00x | 8.33x |
| 250 | 625 | 7.81x | 2.50x | 20.83x |
| 500 | 1250 | 15.63x | 5.00x | 41.67x |
| 1000 | 2500 | 31.25x | 10.00x | 83.33x |

### 6.2 Wave-Durchsatz (200m Pfad, 40m Kill-Zone)

| DPS | HP | Count | Spawn Delay | Gleichzeitig | Survivors |
|-----|-----|-------|-------------|--------------|-----------|
| 100 | 200 | 15 | 500ms | ~4 | 3-5 |
| 100 | 200 | 15 | 1000ms | ~2 | 0-2 |
| 250 | 500 | 20 | 500ms | ~6 | 5-8 |
| 250 | 500 | 20 | 1000ms | ~3 | 2-4 |
| 500 | 1000 | 25 | 500ms | ~8 | 8-12 |

### 6.3 Sweet-Spot Parameter (Ziel: 55% Progress)

| Wave | DPS | kill_time | count | spawn_delay | healthMult |
|------|-----|-----------|-------|-------------|------------|
| 1-3 | 50-100 | 2.0-2.5s | 8-12 | 800-1200ms | 1.5-3.0x |
| 5-8 | 150-300 | 2.5-3.5s | 15-25 | 600-1000ms | 3.0-6.0x |
| 10-15 | 400-700 | 3.0-4.5s | 25-40 | 500-800ms | 6.0-12.0x |
| 15+ | 800+ | 4.0-6.0s | 35-50 | 500-700ms | 10.0-20.0x |

---

## Teil 7: Implementierungs-Reihenfolge

### Phase 1: Tower & Wirtschaft (sicher, keine AI-Aenderung)

| Datei | Aenderung |
|-------|-----------|
| `tower-types.config.ts` | Archer cost 20->45, sellValue 12->27 |
| `tower-types.config.ts` | Rocket sellValue 120->60 (Bug-Fix) |
| `tower-types.config.ts` | Magic 150->120, Cannon 175->140, Ice 120->90 |
| `game-balance.config.ts` | startCredits 70->50, waveBonus 50->35 |

### Phase 2: Dynamische Rewards (sicher)

| Datei | Aenderung |
|-------|-----------|
| `enemy.manager.ts` | `calculateDynamicReward()` Funktion |
| `enemy.manager.ts` | In `kill()`: dynamicReward statt fixed |

### Phase 3: Bot-Fixes (sicher)

| Datei | Aenderung |
|-------|-----------|
| `strategy-bot.ts` | `makeSuboptimalAction()` ueberschreiben |
| `distributed-placement.strategy.ts` | Spar-Rate 60%->30% |
| `distributed-placement.strategy.ts` | Archer-Limit (max 4) |

### Phase 4: AI-Parameter (optional, vorsichtig)

| Datei | Aenderung | Risiko |
|-------|-----------|--------|
| `config.py` | KILL_TIME_MIN 1.5->2.0 | Niedrig |
| `server.py` | healthMultiplier cap bei 20x | Niedrig |

> **Nicht implementieren:** speedMultiplier, Model-Aenderungen, count-Erweiterung

---

## Teil 8: Dateien und Code-Aenderungen

### 8.1 `src/app/configs/tower-types.config.ts`

```typescript
archer: {
  cost: 45,      // War: 20
  sellValue: 27, // War: 12
  // Rest bleibt
},
magic: {
  cost: 120,     // War: 150
  sellValue: 72, // War: 90
},
cannon: {
  cost: 140,      // War: 175
  sellValue: 84,  // War: 120
},
ice: {
  cost: 90,      // War: 120
  sellValue: 54, // War: 72
},
rocket: {
  sellValue: 60, // War: 120 (BUG!)
},
```

### 8.2 `src/app/configs/game-balance.config.ts`

```typescript
export const GAME_BALANCE = {
  player: {
    startHealth: 100,
    startCredits: 50,    // War: 70
  },
  waves: {
    completionBonus: 35, // War: 50
  },
  // Rest bleibt
};
```

### 8.3 `src/app/managers/enemy.manager.ts` (in kill() Methode)

```typescript
kill(enemy: Enemy, timescale = 1.0): void {
  // ... existing code ...

  // Dynamische Reward-Berechnung (v3.5 - reduziert auf ~1/3)
  const healthMultiplier = enemy.health.maxHp / enemy.typeConfig.baseHp;
  const effectiveHP = enemy.health.maxHp;
  const speedBonus = Math.floor(enemy.typeConfig.baseSpeed / 10); // War: /5

  const hpReward = Math.floor(effectiveHP / 150); // War: /50
  const scaleFactor = 1 + Math.sqrt(Math.max(0, healthMultiplier - 1)) * 0.4; // War: 0.6
  const baseReward = Math.max(1, hpReward + speedBonus);
  const dynamicReward = Math.round(baseReward * Math.min(scaleFactor, 2.0)); // War: 2.5
  const finalReward = Math.min(25, Math.max(1, dynamicReward)); // War: 40

  this.eventBus.emit({
    type: 'enemy:died',
    enemy,
    credits: finalReward,  // War: enemy.typeConfig.reward
  });

  // ... rest of method ...
}
```

### 8.4 `src/app/ai/training/bots/strategy-bot.ts`

```typescript
// Neue Methode hinzufuegen:
protected override makeSuboptimalAction(
  state: GameStateSnapshot,
  originalAction: TowerAction
): TowerAction {
  // Zufaellig anderen Tower-Typ waehlen
  if (originalAction.type === 'place' && originalAction.towerType) {
    const alternatives = this.config.knownTowerTypes.filter(
      t => t !== originalAction.towerType
    );
    if (alternatives.length > 0 && Math.random() < 0.5) {
      const randomType = alternatives[Math.floor(Math.random() * alternatives.length)];
      return {
        ...originalAction,
        towerType: randomType,
        reason: `Mistake: ${randomType} statt ${originalAction.towerType}`,
        confidence: (originalAction.confidence ?? 0.8) * 0.6,
      };
    }
  }

  // Position leicht verschieben
  if (originalAction.position) {
    return {
      ...originalAction,
      position: {
        x: originalAction.position.x + (Math.random() - 0.5) * 20,
        z: originalAction.position.z + (Math.random() - 0.5) * 20,
      },
      confidence: (originalAction.confidence ?? 0.8) * 0.7,
    };
  }

  return originalAction;
}
```

### 8.5 `src/app/ai/training/strategies/placement/distributed-placement.strategy.ts`

```typescript
// Zeile ~85: Spar-Rate reduzieren
if (Math.random() < 0.30) {  // War: 0.60
  this.savingForType = target;
  return { type: 'wait', reason: `Saving for ${target}` };
}

// Nach Tower-Typ-Auswahl: Archer-Limit
const archerCount = existingTowers.filter(t =>
  t.typeConfig.id === 'archer'
).length;
if (chosen === 'archer' && archerCount >= 4) {
  const alternatives = affordable.filter(t => t !== 'archer');
  if (alternatives.length > 0) {
    chosen = alternatives[Math.floor(Math.random() * alternatives.length)];
  }
}
```

### 8.6 `training-backend/config.py` (optional)

```python
# Nur diese Aenderung - vorsichtig testen
KILL_TIME_MIN = 2.0  # War: 1.5

# NICHT AENDERN (v3.4 optimiert):
# ENTROPY_COEF = 0.08
# TYPE_COOLDOWN_WAVES = 4
# REWARD_VARIETY_BONUS = 0.20
# REWARD_BORING_THRESHOLD = 0.30
```

### 8.7 `training-backend/server.py` (optional)

```python
# Nach health_mult Berechnung (in _decode_action):
health_mult = min(health_mult, 20.0)  # Cap bei 20x
```

---

## Teil 9: Verifikation

### 9.1 Build & Lint
```bash
npm run build  # Keine TypeScript-Fehler
npm run lint   # Keine ESLint-Fehler
```

### 9.2 Manueller Test (ohne Bot)
1. `http://localhost:4200/?devworld=&terrain=flat`
2. Pruefen:
   - Start-Credits = 50
   - Archer kostet 45
   - Wave-Bonus = 35
   - Kill-Rewards steigen mit Wave-Nummer

### 9.3 Bot-Test
1. `http://localhost:4200/?devworld=&terrain=flat&bot=auto`
2. Beobachten:
   - Bot macht gelegentlich "Fehler" (falscher Tower-Typ, Position-Offset)
   - Nicht mehr als 4 Archer
   - Weniger geduldiges Sparen

### 9.4 Training-Test (nur nach Phase 4)
1. Training starten mit neuen Parametern
2. Beobachten:
   - kill_time durchschnittlich bei 2.5s+ (nicht 1.6s)
   - healthMultiplier bleibt unter 20x
   - Keine Regression bei avg_reward

---

## Teil 10: Risiken und Mitigationen

| Risiko | Mitigation |
|--------|------------|
| Zu schwer fuer Anfaenger | Wave 1-3 haben niedrigen healthMult |
| Dynamische Rewards zu hoch | Cap bei 40 Credits |
| Bot zu schlecht | mistakeRate anpassen (Config: 5-40%) |
| Training divergiert | Rollback zu Checkpoint, keine Model-Aenderungen |
| Archer-Limit frustriert | Limit auf 4-5 belassen |

---

## Zusammenfassung

**Kern-Aenderungen:**
1. Archer 20->45 (Cost/DPS angleichen)
2. Dynamische Rewards (HP/150, Speed/10, Scale 0.4, Cap 25 - ca. 1/3 der urspruenglichen Werte)
3. Wirtschaft verlangsamen (50/35 statt 70/50)
4. Bot: makeSuboptimalAction implementieren, Archer-Limit
5. Training-Limits erhoeht: Tower 50, Episode 100
6. KILL_TIME_MIN auf 2.0s erhoeht, healthMult cap bei 20x

**Bewusst NICHT implementiert:**
- speedMultiplier (Model-Aenderung zu riskant)
- Skill-Level-Differenzierung (unnoetige Komplexitaet)

**Erwartetes Ergebnis:**
- Mehr Tower-Vielfalt (Archer nicht mehr OP)
- Rewards fuehlen sich fair an (ca. 1-8 pro Kill statt 5-15)
- Bot spielt menschlicher
- Training bleibt stabil (40%+ Sweet Spot erreicht)

---

**Last Updated:** 2026-01-25
