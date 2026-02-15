# Damage & Armor System - Entwurf v2

> **Status:** Entwurf / In Diskussion
> **Prioritaet:** Phase 5 - vor Gameplay-Balancing und erneutem AI-Training
> **Referenzen:** Warcraft 3 Armor System, Kingdom Rush, Bloons TD

---

## Uebersicht

Ein Schadens- und Ruestungssystem das strategische Tiefe hinzufuegt:
- **Tower** haben einen Schadenstyp (DamageType)
- **Enemies** haben einen Ruestungstyp (ArmorType)
- **Schadensmatrix** bestimmt Multiplikator fuer jede Kombination
- **Immunitaeten** schuetzen gegen Status-Effekte (unabhaengig von Matrix)
- **Visuelles Feedback** zeigt dem Spieler Effektivitaet in Echtzeit

**Designprinzip:** Jeder Schadenstyp hat eine klare Nische. Kein Tower ist universell ueberlegen. Der Spieler MUSS seinen Tower-Mix diversifizieren.

---

## 1. Schadenstypen (DamageType)

7 Typen, jeder mit klarer Rolle:

```typescript
type DamageType =
  | 'physical'  // Kinetisch - Standardwaffen, schlecht vs Panzerung
  | 'pierce'    // Durchbohrend - exzellent vs ungeschuetzte Ziele
  | 'siege'     // Sprengkraft - DIE Antwort auf schwere Panzerung
  | 'magic'     // Arkan - ignoriert physische Ruestung, trifft Geister
  | 'fire'      // Thermisch - verbrennt Ungeschuetzte
  | 'ice'       // Frost - gleichmaessig effektiv, magischer Ursprung
  | 'chaos';    // Universal - 100% gegen alles, sehr teuer
```

### Tower → DamageType Zuordnung

| Tower | DamageType | Begruendung |
|-------|-----------|-------------|
| **Archer** | `pierce` | Pfeile durchbohren - exzellent vs Unarmored/Light |
| **Dual-Gatling** | `physical` | Kugelregen - Standard-Kinetikschaden |
| **Cannon** | `siege` | Explosive AOE - knackt schwere Panzerung |
| **Rocket** | `siege` | Anti-Air Sprengkoepfe |
| **Magic** | `magic` | Arkane Bolzen - umgeht physische Ruestung |
| **Ice** | `ice` | Frostmagie - Utility-Fokus (nur 2 Dmg) |
| **Fire** | `fire` | Flammenstrahl - verbrennt Leichtes |
| **Tentacle** | `physical` | Rohe Gewalt - Nahkampf |

**Abdeckung:** physical (2), pierce (1), siege (2), magic (1), fire (1), ice (1), chaos (0)

### Zukuenftige Tower (Ideen)

| Tower | DamageType | Beschreibung |
|-------|-----------|--------------|
| Tesla Tower | `magic` | Kettenblitz, mehrere Ziele |
| Poison Tower | `magic` | DoT, stapelbar |
| Chaos Tower | `chaos` | Teuer, Endgame, voller Schaden vs alle |

---

## 2. Ruestungstypen (ArmorType)

6 Typen mit aufsteigender Schutzwirkung:

```typescript
type ArmorType =
  | 'unarmored'  // Kein Schutz - anfaellig fuer Pierce/Fire
  | 'light'      // Leicht - Standard, kaum Reduktion
  | 'medium'     // Mittel - Physical/Pierce reduziert
  | 'heavy'      // Schwer - nur Siege effektiv, Physical halbiert
  | 'fortified'  // Befestigt - Festung, fast immun vs Physical
  | 'ethereal';  // Aetherisch - immun vs alles Physische
```

### Enemy → ArmorType Zuordnung

| Enemy | ArmorType | immuneToSlow | Archetype | Gameplay-Rolle |
|-------|----------|-------------|-----------|---------------|
| **Rat** | unarmored | ja | Swarm | Masse, ueberrennt langsame Tower |
| **Penguin** | unarmored | nein | Swarm/Fast | Schnell, gut von Pierce/Fire erledigt |
| **Bat** | unarmored | ja | Air/Fast | Fliegend, nur Rocket + Air-Target Tower |
| **Zombie** | light | nein | Fodder | Einstiegsgegner, alle Tower OK |
| **Spider** | light | nein | Fast | Schnell mit etwas HP |
| **Zombie Soldier** | medium | nein | Standard+ | Aufgewerteter Fodder, Physical schwaechelt |
| **Wallsmasher** | medium | nein | Bruiser | Schnell + robust, Siege hilft |
| **Tank** | heavy | nein | Tank | Langsam, massiv HP, braucht Siege |
| **Mammoth** | heavy | ja | Siege/Tank | Wie Tank + Slow-immun = sehr gefaehrlich |
| **Herbert** | fortified | ja | Boss | Braucht Siege UND Magic, CC nutzlos |

### Zukuenftige Enemies (Ideen)

| Enemy | ArmorType | Properties | Beschreibung |
|-------|----------|------------|--------------|
| **Skeleton** | unarmored | `isSwarm` | Schnell, zerbrechlich, viele |
| **Ghost** | ethereal | - | Nur Magic/Ice/Chaos wirkt! |
| **Golem** | fortified | `isTanky`, `isBoss` | Extrem langsam, massiv HP, immuneToBurn |
| **MechaCat** | medium | `isFast` | Roboter-Katze, immuneToBurn |
| **Dragon** | heavy | `isAir`, `isBoss` | Fliegender Boss |

---

## 3. Schadensmatrix

`finalDamage = baseDamage * matrix[damageType][armorType]`

```
Schaden ->      Physical  Pierce   Siege   Magic   Fire    Ice    Chaos
Ruestung v
---------------------------------------------------------------------------
Unarmored       100%     150%      75%    100%    125%   100%    100%
Light           100%     125%      75%    100%    100%   100%    100%
Medium           75%      75%     100%    100%    100%   100%    100%
Heavy            50%      50%     150%    100%     75%   100%    100%
Fortified        25%      25%     125%     75%     50%    75%    100%
Ethereal          0%       0%       0%    150%      0%   100%    100%
```

### Matrix-Design-Entscheidungen

- **Pierce vs Light = 125%** (nicht 100%): Pierce muss sich staerker von Physical unterscheiden. Archer ist DER Anti-Swarm-Tower.
- **Siege vs Unarmored = 75%** (nicht 50%): 50% war zu hart. Siege ist ineffizient gegen kleine Ziele, aber nicht nutzlos.
- **Siege vs Fortified = 125%** (nicht 100%): "Siege" heisst woertlich Belagerung - muss gut gegen Festungen sein.
- **Pierce vs Fortified = 25%** (nicht 35%): Pfeile prallen an Festungen ab, wie Physical.
- **Ice vs Ethereal = 100%**: Frost hat magischen Ursprung, trifft Geister.
- **Fire vs Ethereal = 0%**: Feuer ist physische Energie, geht durch Geister hindurch.

### Implementierung

```typescript
const DAMAGE_MATRIX: Record<DamageType, Record<ArmorType, number>> = {
  physical: {
    unarmored: 1.0, light: 1.0, medium: 0.75,
    heavy: 0.5, fortified: 0.25, ethereal: 0.0,
  },
  pierce: {
    unarmored: 1.5, light: 1.25, medium: 0.75,
    heavy: 0.5, fortified: 0.25, ethereal: 0.0,
  },
  siege: {
    unarmored: 0.75, light: 0.75, medium: 1.0,
    heavy: 1.5, fortified: 1.25, ethereal: 0.0,
  },
  magic: {
    unarmored: 1.0, light: 1.0, medium: 1.0,
    heavy: 1.0, fortified: 0.75, ethereal: 1.5,
  },
  fire: {
    unarmored: 1.25, light: 1.0, medium: 1.0,
    heavy: 0.75, fortified: 0.5, ethereal: 0.0,
  },
  ice: {
    unarmored: 1.0, light: 1.0, medium: 1.0,
    heavy: 1.0, fortified: 0.75, ethereal: 1.0,
  },
  chaos: {
    unarmored: 1.0, light: 1.0, medium: 1.0,
    heavy: 1.0, fortified: 1.0, ethereal: 1.0,
  },
};
```

---

## 4. Status-Effekt-Immunitaeten

Unabhaengig von der Schadensmatrix. Die Matrix regelt nur den Damage-Multiplikator.
Immunitaeten betreffen Status-Effekte (Slow, Freeze, zukuenftig Burn/Poison).

```typescript
interface EnemyTypeConfig {
  // ... bestehende Felder ...
  armorType: ArmorType;

  // Status-Effekt-Immunitaeten
  immuneToSlow?: boolean;    // Kann nicht verlangsamt werden
  immuneToBurn?: boolean;    // Kann nicht brennen (zukuenftig)
  immuneToPoison?: boolean;  // Kann nicht vergiftet werden (zukuenftig)
}
```

### Aktuelle Zuordnung

| Enemy | immuneToSlow | Begruendung |
|-------|-------------|-------------|
| Rat | ja | Zu klein und wendig |
| Bat | ja | Fliegend, Frost faellt ab |
| Mammoth | ja | Zu massiv fuer Frost-Slow |
| Herbert | ja | Boss ignoriert Crowd Control |
| *alle anderen* | nein | Koennen verlangsamt werden |

### Zukuenftige Immunitaeten (vorbereitet)

- `immuneToBurn`: Golem (Stein brennt nicht), MechaCat (Metall)
- `immuneToPoison`: MechaCat (Roboter), Golem (kein Organismus)

---

## 5. Strategische Konsequenzen

### "Was passiert wenn der Spieler nur X baut?"

| Strategie | Konsequenz |
|-----------|-----------|
| Nur Physical/Pierce | Tank/Mammoth/Herbert werden zum Albtraum (50%/25%) |
| Nur Siege | Rat-Swarms laufen durch (75% + niedrige Feuerrate) |
| Kein Magic | Ghost-Waves (zukuenftig) sind unschlagbar |
| Guter Mix | Jede Wave handhabbar, aber teurer |

### Tower-Rollen mit System

| Tower | Ohne System | Mit System |
|-------|------------|-----------|
| Archer | Solider Allrounder | **Anti-Swarm Spezialist** (Pierce 150% vs Unarmored) |
| Gatling | DPS-Maschine | Nur vs Light/Unarmored gut, faellt bei Heavy ab |
| Cannon | AOE-Nuke | **Anti-Heavy Pflicht** (Siege 150% vs Heavy) |
| Magic | Nischig | **Universell nuetzlich** + einzige Anti-Ethereal Option |
| Rocket | Anti-Air Only | Anti-Air + Anti-Heavy (Siege-Typ) |
| Ice | Slow-Utility | Unveraendert (Utility, Matrix kaum relevant bei 2 Dmg) |
| Fire | Beam-DPS | Anti-Swarm (125% vs Unarmored), nutzlos vs Ethereal |
| Tentacle | Billig-Melee | Guenstige Front vs Light, schlecht vs Heavy |

### Wave-Impact

| Wave-Typ | Bisher | Mit System |
|-----------|--------|-----------|
| Zombie Rush | Alles OK | Immer noch einfach (light armor) |
| Tank Wave | Nur viel DPS noetig | **Siege-Tower Pflicht**, Physical halbiert |
| Rat Swarm | Schnelle Tower noetig | Pierce/Fire ideal, **Slow nutzlos** (immun) |
| Air (Bats) | Rocket Pflicht | Rocket Pflicht + unarmored = Siege Verschwendung |
| Mammoth Siege | Viel DPS + Slow | **Siege Pflicht, Slow nutzlos** (immun), teuerste Wave |
| Herbert Boss | Alles draufhauen | Siege+Magic Combo, Physical/Pierce fast nutzlos |
| *Ghost Wave* | - | **Magic PFLICHT**, keine Alternative |
| *Mixed Wave* | - | Braucht Tower-Vielfalt |

---

## 6. Visuelles Feedback

### Damage Numbers (farbig nach Effektivitaet)

| Multiplikator | Farbe | Groesse | Effekt |
|--------------|-------|---------|--------|
| > 100% | Rot/Orange | Groesser | "Super effective" |
| = 100% | Weiss | Normal | Neutraler Treffer |
| < 100% | Grau | Kleiner | "Not very effective" |
| = 0% | - | - | "IMMUNE" Text in Grau |

Das ist die wichtigste Rueckmeldung - der Spieler sieht sofort ob sein Tower-Typ funktioniert.

### Tower-Panel

Schadenstyp-Label mit Farbe neben dem Damage-Wert:

```
+-----------------------------+
| Archer            Lv. 2    |
| --------------------------  |
| Damage: 25  [Pierce]       |
| Range: 60m                 |
| Fire Rate: 1.0/s           |
+-----------------------------+
```

### Wave-Preview

Ruestungstyp + Schwaechen/Staerken:

```
+-----------------------------+
| Wave 15: Tank Rush          |
| --------------------------  |
| Heavy Armor                 |
| Resistant to: Physical      |
| Weak to: Siege, Magic       |
+-----------------------------+
```

### Schadens-Icons & Farben

| Typ | Farbe | Hex |
|-----|-------|-----|
| Physical | Grau | #A0A0A0 |
| Pierce | Orange | #FF8800 |
| Siege | Rot | #CC2200 |
| Magic | Lila | #AA44FF |
| Fire | Orange-Rot | #FF4400 |
| Ice | Cyan | #44CCFF |
| Chaos | Gold | #FFD700 |

---

## 7. Config-Felder (TypeScript Interfaces)

### TowerTypeConfig Erweiterung

```typescript
interface TowerTypeConfig {
  // ... bestehende Felder ...

  /** Schadenstyp fuer Ruestungsberechnung */
  damageType: DamageType;
}
```

### EnemyTypeConfig Erweiterung

```typescript
interface EnemyTypeConfig {
  // ... bestehende Felder ...

  /** Ruestungstyp fuer Schadensberechnung */
  armorType: ArmorType;

  // AI-Training Properties (unabhaengig von Armor)
  isTanky?: boolean;    // Viel HP (tank, wallsmasher, mammoth, herbert)
  isSwarm?: boolean;    // Wenig HP, viele (rat, penguin)
  isBoss?: boolean;     // Boss-Einheit (herbert)
  isFast?: boolean;     // Speed >= 7 (bat, penguin, rat, spider)

  // Status-Effekt-Immunitaeten
  immuneToSlow?: boolean;
  immuneToBurn?: boolean;
  immuneToPoison?: boolean;
}
```

---

## 8. AI Wave Director Integration (spaeter)

### Erweiterter State-Vektor

```typescript
interface GameStateSnapshot {
  defense: {
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

### AI lernt Konter-Strategien

- "Spieler hat nur Physical-Tower -> Heavy/Fortified Enemies effektiv"
- "Viel Magic-DPS -> Ethereal Enemies sind keine Bedrohung"
- "Kein Siege-DPS -> Tank/Herbert sind sehr stark"
- "Nur Siege-Tower -> Rat-Swarm schicken"

---

## 9. Implementierungsreihenfolge

### Schritt 1: Infrastruktur (kein Gameplay-Impact)
1. `DamageType` + `ArmorType` Types definieren
2. `damageType` zu Tower-Configs hinzufuegen
3. `armorType` + Immunitaeten zu Enemy-Configs hinzufuegen
4. `DAMAGE_MATRIX` Konstante anlegen
5. `calculateDamage()` in DamageApplicationService einbauen
6. Alle Multiplikatoren zunaechst 1.0 -> Kein Unterschied spuerbar

**Ergebnis:** System existiert, Gameplay unveraendert

### Schritt 2: Matrix aktivieren (Gameplay-Impact)
1. Echte Multiplikatoren einsetzen
2. Farbige Damage Numbers (rot/weiss/grau/IMMUNE)
3. Status-Effekt-Immunitaeten aktivieren

**Ergebnis:** Schaden variiert, Spieler sieht Feedback

### Schritt 3: UI-Feedback
1. Tower-Panel: Schadenstyp-Anzeige mit Farbe
2. Wave-Preview: Ruestungstyp + Schwaechen/Staerken
3. Ggf. Tower-Auswahl: Effektivitaets-Hinweis gegen aktuelle Wave

**Ergebnis:** Spieler versteht das System

### Schritt 4: Balancing & Testing
1. Werte iterativ anpassen basierend auf Spielgefuehl
2. Tower-Kosten ggf. rebalancen (Siege-Tower wertvoller -> teurer?)
3. Enemy HP ggf. anpassen

### Schritt 5: Doku & Cleanup
1. Dieses Dokument auf Final aktualisieren
2. DONE.md Eintrag

---

## 10. Balancing-Ueberlegungen

### Chaos-Schaden
- Sehr teuer (2-3x normale Tower-Kosten)
- Geringe DPS, aber garantiert effektiv gegen alles
- Endgame-Option gegen gemischte Waves

### Ethereal-Gegner (Ghost)
- Ghost sollte nicht zu frueh kommen (erst wenn Magic Tower verfuegbar)
- Wenig HP, aber immun gegen Physical/Pierce/Siege/Fire
- Erzwingt Magic-Investment -> strategische Diversifizierung

### Boss-Ruestungen
- Herbert (Fortified) - Siege+Magic sind key, Physical fast nutzlos
- Dragon (Heavy + Air) - Braucht Anti-Air + Siege, doppelte Herausforderung

### Slow-Immunitaet
- Rat, Bat, Mammoth, Herbert ignorieren Slow
- Wichtig: Ice Tower behalt Schadensmultiplikator (minimal bei 2 Dmg)
- Gameplay: Gegen diese Feinde muss man mit reinem DPS loesen

---

## Offene Fragen / Diskussionspunkte

- [ ] Soll Sniper ein eigener Tower werden (Pierce mit hohem Single-Target)?
- [ ] Tentacle als `physical` oder eigener Typ (z.B. `nature`)?
- [ ] Ice-Schaden (2 Dmg): Lohnt sich Matrix-Anwendung oder pauschal ignorieren?
- [ ] Fire-Beam: Soll er zusaetzlich Burn-DoT als Status-Effekt bekommen?
- [ ] Tower-Kosten-Rebalancing noetig wenn Siege-Tower "Pflicht" werden?
- [ ] Ethereal + Air Kombination erlauben? (Geister-Fledermaus = nur Magic+Air-Target)

---

**Erstellt:** 2026-01-27
**Aktualisiert:** 2026-02-15 (Entwurf v2 - umfassende Ueberarbeitung)
**Status:** Entwurf / In Diskussion
