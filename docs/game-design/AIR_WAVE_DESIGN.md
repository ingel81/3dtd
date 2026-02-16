# AIR_WAVE_DESIGN

> Ziel: Faire, planbare Air-Waves trotz dynamischem AI Wave Director. Spieler sollen Zeit haben, Anti-Air aufzubauen, ohne dass Air-Waves „random“ unfair bestrafen.

---

## 1) Air-Wave-Fairness-System — Optionen & Empfehlung

### Option A: **Feste Air-Wave Slots**
**Idee:** Jede X. Wave ist garantiert eine Air-Wave (z. B. Wave 8, 15, 22 …).

**Vorteile**
- Maximale Planbarkeit, Spieler weiß genau wann Air kommt.
- Sehr verständlich, easy kommunizierbar.
- Kein „Gotcha“-Moment durch AI Director.

**Nachteile**
- Wenig dynamisch, AI wirkt „starr“.
- Schwieriger, auf Spielerleistung zu reagieren.
- Wiederholungsgefühl bei mehreren Runs.

---

### Option B: **AI Director mit Fairness-Constraint**
**Idee:** AI darf Air nur schicken, wenn Spieler mind. 1 Anti-Air-Tower hat **oder** Air wird X Waves vorher angekündigt.

**Vorteile**
- Dynamik bleibt erhalten.
- Fairness über Regeln gesichert.
- AI kann Druck aufbauen, wenn Spieler bereits vorbereitet ist.

**Nachteile**
- Ohne klare Warnsysteme trotzdem überraschend.
- Spieler könnte Anti-Air vermeiden → AI kann Air nie bringen (Content wird „geblockt“).
- Erfordert gutes UI/Warning, sonst fühlt es sich immer noch willkürlich an.

---

### Option C: **Hybrid**
**Idee:** Erste Air-Wave ist fix (Wave X), danach dynamisch mit Constraints.

**Vorteile**
- Erste Erfahrung ist fair & planbar.
- Danach bleibt Dynamik erhalten.
- Spieler lernt Air-Bedrohung früh und reagiert.

**Nachteile**
- Nach der ersten Air-Wave weiterhin Warnsystem nötig.
- Balance der Constraints muss gut sein.

---

### Option D: **Progressive Air-Einführung**
**Idee:** Früher Teaser (1–2 Bats in Ground-Waves), kurze Zeit später erste reine Air-Wave.

**Vorteile**
- Spieler erkennt früh „Air existiert“.
- Natürliche Lernkurve.
- Weniger Frust durch Überraschung.

**Nachteile**
- Teaser-Waves müssen sehr klar kommuniziert werden.
- Wenn Teaser zu schwach, Spieler ignoriert sie.

---

### ✅ Empfehlung: **Option C + D kombiniert**
**Warum:**
- **Erste Air-Wave fix (Wave X)** → garantiert faire Erstbegegnung.
- **Progressive Teaser davor** → Spieler wird vorbereitet (lernen & reagieren).
- **Danach dynamisch** aber mit **Fairness-Constraints** → AI bleibt spannend, aber keine unfairen Random-Air-Waves.

**Kurzform:**
1. **Teaser** (Bats in Mixed Waves)
2. **Erste reine Air-Wave fix bei Wave X**
3. **Danach AI dynamisch, aber nur mit Constraints + Pre-Warn**

---

## 2) Anti-Air Ökosystem

### Reicht 1 dedizierter Anti-Air Tower?
**Kurz: Nein.**
- Rocket Tower ist **Air-only** → Risiko: Spieler baut nur Rocket und verliert Ground.
- Ice Tower kann Air, aber hat **zu wenig Damage**.

### Empfehlung: Mehrere Air-Optionen schaffen
- **Ein weiterer Tower sollte Air als Upgrade bekommen**, damit Air nicht nur „1 Hard-Counter“ hat.
- **Mind. 2–3 viable Air-Lösungen** = faire strategische Entscheidung.

### Kandidaten für Anti-Air-Upgrade
- **Magic Tower** (logisch: homing/projectiles, Elementar, „Arcane Bolts“)
- **Sniper/Marksman** (logisch: hoch, gezielt, „Skyfire Ammo“)
- **Tesla/Chain** (logisch: trifft alles in Luftlinie, „Storm Coil“)

### Balance: Ground+Air vs Air-Only
**Air-Only (Rocket):**
- Stark vs Air (hoher DPS, Siege)
- Nachteil: gegen Ground nutzlos

**Ground+Air (Magic/Ice):**
- Flexibel, aber geringerer DPS
- Ideal als „Basis-Antwort“ auf Air

**Design-Regel:**
- **Air-Only = High DPS, hoher Preis, Spezialisierung**
- **Hybrid = solide, aber nicht optimal gegen Air**

---

## 3) Wave Preview & Warnsystem

### Minimal: Wave Preview mit Air Icon
- „✈️ Air Units“ in der Preview
- reicht für Experten, nicht für neue Spieler

### Besser: „Air Alert“ X Waves vorher
- **Air Alert: „Air-Wave in 2 Waves!“**
- Unterstützt Planung & Aufbau

### UI/Audio
- **Klares Air-Symbol** (rot/blinkend)
- **Optionaler Sound** (kurzer Alarm/Whoosh)
- UI-Text: „Air incoming – build Anti-Air!“

**Best Practice:**
- **2-Wave Vorwarnung** + Preview
- Option, Air-Warnung in Settings zu toggeln

---

## 4) Air-Wave Composition

### Reine Air-Waves vs Mixed
- **Reine Air-Wave = klarer Check** (Test: „Hast du Anti-Air?“)
- **Mixed = später, um Multi-Defense zu prüfen**

### Air-Boss (Dragon) Einführung
**Stufenweise:**
1. **Teaser:** 1 Dragon solo (mit klarer Warnung)
2. **Boss-Wave:** Dragon + Escort (Bats)
3. **Late-Game:** 2 Dragons + Mixed Ground

### Air-Swarm vs Air-Elite
- **Air-Swarm:** viele Bats, schwach, DPS-Check
- **Air-Elite:** wenige Dragons, HP-Check

**Ideal:** Abwechseln → Swarm (DPS) → Elite (Burst/Single Target)

---

## 5) Pacing & Wave-Rhythmus (30 Waves Beispiel)

### Zielkurve
**Leicht → schwer → Atempause → schwerer → Boss**

### Pacing-Template (Beispiel)

**Waves 1–5: Einführung**
- Ground only, langsam steigende HP/Speed
- Wave 4: erste „Check“-Welle (z. B. Fast)

**Wave 6–8: Teaser & Vorbereitung**
- Wave 6: Mixed mit 1–2 Bats (Teaser)
- Wave 8: **Erste Air-Wave (fix)**

**Waves 9–12: Steigerung + Breather**
- Wave 9: Breather (leichter)
- Wave 10–11: stärkere Ground-Waves
- Wave 12: Air-Swarm (viele Bats)

**Waves 13–16: Multi-Checks**
- Wave 13: Heavy (Tank)
- Wave 15: Mixed Air+Ground (erster Hybrid-Check)
- Wave 16: Breather

**Waves 17–20: Mid-Boss & Druck**
- Wave 18: Mini-Boss (Ground)
- Wave 20: Air-Elite (1 Dragon)

**Waves 21–25: Intensivphase**
- Wave 22: Mixed Heavy + Air
- Wave 24: Breather
- Wave 25: Air-Swarm + Ground Rush

**Waves 26–30: Finale**
- Wave 27: Heavy Check
- Wave 28: Air-Elite (2 Dragons)
- Wave 30: Final Boss + Mixed

### Breather-Waves
- alle ~4–6 Waves
- niedrigere HP/Speed, mehr Buildup-Fenster

### Check-Waves (System-Checks)
- **Air Check:** erste reine Air-Wave
- **Heavy Check:** Tank-Wave
- **Speed Check:** Rush-Wave
- **Hybrid Check:** Mixed Air+Ground

---

## 6) AI Director Constraints (Pseudo-Regeln)

### Ziel: Fairness + Dynamik

**Regeln (Pseudo-Code):**
```
if waveIndex < FIRST_AIR_WAVE:
    allowAir = false

if waveIndex == FIRST_AIR_WAVE:
    forceAirWave()

if waveIndex > FIRST_AIR_WAVE:
    # Mindestabstand zwischen Air-Waves
    if wavesSinceLastAir < MIN_AIR_GAP:
        allowAir = false

    # Spieler muss Anti-Air besitzen oder Air wurde angekündigt
    if player.hasAntiAir == false:
        allowAir = false
    else:
        allowAir = true

    # Vorwarnung
    if plannedAirWave:
        announceAirWave(waveIndex + AIR_WARNING_LEAD)
```

### Konkrete Constraints
- **FIRST_AIR_WAVE = 8** (fix)
- **MIN_AIR_GAP = 4** (mind. 4 Waves Abstand)
- **AIR_WARNING_LEAD = 2** (2 Waves Vorwarnung)
- **Anti-Air-Check:** Air nur, wenn mind. 1 Anti-Air Tower oder Hybrid Air-Upgrade existiert
- **Fallback:** Wenn Spieler kein Anti-Air baut → AI ersetzt Air-Waves durch Ground-Checks

---

## Zusammenfassung (TL;DR)
- **Beste Lösung:** Hybrid + Progressive Einführung (fixe erste Air-Wave + Teaser + dynamische Air-Waves mit Constraints).
- **Anti-Air:** 1 Tower reicht nicht. Mind. 2–3 viable Optionen + Hybrid-Upgrades.
- **Warnung:** Air-Icon allein reicht nicht → Air Alert 2 Waves vorher + optionaler Sound.
- **Air-Design:** Abwechselnd Swarm vs Elite, Dragon stufenweise einführen.
- **Pacing:** Kurve mit Breather- und Check-Waves, klare Rhythmik.
- **AI Constraints:** Mindestabstand, Anti-Air-Check, Vorwarnung, fallback ground.
