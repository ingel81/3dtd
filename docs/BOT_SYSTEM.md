# Bot System: Dokumentation

**Stand:** 2026-10-03 (Schiedsrichter, B3 in [BOT_PLAYER_PLAN.md](BOT_PLAYER_PLAN.md))
**Code:** `src/app/bots/`

## Überblick

Der Bot spielt die Verteidigerseite: er baut, upgradet, verkauft, forscht und
startet Wellen. Er hat zwei Aufgaben, und die zweite bestimmt sein Design:

1. Automatisiertes Spielen für Playtests und Headless-Läufe.
2. **Der Bot ist der Gegner, gegen den der Wave Director gemessen wird.** Alles,
   was der Bot systematisch anders macht als ein Mensch, verschiebt die Messung
   des Wave-Designs. Das ist kein theoretisches Risiko: genau daran ist eine
   ganze Trainingsgeneration gescheitert (siehe [Warum die Platzierung so
   aussieht](#warum-die-platzierung-so-aussieht)).

**Drei Profile seit 2026-10-03** ([BOT_PLAYER_PLAN.md](BOT_PLAYER_PLAN.md), B5):
`beginner`, `normal` und `expert`. Von 2026-09-20 bis dahin gab es zwei
([BALANCING_PLAN.md](BALANCING_PLAN.md), D15), davor vier, von denen zwei Paare
dasselbe Strategie-Set hatten.

**Der Bot handelt nur über `command:*`.** Bauen, Upgraden, Verkaufen, Forschen,
Fähigkeiten und der Held gehen denselben Weg wie ein Klick. Vorher riefen Bau
und Verkauf direkt in den `GameStateManager`, und das Run-Log
([RUN_LOG.md](RUN_LOG.md)) hätte diese Entscheidungen nie gesehen.

Architektur: **Strategien schlagen vor, ein Schiedsrichter entscheidet**
(seit 2026-10-03). Ein `StrategyBot` hält eine Liste von `ITowerStrategy`-
Objekten; jede liefert Vorschläge (`Proposal`), `arbitrate` in
`decision/arbiter.ts` nimmt einen. Käufe vergleicht er nach Nutzen je Gold
(`decision/value.ts`). Vorher führte er je Entscheidung die erste Strategie
einer Prioritätsliste aus, die konnte. Wahrnehmung (B1) und Sichtprobe (B2)
stehen in [BOT_PLAYER_PLAN.md](BOT_PLAYER_PLAN.md).

---

## Ausführungsmodell

```
Sub-Step-Loop (game-loop-facade)
  └─ BotClientService.updateBot(getSnapshot, deltaTime)   → ohne Session: false
       └─ BotSession.updateBot(getSnapshot, deltaTime)
            ├─ bot.tickCooldown(deltaTime)      → false ⇒ Abbruch, KEIN Snapshot
            ├─ bot.update(getSnapshot(), 0)     → StrategyBot.decideAction(state)
            │    ├─ Kontext: Bedrohung, Kapazität, Meter je Tower
            │    ├─ jede Strategie: propose(state, context) → Proposal[]
            │    └─ arbitrate(): Regeln → Forschung → Kauf nach Nutzen/Gold → Welle
            └─ BotSession.executeBotAction(action)
```

Drei Details, die man beim Lesen des Codes sonst falsch erwartet:

- **Cooldown läuft in Game-Time, nicht Wall-Clock.** `tickCooldown(deltaTime)`
  bekommt den Sub-Step-Delta des Fixed-Timestep-Loops. Bei Timescale 75 verhält
  sich der Bot dadurch pro *Spiel*sekunde identisch zu 1×. Vorher lief er über
  `Date.now()` und traf im Schnelldurchlauf ein 75-tel der Entscheidungen pro
  Spielsekunde; das war die Ursache von „Bot kommt bei 75× bis Welle 6, bei 10×
  bis Welle 20".
- **`tickCooldown` ist von `update` getrennt**, damit der Aufrufer den
  Snapshot-Bau überspringen kann, solange der Bot in Reaktionszeit steht. Der
  Snapshot ist das mit Abstand teuerste in der Schleife (volle Defense-Analyse,
  effektive DPS pro Rüstung, Route-Grid-Reach-Query), und die Sub-Step-Loop
  läuft bei hohem Spieltempo ~200 Ticks pro gerendertem Frame. Wer
  `tickCooldown` vorher ruft, übergibt danach `deltaTime = 0`, sonst tickt der
  Cooldown doppelt.
- **`wait` kommt vom Schiedsrichter.** Er wartet, wenn er auf einen Kauf
  spart oder nichts lohnt; der Grund steht im `reason` („Saving for …“). Jede
  Action, auch `wait`, setzt den Reaktionszeit-Cooldown zurück. Ein `wait`
  zählt nicht als Aktion für die Strategien (`onActionExecuted`), sonst liefe
  der Timer des Wellenstarts nie ab.

Strategie-eigene Cooldowns (Sell-Cooldown, Wave-Start-Delay) laufen über
`tickCooldowns(deltaTime)` und werden **jeden** Frame getickt, auch während der
Bot selbst in Reaktionszeit steht. Sonst würden sie bei hoher Timescale
verhungern.

---

## Verzeichnisstruktur

```
src/app/bots/
├── bot-client.service.ts       # Einstieg: Signale für UI/Game-Loop, lädt die Session bei Bedarf
├── bot-session.ts              # WebSocket-Client + Bot-Steuerung + Action-Ausführung (Lazy-Chunk)
├── bot-world.ts                # Was der Bot sieht: Tower, Gegner, Routen, Wahrnehmung, Wellen-Panel
│
├── bots/
│   ├── tower-bot.interface.ts       # ITowerBot, TowerAction, BotConfig, BOT_CONFIGS, towersByWave
│   ├── base-tower-bot.ts            # Cooldown, Stats
│   ├── strategy-bot.ts              # Kontext je Entscheidung, Vorschläge sammeln, Schiedsrichter
│   └── strategy-bot.factory.ts      # Strategie-Sets je Skill-Level + Jitter
│
├── decision/
│   ├── arbiter.ts                   # Proposal, arbitrate(): Reihenfolge, Sparziel
│   └── value.ts                     # Bedrohung, Kapazität, Nutzen (killTimeSaved), Verlangsamung
│
├── perception/
│   └── bot-perception.ts            # Letzte Wellen: Kills je Abschnitt, Lecks, Tower-Leistung (B1)
│
└── strategies/
    ├── tower-strategy.interface.ts  # ITowerStrategy, DecisionContext, BaseStrategy (eine Regel)
    ├── ability/                     # Regeln: Nuklearschlag, Frostbombe, EMP, Orbitallaser
    ├── hero/hero.strategy.ts        # Regel: anheuern, Munition, Stellung
    ├── placement/                   # Regeln: Research Center, Missile Silo
    ├── research/research-pick.strategy.ts   # Forschung: Kauf, Forschung oder Regel
    ├── build/tower-build.strategy.ts        # Kauf: ein neuer Tower je Typ
    ├── upgrade/tower-upgrade.strategy.ts    # Kauf: jedes Upgrade jedes Towers
    ├── sell/tower-sell.strategy.ts          # Regel: blinde Tower verkaufen, Platz für Besseres
    ├── targeting/targeting.strategy.ts      # Regel: Zielwahl für Boss und Luft
    └── wave/auto-start-wave.strategy.ts     # Welle
```

Es gibt **keine** `index.ts`-Barrels in diesem Baum; importiert wird direkt aus
den Dateien. `GameStateSnapshot` liegt in
`src/app/director/models/game-state-snapshot.ts`.

---

## Core Interfaces

### ITowerBot

```typescript
export interface ITowerBot {
  readonly config: BotConfig;
  readonly name: string;

  update(state: GameStateSnapshot, deltaTime: number): TowerAction | null;

  /** Timer um deltaTime (Game-Time ms) vorstellen; true = Entscheidung fällig. */
  tickCooldown(deltaTime: number): boolean;

  reset(): void;
  onWaveCompleted?(survived: boolean, damagePercent: number): void;
}

export type BotSkillLevel = 'beginner' | 'normal' | 'expert';
```

### ITowerStrategy

```typescript
export interface ITowerStrategy {
  readonly name: string;
  /** Was sie jetzt täte; leer, wenn nichts */
  propose(state: GameStateSnapshot, context: DecisionContext): Proposal[];
  tickCooldowns?(deltaTime: number): void;
  onActionExecuted?(action: TowerAction): void;
  onReset?(): void;
}

export interface Proposal {
  kind: 'rule' | 'research' | 'buy' | 'wave';
  label: string;
  cost: number;     // Gold
  value: number;    // Käufe: gesparte Tötungszeit gegen die kommenden Wellen
  act(): TowerAction | null;   // erst für den genommenen Vorschlag ausgerechnet
}
```

`BaseStrategy` ist eine Strategie aus einer Regel: `canExecute`/`execute` wie
früher, `propose` macht daraus einen Vorschlag ihrer Art (`rule` als Vorgabe,
`wave` für den Wellenstart). `DecisionContext` baut der `StrategyBot` einmal je
Entscheidung: Bedrohung, Kapazität, Meter unter Feuer je Tower, Zahl und mittlere
Länge der eigenen Routen.

### TowerAction

```typescript
export type TowerActionType =
  'place' | 'upgrade' | 'sell' | 'wait' | 'start-wave' | 'research-start' | 'research-cancel' | 'use-ability';

export interface TowerAction {
  type: TowerActionType;
  position?: { x: number; z: number };   // place, use-ability: x = lon, z = lat
  towerType?: TowerTypeId;               // place
  towerId?: string;                      // upgrade, sell
  upgradeId?: string;                    // upgrade
  researchId?: string;                   // research-start, research-cancel
  abilityId?: AbilityId;                 // use-ability
  confidence?: number;
  reason?: string;
}
```

`research-cancel` wird von `executeBotAction` behandelt, aber von keiner
aktuellen Strategie erzeugt.

### BotConfig / BOT_CONFIGS

```typescript
export interface BotConfig {
  skillLevel: BotSkillLevel;
  reactionTimeMs: number;          // Game-Time zwischen Entscheidungen
  knownTowerTypes: TowerTypeId[];  // für alle Skill-Level dieselbe Liste
  adaptsToEnemies: boolean;
  maxTowers: number;               // 0 = unbegrenzt
}
```

| Profil | reactionTimeMs | maxTowers | buildTempo | attention | noise | knows |
|---|---|---|---|---|---|---|
| beginner | 3000 | 10 | 1 + 1 je Welle | 0 | 0,5 | nichts davon |
| normal | 1500 | 25 | 1 + 1,5 je Welle | 0,6 | 0,25 | Held, adaptive Forschung, verteilt bauen, Gold senden |
| expert | 800 | 40 | 1 + 1,75 je Welle | 0,95 | 0,1 | dazu Verkaufen, Zielwahl |

Die menschlichen Grenzen (Entscheidung P3):

- **`attention`:** Chance, dass eine Entscheidung auf das Wellen-Panel (die
  nächsten zwei Wellen, `WaveDirector.peek`) und die Lecks der letzten Wellen
  schaut. Ohne den Blick rechnet der Bot mit der erwarteten Rüstungsverteilung
  am Boden und nimmt die letzte Welle als dicht. Ersetzt `adaptsToEnemies`.
- **`noise`:** Streuung auf den Wert jedes Kaufs, je Entscheidung gewürfelt
  (Faktor `1 ± noise`): ein Spieler sieht nicht immer das Beste je Gold.
- **`reactionTimeMs`** ist auch der Deckel für Aktionen je Minute: 800 ms sind 75
  je Spielminute. Der Lauf des Users kam in Upgrade-Salven auf 60 bis 90, dazwischen
  auf 3 bis 18; ein fester Deckel je Minute hätte die Salven verboten.
- **`knows`:** Held, Verkaufen, Zielwahl, adaptive Forschung, verteiltes Bauen,
  Gold senden im Coop. Die Factory baut danach das Strategie-Set.

Der Zufall kommt aus dem `bot`-Strom des Laufs, Läufe bleiben reproduzierbar.
`buildTempo` ist das Bautempo eines Menschen:
höchstens `base + perWave × Welle` Kampftower, abgerundet (`towersByWave`). Per
Gold schlägt ein neuer Tower jedes Upgrade, ein Bot nur nach Nutzen baute 35
Archer bis Welle 4. Im Lauf des Users (2026-10-01, Binswangen) standen 1
Kampftower bei W1, 3 bei W2, 8 bei W4, 14 bei W8, 29 bei W12; das Gold darüber
ging in Upgrades. Abgleich mit `tools/play-profile/play-profile.mjs`.

`knownTowerTypes` ist bei allen `ALL_COMBAT_TOWERS` (archer, dual-gatling,
cannon, magic, rocket, ice, fire, tentacle, poison, lightning, chaos). Was ein Bot
tatsächlich bauen *kann*, entscheidet der Research-Unlock, nicht die Config.
Skill-Level unterscheiden sich in Reaktionszeit, Turm-Cap und Strategie-Set.

**Warum `maxTowers` bei 40 liegt:**

- Der Design-Zielbestand sind ~13 Türme (einer je Typ, Archer ×3) auf Level 20,
  siehe `docs/wave-planner.html`. 40 liegt deutlich darüber, damit der Bot misst,
  was ein Spieler erreicht, der weiter baut. Die Wellenquellen planen gegen die
  Abwehr, die steht; ein Training, dem ein zu starker Bot falsche Wellen
  beibringt, gibt es nicht mehr.
- Die Grenze hält die Rechenlast der Messläufe: bei 300 baute der Bot 298 Türme,
  die Kampfauflösung allein kostete 6 ms pro Sub-Step.

Die Factory legt beim Erzeugen ±30 % Jitter auf `reactionTimeMs` und `maxTowers`
(`jitterConfig()`, Faktor in [0.7, 1.3], Untergrenzen 100 ms und 5 Türme,
`maxTowers = 0` bleibt 0), damit
parallele Bot-Tabs nicht identisch spielen. Seit 2026-10-03 bekommen auch die
Strategien die gejitterte Config; vorher lasen sie `BOT_CONFIGS` und der
Jitter des Tower-Deckels wirkte nie.

---

## Strategie-Sets je Skill-Level

Quelle: `strategy-bot.factory.ts::getStrategiesForSkillLevel`. Die Reihenfolge
ist die, in der der Schiedsrichter Regeln nimmt.

| Strategie | Art | beginner | expert |
|---|---|:--:|:--:|
| NuclearStrike | Regel | ✓ | ✓ |
| FrostBomb | Regel | ✓ | ✓ |
| Emp | Regel | ✓ | ✓ |
| OrbitalLaser | Regel | ✓ | ✓ |
| Hero | Regel | | ✓ (auch normal) |
| ResearchCenterPlacement | Regel | ✓ | ✓ |
| MissileSiloPlacement | Regel | ✓ | ✓ |
| Sell | Regel | | ✓ |
| Targeting | Regel | | ✓ |
| Gift (nur Coop) | Regel | | ✓ (auch normal) |
| ResearchPick | Kauf, Forschung oder Regel | ✓ | ✓ |
| Build | Kauf | ✓ (Enden der Route) | ✓ (Zonen) |
| Upgrade | Kauf | ✓ | ✓ |
| AutoStartWave | Welle | (✓) | (✓) |

`(✓)` = wird nur angehängt, wenn `createBot(skill, autoStartWaves = true)`.

Die Fähigkeiten feuern nur, wenn erforscht; das erforscht nur der Könner
(ResearchPick), beim Einsteiger bleiben sie stumm.

**Unterschied der drei:** Der Einsteiger reagiert langsam (3000 ms), baut
höchstens 10 Tower und langsamer, liest das Wellen-Panel nie, forscht nach
seiner festen Liste, baut an den beiden Enden der Route, verkauft nie und lässt
die Zielwahl, wie sie ist. Der Normale (1500 ms) schaut in sechs von zehn
Entscheidungen auf Panel und Lecks, forscht adaptiv, verteilt seine Tower,
heuert den Helden an und schickt im Coop Gold, verkauft aber nicht und stellt
keine Tower um. Der Könner (800 ms) schaut fast immer, verkauft und stellt vor
Boss- und Luftwellen Tower um.

Ein Batch verteilt die Bots gleich (`BOT_WEIGHTS` im Bot-Server); der Server
sagt jedem Client vor jedem Lauf, welchen er spielt.

---

## Der Schiedsrichter

`decision/arbiter.ts`, Entscheidung P1 in [BOT_PLAYER_PLAN.md](BOT_PLAYER_PLAN.md).
Reihenfolge:

1. **Regeln** in der Reihenfolge der Factory, die erste, die eine Aktion
   ergibt: Fähigkeiten, Held, Research Center, Silo, Verkauf, eine Forschung,
   auf die die nächste Welle nicht warten kann.
2. **Forschung** ohne Kaufwert, solange die letzte Welle dicht war.
3. **Käufe** nach Nutzen je Gold. Ist der beste aller Käufe zu teuer, aber je
   Gold mindestens `SAVE_MARGIN` (1,5) mal so gut wie der beste bezahlbare und
   höchstens `SAVE_REACH` (3) mal so teuer wie das Gold, das da ist, spart der
   Bot darauf.
4. **Forschung** nach einem Leck, wenn es nichts zu kaufen gibt.
5. **Welle**, in der Bauphase, wenn oben nichts handelt: das Gold ist
   ausgegeben oder verplant.

### Nutzen

`decision/value.ts`. Eine Einheit für jeden Kauf: wie viel schneller die
Abwehr die kommenden Wellen tötet.

- **Bedrohung:** HP der nächsten Welle je Rüstung, Boden und Luft, die
  übernächste zur Hälfte (`threatFromWaves`, aus dem Wellen-Panel). Den
  Luftanteil einer Rüstung geben die Gegnerarten der Welle, die sie tragen.
- **Kapazität:** Schaden mal Meter Route unter Feuer je Rüstung und Seite
  (`damageMetresPerArmor`, echte Sichtlinien). Über das Tempo eines Gegners
  ist das die HP, die er auf dem Weg verliert.
- **Nutzen** eines Kaufs, der Kapazität `Δ` hinzufügt:
  `Σ Bedrohung × (1/(Kapazität + Boden) − 1/(Kapazität + Boden + Δ))`.
  Der Ertrag fällt mit dem, was steht: eine Lücke ist am meisten wert. Gegen
  eine Luftwelle ohne Luftabwehr schlägt der erste Luft-Tower jede weitere
  Kanone. Regeln wie „Anti-Air ab Welle 4“ gibt es nicht mehr.
- **Neuer Tower:** Meter erwartet aus der Sehne seiner Reichweite neben der
  Straße (`chordMetres`) mal 0,9; den Platz probt die Platzierung selbst (B2).
  Der erste Tower eines Typs zählt 1,5-fach (`FIRST_OF_TYPE`): ein Spieler baut,
  was er gerade erforscht hat. Ohne das erforschte ein Normal-Bot Eis und Magie
  und baute keins davon.
  Kurze Reichweite deckt weniger Route, darum verliert der Archer gegen
  weiterreichende Tower, sobald sie frei sind.
- **Upgrade:** was es hinzufügt, mit den Metern, die der Tower wirklich unter
  Feuer hat; eine Reichweitenstufe skaliert die Meter mit der Sehne.
- **Verlangsamung** (Eis, `slowAdded`): Gegner bleiben länger im Feuer der
  anderen Tower auf seiner Strecke, für den Anteil, den er verlangsamt halten
  kann.
- **Schaden über Zeit** (Gift, Brand, `lingerAdded`): tickt nach der Reichweite
  weiter, über die Meter, die ein Gegner in der Wirkdauer läuft (6 m/s).
- **Forschung** mit Tower-Freischaltung: der Gewinn je Gold des neuen Typs
  gegenüber dem besten jetzigen, mal 1.000 Gold, die der Bot in den Typ
  stecken wird (`UNLOCK_SPEND`); ein Tor zählt mit 0,9 dessen, was es öffnet.

---

## Strategien im Einzelnen

### ResearchCenterPlacement (Regel)

Baut das Research-Center, solange `state.research.centerLevel === 0`. Wartet, bis
Center **plus** ein Archer bezahlbar sind (75 + 45), damit der Bot sich nicht
in die Forschung leerkauft und ohne Verteidigung dasteht. Position über
`findStrategicPositions` mit dem Typ `research-center`: das Center braucht keine
Reichweite (der Service bewertet die Abdeckung dann in 60 m), aber er liefert
bereits validierte straßennahe Punkte.

Eine Regel vor jedem Kauf, weil ohne Center kein Tower-Unlock passiert und
damit fast das gesamte Spiel verschlossen bleibt.

### MissileSiloPlacement (Regel)

Baut das Missile Silo, von dem der Nuklearschlag startet
([ABILITIES.md](ABILITIES.md#nuklearschlag-in-zahlen)): sobald
`state.research.towerUnlocked['missile-silo']` gilt (Forschung
`nuclear-strike` fertig) und keines steht
(`state.defense.towerDistribution['missile-silo']`). Goldregel wie beim
Research Center: Silo **plus** ein Archer (400 + 45). Position über
`findStrategicPositions` mit dem Typ `missile-silo`, der beste Kandidat: ohne
Reichweite in 60 m bewertet, 15 bis 25 m neben der Straße und nach den
Platzierungsregeln, also nicht auf der Route.

Eine Regel vor jedem Kauf, damit die 1.000 Gold der Forschung nicht ohne Silo
liegen bleiben.
Wie das Research Center ignoriert die Strategie `maxTowers`, das Silo zählt
aber wie das Center in `defense.towerCount` und damit gegen den Turm-Cap der
anderen Platzierungen.

### ResearchPick

Schlägt die nächste Node vor, wenn ein Center steht, ein Slot frei ist und ihre
Prereqs und ihre Mindestwelle erfüllt sind, auch unbezahlbar, damit der
Schiedsrichter darauf sparen kann. Schaltet sie einen Tower frei, der je Gold
besser ist als der beste baubare, ist sie ein **Kauf** (Nutzen siehe oben).
Sonst ist sie **Forschung** und wartet, bis eine Welle dicht war. Sind alle
Slots belegt, schlägt sie einen weiteren Slot des Research Centers vor, mit
dem Wert der Forschung, die wartet. Die Warteschlange (`queue-research`) nutzt
der Bot nicht: sie bezahlt am Schiedsrichter vorbei, und ein Bot, der jede
Sekunde schaut, startet eine Forschung ebenso schnell selbst. Bringt die
nächste Welle Luft, gegen die nichts schießt, und ist der Retrofit (oder bei
gepanzerter Luft die Rakete) dran, ist sie eine **Regel**, sobald bezahlbar.

- **beginner:** nur `gatling-tech`.
- **expert:** primär **adaptiv**: bewertet alle offenen Nodes gegen
  `state.expectedArmorDistribution` (effektive DPS pro Credit des freigeschalteten
  Turms gegen den erwarteten Rüstungsmix, Tier-Unlocks nach Bedarf). Nur wenn
  daraus nichts kommt, greift die statische Liste
  (`gatling-tech → aa-retrofit → ice-magic → tentacle-biology → siege-engineering →
  rocketry → arcane-studies → toxic-compounds → fire-alchemy →
  advanced-weaponry → nuclear-strike → frost-bomb → storm-mastery → emp →
  master-engineering → orbital-laser → chaos-rift → advanced-engineering →
  transcendent-tech`, `research-pick.strategy.ts`), die am Wave-Kampagne
  ausgerichtet ist: AA fertig vor
  `bat_swarm` (W7), Cannon vor `boss_herbert` (W10), Rocket vor `dragon_elite`
  (W12), Magic vor `ghost_surge` (W13).
- **Keine Stufe** erforscht `mercenary-contract` (Held, [HERO.md](HERO.md)):
  `BOT_SKIPPED_RESEARCH` nimmt die Node aus der adaptiven Wahl und der Liste.
  Bots heuern den Helden nie an, eine Aktion dafür gibt es nicht; ohne den
  Ausschluss hätte die adaptive Wahl den Global-Perk wie jeden anderen
  bewertet und 600 Credits ausgegeben.

Drei Sonderregeln, alle aus konkreten Fehlern:

- **Anti-Air-Dringlichkeit:** Enthält das Kampagnen-Template der *nächsten*
  Welle Lufteinheiten und die Verteidigung hat keine Luftfähigkeit, bekommt
  `aa-retrofit` +100 auf den Score. Ohne den Bump gewinnt die
  reine Matrix-Bewertung mit einem Turm, der Luft nicht trifft (Gatling ohne
  AA-Retrofit, 1,6× gegen light), gegen Rocket (0,5×), und der Bot geht
  wehrlos in eine forcierte Luftwelle. `rocketry` bekommt den Bump getrennt
  davon, sobald die nächste Welle **gepanzerte** Luft trägt (`heavy`, also
  `dragon_elite`): Das ist der Gegner, für den die Rakete gebaut ist, während
  gegen die leichten Schwärme das nachgerüstete Gatling die bessere Wahl je
  Gold ist.
- **Ethereal im Mix:** Forschungen, die Magic, Eis oder Blitz freischalten,
  bekommen +2,5 (`ETHEREAL_STAPLE_BONUS`): nach der Luftnot, vor der Tier-Linie
  (2,0). Gates davor erben den Wert über `bestScoreBehind`.
- **`hasAntiAirCapability`** liest bevorzugt `defense.capabilities.hasAntiAir`
  (was wirklich gebaut ist und reicht) und fällt sonst auf die Unlock-Flags
  *aller* luftfähigen Türme zurück. Die alte Prüfung sah nur `rocket`, also galt
  eine Verteidigung voller Archer (die Luft treffen) als „keine Anti-Air" und
  der Bot kaufte weiter Rocketry.

### Sell (Regel, nur Könner)

`strategies/sell/tower-sell.strategy.ts`, ersetzt SellUnderperformer (unaufgerüstete
Archer ab 2.000 Gold). Zwei Fälle, beide erst für einen Tower, der drei Wellen
stand (`IDLE_WAVES`, Wahrnehmung B1):

- **Blind:** er hat weniger als 30 % der Meter unter Feuer, die seine Reichweite
  decken sollte, und machte über die drei Wellen unter 2 % des Schadens. Ein
  stiller Tower, der die Route sieht (das Polster vor dem HQ), bleibt.
- **Platz für Besseres:** in der Bauphase am Bautempo, wenn ein freier,
  bezahlbarer Typ doppelt so viel wert ist wie der schwächste unaufgerüstete
  Tower. Der Bau nimmt den freien Platz danach.

4 s Spielzeit zwischen zwei Verkäufen.

### Gift (Regel, Coop, normal und Könner)

`strategies/coop/gift.strategy.ts`, Entscheidung P5. In der Bauphase, einmal je
Welle: hat ein Partner in der letzten Welle mehr geleckt als der Bot und weniger
als die Hälfte seines Golds, schickt der Bot 30 % seines Golds
(`command:give-credits`), wenn er mindestens 300 hat. Die Lecks auf den Spuren
der Partner zählt die Wahrnehmung mit (`leaksElsewhere`), Gold und Spuren der
Partner liefert `BotWorld.partners()`. Bereit meldet sich ein Coop-Bot wie
jeder Bot erst, wenn der Schiedsrichter nichts mehr kauft.

### Targeting (Regel, nur Könner)

`strategies/targeting/targeting.strategy.ts`. Nur in der Bauphase, nach der
nächsten Welle im Wellen-Panel, ein Tower je Entscheidung:

- **Boss:** die drei stärksten Einzelziel-Tower (DPS) zielen auf die meisten HP.
- **Luft:** bringt die Welle mindestens 30 % ihrer HP in der Luft, zielt das
  stärkste Drittel der Tower, die beides treffen, auf Luft zuerst.
- Sonst der Standard des Typs. Die erste Fassung stellte vor jeder Luftwelle
  alle Archer um und danach zurück: 104 Umstellungen bis Welle 13, jetzt 34.

### Hero (Regel, normal und Könner)

`strategies/hero/hero.strategy.ts`. Drei Entscheidungen in dieser Reihenfolge:

1. **Anheuern**, sobald `mercenary-contract` erforscht und `HERO.cost` da ist. Er kostet anderthalb Tower und
   stirbt nie, es gibt also keinen Grund zu warten.
2. **Munition** nach dem, was die laufende Welle trägt: Sprenggeschosse gegen heavy und fortified, Runen gegen
   ethereal, sonst Standard. Seine Schadensart ist das Einzige an ihm, das der Spieler wählt ([HERO.md](HERO.md)).
3. **Stellung** beim Pulk: der Punkt unter den lebenden Gegnern, der die meisten anderen in seiner Reichweite hat
   (`densestCenter`). Ein neuer Befehl erst, wenn der Pulk mehr als zwei Leinenlängen von seinem Posten weg ist,
   sonst läuft er mehr als er schießt.

### NuclearStrike (Regel)

Feuert den Nuklearschlag ([ABILITIES.md](ABILITIES.md)): während einer Welle,
sobald die Fähigkeit bereit ist (`AbilityManager.checkUse`: erforscht,
geladen, Missile Silo steht), und nur, wenn beim Einschlag mindestens 10
Gegner im letzten Fünftel ihrer Route stehen werden (Pfadfortschritt ab 0,8).

**Vorhalten.** Die Rakete landet 6,5 s nach dem Befehl (`warningMs`), ein
Zombie läuft in der Zeit 32 m. Jeder Gegner zählt deshalb dort, wo er beim
Einschlag steht: sein Tempo dieses Moments (`getEffectiveSpeed`, Slow, Freeze
und Stun eingerechnet) mal 6,5 s weiter auf der Mittellinie seines Pfads
(`enemyAhead` in `ability-aim.ts`, derselbe Helfer, mit dem der Orbitallaser
seinen Aufsetzpunkt vorhersagt). Wer bis dahin über das Pfadende hinaus wäre,
hat die HQ erreicht und zählt nicht; die Gruppe, auf die der Bot feuert, liegt
also vor der HQ. Ziel ist unter diesen vorhergesagten Punkten der mit den
meisten anderen im Strike-Radius von 25 m. Geprüft werden höchstens 48
Kandidaten, gleichmäßig verteilt, damit ein Mega-Schwarm billig bleibt. Die
Aktion `use-ability` geht als `command:use-ability` an den AbilityManager, der
das Ziel wie einen Klick auf die Route snappt.

**Grenzen des Modells.** Das Tempo gilt als konstant: ein Freeze, der in den
6,5 s endet, ein Slow, der ausläuft, und ein Gegner, der erst in der Zeit
angehalten wird, sind nicht vorhergesagt. Ein Wurm zählt je Glied mit dessen
eigenem Tempo, obwohl die Kette steht, solange ihr Kopf angehalten ist: Glieder
hinter einem eingefrorenen Kopf sagt das Modell zu weit vorn voraus, ein
betäubtes Glied zu weit hinten, höchstens um Restdauer mal Tempo. Gegner laufen auf der Mittellinie,
die seitliche Lage in der Straße zählt nicht.

Die Gegner liest die Strategie aus dem GameStateManager, nicht aus dem
Snapshot: der trägt keine Positionen.

**Vergleichbarkeit:** Der Könner erforscht die Fähigkeit für 1.000 Gold und
setzt sie ein. Ihre Läufe sind mit Läufen vor dem
2026-09-13 nicht direkt vergleichbar: anderes Gold, eine andere
Forschungsfolge, weniger Lecks in Wellen mit Einsatz. Der Einsteiger
erforscht sie nie und spielt unverändert. Der Leck-Regler bucht die Kills
einer Fähigkeit als Leck, die Wellengröße wächst also nicht durch den Einsatz
([WAVE_DIRECTOR.md](WAVE_DIRECTOR.md), Abschnitt 6). Seit 2026-09-17 baut der
Könner dafür zusätzlich das Silo (400 Gold) und zielt mit Vorhalt auf die
Gruppe beim Einschlag; Läufe davor sind in allem, was vom Nuklearschlag
abhängt, nicht direkt vergleichbar. Das Silo zählt in `defense.towerCount` wie
das Research Center.

### FrostBomb (Regel)

Wirft die Frostbombe ([ABILITIES.md](ABILITIES.md#frostbombe-in-zahlen)):
während einer Welle, sobald sie bereit ist, und nur, wenn irgendwo in der
zweiten Hälfte der Route (Pfadfortschritt ab 0,5) mindestens 8 Gegner im
Radius von 20 m um einen von ihnen stehen. Ziel ist dieser Gegner, gewählt wie
beim Nuklearschlag (`densestCenter` in `strategies/ability/ability-aim.ts`,
höchstens 48 Kandidaten). Steht beides bereit, geht der Nuklearschlag vor
(Reihenfolge der Factory).

**Vergleichbarkeit:** Der Könner erforscht `frost-bomb` direkt nach
`nuclear-strike` (700 Gold). Ihre Läufe sind mit Läufen vor dem 2026-09-14
nicht direkt vergleichbar; der Einsteiger spielt unverändert.

### Emp (Regel)

Setzt das EMP ein ([ABILITIES.md](ABILITIES.md#emp-in-zahlen)): während einer
Welle, sobald es bereit ist, wenn mindestens 3 Maschinen (`mechanical`) ab
Pfadfortschritt 0,4 im Radius von 30 m um eine von ihnen stehen, dort stoppt
es sie 6 s; sonst, wenn mindestens 12 Gegner beliebiger Art in den letzten
40 % der Route (Pfadfortschritt ab 0,6) im Radius um einen stehen. Ziel ist die
Maschine mit den meisten Maschinen im Radius, sonst der Gegner der Menge mit
den meisten anderen (`densestCenter`).

**Vergleichbarkeit:** Der Könner erforscht `emp` direkt nach
`storm-mastery` (800 Gold). Der Einsteiger spielt unverändert.

### OrbitalLaser (Regel)

Ruft den Orbitallaser ([ABILITIES.md](ABILITIES.md#orbitallaser-in-zahlen)):
während einer Welle, sobald er bereit ist, wenn ein Strahl, gezielt auf einen
der Gegner ab Pfadfortschritt 0,5, mindestens 10 Gegner treffen würde.
Kandidaten sind diese Gegner, höchstens 48. Gezielt wird auf den Punkt, den
der Kandidat bei der Landung erreicht: seine Geschwindigkeit mal 1 s
Vorwarnung weiter auf seinem Pfad. Unter den Kandidaten mit mindestens 10
Treffern gewinnt der mit dem größten erwarteten Schaden, der Summe der
Max-HP-Anteile, die der Strahl den Getroffenen nimmt (bis zur Kappe, höchstens
ihre Rest-HP); bei Gleichstand der erste.

**Strahlmodell.** Der Weg ist der der Fähigkeit (`AbilityManager.previewSweep`),
für die Bewertung über die 72 m hinaus verlängert um die Strecke, die der
schnellste Gegner bis zum Ende des Strahls läuft, plus 5 m. Vorwarnung, Tempo,
Brenndauer (`abilityBeamBurnMs`), Radius und Schaden (`abilityBeamFraction`,
`abilityBeamCap`) kommen aus der Config. Jeder Gegner im 5-m-Radius der Strecke
(2D, `sweepOffset`) läuft mit seiner Geschwindigkeit dieses Moments (Slow,
Freeze und Stun eingerechnet) die Strecke entlang auf ihren Anfang zu. Strahl
und Gegner kommen sich mit der Summe ihrer Geschwindigkeiten näher; der Gegner
steht unter dem Strahl, solange ihr Abstand entlang der Strecke unter
√(r² − Seitenabstand²) liegt. Die Route des Gegners spielt keine Rolle: Gegner
einer anderen Route auf derselben Straße trifft der Strahl auch.

**Grenzen des Modells.** Die Geschwindigkeit gilt als konstant, ein Freeze,
der während des Strahls endet, ist nicht vorhergesagt. Ein Gegner nahe der
Strecke gilt als einer, der sie entlangläuft; Querverkehr an einer Kreuzung
sagt das Modell falsch vorher. Liegen an einer engen Kehre zwei Abschnitte der
Strecke näher als 5 m beieinander, zählt ein Gegner einmal, sein Schaden kann
unterschätzt sein.

**Vergleichbarkeit:** der Könner erforschen `orbital-laser` direkt
nach `master-engineering` (1.500 Gold). Der Einsteiger spielt
unverändert. Seit 2026-09-15 zielt der Bot mit dem Strahlmodell statt mit der
Zählung "bis 72 m hinter einem Gegner derselben Route" (Entscheidung E2):
Wann und wohin er den Laser feuert, hat sich geändert, Läufe davor sind in
allem, was vom Laser abhängt, nicht direkt vergleichbar.

### AutoStartWave (Welle)

Nur im Auto-Modus und nur in der Setup-Phase, ab 1 Turm. Wartet auf laufende
Forschung (ein Mensch startet keine Welle mitten im Upgrade), verlangt 1 s
Game-Time seit der letzten Action, und will vor Welle 3 lieber 2 Türme sehen,
solange noch ≥ 20 Credits da sind. Nach 5 s Game-Time in Setup wird die Welle
erzwungen, sonst wartet der Bot in Situationen ohne laufende Forschung
unbegrenzt.

Alle drei Timer laufen in Game-Time über `tickCooldowns`.

---

## Warum die Platzierung so aussieht

Der wichtigste Teil dieses Dokuments, weil das Ergebnis kontraintuitiv ist.

### Der Befund

Gemessen über 1834 Wellen mit der alten Platzierung (lineares Gewicht auf
Spawn-Nähe, 0.6) und der alten Upgrade-Strategie (nur der spawn-nächste Turm):

| | |
|---|---:|
| Wellen, in denen die Verteidigung **alles** tötete | 70 % |
| Wellen, in denen > 5 % durchkamen | 28 % |
| dazwischen | 2 % |

Die Verteidigung war **binär**. In Wellen ohne Durchbruch starb der weiteste
Gegner bei median **12 %** des Pfades. Sobald ein Gegner 80 % passierte, kam in
**95 %** der Fälle einer an. Es gab kein „knapp abgefangen": eine Killzone am
Spawn, dahinter ein unverteidigter Korridor.

Das ist der Grund, warum sich der Wave Director nicht trainieren ließ. Seine
Reward-Funktion verlangt Near-Misses, den Anteil einer Welle, der 80 % des
Pfades passiert **ohne** anzukommen. Erreichbar war das in 2.2 % der Wellen, weil
auf der letzten Strecke nichts tötet. Vier Wave-Designer, so verschieden wie ein
Policy-Netz und ein Gleichverteilungs-Sampler, erzeugten statistisch identische
Läufe.

### Die Änderung

Zwei Stellen, gemeinsam:

- `strategic-placement.service.ts::endZoneProximity(t)`: U-förmiges Gewicht über
  die normalisierte Pfadposition (0 = Spawn, 1 = HQ) statt linearer Spawn-Nähe:

  ```ts
  const END_ZONE_HQ_WEIGHT = 0.8;
  endZoneProximity(t) = max(1 - t, 0.8 * t)
  ```

  Beide Enden schlagen die Mitte; das Spawn-Ende behält knapp die Nase vorn. Die
  Asymmetrie ist Absicht: ein Zwei-Turm-Anfang platziert genau dort, wo er vorher
  platzierte, die frühen Wellen ändern sich nicht. Ab etwa dem vierten Turm
  schlägt das HQ-Ende die Mitte und eine zweite Killzone entsteht. Das Minimum
  liegt bei `t = 1/(1+0.8) ≈ 0.556`, also leicht hinter der Mitte, weil der
  Spawn-Ast der steilere ist. Die Form ist in
  `strategic-placement.service.spec.ts` direkt asserted.

  Das Gewicht geht mit 0.6 in `calculatePlacementScore` ein; die restlichen 0.4
  verteilen sich auf Pfadabdeckung (0.2) und Straßenabstand (0.2, Optimum 20 m).

- `path-coverage-upgrade.strategy.ts` (seit 2026-10-03 entfernt, Upgrades gehen
  nach Nutzen und den Metern, die ein Tower sieht): Upgrade-Kandidaten
  abwechselnd von beiden Enden der spawn-sortierten Liste. Solange sie nur das
  Spawn-Ende bediente, landete praktisch das gesamte Upgrade-Gold in einem
  Cluster, egal wie gut die Platzierung verteilte.

### Das Ergebnis

| | vorher | nachher |
|---|---:|---:|
| Gegner, die 80 % passieren und ankommen | 95 % | 75 % |
| Near-Miss-Quote | 0.031 | 0.058 |

Die Kill-Quoten-Verteilung blieb bimodal. Das ist eine **Kapazitäts**- und keine
Platzierungseigenschaft: entweder die Verteidigung hat genug DPS für die Welle
oder nicht.

### Warum nicht einfach gleichmäßig verteilen

Gleichverteilung wäre die naheliegende Antwort und sie wäre falsch. Fünf Türme
decken nur einen Bruchteil eines Pfades ab. Türme stehen 15–25 m von der Straße
entfernt; die Pfad-Sehne, die ein Turm mit Reichweite `r` bei 20 m Abstand
abdeckt, ist `2·√(r² − 20²)`:

| Turm | range | Sehne bei 20 m Abstand |
|---|---:|---:|
| Archer | 30 | ~45 m |
| Dual-Gatling | 50 | ~92 m |
| Magic | 70 | ~134 m |
| Cannon | 70 | ~134 m |
| Rocket | 100 | ~196 m |

Spawns liegen 500–1000 m vom HQ. Fünf Türme decken damit grob 25–50 % des Pfades.
Überall dünn heißt überall durchlässig: dann stirbt niemand mehr irgendwo
zuverlässig, und die Kurve wird nicht spannender, sondern nur schlechter.

Die spielbare Lösung ist **eine zweite Killzone vor dem HQ**, nicht
Gleichverteilung. Genau das macht das U-Gewicht: es verschiebt die Reihenfolge
(HQ-Ende vor Mitte), nicht die Dichte.

---

## Integration

Bot-Logik, Steuerung und Stats liegen nicht in der Component, sondern in zwei
Teilen:

- **`BotClientService`** (im Spiel-Chunk): die Signale, die Templates und
  Game-Loop lesen (`botEnabled`, `botStats`, `isConnected`, `stats`, ...), plus
  Weiterleitungen. Die Facades und das Bot-Debug-Fenster kennen nur ihn.
- **`BotSession`** (eigener Lazy-Chunk `bot-session`): WebSocket-Client,
  Bot, Strategien, Action-Ausführung. Der Service lädt sie per
  `import('./bot-session')` beim ersten `enableBot()`, `connect()` oder
  `connectToBackend()` und legt sie über `runInInjectionContext` an. Sie schreibt
  in die Signale des Service.

```typescript
// BotClientService
enableBot(skillLevel: BotSkillLevel): void
disableBot(): void
updateBot(getSnapshot: () => GameStateSnapshot, deltaTime: number): boolean  // ohne Session: false
```

`updateBot` läuft nur in Phase `setup` oder `wave`. `BotSession.executeBotAction`
prüft noch einmal gegen den echten Spielstand (Platzierungsregeln über
`TowerPlacementService.placementAt`, mit Grundfläche und Sockel wie beim Klick; Kosten, Existenz des Turms,
Max-Level des Upgrades) und führt dann aus: Platzieren und Verkaufen direkt am
`GameStateManager`, Upgrade und Wellenstart (nur in `setup`) über die
Facade-Callbacks, Forschung über `command:start-research` bzw.
`command:cancel-research`.

`enableBot` wird **gepuffert** (`pendingBotSkill`), solange die Session nicht
steht: der Chunk lädt noch, oder `initialize()` lief noch nicht. Die zweite
Reihenfolge erzeugt ein Tab-Reload. Vorher kehrte der Aufruf still zurück, und
der Client meldete sich anschließend als verbunden und gesund, ohne je zu
spielen. `disableBot()` verwirft eine gepufferte Anfrage. `initialize()` selbst
lädt nichts, es läuft in jedem Spiel.

Für die Verbindung gilt dasselbe: der letzte Wunsch gewinnt. Ein `disconnect()`,
während `connect()` oder `connectToBackend()` noch auf den Chunk warten, bricht
den Aufbau ab (Zähler `connectionRequest`). Scheitert der Chunk-Import, versucht
der Service es bis zu dreimal (1 s, 2 s Pause) und schreibt danach eine Meldung
in `sessionError`, die das Bot-Debug-Fenster anzeigt. Gepufferte Wünsche
bleiben stehen; der nächste Aufruf startet eine neue Runde. Ob ein erneuter
Import im Browser wirklich neu lädt, ist nicht garantiert (fehlgeschlagene
Module können gecacht bleiben), dann hilft nur ein Reload des Tabs.

### Warum die Session ein eigener Chunk ist

Im normalen Spiel laufen weder Bot noch Backend-Verbindung, trotzdem lagen Bots,
Strategien und WebSocket-Client im Spiel-Chunk. Production-Build vom 2026-09-11,
Raw-Größen aus `ng build --stats-json`:

| | vorher | nachher |
|---|---:|---:|
| Initial-Bundle | 358,5 kB | 358,5 kB |
| Chunks, die der Spielstart statisch lädt | 2244,9 kB | 2217,1 kB |
| davon Bot-Code | 51,4 kB | 17,5 kB |
| `bot-session` (lazy, nur Bot-Läufe) | | 29,8 kB |

Die verbleibenden 17,5 kB sind das Bot-Debug-Fenster (15 kB) und der
Service. Das Fenster bleibt eager: es per `@defer` zu laden, zieht 8 kB
Defer-Runtime aus `@angular/core` ins Initial-Bundle. Lohnt erst, wenn alle
Debug-Fenster (zusammen rund 160 kB) gemeinsam deferred werden.

Die geschätzte gzip-Transfergröße ändert sich kaum (326,8 → 327,9 kB): Spiel und
Session teilen Module (Configs, Store, Data-Collector), die esbuild in einen
eigenen Shared-Chunk legt, und zwei gzip-Streams komprimieren etwas schlechter
als einer. Gewonnen ist JS, das beim Spielstart nicht mehr geparst und
ausgeführt wird.

Die Trennung hält nur, solange außerhalb von `bots/` niemand einen Wert
aus Session, `bots/` oder `strategies/` importiert (`import type` ist frei). Das
prüft `bot-client.service.spec.ts`; das Budget `bot-session` in
`angular.json` warnt ab 48 kB.

### Wie der Bot angeschaltet wird

`TowerDefenseFacadeService.initialize()` liest `?bot=` aus der URL:

| Kontext | Verhalten |
|---|---|
| `?devworld` (ohne `?bot=manual`) | `botAutoMode = true` **und** `enableBot('expert')`: der Tab spielt sofort selbst |
| `?devworld&bot=manual` | kein Bot, kein Auto-Wave |
| sonst mit `?bot=auto` | nur `botAutoMode = true`; der Bot selbst wird über die Debug-UI oder das Dashboard aktiviert |
| Dashboard-Kommando `start` | Timescale 75 + `enableBot('expert')` |

DevWorld startet den Bot bewusst **selbst**, statt auf den `start`-Broadcast des
Dashboards zu warten: Ein Tab, der neu lädt, verpasst diesen Broadcast (er wird
nicht wiederholt) und saß danach dauerhaft in der Setup-Phase, während er sich
weiter als verbunden und gesund meldete. Analog `?bot=auto` als Pflichtangabe
zusätzlich zu `?devworld`: der Bot baute dann Türme, startete aber nie eine Welle,
und der Lauf schrieb keine Daten.

`botAutoMode` steuert nur, ob `AutoStartWaveStrategy` überhaupt Teil des
Strategie-Sets ist (`createBot(skill, autoStartWaves)`), und wird zum
Erzeugungszeitpunkt gelesen; eine spätere Änderung wirkt erst beim nächsten
`enableBot`.

---

## Troubleshooting

### Bot platziert keine Türme

1. Bot aktiv? → `botEnabled()`
2. Bautempo erreicht? → `towersByWave(config, welle)`, Kampftower ohne Center und Silo
3. Turm-Cap (`maxTowers`, gejittert) erreicht?
4. Valide Positionen? → `StrategicPlacementService` gibt nur Kandidaten zurück,
   die `TowerPlacementService.placementChecker()` besteht (dieselben Regeln wie
   Vorschau und Klick). Die besten vier, die stehen (`placementAt`), probt er
   auf Sicht (B2). Keine Kandidaten, keine Platzierung; der Schiedsrichter
   nimmt dann den nächsten Kauf
5. Spart er? → `reason` „Saving for …“ im Bot-Fenster
6. Reaktions-Cooldown abgelaufen? → `reactionTimeMs`, ebenfalls gejittert

### Bot upgradet nicht

1. Upgrades verfügbar? → `tower.getAvailableUpgrades()`
2. Bezahlbar? → `tower.getNextUpgradeCost(upgradeId)` (dynamisch)
3. Tier-Gate? → `requiredUpgradeTier(level)` gegen `state.research.maxUpgradeTier`
4. Ein neuer Tower je Gold mehr wert? Unter dem Bautempo baut der Bot meist
   erst aus

### Bot startet Wellen im Dauerfeuer

1. `WAVE_START_DELAY` (1 s Game-Time) seit der letzten Action
2. Nur Phase `setup`
3. Force-Start nach `MAX_SETUP_WAIT` (5 s Game-Time)
4. Laufende Forschung blockiert den Start

### Bot hortet Gold

Er spart, wenn ein teurer Kauf je Gold klar besser ist (Sparziel, höchstens
dreimal sein Gold). Am Bautempo und ohne Upgrade im erlaubten Tier bleibt
Gold liegen; Sell macht am Bautempo Platz für einen deutlich besseren Typ.

---

## Changelog

### 2026-10-03: Profile und Coop-Partner (B5, B6)
- Bautempo neu gegen den Lauf des Users: Könner 1 + 1,75 je Welle, Normal 1 + 1,5,
  Anfänger 1 + 1; erster Tower eines Typs 1,5-fach.
- Drittes Profil `normal`; `attention`, `noise` und `knows` je Profil statt
  `adaptsToEnemies` und Stufen-Abfragen in Factory und Forschung.
- Neue Regel Gift (Coop): Gold an einen Partner, der leckt und knapp ist.
- `tools/play-profile/play-profile.mjs` vergleicht Läufe je Welle (Replay oder Run-Log).

### 2026-10-03: Zielwahl, Verkauf, Slots, Schaden über Zeit (B4)
- Neue Regel Targeting (Boss, Luft), neue Regel Sell (blind, Platz für Besseres)
  statt SellUnderperformer; Aktion `set-targeting`.
- ResearchPick schlägt einen Forschungs-Slot vor, wenn alle belegt sind.
- Nutzen zählt Gift und Brand nach der Reichweite (`lingerAdded`).

### 2026-10-03: Schiedsrichter statt Prioritätsliste (B3)
- Strategien schlagen vor (`propose`), `arbitrate` entscheidet: Regeln, Forschung,
  Käufe nach Nutzen je Gold mit Sparziel, Welle. Nutzen in `decision/value.ts`.
- Neu: `TowerBuildStrategy`, `TowerUpgradeStrategy`. Entfernt: AntiAir-,
  AntiEthereal-, SplashDefense-, Distributed-Placement, CoverageFill,
  PathCoverageUpgrade, FavouriteTowerUpgrade.
- Forschung mit Tower-Freischaltung ist ein Kauf; Bautempo (`buildTempo`)
  aus dem Lauf des Users; Strategien bekommen die gejitterte Config.
- Läufe davor sind mit Läufen danach nicht vergleichbar.

### 2026-09-17: Missile Silo und Vorhalt
- Neue Strategie MissileSiloPlacement (91) in allen Skill-Stufen: baut das
  Silo nach `nuclear-strike`, ohne das der Nuklearschlag nicht feuert.
- NuclearStrike zählt und zielt mit den Positionen beim Einschlag (6,5 s
  Vorwarnung statt 1,5 s) statt mit den aktuellen; Gegner, die bis dahin die
  HQ erreichen, zählen nicht. `pointAhead` aus OrbitalLaser heißt jetzt
  `enemyAhead` und liegt in `ability-aim.ts`; `densestCenter` nimmt alles mit
  einer Position.

### 2026-09-16: Kandidaten mit Grundfläche
- `findStrategicPositions` und `findDistributedPositions` nehmen den Tower-Typ
  statt der Reichweite (Reichweite aus `TOWER_TYPES`, 60 m ohne Reichweite).
  Die sortierten Kandidaten beginnen beim ersten, auf dem der Tower stehen darf
  (`TowerPlacementService.placementAt`: Grundfläche und Platzierungsregeln);
  bessere, deren Mitte oder innerer Ring in einer Wand steht oder über einem
  Abbruch hängt, fallen weg (TOWER_CREATION.md, Platzierungsregeln). Geprobt
  wird nur bis zu diesem ersten, die übrigen nicht. Ohne das wählte die
  Strategie nach der neuen Regel immer wieder denselben abgelehnten Kandidaten.
- `BotSession.executeBotAction` platziert über `placementAt`;
  `getSurfaceHeightAt` und die Engine-Referenz von `BotClientService` und
  `BotSession` (`setEngine`) entfallen.

### 2026-09-15: Orbitallaser mit dem echten Strahl
- OrbitalLaser bewertet Kandidaten mit dem Strahl der Fähigkeit (Weg, Radius,
  Vorwarnung, Tempo, Brenndauer) und den Gegnern in Bewegung statt mit den
  Gegnern bis 72 m hinter dem Kandidaten auf dessen Route. Ziel ist der Punkt,
  den der Kandidat bei der Landung erreicht, Rang nach erwartetem Schaden,
  Schwelle weiter 10 Treffer (Playtest-Entscheidung E2).

### 2026-09-14: Orbitallaser
- Neue Strategie OrbitalLaser (93) in allen Skill-Stufen; `orbital-laser` in
  den Forschungslisten von der Könner nach `master-engineering`.

### 2026-09-14: EMP
- Neue Strategie Emp (94) in allen Skill-Stufen; `emp` in den Forschungslisten
  von der Könner nach `storm-mastery`.

### 2026-09-14: Frostbombe
- Neue Strategie FrostBomb (96) in allen Skill-Stufen; `frost-bomb` in den
  Forschungslisten von der Könner nach `nuclear-strike`. Die
  Zielhilfen des Nuklearschlags liegen jetzt in `ability-aim.ts`.

### 2026-09-20: zwei Bots, der Held und das Run-Log
- Aus vier Skill-Stufen werden zwei: `beginner` und `expert` (D15). `casual`
  und `meta` hatten dieselben Strategie-Sets wie ihre Nachbarn.
- **Einsteiger (2026-09-20, nach der ersten Baseline):** Er hatte keine
  Upgrade-Strategie und nur `gatling-tech` als Forschung. Folge, gemessen über
  163 Läufe: Nach Welle fünf (später zwölf) war jeder Zweig jedes Towers am
  Tier-1-Deckel von Stufe 5, es gab nichts mehr zu kaufen, die Entscheidungen
  fielen auf 0 je Welle und das Gold lief auf 143.000 auf. Er starb an einer
  eingefrorenen Verteidigung, nicht an der Balance. Neu: die Strategie
  **FavouriteTowerUpgrade (70)** (bester Tower, billigster Zweig, Polster über
  dem Preis) und die Tier-Linie in der Forschung bis Tier 4. Die Breite bleibt
  dem Könner: keine Luft-, keine Ethereal-Antwort, kein Verkaufen, kein Held.
- Neue Strategie **Hero (85)**, nur beim Könner: anheuern, Munition nach dem
  Rüstungsmix, Stellung beim Pulk. Vorher nutzte kein Bot den Helden.
- Der Bot handelt nur noch über `command:*`; Bau und Verkauf gingen vorher
  direkt an den `GameStateManager`, und das Run-Log sah sie nicht.
- Der Bot schickt sein **Run-Log** je Welle an den Server (`run_log`), der es
  nach `runs/<config-hash>/<lauf>.jsonl` schreibt. `result` und `game_start`
  sind entfallen.
- Der Server sagt jedem Client vor jedem Lauf, was er spielt (`run_config`:
  Bot, Seed, Director-Parametersatz). Der Client **wartet darauf**: Nach dem
  Game Over startet er den nächsten Lauf erst, wenn die Antwort da ist, sonst
  nach fünf Sekunden mit der letzten. Sofort neu zu starten hieß, den Kopf des
  nächsten Laufs mit dem Bot des vorigen zu beschriften und mit einem Seed, den
  `rng.reset` einen Wimpernschlag später überschrieb.

### 2026-09-13: Nuklearschlag
- Neue Aktion `use-ability`, neue Strategie NuclearStrike (97) in allen
  Skill-Stufen; `nuclear-strike` in der Forschungsliste des Könners nach
  `advanced-weaponry`. Folgen für Messungen:
  [NuclearStrike](#nuclearstrike-regel).

### 2026-09-12: Platzierungsregeln aus einer Quelle
- `TowerManager.validatePosition` und `StrategicPlacementService.meetsPlacementConstraints`
  entfernt. Die Kandidatensuche prüft mit `TowerPlacementService.placementChecker()`
  gegen `checkTowerPlacement`, dieselben Regeln wie Vorschau und Klick. Neu im
  Bot-Filter: der Spielbereich (Bounds). Spawns kommen aus dem Store statt aus
  dem Stand von `initializeWithContext`.
- Die Strategien nehmen den besten Kandidaten direkt; die zweite Prüfschleife
  pro Kandidat entfällt.

### 2026-09-12: Chaos Tower
- `chaos` in `ALL_COMBAT_TOWERS`, `chaos-rift` in den Research-Listen von
  der Könner, nach Master Engineering.
- Keine neue Strategie: Chaos zählt als Anti-Air und Anti-Ethereal
  (`isAntiEtherealTower`, Schwelle 1,0), die bestehenden Placement-Strategien
  wählen ihn nach Wert pro Credit. Gegen Ethereal (0,30) liegt er dort hinter
  Magic (0,86) und Lightning (0,71), gegen Light hinter Gatling und Lightning.

### 2026-09: Platzierung an beiden Pfadenden
- `NearSpawnUpgradeStrategy` → **`PathCoverageUpgradeStrategy`**, Datei
  `near-spawn-upgrade.strategy.ts` → `path-coverage-upgrade.strategy.ts`.
  Kandidaten jetzt abwechselnd von beiden Enden der spawn-sortierten Liste.
- `StrategicPlacementService`: lineares Spawn-Gewicht → U-förmiges
  `endZoneProximity(t)` (`END_ZONE_HQ_WEIGHT = 0.8`), plus Spec, die die Form
  asserted.
- Begründung und Messwerte: [Warum die Platzierung so
  aussieht](#warum-die-platzierung-so-aussieht).

### 2026-08: Training-Refresh (P3 im [Handover](archive/HANDOVER_TRAINING_REFRESH.md))
- `lightning` in `ALL_COMBAT_TOWERS`, `storm-mastery` in den Research-Listen.
- Neue **AntiEtherealPlacementStrategy** (88) + `etherealGap` im Snapshot.
- Tower-Bewertung über `computeTowerDPSFromLevels`; Anti-Air und Splash nach
  Wirksamkeit statt hartkodierter Turmliste.
- Upgrade-Tier-Regel geteilt (`requiredUpgradeTier`), bis Tier 5.
- `maxTowers` 300 → 80 → **20**; Upgrade-Strategie über 8 statt 1 Turm.
- Toter Auswahl-Code (Damage-Matrix-Pfad in `base-tower-bot.ts`) entfernt.
- Fehler-Simulation (`mistakeRate`, `makeSuboptimalAction`) und `plansAhead`
  existieren nicht mehr; Variation kommt aus dem Factory-Jitter.

### Phase 5.16 (2026-04 ff.): Research-aware Bots
- **ResearchCenterPlacement** (95), **ResearchPick** (80, curriculum-aligned,
  expert/expert adaptiv), **SellUnderperformer** (72, nur Könner).
- Alle Skill-Level bekommen die Research-Strategien.
- Factory-Jitter auf `reactionTimeMs` / `maxTowers`.

### Phase 5.12: Game-Time-Cooldowns
- Bot- und Strategie-Cooldowns von `Date.now()` auf Game-Time-Akkumulatoren
  umgestellt; `tickCooldown` von `update` getrennt, damit der Snapshot-Bau
  übersprungen werden kann.

### 2026-01: Distributed Placement / Strategy Pattern
- `DistributedPlacementStrategy` + `findDistributedPositions` (Zonen-Scoring).
- Komplette Ablösung des monolithischen SmartBots durch Strategy Pattern +
  Composition.

---

## Verwandte Dokumente

- [WAVE_DIRECTOR.md](WAVE_DIRECTOR.md): die Wellenseite,
  Regel-Director und Überlebbarkeits-Deckel, gegen die der Bot spielt
- [HANDOVER_TRAINING_REFRESH.md](archive/HANDOVER_TRAINING_REFRESH.md): Trainings- und
  Messhistorie, inklusive der Befunde, die zu dieser Platzierung geführt haben
- [WAVE_SYSTEM.md](WAVE_SYSTEM.md): Wave-Management und Spawn-Pipeline
- [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md): Damage-Matrix und
  Rüstungsklassen, auf denen die Turmauswahl rechnet
- `bot-server/README.md`: der Server, sein Protokoll und sein Log
