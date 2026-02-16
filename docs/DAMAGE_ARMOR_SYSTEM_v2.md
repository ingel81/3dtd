# Damage & Armor System v2 — Überarbeitetes Konzept

> **Status:** Entwurf v2.1 (Veteran-tauglich + erweiterbar)
> **Erstellt:** 2026-02-16
> **Aktualisiert:** 2026-02-16 (Feedback: mehr Tiefe für Veteranen, Zukunftssicherheit)
> **Methode:** 4-köpfiges Gameplay-Team + Nachschärfung

---

## Design-Philosophie

**Für Veteranen UND Einsteiger.** Das System soll:
- Einfach zu lernen, schwer zu meistern sein
- TD-Veteranen strategische Tiefe bieten (Counter-Building, Meta-Reads)
- Erweiterbar sein für zukünftige Tower und Enemies
- Mit dem AI Wave Director harmonieren ohne sich unfair anzufühlen
- Visuell lesbar sein — aber nicht auf Kosten der Tiefe

**Kein WC3-Klon**, aber auch kein Casual-Minimalsystem. Eigene Identität.

---

## Das System: 3 Schichten

Das Damage/Armor System besteht aus **drei Schichten**, die aufeinander aufbauen:

```
Schicht 3: Immunität-Flags    ← Binäre Checks (Camo, Shielded, Regen, etc.)
Schicht 2: Status-Effekte     ← Slow, Burn, Poison, Stun (Tower-Utility)
Schicht 1: Schadensmatrix     ← Damage Type × Armor Type Multiplikatoren
```

Schicht 1 ist das Fundament. Schichten 2+3 kommen progressiv dazu und erhöhen die Tiefe.

---

## Schicht 1: Schadensmatrix (6 × 5)

### 6 Schadenstypen

| Typ | Icon | Farbe | Identität | Zukunftssicherheit |
|-----|------|-------|-----------|--------------------|
| **Physical** | ⚔️ | Silber | Solide Einzeltreffer, Allrounder | Basis-Typ, immer relevant |
| **Pierce** | 🎯 | Orange | Durchdringend, hohe Feuerrate | Skaliert mit neuen Rapid-Fire Tower |
| **Siege** | 💥 | Rot | Schwere AoE, langsam, devastierend | Skaliert mit Heavy/Fortified Enemies |
| **Magic** | ✨ | Lila | Arkaner Schaden, teilweise Armor-Bypass | Anti-Ethereal Nische, Utility-Slot |
| **Fire** | 🔥 | Orange-Rot | DoT + Flächenschaden | Burn-Synergie, Anti-Regen |
| **Ice** | ❄️ | Cyan | Niedrig-DPS + Slow | Utility-Dominant, Crowd Control |

**Warum 6 statt 4?** Fire und Ice sind keine generischen "Elementar"-Tower — sie haben fundamental verschiedene Gameplay-Rollen (DoT/Burst vs. Crowd Control). Sie zusammenzuwerfen killt ihre Identität.

**Warum 6 statt 7?** Chaos ist raus. "Voller Schaden gegen alles" ist kein Typ, sondern fehlende Entscheidung. True Damage kann als spezielles Tower-Upgrade existieren, nicht als eigener Typ.

### 5 Rüstungstypen

| Typ | Icon | Farbe | Identität | Typische Enemies |
|-----|------|-------|-----------|-----------------|
| **Unarmored** | – | Weiß | Kein Schutz, Standard-Futter | Zombie, Rat, Penguin |
| **Light** | 🛡️ | Grün | Leichte Rüstung, schnell/evasiv | Wallsmasher, Bat, Scout |
| **Heavy** | 🛡️🛡️ | Orange | Massiv gepanzert, langsam | Tank, Zombie Soldier, Mech |
| **Fortified** | 🏰 | Braun-Gold | Befestigt/Organisch-massiv, Damage-Sponge | Mammoth, Golem, Herbert |
| **Ethereal** | 👻 | Lila-Transparent | Geisterhaft, immun vs. Physical | Ghost, Wraith, Lich |

**Warum 5 statt 4?** Fortified und Heavy sind nicht dasselbe:
- **Heavy** = Panzerung (Tank, Mech) — Siege durchbricht sie
- **Fortified** = Organische/strukturelle Masse (Mammoth, Golem, Boss) — braucht sustained DPS
- Das gibt dem AI Director **zwei verschiedene "tanky" Optionen** zum Kontern

### Die Matrix

```
                  Unarmored   Light    Heavy    Fortified   Ethereal
                  ─────────  ──────   ──────   ─────────   ────────
Physical  ⚔️       1.0×      1.0×     0.7×     0.5×        0.0× ★
Pierce    🎯       1.2×      1.3×     0.5×     0.6×        0.0× ★
Siege     💥       0.8×      0.7×     1.5×     1.25×       0.75×
Magic     ✨       1.0×      1.0×     0.85×    0.75×       1.75×
Fire      🔥       1.15×     1.0×     0.9×     0.6×        0.0× ★
Ice       ❄️       1.0×      0.9×     1.0×     1.0×        1.25×
```

★ = **Immun.** Physical, Pierce und Fire gehen durch Geister durch. Das ist der härteste Check im Spiel — erzwingt Magic/Ice/Siege Investment.

### Design-Logik der Matrix

**Physical (⚔️) — Honest Midrange**
- 1.0× gegen Unarmored/Light: verlässlich, nie falsch
- 0.7× vs Heavy: Pfeile/Schläge werden abgeschwächt
- 0.5× vs Fortified: kaum Wirkung gegen massive Ziele
- 0.0× vs Ethereal: Pfeile gehen durch Geister durch
- **Rolle:** Safe Early Pick, fällt Late-Game ab → Upgrade-Pfad oder Tower-Rotation nötig

**Pierce (🎯) — Anti-Swarm Spezialist**
- 1.3× vs Light: hohe Feuerrate shredded evasive Ziele
- 1.2× vs Unarmored: Swarm-Killer
- 0.5× vs Heavy: Kugeln prallen an Panzerung ab
- 0.0× vs Ethereal: physische Projektile nutzlos
- **Rolle:** Dominiert Early/Mid Swarm-Waves, nutzlos gegen Tanks/Ghosts

**Siege (💥) — Anti-Armor Breaker**
- 1.5× vs Heavy: Explosionen ignorieren Panzerung
- 1.25× vs Fortified: auch gegen Masse effektiv
- 0.7× vs Light: schnelle Ziele weichen AoE aus
- 0.75× vs Ethereal: teilweise Wirkung (Druckwelle trifft auch Geister)
- **Rolle:** Essential Mid-Late, aber schwach gegen Swarm/Evasive

**Magic (✨) — Ethereal Counter + Utility**
- 1.75× vs Ethereal: DER Counter gegen Geister
- 0.85× vs Heavy: magische Bolts tun wenig gegen Stahl
- 0.75× vs Fortified: noch weniger gegen massive Kreaturen
- **Rolle:** Nischen-Pick, aber ESSENTIAL wenn Ethereal auftaucht. Kein Allrounder mehr!

**Fire (🔥) — DoT Specialist**
- 1.15× vs Unarmored: Fleisch brennt gut
- 0.6× vs Fortified: dickes Fell/Fels brennt kaum
- 0.0× vs Ethereal: Feuer kann Geister nicht berühren
- **Rolle:** Anti-Regen (Burn verhindert Heilung), gut vs. organische Feinde

**Ice (❄️) — Crowd Control**
- Niedrige Multiplikatoren überall (0.9–1.25×)
- 1.25× vs Ethereal: Kälte verlangsamt auch Geister
- **Rolle:** DPS ist nie das Ziel. Slow-Utility + leichter Ethereal-Support

### Warum diese Multiplier-Range?

| Range | Effekt |
|-------|--------|
| **0.0×** | Immun — klarer "du brauchst was anderes" Moment. Nur für Ethereal vs Physical/Pierce/Fire |
| **0.5×–0.7×** | Spürbar schwach — Spieler merkt es über Damage Numbers + HP-Bar |
| **0.85×–1.15×** | Subtil — Allrounder-Zone, kein harter Konter |
| **1.25×–1.5×** | Spürbar stark — "Oh nice, der schmilzt!" |
| **1.75×** | Sehr stark — Nur Magic vs Ethereal. DER Moment. |

**Keine 0.25× oder 2.0×** (außer der Ethereal-Immunität). Der AI Director soll Druck machen, nicht den Spieler hard-locken.

---

## Schicht 2: Status-Effekte

Status-Effekte sind **unabhängig vom Schadenstyp** — sie kommen von spezifischen Towern, nicht von der Matrix.

| Effekt | Quelle | Wirkung | Counter (Enemy) |
|--------|--------|---------|-----------------|
| **Slow** | Ice Tower | Speed -40% für 2s | `immuneToSlow` Flag |
| **Burn** | Fire Tower | X dmg/s für 3s, verhindert Regen | `immuneToBurn` Flag |
| **Poison** | (zukünftig) | Stacking DoT, Armor -10% | `immuneToPoison` Flag |
| **Stun** | (zukünftig) | Voller Stopp für 0.5s | Bosses immun, Fortified 50% Resist |
| **Armor Break** | (zukünftig) | Rüstung -1 Stufe für 5s | Ethereal immun |
| **Mark** | (zukünftig) | +20% Schaden von allen Quellen | Kein Counter |

**Warum als eigene Schicht?** 
- Status-Effekte geben Towern Utility NEBEN ihrem Schadenstyp
- Ice Tower ist "schlecht in DPS" aber "essential für Slow" — das ist eine ECHTE Entscheidung
- Zukünftige Tower können neue Effekte bringen ohne die Matrix zu ändern

### Synergie-Potenzial (Veteranen-Tiefe)

- **Armor Break + Siege** = Fortified-Killer Combo
- **Slow + Pierce** = Swarm in Zeitlupe shredden
- **Mark + Magic** = Ethereal Boss in Sekunden
- **Burn + alles** = Anti-Regen Counter

→ Veteranen optimieren nicht nur Tower-Typen, sondern **Status-Combos**.

---

## Schicht 3: Immunität-Flags

Binäre Checks, inspiriert von Bloons TD. Unabhängig von Matrix UND Status.

| Flag | Effekt | Wie man's kontert | Einführung |
|------|--------|-------------------|------------|
| **Shielded** | Absorbiert ersten X Damage, dann bricht Schild | Hohe Burst-DPS / Siege | Mid-Game |
| **Camo** | Unsichtbar für Standard-Tower | Detection-Fähigkeit (Magic-Upgrade, Radar-Tower) | Mid-Game |
| **Regen** | Regeneriert HP pro Sekunde | Burn-Effekt, Burst-DPS | Mid-Late |
| **Split** | Teilt sich beim Tod in kleinere Einheiten | AoE, vorausschauend bauen | Late-Game |
| **Phasing** | Ignoriert Slow-Effekte | Pure DPS statt Crowd Control | Late-Game |
| **Aura** | Buffed nahe Enemies (Speed/Armor) | Priorisiert Aura-Träger zuerst | Late-Game |

**Warum als eigene Schicht?**
- Flags sind sofort verständlich (ja/nein, nicht Multiplikatoren)
- Sie erzwingen **spezifische Antworten** — nicht nur "mehr DPS"
- Jedes Flag ist ein potenzieller "Aha!"-Moment
- Flags sind **unendlich erweiterbar** ohne die Matrix aufzublähen

---

## Tower-Zuordnung

### Aktuell (8 Tower)

| Tower | Damage Type | Status-Effekt | Nische |
|-------|------------|---------------|--------|
| **Archer** | ⚔️ Physical | – | Early-Game Backbone, Anti-Light verlässlich |
| **Dual-Gatling** | 🎯 Pierce | – | Anti-Swarm, hohe Feuerrate |
| **Cannon** | 💥 Siege | – | Anti-Heavy, AoE |
| **Rocket** | 💥 Siege | – | Anti-Heavy + Anti-Air, AoE |
| **Magic** | ✨ Magic | – | Anti-Ethereal, einziger harter Ghost-Counter |
| **Ice** | ❄️ Ice | Slow | Crowd Control, Utility |
| **Fire** | 🔥 Fire | Burn | DoT, Anti-Regen |
| **Tentacle** | ⚔️ Physical | – | Melee Multi-Target, Anti-Swarm (Nahbereich) |

### Geplante Erweiterungen (Zukunft)

| Tower (Idee) | Damage Type | Status-Effekt | Nische |
|-------------|------------|---------------|--------|
| **Tesla** | ✨ Magic | Stun (kurz) | Chain Lightning, Anti-Cluster |
| **Poison** | 🔥 Fire* | Poison (stacking) | Sustained DoT, Armor Break |
| **Railgun** | 🎯 Pierce | Armor Break | Anti-Heavy Pierce (durchschlägt Panzerung) |
| **Void Tower** | ✨ Magic | Mark | Support, +20% Damage für alle |
| **Mortar** | 💥 Siege | – | Extreme Range AoE, sehr langsam |
| **Sniper** | ⚔️ Physical | – | Extreme Range, Single-Target, Anti-Boss |

*Poison Tower könnte auch ein eigener 7. Schadenstyp werden wenn genug Tower ihn nutzen.

**Erweiterbarkeit:** Das 6×5 System hat Platz für mindestens 2 weitere Schadenstypen und 2 weitere Rüstungstypen ohne die Matrix unleserlich zu machen. Ein 8×7 System wäre das absolute Maximum.

---

## Enemy-Zuordnung

### Aktuell

| Enemy | Armor Type | Properties | Begründung |
|-------|-----------|------------|------------|
| **Zombie** | Unarmored | – | Standard-Feind, jeder Tower tut was |
| **Rat** | Unarmored | Swarm, Fast | Gatling-Futter |
| **Penguin** | Unarmored | Swarm, Very Fast | Noch mehr Gatling-Futter |
| **Wallsmasher** | Light | Fast | Schnell + evasiv |
| **Bat** | Light | Air | Fliegend, braucht Anti-Air |
| **Zombie Soldier** | Heavy | – | Gepanzert, Mid-Game Herausforderung |
| **Tank** | Heavy | Tanky | Klassischer Armor-Check |
| **Mammoth** | Fortified | Tanky, Very Slow | Damage-Sponge, braucht sustained DPS |
| **Herbert** | Fortified | Boss | Boss — erzwingt alles |

### Geplante Erweiterungen

| Enemy (Idee) | Armor Type | Properties | Beschreibung |
|-------------|-----------|------------|-------------|
| **Ghost** | Ethereal | – | DER System-Check. Immun vs Physical/Pierce/Fire |
| **Wraith** | Ethereal | Fast | Schneller Geist, Late-Game Terror |
| **Lich** | Ethereal | Boss, Aura | Buffed nahe Geister, Mystisch-Boss |
| **Golem** | Fortified | Tanky, Shielded | Schild + Fortified = doppelter Check |
| **Spider** | Light | Fast, Camo | Unsichtbar + schnell |
| **Mech** | Heavy | Shielded, immuneToBurn | Robopanzer, brennt nicht |
| **Dragon** | Heavy | Air, Boss | Fliegender Boss — Alptraum |
| **Skeleton** | Unarmored | Swarm, Split | Teilt sich in 2 Mini-Skeletons |
| **Slime** | Unarmored | Regen, Split | Regeneriert + teilt sich |
| **Banshee** | Ethereal | Fast, Phasing | Immun vs Slow + Physical |

---

## Progression — Schrittweise Komplexität

### Phase 1: Basics (Wave 1–5)
**Armor:** Nur Unarmored
**Enemies:** Zombie, Rat
**Tower verfügbar:** Archer, Dual-Gatling
**Lernen:** Platzierung, Economy, Targeting

→ *Kein System nötig. Spieler lernt Kernmechaniken.*

### Phase 2: Erste Differenzierung (Wave 6–10)
**Neuer Armor-Typ:** Light (Wallsmasher, Bat)
**Tower unlock:** Cannon, Ice
**Aha-Moment:** Bat erscheint → "Brauche Anti-Air!" (Rocket/Magic)
**Status-Effekt:** Slow wird spürbar (Ice)

→ *Spieler merkt: verschiedene Enemies brauchen verschiedene Antworten.*

### Phase 3: Armor-Check (Wave 11–18)
**Neuer Armor-Typ:** Heavy (Tank, Zombie Soldier)
**Tower unlock:** Rocket, Magic, Fire
**Aha-Moment:** "Meine Pfeile prallen am Tank ab!" → Cannon/Rocket sind der Counter
**Status-Effekte:** Burn (Fire Tower)

→ *Spieler lernt die Matrix intuitiv: Siege > Heavy.*

### Phase 4: Fortified + Boss (Wave 19–25)
**Neuer Armor-Typ:** Fortified (Mammoth, Herbert als Boss)
**Aha-Moment:** "Mammoth stirbt einfach nicht!" → Sustained DPS + Siege nötig
**Immunität-Flags:** Shielded (auf manchen Heavy/Fortified)
**Veteran-Depth:** Burn + Siege Combo für Max-Damage

→ *System fühlt sich "komplett" an für Schicht 1.*

### Phase 5: Ethereal — Der Game-Changer (Wave 22–30)
**Neuer Armor-Typ:** Ethereal (Ghost)
**Aha-Moment:** "WAS?! 0 Damage?!" → Magic Tower ist ESSENTIAL
**Mischung:** Ghost + Tank Eskorte → erzwingt Mixed Build (Magic + Siege)
**Immunität-Flags:** Camo, Regen

→ *Der härteste System-Check. Veteranen lieben es, Casuals lernen es.*

### Phase 6: Endgame / Endless (Wave 30+)
**Alles gemischt.** AI Director kontert dynamisch.
**Neue Flags:** Split, Phasing, Aura
**Boss-Combos:** Lich (Ethereal + Aura) + Mech (Heavy + Shielded) + Spider Swarm (Camo)

→ *Pures Chaos. Nur Mixed Builds überleben.*

---

## AI Wave Director Integration

### State-Vektor

```typescript
interface DamageProfile {
  physical: number;   // DPS aller Physical-Tower
  pierce: number;     // DPS aller Pierce-Tower
  siege: number;      // DPS aller Siege-Tower
  magic: number;      // DPS aller Magic-Tower
  fire: number;       // DPS aller Fire-Tower
  ice: number;        // DPS aller Ice-Tower (Utility-gewichtet)
}
```

### AI-Konter-Logik

| Spieler-Schwäche | AI-Antwort | Intensität |
|------------------|------------|------------|
| Kein Siege | Mehr Heavy/Fortified | Soft (+25% Spawn-Rate) |
| Kein Magic | Ethereal einstreuen | Hard (Ghost-Wave als Check) |
| Nur Siege | Swarm + Light (weichen AoE aus) | Soft |
| Kein Pierce | Swarm-Waves | Soft |
| Kein Anti-Air | Air-Units | Medium |
| Alles balanced | Mixed Waves + Flags | Standard |

**Soft Counter (Default):** AI erhöht Spawn-Rate um 20-30%. Spieler hat Zeit zu reagieren.
**Hard Counter (selten):** Ein klarer Check-Wave (z.B. erste Ghost-Wave). Spieler MUSS reagieren.

**Wichtig:** Hard Counters nur für NEUE Mechaniken (Ethereal, Camo). Nicht für "mehr Tank weil du kein Siege hast" — das wäre frustrierend.

---

## Visuelles Feedback

### Damage Numbers

| Effektivität | Größe | Farbe | Animation | Sound |
|-------------|-------|-------|-----------|-------|
| Immun (0×) | Winzig | Grau | "0" + Abprall nach oben | Hohles "Ping" |
| Schwach (≤0.7×) | 0.7× kleiner | Dunkelgrau | Sinkt nach unten | Dumpfes "Clonk" |
| Normal (0.85–1.15×) | Standard | Weiß | Standard Float-Up | Standard Impact |
| Effektiv (≥1.25×) | 1.5× größer | Gold/Gelb | Punch-Out + Glow | Satisfying "Crunch" |
| Sehr effektiv (≥1.5×) | 2× größer | Leuchtendes Gold | "WEAK!" Text + Mini-Shake | Fetter "Shatter" |

### Enemy Armor Readability

- **Health-Bar Rahmen** in Armor-Farbe
- **Kleines Armor-Icon** links neben Health-Bar
- **Ethereal:** Leicht transparentes Model + lila Partikel-Aura
- **Fortified:** Leichter Stein/Erd-Shader, massiver wirkend
- **Shielded:** Sichtbare Schild-Blase um den Enemy

### Tower Selection

- **Tower-Panel:** Damage-Typ Icon + "Stark vs 🛡️🛡️ Heavy" Tag
- **Hover:** Mini-Effektivitäts-Bar gegen alle 5 Armor-Typen
- **Platzierung:** Enemies auf dem Feld zeigen kurz grün/rot Rahmen (kompatibel/inkompatibel)

### Wave Preview

```
┌─────────────────────────────────────┐
│ Wave 18: Armored Assault            │
│ ────────────────────────────────── │
│ 🛡️🛡️ Heavy Armor (dominant)        │
│ ⚠️ Resistant to: Physical, Pierce   │
│ ✅ Weak to: Siege, Magic            │
│ 🛡️ Shielded (einige Einheiten)     │
└─────────────────────────────────────┘
```

---

## Cost-Rebalancing

| Tower | Aktuell | Neu | Begründung |
|-------|---------|-----|------------|
| Archer | 45 | **50** | Physical-Backbone, leicht stärker durch Anti-Light |
| Dual-Gatling | 90 | **95** | Pierce Anti-Swarm ist stark |
| Cannon | 140 | **155** | 1.5× vs Heavy ist premium |
| Rocket | 160 | **160** | Bleibt — Air + Siege bereits teuer |
| Magic | 125 | **130** | 1.75× vs Ethereal = einziger Hard-Counter |
| Ice | 100 | **100** | Bleibt — Low DPS, Utility-Tower |
| Fire | 175 | **170** | Leicht günstiger — 0.0× vs Ethereal ist ein Nachteil |
| Tentacle | 200 | **185** | Physical-Melee ist riskant → günstiger |

---

## Implementierungsreihenfolge

### Phase 1: Infrastruktur (kein Gameplay-Einfluss)
1. Types: `DamageType` = `physical | pierce | siege | magic | fire | ice`
2. Types: `ArmorType` = `unarmored | light | heavy | fortified | ethereal`
3. `DAMAGE_MATRIX` als 6×5 Record in `damage-calculator.service.ts`
4. `calculateDamage(baseDamage, damageType, armorType): number`
5. `damageType` Feld zu allen Tower-Configs
6. `armorType` Feld zu allen Enemy-Configs (alle `unarmored` initial)
7. In `CombatEffectService` einbauen

### Phase 2: Tower-Schadenstypen sichtbar
1. Damage-Typ Icon + Farbe im Tower-Panel
2. Tooltip mit Effektivitäts-Info
3. Shop-Tags

### Phase 3: Enemy-Rüstungen aktivieren (ohne Ethereal)
1. Bestehende Enemies: Unarmored, Light, Heavy, Fortified zuweisen
2. Matrix-Multiplikatoren aktiv
3. Health-Bar Rahmen + Armor-Icon
4. Wave Preview Armor-Info
5. Damage Numbers Feedback (Farbe/Größe)

### Phase 4: Audio + VFX Feedback
1. Hit-Sounds: Crunch (effektiv) vs Clonk (resist)
2. Abprall-Animation bei Resistenz
3. Glow bei Weakness-Hit
4. "WEAK!" Floating Text bei ≥1.5×

### Phase 5: Ghost + Ethereal
1. Ghost Enemy Model + Config
2. Ethereal-Armor aktivieren
3. 0×-Immunitäts-Feedback (Projektil geht durch)
4. "Boss + Ghost-Eskorte" Wave-Pattern

### Phase 6: Immunität-Flags
1. Shielded (Schild-HP → bricht)
2. Camo (Detection-Mechanik)
3. Regen (HP/s, Counter: Burn)

### Phase 7: Status-Effekt Synergien
1. Armor Break Effekt
2. Mark Effekt
3. Poison (stacking DoT)
4. Synergie-Combos testen + balancen

### Phase 8: AI Director Update
1. State-Vektor: DPS per Damage Type
2. Soft-Counter Spawn-Logik
3. Hard-Counter nur für neue Mechaniken
4. Neu trainieren mit 6×5 Matrix

---

## Offene Entscheidungen

1. **Ghost-Model:** Asset beschaffen (transparent, eerie, lila Glow)
2. **Camo-Mechanik:** Upgrade für bestehende Tower oder eigener "Radar" Tower?
3. **Tower-Unlock:** Alle verfügbar oder progressiv freischalten?
4. **Tentacle-Spezial:** True Damage als Melee-Bonus? Oder Physical bleibt?
5. **Armor Break:** Eigener Tower oder Upgrade für Cannon?
6. **7. Schadenstyp (Poison/Corrosive):** Wann einführen? Braucht mindestens 2 Tower.

---

## Zukunftsplan: System-Kapazität

```
Aktuell:     6 Damage × 5 Armor + 6 Status + 6 Flags = tiefes System
Maximum:     8 Damage × 7 Armor + 10 Status + 10 Flags = Endgame-reif
Tower-Limit: ~15-18 Tower (2-3 pro Damage Type)
Enemy-Limit: ~25-30 Typen (5-6 pro Armor Type)
```

Das System skaliert über **drei Dimensionen** (Matrix + Status + Flags), nicht nur über mehr Typen in der Matrix. Das hält die Matrix lesbar während die Tiefe über Status und Flags wächst.

---

## Referenzen

- **Bloons TD 6:** Immunität-Layer Konzept (Camo, Lead, Purple)
- **Kingdom Rush:** Flat Armor als Baseline, Magic als Counter
- **Element TD:** Matrix-Tiefe für Veteranen
- **Warcraft 3:** Schadenstyp-Inspiration (adaptiert, nicht kopiert)
- **Slay the Spire:** Schicht-System (Block + Status + Relics als orthogonale Systeme)

---

*Erstellt: 2026-02-16 | v2.1 — Veteran-tauglich, erweiterbar*
