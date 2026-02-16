# RESEARCH_SYSTEM

## Ziel
Ein leicht verständliches, aber tiefes Research/HQ-System für ein 3D Browser-TD. In **<30 Sekunden** erklärbar: *„Baue/upgrade das HQ, schalte neue Tower & Mechaniken frei, starte Forschungen, die nach X Waves fertig sind.“*

---

## 1) HQ-Gebäude Konzept
**Form:** Platzierbares Gebäude + UI-Panel
- **Platzierung:** Ein HQ-„Core“ wird **einmal pro Map** automatisch platziert (vordefinierter Slot nahe Start) oder der Spieler platziert es wie einen Tower zu Beginn. Kein Spam möglich.
- **Angreifbar:** Optionaler Modus „Hardcore“ – HQ hat HP und kann zerstört werden. Standardmodus: **nicht angreifbar**, nur UI-Progression.
- **Map-Interaktion:**
  - Belegt 1x1 Tile (oder kleine Base-Plate), blockiert Pfad nicht.
  - Definiert **Forschungs-Reichweite** (kleiner Radius) für spezielle Upgrades (z. B. Buff-Aura) – optionaler Flavor.

**Design-Entscheidung:** Standard = UI-zentriert, **keine Frust-Mechanik**. Hardcore-Option optional für später.

---

## 2) HQ-Level 1–5 + Freischaltungen
**Wirtschafts-Balance:** Start 50 Credits, Wave-Bonus 35. HQ-Upgrades sollen **spürbar** sein, aber nicht erdrücken. Ziel: Spieler muss abwägen: *„Upgrade ich HQ oder baue ich Tower?“*

### HQ-Level Übersicht
| HQ-Level | Kosten | Freischaltungen (Tower + Mechaniken) |
|---|---:|---|
| **1** | Start | **Archer**, **Dual-Gatling** verfügbar. Basis-Research-Branch freigeschaltet (Military + Intel). |
| **2** | 120 | **Cannon** (Siege) + **Magic** (Magic). Mechanik: **Armor Types sichtbar** (UI-Tooltip), erste **Research Queue** (1 Slot). |
| **3** | 220 | **Ice** (Slow) + **Fire** (Burn). Mechanik: **Status-Effekte anzeigen** (Status-Icons über Enemies). Research Queue 2 Slots. |
| **4** | 360 | **Rocket** (Air-only) + **Tentacle** (Melee/True). Mechanik: **Camo Enemies möglich**, **AA Upgrades** freischaltbar. |
| **5** | 520 | **Spezialisierungen** (Tier-4 Pfade) + **Global Perks** (passive Boni). Research Queue 3 Slots. |

**Hinweis:** Kosten lassen den Spieler typischerweise **1–2 HQ-Level pro 10 Waves** erreichen, abhängig von Build.

---

## 3) Forschungs-Baum (4 Zweige, 4–5 Forschungen)
Forschung kostet Credits und dauert **X Waves** (kein Echtzeit-Timer). Forschung läuft **im Hintergrund**, pro Queue-Slot 1 Research.

### A) Military (Ballistik & Kontrolle)
1. **Ballistic Calibration** (80, 2 Waves)
   - +10% Projektilgeschwindigkeit (Archer, Gatling, Cannon)
2. **Shatter Rounds** (120, 3 Waves)
   - **Armor Break**-Chance +10% (Physical/Pierce)
3. **Suppressing Fire** (140, 3 Waves)
   - **Stun**-Chance 5% auf Gatling (kurz, 0.4s)
4. **Forward Observer** (160, 3 Waves)
   - +1.5 Range für Archer/Cannon
5. **High-Explosive Doctrine** (200, 4 Waves)
   - Cannon/ Rocket: +15% AoE-Radius

### B) Engineering (Maschine & Infrastruktur)
1. **Efficient Salvage** (70, 2 Waves)
   - **+10% Sell Value**
2. **Reinforced Barrels** (110, 3 Waves)
   - +10% Base Damage (Cannon/Gatling)
3. **AA Retrofit** (140, 3 Waves)
   - **Anti-Air Capability**: Archer & Gatling können Air angreifen (reduzierter DMG vs Air)
4. **Auto-Loader** (160, 4 Waves)
   - +10% Attack Speed (Gatling/Cannon)
5. **Shock Plating** (200, 4 Waves)
   - **Stun Resistance** für Towers (gegen EMP-Enemies) / falls nicht existiert: +10% Tower HP (Hardcore)

### C) Arcane (Magie & Status)
1. **Arcane Focus** (90, 2 Waves)
   - +12% Magic Damage
2. **Cryo Mastery** (130, 3 Waves)
   - Ice Slow +15%, Slow-Duration +0.3s
3. **Pyro Infusion** (140, 3 Waves)
   - Fire Burn: +1 Tick, +10% Burn Damage
4. **Hexed Mark** (180, 4 Waves)
   - **Mark**-Status: +8% Schaden auf markierte Enemies (Magic/Fire)
5. **Soul Tap** (220, 4 Waves)
   - **+5% Kill Reward** (global)

### D) Intel (Aufklärung & Kontrolle)
1. **Scout Drones** (80, 2 Waves)
   - **Camo Detection** für Archer/Magic im Radius
2. **Target Lock** (120, 3 Waves)
   - Priorisiert High-Armor Targets automatisch (Smart Targeting)
3. **Signal Relay** (140, 3 Waves)
   - +1.0 Range für Towers im HQ-Radius
4. **Threat Analysis** (170, 4 Waves)
   - Zeigt Armor Type über Enemy-HP-Bar
5. **Adaptive Algorithms** (210, 4 Waves)
   - +5% Damage vs. enemy type, den der Tower zuletzt getötet hat (Soft Counter)

**Anmerkung:** Die Branches sind **kurz**, gut lesbar, keine Skill-Überladung.

---

## 4) Freischaltbare Mechaniken (Mapping)
| Mechanik | Freischaltung | Branch | Details |
|---|---|---|---|
| **Camo Detection** | Scout Drones | Intel | Archer/Magic erkennen Camo im Radius |
| **Armor Break** | Shatter Rounds | Military | 10% Chance, Armor -1 für 3s |
| **Anti-Air (Ground-Tower)** | AA Retrofit | Engineering | Archer/Gatling können Air treffen (70% DMG) |
| **Poison** | Optional: „Toxic Coils“ | Arcane | Fire/Tentacle Dot, 4s, leicht |
| **Stun** | Suppressing Fire | Military | Gatling 5% Stun 0.4s |
| **Mark** | Hexed Mark | Arcane | +8% Schaden auf markierte Enemies |
| **Passive Boni** | Efficient Salvage / Soul Tap | Engineering / Arcane | +10% Sell, +5% Kill Reward |

**Optionales Mini-Feature:** Poison kann als Level-5 Global Research kommen, falls Status sonst zu komplex.

---

## 5) Progression über Waves (Planungstabelle)
*Beispiel für 30–35 Waves. Werte können je nach Balance angepasst werden.*

| Wave | Mögliches HQ-Level | Fokus (Tower/Research) |
|---|---|---|
| 1–3 | HQ1 | Archer + Gatling, 1. Research (Military/Intel) |
| 4–6 | HQ2 | Cannon/Magic, 1–2 neue Researches |
| 7–10 | HQ2–3 | Ice/Fire optional, Status-Research |
| 11–15 | HQ3 | Forschungsschwerpunkt (2 Slots) |
| 16–20 | HQ4 | Rocket/Tentacle, AA/Camo gegen neue Enemy-Typen |
| 21–25 | HQ4–5 | Spezialisierungen + Global Perks |
| 26–30+ | HQ5 | Optimieren, starke Synergien |

**Design-Prinzip:**
- **Kein Zwang**: Jede Wave ist ohne Max-Research schaffbar, aber Research glättet Härte-Spikes.
- Spieler trifft echte Entscheidungen: *„HQ-Upgrade vs. Tower?“*

---

## 6) Interaction mit AI Director
**AI kennt HQ-Level + Research Status.**
- **Camo Enemies** erscheinen erst, wenn **Camo Detection** erforschbar oder bereits erforscht ist (Intel Branch). 
- **High-Armor Enemies** steigen erst, wenn **Cannon/Magic** oder **Armor Break** verfügbar sind.
- **Air-Heavy Waves** erst ab HQ4 (Rocket) oder **AA Retrofit** verfügbar.

**Heuristik (einfach, erklärbar):**
- *„AI darf Tools erst testen, wenn der Spieler Zugriff darauf hatte.“*
- Dennoch: AI kann **vorsichtig anteasern** (1–2 Camo-Units), sobald Research „in Queue“ ist → weicher Übergang.

---

## 7) UI-Mockup (Beschreibung)
**Ziel:** Schnell verständlich, wenig Overhead.

### Layout
- **Button:** „HQ / Forschung“ (unten links, neben Build-Menü)
- **Panel:** Rechts ein **Research Tree** mit Tabs: Military / Engineering / Arcane / Intel
- **Tree-Style:** Vertikale Kette, 4–5 Nodes pro Branch
- **Queue:** Oben rechts im Panel: 1–3 Slots (zeigt „fertig in X Waves“)

### Flow
- **Zwischen Waves:** Voller Zugriff, Fokus-Mode (Panel groß)
- **Während Waves:** Minimal-Panel (nur Queue + Start/Pause), keine komplexen Dialoge

### UX-Details
- Hover zeigt: Kosten, Wellen-Dauer, Effekt, Voraussetzung
- Lock-Icons für nicht verfügbare HQ-Levels
- Animation: Research-Fortschritt als Wave-Ticks

---

## Kurz-Zusammenfassung (30s Pitch)
- **HQ-Level 1–5** schalten Tower & Mechaniken frei.
- **Forschung** kostet Credits und dauert **X Waves**.
- **4 Branches**, je 4–5 Nodes → klare Entscheidungen.
- AI Director nutzt HQ-Level, um Enemies fair zu skalieren.
- System bleibt simpel, aber mit Tiefe.

---

## Bonus: Beispiel-FAQ (Ingame Tooltip)
**„Warum kann ich Rocket nicht bauen?“** → Upgrade HQ auf Level 4.

**„Wie lange dauert Forschung?“** → X Waves, Fortschritt pro Wave-Tick.

**„Kann ich ohne Forschung gewinnen?“** → Ja, Forschung macht’s komfortabler.

---

*Dieses Dokument ist absichtlich kompakt und UI-sparsam für einen Browser-TD, inspiriert von Bloons/Factorio/They Are Billions.*
