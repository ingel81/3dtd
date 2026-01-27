# Damage & Armor System - Konzept

> **Status:** Konzept / Geplant
> **Priorität:** Nach AI Wave Director
> **Abhängigkeit:** Neue Tower zuerst, dann Gegner-Rüstungen

---

## Übersicht

Ein Schadens- und Rüstungssystem das strategische Tiefe hinzufügt:
- **Tower** haben einen Schadenstyp
- **Enemies** haben einen Rüstungstyp
- Bestimmte Kombinationen sind effektiver/ineffektiver

---

## Phase 1: Schadenstypen bei Towern

### Neue Config-Felder

```typescript
// In tower-types.ts
interface TowerTypeConfig {
  // ... bestehende Felder ...

  /** Schadenstyp für Rüstungsberechnung */
  damageType: DamageType;
}

type DamageType =
  | 'physical'  // Standard, gut vs Light
  | 'pierce'    // Durchdringend, gut vs Unarmored
  | 'siege'     // Schwer, gut vs Heavy/Fortified
  | 'magic'     // Ignoriert Rüstung teilweise
  | 'fire'      // DoT + Schaden
  | 'ice'       // Slow + Schaden
  | 'chaos';    // Voller Schaden vs alle (selten)
```

### Klassifizierung bestehender Tower

| Tower | Schadenstyp | Begründung |
|-------|-------------|------------|
| Archer | `physical` | Standard-Bogenschütze |
| Dual-Gatling | `physical` | Schnelle Projektile |
| Sniper | `pierce` | Hochkaliber, durchdringend |
| Cannon | `siege` | Explosiv, effektiv vs Panzerung |
| Rocket | `siege` | Schwere Sprengköpfe |
| Magic | `magic` | Magischer Schaden |
| Ice | `ice` | Frost-Schaden |

### Neue Tower (Ideen)

| Tower | Schadenstyp | Beschreibung |
|-------|-------------|--------------|
| **Flame Tower** | `fire` | Flächenschaden + Burn DoT |
| **Tesla Tower** | `magic` | Kettenblitz, mehrere Ziele |
| **Poison Tower** | `magic` | DoT, stapelbar |
| **Chaos Tower** | `chaos` | Teuer, Endgame, voller Schaden |

---

## Phase 2: Rüstungstypen bei Enemies

### Neue Config-Felder

```typescript
// In enemy-types.ts
interface EnemyTypeConfig {
  // ... bestehende Felder ...

  /** Rüstungstyp für Schadensberechnung */
  armorType: ArmorType;

  // Optional: Immunitäten
  immuneToSlow?: boolean;
  immuneToBurn?: boolean;
  immuneToPoison?: boolean;
}

type ArmorType =
  | 'unarmored'  // Kein Schutz, anfällig für Pierce
  | 'light'      // Leichte Rüstung, Standard
  | 'medium'     // Mittlere Rüstung
  | 'heavy'      // Schwere Rüstung, reduziert Physical
  | 'fortified'  // Befestigt, nur Siege/Magic effektiv
  | 'ethereal';  // Geisterhaft, immun vs Physical
```

### Klassifizierung bestehender Enemies

| Enemy | Rüstungstyp | Begründung |
|-------|-------------|------------|
| Zombie | `light` | Standard-Gegner |
| Bat | `unarmored` | Fliegend, kein Schutz |
| Penguin | `unarmored` | Schnell, kein Schutz |
| Tank | `heavy` | Gepanzertes Fahrzeug |
| Wallsmasher | `medium` | Robust aber nicht gepanzert |
| Herbert | `fortified` | Boss mit massiver Panzerung |

### Neue Enemies (Ideen)

| Enemy | Rüstungstyp | Properties | Beschreibung |
|-------|-------------|------------|--------------|
| **Skeleton** | `unarmored` | `isSwarm` | Schnell, zerbrechlich, viele |
| **Ghost** | `ethereal` | - | Nur Magic/Chaos wirkt! |
| **Golem** | `fortified` | `isTanky`, `isBoss` | Extrem langsam, massiv HP |
| **Spider** | `light` | `isFast` | Schnell, ignoriert Slow |
| **Dragon** | `heavy` | `isAir`, `isBoss` | Fliegender Boss |
| **Mech** | `fortified` | `isTanky` | Roboter, immun vs Burn |

---

## Schadensmatrix

Multiplikator für `finalDamage = baseDamage * matrix[damageType][armorType]`

```
Schaden →      Physical  Pierce  Siege  Magic  Fire   Ice    Chaos
Rüstung ↓
────────────────────────────────────────────────────────────────────
Unarmored       100%     150%    50%    100%   125%   100%   100%
Light           100%     100%    75%    100%   100%   100%   100%
Medium           75%      75%   100%    100%   100%   100%   100%
Heavy            50%      50%   150%    100%    75%   100%   100%
Fortified        25%      35%   100%     75%    50%    75%   100%
Ethereal          0%       0%     0%    150%     0%   100%   100%
```

### Implementierung

```typescript
// In combat-effect.service.ts oder neuer damage-calculator.service.ts

const DAMAGE_MATRIX: Record<DamageType, Record<ArmorType, number>> = {
  physical: {
    unarmored: 1.0,
    light: 1.0,
    medium: 0.75,
    heavy: 0.5,
    fortified: 0.25,
    ethereal: 0.0,
  },
  pierce: {
    unarmored: 1.5,
    light: 1.0,
    medium: 0.75,
    heavy: 0.5,
    fortified: 0.35,
    ethereal: 0.0,
  },
  siege: {
    unarmored: 0.5,
    light: 0.75,
    medium: 1.0,
    heavy: 1.5,
    fortified: 1.0,
    ethereal: 0.0,
  },
  magic: {
    unarmored: 1.0,
    light: 1.0,
    medium: 1.0,
    heavy: 1.0,
    fortified: 0.75,
    ethereal: 1.5,
  },
  fire: {
    unarmored: 1.25,
    light: 1.0,
    medium: 1.0,
    heavy: 0.75,
    fortified: 0.5,
    ethereal: 0.0,
  },
  ice: {
    unarmored: 1.0,
    light: 1.0,
    medium: 1.0,
    heavy: 1.0,
    fortified: 0.75,
    ethereal: 1.0,
  },
  chaos: {
    unarmored: 1.0,
    light: 1.0,
    medium: 1.0,
    heavy: 1.0,
    fortified: 1.0,
    ethereal: 1.0,
  },
};

function calculateDamage(
  baseDamage: number,
  damageType: DamageType,
  armorType: ArmorType
): number {
  const multiplier = DAMAGE_MATRIX[damageType][armorType];
  return baseDamage * multiplier;
}
```

---

## AI Wave Director Integration

### Erweiterter State-Vektor

Das AI-Training muss die Tower-DPS nach Schadenstyp aufschlüsseln:

```typescript
interface GameStateSnapshot {
  defense: {
    // Bestehend
    totalDPS: number;
    antiAirDPS: number;

    // Neu: DPS nach Schadenstyp
    dpsByDamageType: {
      physical: number;
      pierce: number;
      siege: number;
      magic: number;
      fire: number;
      ice: number;
      chaos: number;
    };
  };
}
```

### AI lernt

- "Spieler hat nur Physical-Tower → Heavy/Fortified Enemies effektiv"
- "Viel Magic-DPS → Ethereal Enemies sind keine Bedrohung"
- "Kein Siege-DPS → Tank/Herbert sind sehr stark"

### Enemy Properties für AI

```typescript
interface EnemyTypeConfig {
  // Combat
  armorType: ArmorType;

  // Properties für AI-Training (unabhängig von Armor)
  isAirUnit?: boolean;    // Fliegend
  isTanky?: boolean;      // Viel HP (tank, wallsmasher, golem, herbert)
  isSwarm?: boolean;      // Wenig HP, viele (penguin, skeleton)
  isBoss?: boolean;       // Boss-Einheit (herbert, dragon, golem)
  isFast?: boolean;       // Speed >= 7 (bat, penguin, spider)

  // Immunitäten
  immuneToSlow?: boolean;
  immuneToBurn?: boolean;
  immuneToPoison?: boolean;
}
```

---

## Implementierungsreihenfolge

### Schritt 1: Infrastruktur (ohne Gameplay-Änderung)

1. `DamageType` und `ArmorType` Types definieren
2. `damageType` zu allen Tower-Configs hinzufügen
3. `armorType` zu allen Enemy-Configs hinzufügen (alle auf `light`)
4. `calculateDamage()` Funktion erstellen
5. In `CombatEffectService` einbauen (Multiplikator = 1.0 für alle)

**Ergebnis:** System existiert, Gameplay unverändert

### Schritt 2: Tower-Schadenstypen aktivieren

1. Bestehende Tower klassifizieren (siehe Tabelle oben)
2. Schadenstyp-Icons im UI anzeigen
3. Tooltip: "Physical Damage" etc.

**Ergebnis:** Spieler sieht Schadenstypen, aber noch kein Effekt

### Schritt 3: Neue Tower einführen

1. Flame Tower (Fire)
2. Tesla Tower (Magic)
3. Ggf. weitere

**Ergebnis:** Mehr Vielfalt bei Schadenstypen

### Schritt 4: Enemy-Rüstungen aktivieren

1. Bestehende Enemies klassifizieren (siehe Tabelle oben)
2. Schadensmatrix aktivieren
3. Rüstungstyp-Icon im Wave-Preview

**Ergebnis:** Strategische Tiefe - Spieler muss Tower-Mix anpassen

### Schritt 5: Neue Enemies mit speziellen Rüstungen

1. Ghost (Ethereal) - nur Magic wirkt
2. Golem (Fortified) - Siege/Magic effektiv
3. Dragon (Heavy + Air)
4. etc.

**Ergebnis:** Volles System mit Counter-Play

### Schritt 6: AI-Training anpassen

1. State-Vektor erweitern (dpsByDamageType)
2. Enemy-Properties definieren
3. Neu trainieren

**Ergebnis:** AI nutzt das Schadenssystem strategisch

---

## UI-Anpassungen

### Tower-Panel

```
┌─────────────────────────────┐
│ 🏹 Archer          Lv. 2   │
│ ─────────────────────────  │
│ Damage: 25  ⚔️ Physical    │
│ Range: 150m                │
│ Fire Rate: 1.2/s           │
└─────────────────────────────┘
```

### Wave-Preview

```
┌─────────────────────────────┐
│ Wave 15: Tank Rush         │
│ ─────────────────────────  │
│ 🛡️ Heavy Armor             │
│ ⚠️ Resistant to Physical   │
│ ✅ Weak to Siege, Magic    │
└─────────────────────────────┘
```

### Schadens-Icons

| Typ | Icon | Farbe |
|-----|------|-------|
| Physical | ⚔️ | Grau |
| Pierce | 🎯 | Orange |
| Siege | 💥 | Rot |
| Magic | ✨ | Lila |
| Fire | 🔥 | Orange-Rot |
| Ice | ❄️ | Cyan |
| Chaos | 💀 | Schwarz/Gold |

---

## Balancing-Überlegungen

### Chaos-Schaden

- Sehr teuer (2-3x normale Tower-Kosten)
- Geringe DPS, aber garantiert effektiv
- Endgame-Option gegen gemischte Waves

### Ethereal-Gegner

- Ghost sollte nicht zu früh kommen (Magic Tower erst ab Wave X?)
- Wenig HP, aber immun gegen Physical
- Erzwingt Magic-Investment

### Boss-Rüstungen

- Herbert (Fortified) - Siege/Magic sind key
- Dragon (Heavy + Air) - Braucht Anti-Air + Siege/Magic

---

## Referenzen

- Warcraft 3 Armor System
- Kingdom Rush Damage Types
- Bloons TD Damage Types

---

**Erstellt:** 2026-01-27
**Autor:** AI-Assistiert
**Status:** Konzept
