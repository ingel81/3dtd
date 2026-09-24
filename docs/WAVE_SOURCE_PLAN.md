# Wave Source Plan

**Stand:** 2026-09-22, **umgesetzt**. Ein kleines Plugin-System für die Wellenerzeugung: Die adaptive Variante
ist vollständig erhalten und der Standard, der Tabellen-Source steht daneben, und
`configs/director.config.ts` sagt, welche ein Lauf spielt. Was beim Bauen anders kam als geplant, steht in
Abschnitt 16.

Verwandt: [WAVE_DIRECTOR.md](WAVE_DIRECTOR.md) (heutiger Stand), [WAVE_SYSTEM.md](WAVE_SYSTEM.md) (wie eine
fertige Welle abgespielt wird), [BALANCING_PLAN.md](BALANCING_PLAN.md) (woher der heutige Aufbau kommt),
[RUN_LOG.md](RUN_LOG.md) (Datensammlung).

---

## 1. Auftrag

Aus der Absprache vom 2026-09-22:

- Unterordner in `director/`: die jetzige Variante, daneben neue Varianten.
- Alle mit demselben Interface, global konfiguriert, welche greift.
- **Nichts wegwerfen.** Die adaptive Variante bleibt lauffähig.
- Schnell zwischen Implementierungen wechseln, ohne Umbauarbeit.
- Datensammeln bleibt wie heute, das Run-Log bleibt erhalten.
- Die Vorschau der nächsten Welle und ihrer Gegner kommt aus demselben Interface.
- Umschalten **nur zwischen Läufen**, nicht mitten im Lauf.
- Planzeitpunkt bleibt offen, Standard ist „am Ende der Vorwelle".
- Die Boss-Varianten wandern hinter die Naht.

Nicht Teil dieses Umbaus, aber danach billig: das Autorieren der Wellentabelle, der globale
Schwierigkeitsfaktor und das einseitige Sicherheitsnetz. Beide letzteren werden Dekoratoren, siehe
Abschnitt 11.

## 2. Ausgangslage: „welche Welle kommt" steht heute an vier Stellen

| Stelle | Was sie entscheidet |
|---|---|
| `WaveDirector.plan()` | Template und die vier Faktoren, über `buildWaveContext` und `decideWave` |
| `buildWaveConfig()` | Die Größe: Ranges, DPS-Rampe, Endgame-HP, Deckel, Dauer-Deckel, Intensität, Gegner-Gruppen |
| `GameLoopFacadeService.startWaveWithAI()` (Zeile 339) | Tauscht auf Boss-Wellen die geplante Welle gegen eine Boss-Variante |
| `wave-panel/upcoming-waves.ts` | Rechnet die Vorschau der nächsten fünf Wellen **selbst** aus Templates und Kampagne, inklusive `dpsScaledCountMax` |

Die vierte Stelle ist der eigentliche Fund. Die Vorschau ist heute ein zweiter Rechenweg über dieselben
Konfigurationen, und sie muss ab W31 passen („Template picked at wave start"), weil sie nicht weiß, was der
Director wählen wird. Ein Source, der seine Welle vorher kennt, kann das beantworten, und zwar ohne dass das
Panel etwas über ihn weiß.

Was heute schon sauber getrennt ist und deshalb bleibt: `StateSnapshotService` (Messung), `defense-analyzer`
(Verteidigungsanalyse), `spawn-schedule-builder` und `wave-config-adapter` (Weg zum `WaveManager`), das
Run-Log.

## 3. Die Naht

Neue Datei `director/wave-source.ts`. Sie enthält nur Typen und den Vertrag, keine Implementierung.

```ts
export type WaveSourceId = 'adaptive' | 'table';

/** Wann ein Source seine Welle festschreibt. */
export type WavePlanTiming = 'wave-end' | 'wave-start';

export interface WaveSource {
  readonly id: WaveSourceId;
  readonly name: string;

  /**
   * Standard 'wave-end': Die Welle wird am Ende der Vorwelle festgeschrieben,
   * die Vorschau liest genau das, was kommt. 'wave-start' rechnet erst beim
   * Start, wie heute.
   */
  readonly plansAt: WavePlanTiming;

  /** Die Welle `request.wave`, fertig zum Ausliefern. */
  plan(request: WavePlanRequest): PlannedWave;

  /** Die `count` Wellen ab `fromWave`, ohne etwas festzuschreiben. */
  peek(request: WavePeekRequest): WavePeekFacts[];

  /** Ergebnis einer gelaufenen Welle. Ein adaptiver Source lernt daraus, eine Tabelle ignoriert es. */
  onWaveResult(result: WaveResult): void;

  /** Zustand je Lauf. */
  reset(): void;
}

export interface WavePlanRequest {
  /** Die zu planende Welle, absolut. Nicht `state.waveNumber + 1` ableiten. */
  readonly wave: number;
  readonly state: GameStateSnapshot;
  /** Der `director`-Strom des Laufs (GameRng). */
  readonly random: () => number;
}

export interface WavePeekRequest {
  readonly fromWave: number;
  readonly count: number;
  /**
   * Nur was eine Vorschau braucht, kein ganzer Snapshot. Siehe Befund R3:
   * `upcomingWaves` im Wave-Panel ist ein `computed`, das an Turmzahl,
   * Ausbauten und Forschung hängt. Ein Snapshot als Eingabe würde dort die
   * ganze Verteidigungsanalyse bei jedem Turmbau neu rechnen.
   */
  /**
   * Bewusst nur die DPS, siehe Abschnitt 16, Abweichung 4: Fähigkeits-Flags
   * hätte das Panel nur über eine zweite Ableitung derselben Regel liefern
   * können, die die Verteidigungsanalyse schon besitzt.
   */
  readonly defense: { readonly totalDps: number };
}

export interface PlannedWave {
  readonly wave: number;
  /** Die Welle, Boss-Variante schon angewandt. Unverändertes Modell. */
  readonly config: WaveConfig;
  readonly explanation: DecisionExplanation | null;
  /** Was ins Run-Log geht. */
  readonly log: WaveLogFields;
}

export interface WaveLogFields {
  readonly survivableCount?: number | null;
  readonly pressureMultiplier?: number;
  readonly targetPressure?: number;
  /** Zahlen, die das Log-Format nicht kennt. Additiv, je Source frei. */
  readonly diagnostics?: Readonly<Record<string, number | string | boolean | null>>;
}

/** Fakten über eine kommende Welle. Formulierung und Icons bleiben in der UI. */
export interface WavePeekFacts {
  readonly wave: number;
  readonly name: string;
  /** Steht die Welle fest, oder ist das nur die Menükarte? */
  readonly known: boolean;
  readonly boss: boolean;
  readonly air: boolean;
  readonly armors: readonly ArmorType[];
  /** HP je Rüstung, für "weak to". */
  readonly hpByArmor: readonly (readonly [ArmorType, number])[];
  /**
   * Gegnerzahl, oder null wenn die Quelle sie nicht kennt. `hi` ist, was sie
   * gegen die Abwehr im Request schicken würde, `max` was die Welle höchstens
   * hält; die UI formuliert den Unterschied. Eine aufgeschriebene Welle hat
   * für alle drei dieselbe Zahl.
   */
  readonly count: { readonly lo: number; readonly hi: number; readonly max: number } | null;
  /** Gegnertypen mit Anteil, für den Tooltip. */
  readonly enemies: readonly (readonly [string, number])[];
  /** Zusatz des Sources, etwa "Template wird beim Start gewählt". */
  readonly note: string;
  readonly description: string;
}
```

Drei Entscheidungen, die in diesen Typen stecken:

**`wave` wird übergeben, nicht abgeleitet.** Heute rechnet jede Schicht `state.waveNumber + 1` neu
(`WaveDirector.plan`, `buildWaveConfig`, `buildWaveContext`, die Facade für die Boss-Variante). Beim Planen am
Ende der Vorwelle ist diese Konvention nicht mehr eindeutig, weil `state.waveNumber` dann schon die beendete
Welle sein kann. Die Zielwelle explizit zu übergeben nimmt eine ganze Fehlerklasse weg.

**`peek` liefert Fakten, keine Sätze.** `WavePeek` in `upcoming-waves.ts` enthält heute Tooltip-Text,
`armorLabel` und Icon-Logik. Das bleibt in der UI, sonst besitzt ein Plugin die Spielcopy. Der Source liefert
nur, was er weiß.

**`peek` ist seitenwirkungsfrei und stabil.** Kein Zugriff auf `StateSnapshotService`, nichts wird
festgeschrieben, zwei Aufrufe zwischen zwei Wellen antworten gleich. Nur so bleibt der Aufruf in einem
Angular-`computed` billig und seine Abhängigkeiten sichtbar.

**`log` statt eines offenen Sacks allein.** Die drei Felder, die das Run-Log-Format heute kennt
(`survivableCount`, `pressureMultiplier`, `targetPressure`), bleiben typisiert, damit Format 2 und der
Python-Bericht weiterlesen. Alles andere geht in `diagnostics`.

## 4. Was geteilt bleibt, was ins Plugin wandert

Geteilt, bleibt im Wurzelordner `director/`:

| Datei | Warum geteilt |
|---|---|
| `wave-source.ts` | der Vertrag |
| `wave-director.ts` | der eine Angular-Service, den die Facade kennt |
| `state-snapshot.service.ts`, `wave-outcome-tracker.ts`, `wave-history.ts` | Messung, für alle Sources gleich |
| `defense-analyzer.ts`, `dps-profile*.ts`, `tower-dps.util.ts` | Verteidigungsanalyse, auch von Bots, Held, Wave-Panel genutzt |
| `spawn-schedule-builder.ts`, `wave-config-adapter.ts` | Weg zum WaveManager |
| `models/` | `WaveConfig`, `WaveResult`, `GameStateSnapshot` |
| `wave-explanation.ts` (**neu**) | die Typen `DecisionExplanation` und `WaveSizing` |
| `templates.ts` | Gegnerinhalt der 22 Templates plus `candidateTemplates` |
| `director-params.ts` | die benannten Parametersätze eines Laufs, siehe Befund R8 |

Ins Plugin `sources/adaptive/`:

| Datei | Heute |
|---|---|
| `adaptive-source.ts` (**neu**) | implementiert `WaveSource`, hält `recentTemplateIndices`, den Regler und den Boss-Tausch |
| `director-rules.ts` | unverändert verschoben |
| `pressure-controller.ts` | unverändert verschoben |
| `wave-config-builder.ts` | unverändert verschoben |
| `wave-context.ts` | unverändert verschoben |
| `decision-explainer.ts` | die Satzbauer; die **Typen** bleiben in `wave-explanation.ts` |
| `wave-reference.adaptive.json` | umbenannt aus `wave-reference.json`, Inhalt Byte für Byte gleich |

Zwei Dinge dazu:

**`decision-explainer.ts` muss geteilt werden**, nicht verschoben. `store/game.store.ts`,
`models/wave-config.ts` und `configs/boss-variants.config.ts` importieren daraus den **Typ**
`DecisionExplanation`. Der Typ wandert nach `director/wave-explanation.ts`, die Satzbauer
(`explainWaveDecision`, `formatExplanation`, `capIsBinding`) wandern ins adaptive Plugin. `formatExplanation`
ist reine Textformatierung und bleibt geteilt, weil auch andere Sources ihre Sätze so ausgeben.

**`templates.ts` wird noch nicht geteilt.** Es enthält beides: den Inhalt (TEMPLATES, `candidateTemplates`) und
adaptive Maschinerie (`survivableCount`, die acht `FAIRNESS_*`, `DPS_RAMP_*`, `dpsScaledCountMax`,
`lerpRange`). Der Schnitt gehört in Schritt 4, wenn `upcoming-waves.ts` seinen direkten Zugriff auf
`dpsScaledCountMax` verliert. Vorher wäre es Churn ohne Nutzen.

Kein `shared/`-Unterordner. Die geteilten Dateien bleiben liegen, wo sie sind; nur die fünf Dateien der
adaptiven Variante ziehen um. Das halbiert die Import-Änderungen und entspricht dem Auftrag („Unterordner in
director").

## 5. Ordnerschnitt danach

```
director/
├── wave-source.ts                  # Vertrag: WaveSource, PlannedWave, WavePeekFacts
├── wave-source.registry.ts         # id -> Factory, plus der Standard aus der Config
├── wave-director.ts                # dünner Angular-Service, einzige Tür für die Facade
├── wave-explanation.ts             # DecisionExplanation, WaveSizing, formatExplanation
├── director-params.ts              # benannte Parametersätze des Laufs (Bots, Log-Kopf)
├── templates.ts                    # Inhalt der Templates (Schnitt in Schritt 4)
├── state-snapshot.service.ts       # Messung
├── wave-outcome-tracker.ts · wave-history.ts
├── defense-analyzer.ts · dps-profile.ts · dps-profile-visualizer.ts · tower-dps.util.ts
├── spawn-schedule-builder.ts · wave-config-adapter.ts
├── models/
├── wave-source.contract.spec.ts    # gilt für jeden Source
└── sources/
    ├── adaptive/
    │   ├── adaptive-source.ts
    │   ├── director-rules.ts
    │   ├── pressure-controller.ts
    │   ├── wave-config-builder.ts · wave-context.ts
    │   ├── decision-explainer.ts
    │   └── wave-reference.adaptive.json
    └── table/
        ├── table-source.ts
        ├── wave-table.ts           # Typ und Laderoutine
        ├── wave-table.json         # die editierbare Liste
        └── wave-reference.table.json
```

`director-params.ts` **bleibt im Wurzelordner**, obwohl alle fünf Knöpfe darin (`rampFullWave`,
`pressureTargetScale`, `pressureGain`, `dpsRampWeight`, `capSlack`) heute ausschließlich die adaptive Variante
beschreiben. Drei Gründe, siehe Befund R8:

- `bots/bot-session.ts:25` setzt den Satz (`useDirectorParams`), `run-log/run-log.facade.ts:21` schreibt
  seinen Namen in den Log-Kopf. Beides liegt außerhalb von `director/` und ist eine Eigenschaft des **Laufs**,
  nicht der Wellenregel.
- `templates.ts` liest ihn heute in `dpsScaledCountMax` (`templates.ts:665`). Läge die Datei im Plugin, würde
  geteilter Code aus einem Plugin importieren, also genau die Abhängigkeit, die S4 verbietet. Nach S4 liest
  kein geteiltes File ihn mehr, weil `dpsScaledCountMax` mit der adaptiven Maschinerie umzieht.
- Kommt ein zweiter Source mit eigenen Knöpfen, bekommt er dort seinen eigenen Satz. Die Registry ist die
  gemeinsame Stelle, die Werte gehören den Sources.

Der Bot-Server wählt also weiter ein benanntes Set; läuft ein anderer Source, sind die adaptiven Sätze ohne
Wirkung, und das Run-Log sagt über `waveSource`, welcher lief.

## 6. Der neue `WaveDirector`

Bleibt der einzige Angular-Service und die einzige Tür für die Facade. Aufgaben:

```ts
@Injectable()
export class WaveDirector {
  private source: WaveSource;            // aus der Registry, je Lauf fest
  private committed: PlannedWave | null; // was zuletzt festgeschrieben wurde

  /** Die Welle `wave`, geplant wenn nötig. Idempotent. */
  ensurePlanned(wave: number, random: () => number): PlannedWave;

  /** Die Welle `wave` zum Start. Ruft ensurePlanned und legt sie in den Snapshot. */
  getNextWave(wave: number, random: () => number): PlannedWave;

  /** Vorschau für das Wave-Panel. */
  peek(fromWave: number, count: number): WavePeekFacts[];

  onWaveCompleted(result: WaveResult): void;  // an den Source, plus ensurePlanned bei 'wave-end'
  resetForNewGame(): void;                    // Source neu wählen, committed leeren, source.reset()
}
```

`ensurePlanned` ist der Kern und macht `plansAt` zu einem Hinweis statt zu einem zweiten Codepfad:

- Ist `committed?.wave === wave`, wird sie zurückgegeben, ohne neu zu planen.
- Sonst wird geplant und festgeschrieben.
- `onWaveCompleted` ruft es bei `plansAt === 'wave-end'` gleich nach dem Ergebnis; ebenso `resetForNewGame`
  für die erste Welle eines Laufs.
- Bei `plansAt === 'wave-start'` plant nur der Aufruf aus der Facade.

Damit ist auch `jumpToWave` abgedeckt: Der Sprung nach W35 findet eine festgeschriebene Welle für W`n+1` vor,
die Nummern stimmen nicht, also wird neu geplant. Ein Spec dafür, siehe Schritt 6.

**Reihenfolge und Fehlerfall** (Befund R9):

- `committed` wird **nur** in `ensurePlanned` gesetzt, und nur nach einem erfolgreichen `plan()`. Wirft ein
  Source, bleibt die alte festgeschriebene Welle stehen, statt dass ein halber Zustand entsteht.
- Die Facade liest die Log-Felder aus dem **Rückgabewert** von `getNextWave`, nicht aus `director.committed`.
  Damit gibt es keine Frage der Reihenfolge: Wer die Welle bekommt, hat auch ihre Zahlen. `committed` ist nur
  für die Leser *zwischen* den Wellen da, also Vorschau und Bot-Debugger.
- Wirft `plan()`, propagiert das durch `getNextWave` in den bestehenden `catch` der Facade: `directorError`
  wird gesetzt, `directorEnabled` fällt auf `false`, der Lauf spielt Debug-Panel-Wellen weiter. Das ist das
  heutige Verhalten und bleibt unverändert.
- Leser von `committed` müssen mit `null` umgehen: vor der ersten geplanten Welle eines Laufs gibt es keine.
  Der Bot-Debugger zeigt dann nichts an.

`getNextWave` bleibt `async`, obwohl nichts mehr asynchron ist (das ONNX-Modell dahinter ist seit dem
2026-09-20 weg). Es aufzulösen hieße, den Retry-Zweig der Facade (`MAX_AI_RETRY`, `pendingAIWaveRequest`,
`directorError`) mit anzufassen, und der fängt einen echten Bug ab. Außerhalb dieses Umbaus, siehe Befund R5.

Die Facade schrumpft auf: Welle holen, Erklärung in den Store, Log-Notiz weitergeben, `adaptDirectorWave`,
Event. Der Boss-Tausch und das zweite `setCurrentWaveConfig` verschwinden dort.

**Was am Service nach außen weg muss:** `WaveDirector.pressure` ist heute ein öffentliches Feld und wird an
zwei Stellen von außen gelesen, in der Facade für die Log-Notiz und in
`bot-debugger.component.html:73` für die Anzeige. Beide lesen künftig `committed.log.pressureMultiplier`
beziehungsweise die Log-Felder; ein Source ohne Regler zeigt dort nichts an. Befund R1.

## 7. Konfiguration und Umschalten

Neu: `configs/director.config.ts`

```ts
export const DEFAULT_WAVE_SOURCE: WaveSourceId = 'adaptive';
```

Zur Laufzeit wählbar über `DebugStore` (neues Signal `waveSource`), angezeigt und umschaltbar im
Wave-Debug-Fenster. **Wirkung erst ab dem nächsten Lauf**, wie abgesprochen: `resetForNewGame()` liest das
Signal, während eines Laufs bleibt der Source fest. Die UI sagt das an („gilt ab Neustart"), sonst wirkt der
Schalter kaputt.

Kein zweiter Weg: `GameStore.directorEnabled = false` bleibt, was es ist, nämlich der Weg zu den
Debug-Panel-Wellen, und ist kein Source.

## 8. Run-Log

Das Format wächst additiv, Format 3:

- `noteDirectorDecision` bekommt `waveSource: WaveSourceId` und `diagnostics`.
- `RunLogWave` bekommt `waveSource?: WaveSourceId` und `diagnostics?: Record<string, ...>`.
- `survivableCount`, `pressureMultiplier`, `targetPressure` behalten Bedeutung und Position. Läuft ein Source,
  der sie nicht kennt, fehlen sie, wie heute bei einer Welle aus dem Debug-Panel.
- Der Python-Bericht liest weiter; ein Lauf ohne `pressureMultiplier` ist für ihn ein Lauf ohne Regler.

**Der Config-Hash.** `run-log/config-hash.ts` hasht heute zehn Konfigurationen, darunter `TEMPLATES` und
`CAMPAIGN`. Zwei Läufe mit unterschiedlichem Source dürfen nicht im gleichen Mittel landen, also muss der
Source in den Hash. Damit die Hashes bereits gemessener Läufe nicht wandern, geht nur der **abweichende** Fall
ein: bei `adaptive` bleibt der Hash unverändert, jeder andere Source hängt `id` und seine eigenen Tabellen an.
Begründung im Code, weil es sonst wie eine Unterlassung aussieht.

## 9. Vorschau

`upcoming-waves.ts` bekommt seine Fakten künftig aus `WaveDirector.peek()` und formt nur noch Labels, Icons
und Tooltips daraus. Was sich dadurch ändert:

- Der direkte Import von `dpsScaledCountMax` aus `templates.ts` fällt weg. Genau diese Zeile ist heute der
  Grund, warum die Vorschau adaptive Interna kennt.
- `templateObjectForWave` und `bossVariantForWave` wandern in den adaptiven `peek`, weil sie dessen Antwort
  sind, nicht die der UI.
- Ab W31 kann der adaptive Source weiter nur die Menükarte liefern (`known: false`). Das ist die Wahrheit über
  ihn und bleibt so.
- Ein Tabellen-Source liefert jede Welle als `known: true` mit fester Zahl. Die Vorschau wird dadurch ohne
  weitere Arbeit vollständig.

Die Vorschau der **unmittelbar nächsten** Welle kommt zusätzlich aus `committed`, wenn der Source
`plansAt: 'wave-end'` hat. Dann stimmt sie exakt und nicht nur als Spanne.

## 10. Tests

**Contract-Spec** `director/wave-source.contract.spec.ts`, läuft über jeden registrierten Source:

1. Gleicher Seed, gleicher Zustand, gleiche Welle (zweimal planen, gleiches Ergebnis).
2. `plan` liefert nie eine leere Welle: `totalCount >= 1`, jede Gruppe `count >= 1`, jeder Gegnertyp existiert
   in `ENEMY_TYPES`.
3. `spawnDelay >= MIN_SPAWN_DELAY_MS`. Zur Dauer: `count * spawnDelay <= MAX_WAVE_DURATION_MS` ist heute
   **nicht** garantiert, weil `campaignIntensity` die Anzahl **nach** dem Dauer-Deckel multipliziert
   (`wave-config-builder.ts`, letzter Schritt). In der Kampagne steht die Intensität nur auf Werten `<= 1`,
   also hält es zufällig; der Typ erlaubt mehr. Die Zusicherung lautet deshalb
   `count * spawnDelay <= MAX_WAVE_DURATION_MS * max(1, intensity)`, und der Befund R4 bleibt als eigener
   Punkt offen, statt in einer Zusicherung zu verschwinden.
4. `plan({wave: n})` liefert `PlannedWave.wave === n`.
5. `peek` liefert genau `count` Einträge, aufsteigend, ab `fromWave`, ohne den Zustand zu verändern (zweimal
   aufgerufen gleiches Ergebnis, danach plant `plan` unverändert).
6. `reset()` stellt den Ausgangszustand her: planen, Ergebnis einspielen, reset, gleicher Plan wie am Anfang.
7. Ist `plansAt === 'wave-end'`, stimmt der `peek`-Eintrag für die nächste Welle mit `committed` überein.

**Golden Files** je Source: `wave-reference.adaptive.json` ist das heutige `wave-reference.json`, Byte für
Byte. Das ist der Abnahmetest für Schritt 1 bis 3: verschiebt sich dort etwas, hat der Umbau das Spiel
verändert. `wave-reference.table.json` kommt mit dem Tabellen-Source.

**Das Golden File taugt dafür erst nach S0.** `wave-reference.spec.ts` ruft heute
`pressure.recordWave(pressure, wave)` ohne dritten Parameter, also mit dem Standard `capBinding = true`
(`pressure-controller.ts:237`). Produktiv übergibt `WaveDirector` dort `this.lastCapBinding` aus
`capIsBinding(sizing)`. Der Unterschied ist nicht kosmetisch: Bei `capBinding = false` hält das Anti-Windup
den Multiplikator fest, statt ihn zu öffnen (`pressure-controller.ts:299`). Der eingecheckte Referenzlauf
beschreibt also einen Regler, der immer öffnen darf, und damit nicht das Spiel. Wer den Spec auf den Source
umstellt, ändert das Golden File und kann dann nicht mehr unterscheiden, ob der Umbau etwas verschoben hat
oder die Treue des Specs. Deshalb ist das ein eigener erster Schritt mit eigenem Diff. Befund R2.

**Was bestehen bleiben muss:** `determinism.spec.ts`, `pressure-wiring.spec.ts`,
`game-loop-facade.service.spec.ts`, `game-loop-facade.jump.scenario.spec.ts`, `wave-debugger.scenario.spec.ts`
und die Run-Log-Specs. Gesamtlauf heute 5252 Tests; nach jedem Schritt muss er grün sein.

## 11. Dekoratoren, danach

Ein Dekorator ist selbst ein `WaveSource` und wrappt einen anderen. Damit gilt jeder Hebel für jede Variante
und wird nur einmal gebaut.

```ts
withDifficulty(source, () => store.difficulty())   // Faktor auf Anzahl und HP, ganzer Lauf
withSafetyNet(source, { onlyShrink: true })        // verkleinert nur, bei fehlender Antwort
```

`withDifficulty` ist der Hebel für die UI-Auswahl des Spielers. `withSafetyNet` ist der ehrliche Rest der
Adaption: einseitig, gedächtnislos, erklärbar. Beide gehören **nicht** in diesen Umbau; die Naht muss nur so
liegen, dass sie ohne Änderung am Vertrag dazukommen können. Konkret heißt das: `plan` gibt eine fertige
`PlannedWave` zurück, die ein Dekorator lesen, verkleinern und mit eigener Begründung weitergeben kann.

## 12. Schritte

Jeder Schritt ist einzeln lauffähig und einzeln prüfbar. Kein Schritt lässt zwei Systeme nebeneinander
stehen.

**S0 Den Referenzlauf treu machen.** `wave-reference.spec.ts` übergibt `capBinding` so, wie `WaveDirector` es
produktiv tut (`capIsBinding(config.explanation.sizing)`), und das Golden File wird bewusst neu erzeugt. Der
Diff ist der Review: er zeigt, wie die Wellen 1 bis 60 mit greifendem Anti-Windup wirklich aussehen. Ohne
diesen Schritt beweist das Golden File in S2 und S3 nichts.
*Abnahme:* Diff je Welle gelesen und im Commit begründet, voller Testlauf grün. Kein Produktionscode
geändert. Damit der Diff prüfbar bleibt und nicht auf Zureden hin abgenommen wird, läuft der Spec in diesem
Schritt zweimal, einmal mit dem alten `capBinding = true` und einmal treu; der Commit-Body hält fest, wie
viele Wellen sich bewegt haben und in welche Richtung (Befund R11).

**S1 Vertrag und Typen.** `wave-source.ts` mit allen Typen, `wave-explanation.ts` mit `DecisionExplanation`,
`WaveSizing`, `formatExplanation`. Die drei Importstellen von `decision-explainer` für den Typ umhängen
(`store/game.store.ts`, `models/wave-config.ts`, `configs/boss-variants.config.ts`).
*Abnahme:* Build, Lint, voller Testlauf grün, `wave-reference.json` unverändert.

**S2 Adaptive Variante hinter den Vertrag.** `sources/adaptive/adaptive-source.ts` implementiert `WaveSource`
und enthält, was heute in `WaveDirector.plan/ship/tieBreak` steht, plus `recentTemplateIndices`,
`lastCapBinding` und den Regler. `plansAt: 'wave-start'`, damit sich nichts am Verhalten ändert. Die fünf
Dateien ziehen nach `sources/adaptive/` um, `wave-reference.json` wird `wave-reference.adaptive.json`.
*Abnahme:* Golden File Byte für Byte gleich, voller Testlauf grün.

**S3 `WaveDirector` dünn, Boss hinter die Naht.** `ensurePlanned`/`getNextWave`/`peek`/`onWaveCompleted`/
`resetForNewGame` wie in Abschnitt 6. Der Boss-Tausch zieht aus der Facade in den adaptiven Source. Die Facade
verliert `bossVariantForWave`, `bossVariantWave` und das zweite `setCurrentWaveConfig`. Registry plus
`configs/director.config.ts`.
Dazu die zwei Fremdleser von `WaveDirector.pressure` umhängen: die Log-Notiz in der Facade und
`bot-debugger.component.html:73`. Beide lesen die Log-Felder der festgeschriebenen Welle.
*Abnahme:* Golden File unverändert, `game-loop-facade.service.spec.ts`, der Jump-Scenario-Spec und
`bot-debugger.component.spec.ts` grün, ein neuer Spec „Boss-Variante kommt aus dem Source, nicht aus der
Facade", und ein Spec „ein Sprung auf W35 verwirft eine festgeschriebene Welle mit anderer Nummer".

**S4 Vorschau über den Vertrag.** `peek` im adaptiven Source, `upcoming-waves.ts` liest daraus,
`templates.ts` wird in Inhalt und adaptive Maschinerie geschnitten. Die Sätze und Icons bleiben in der UI.
*Abnahme:* Das Wave-Panel zeigt dasselbe wie heute (Snapshot-Spec des Panels), kein Import aus
`sources/adaptive/` außerhalb von `director/`.

**S5 Contract-Spec.** `wave-source.contract.spec.ts` über die Registry, sieben Punkte aus Abschnitt 10. Der
adaptive Source muss ihn bestehen; besteht er einen Punkt nicht, ist das ein Befund und wird hier
dokumentiert, nicht wegdefiniert.

**S6 Run-Log und Umschalter.** `waveSource` und `diagnostics` im Log, Config-Hash, Signal im `DebugStore`,
Umschalter im Wave-Debug-Fenster mit dem Hinweis „gilt ab Neustart".
*Abnahme:* Run-Log-Specs grün, ein Lauf im Log trägt seinen Source, Hash bei `adaptive` unverändert.

**S7 Tabellen-Source.** `sources/table/`: Typ, Lader, `wave-table.json`, `peek` mit festen Zahlen, Erklärung
in eigenen Sätzen. Startinhalt der Tabelle: der heutige Referenzlauf W1 bis W60, damit die Liste beim Status
quo beginnt und nicht bei null. `wave-reference.table.json` als eigenes Golden File.
*Abnahme:* Contract-Spec grün, ein Lauf mit `table` spielt W1 bis W60 aus der Tabelle, Umschalten auf
`adaptive` liefert wieder das alte Golden File.

S1 bis S6 ändern das Spiel nicht. Erst S7 bringt eine zweite Variante, und die ist abgeschaltet, solange
`DEFAULT_WAVE_SOURCE` auf `adaptive` steht.

## 13. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Import-Umhängen über 20 Dateien, 15 davon in `director/` | mechanisch, Build und Testlauf nach jedem Schritt; das Golden File ist der Beweis |
| Planen am Wellenende zieht aus dem `director`-RNG-Strom zu einem anderen Zeitpunkt und würde den Referenzlauf verschieben | Der adaptive Source bleibt auf `plansAt: 'wave-start'`. Der Wechsel ist danach ein Einzeiler plus bewusst neu erzeugtes Golden File |
| `jumpToWave` trifft eine festgeschriebene Welle mit falscher Nummer | `ensurePlanned` plant bei Nummernabweichung neu, eigener Spec |
| Ein Dekorator, der später nur verkleinern soll, braucht Zahlen, die `PlannedWave` nicht führt | `WaveSizing` in der Erklärung führt sie schon (`countRange`, `cap`, `count`, `hpMult`); der Vertrag gibt sie mit |
| Der Config-Hash wandert und macht alte Läufe unvergleichbar | Nur der abweichende Source geht ein, `adaptive` lässt den Hash stehen |
| Zwei Erklärungs-Stile in einem Debug-Fenster | `DecisionExplanation` bleibt der gemeinsame Typ; jeder Source schreibt seine eigenen Sätze hinein, das Fenster zeigt sie unverändert an |
| Das Golden File beweist nichts, weil der Spec nicht produktionstreu ist | S0 vor allem anderen, eigener Diff, eigener Commit |
| Die Vorschau wird teuer, weil sie in einem `computed` hängt | `peek` nimmt nur `totalDps` und zwei Fähigkeiten, keinen Snapshot, und ist seitenwirkungsfrei |

## 14. Review vom 2026-09-22

Gegencheck des Plans gegen den Code, sieben Befunde. Was sie geändert haben, steht jeweils dabei.

**R1 `WaveDirector.pressure` wird von außen gelesen.** `bot-debugger.component.html:73` zeigt
`waveDirector.pressure.pressureMultiplier.toFixed(2)` direkt an, die Facade liest dasselbe Feld für das
Run-Log. Zieht der Regler ins Plugin, brechen beide. *Folge:* Abschnitt 6 und S3 nennen die zwei Leser
ausdrücklich; sie lesen künftig die Log-Felder der festgeschriebenen Welle.

**R2 Der eingecheckte Referenzlauf ist nicht produktionstreu.** `wave-reference.spec.ts` lässt den dritten
Parameter von `recordWave` weg, also läuft der Regler dort ohne Anti-Windup. *Folge:* neuer erster Schritt
S0, und Abschnitt 10 erklärt, warum das Golden File sonst nichts beweist. Das ist der wichtigste Befund des
Reviews.

**R3 Ein Snapshot als Vorschau-Eingabe wäre teuer.** `wave-panel.component.ts:164` ruft die Vorschau in einem
`computed`, das an Turmzahl, Ausbauten und Forschung hängt. *Folge:* `WavePeekRequest` trägt nur
`totalDps`, `hasAntiAir`, `hasAntiEthereal`, und `peek` ist ausdrücklich seitenwirkungsfrei.

**R4 Die Dauer-Zusicherung hält nur zufällig.** `campaignIntensity` multipliziert die Anzahl nach dem
Dauer-Deckel. *Folge:* Die Zusicherung im Contract-Spec ist entsprechend formuliert, und der Punkt bleibt als
Befund offen statt in einer Zusicherung zu verschwinden. Ob die Intensität vor den Deckel gehört, ist eine
Balance-Entscheidung und nicht Teil dieses Umbaus.

**R5 `async` bleibt.** `getNextWave` aufzulösen hieße, den Retry-Pfad der Facade mit anzufassen. *Folge:*
ausdrücklich außerhalb des Umbaus.

**R6 Doku-Drift im Druck-Regler.** `docs/WAVE_DIRECTOR.md`, Abschnitt 6, beschreibt einen Median über ein
Fenster von fünf Wellen und ein `PRESSURE_WINDOW = 5`. Im Code gibt es beides nicht: geglättet wird
exponentiell (`PRESSURE_SMOOTHING = 0.35`), freigegeben ab `PRESSURE_MIN_SAMPLES = 3`. Die Aussage über die
Totzeit bleibt richtig, der Mechanismus ist ein anderer. *Folge:* Abschnitt 6 von WAVE_DIRECTOR.md wird in S6
nachgezogen.

**R7 Zwei Signale ohne Leser.** `lastDecision` und `decisionTimeMs` liest nur ihr eigener Spec.
*Folge:* keine. Sie bleiben, kosten nichts und `lastDecision` ist beim Debuggen nützlich.

### Unabhängiger Review, gleicher Tag

Ein zweiter, unabhängiger Reviewer hat den Plan gegen den Code gelesen. Vier weitere Befunde, alle
nachgeprüft.

**R8 `director-params.ts` darf nicht ins Plugin.** Der Reviewer fand zwei Importe außerhalb von `director/`:
`bots/bot-session.ts:25` (`useDirectorParams`) und `run-log/run-log.facade.ts:21` (`directorParamsName`).
Die Nachprüfung hat einen dritten und schwereren Grund ergeben, den der Reviewer nicht genannt hat:
`templates.ts:665` liest den Satz in `dpsScaledCountMax`, und `templates.ts` bleibt geteilt. Ein Umzug hätte
geteilten Code aus einem Plugin importieren lassen, also genau die Abhängigkeitsumkehr, die S4 verbietet.
*Folge:* Die Datei bleibt im Wurzelordner, Abschnitt 4 und 5 sind korrigiert und begründet. Der Reviewer
nannte das einen Blocker; es war ein Widerspruch zwischen Abschnitt 4 (Datei nicht in der Umzugsliste) und
Abschnitt 5 (Datei im Baum), der jetzt aufgelöst ist.

**R9 `committed`-Reihenfolge und Fehlerfall waren nicht beschrieben.** Berechtigt. *Folge:* Abschnitt 6 sagt
jetzt, dass `committed` nur nach erfolgreichem `plan()` geschrieben wird, dass die Facade die Log-Felder aus
dem Rückgabewert liest und nicht aus der Eigenschaft, dass ein `throw` in den bestehenden `catch` läuft und
dass jeder Leser `null` verträgt.

**R10 `hasAntiAir` und `hasAntiEthereal` sind für die heutige Vorschau überflüssig.** Stimmt für heute:
`peekUpcomingWaves` filtert nicht danach. Sie bleiben trotzdem im Vertrag, weil `candidateTemplates` ab W31
genau darauf sperrt; ohne sie könnte ein `peek` jenseits der Kampagne nichts sagen. *Folge:* Begründung steht
jetzt am Typ.

**R11 Der Golden-File-Diff in S0 ist ein manueller Schritt mit Umkehrrisiko.** Berechtigt. *Folge:* S0 lässt
den Spec zweimal laufen, alt und treu, und der Commit-Body hält die Zahl der bewegten Wellen und die Richtung
fest.

**Nicht übernommen:** das Urteil „derzeit nicht implementierbar". Die beiden gemeldeten Blocker waren ein
Widerspruch in der Doku und zwei Importpfade, beides ohne Auswirkung auf den Schnitt. Der Reviewer hat
außerdem keine fünfte Entscheidungsstelle für Wellen gefunden, die Aussage aus Abschnitt 2 steht damit
unwiderlegt, aber auch nicht unabhängig bestätigt.

**Was der Review bestätigt hat:** die vier Entscheidungsstellen aus Abschnitt 2, die 20 betroffenen Dateien,
dass `jumpToWave` nur vorwärts und nur zwischen Wellen geht (also `ensurePlanned` reicht), dass
`determinism.spec.ts` zwei Läufe gegeneinander prüft und deshalb kein Golden File anzupassen ist, und dass
die Sources reine Klassen ohne Angular-Abhängigkeit sein können, weil `buildWaveContext`, `buildWaveConfig`
und der Regler alle ihren Zustand als Parameter bekommen.

## 15. Offene Punkte

1. **Boss-Varianten im Tabellen-Source.** Eine Tabelle kann den Boss direkt in ihrer Zeile nennen, dann
   braucht sie die Rotation nicht. Entscheidung fällt in S7, nicht vorher.
2. **`directorParams` und der Tabellen-Source.** Die benannten Sets sind adaptiv. Ob ein Tabellen-Lauf im
   Bot-Batch stattdessen einen Tabellennamen mitloggt, entscheidet sich, wenn der erste Batch damit läuft.
3. **`plansAt` für die adaptive Variante.** Entschieden am 2026-09-24 (User): `wave-end`. Beim Klick geplant
   machte ein vor dem Start gebauter Turm dieselbe Welle größer als einer, der nach dem Start kam. Jetzt legt das
   Ende der Vorwelle die Welle fest (Welle 1 der Start des Laufs); der Deckel sieht in der Pause Gebautes eine Welle
   später, der Druck-Regler gleicht das aus, die Vorschau nennt die echte nächste Welle.

## 16. Was beim Bauen anders kam

Umgesetzt am 2026-09-22. Sieben Abweichungen vom Plan, alle mit Grund.

**1. S2 und S3 sind ein Schritt geworden.** Getrennt hätte S2 entweder toten Code hinterlassen oder zwei
Wellenpfade gleichzeitig laufen lassen, und `wave-director.ts` wäre zweimal neu geschrieben worden. Der Boss-Tausch
musste in derselben Änderung aus der Facade verschwinden, sonst hätte er doppelt gegriffen.

**2. Der Referenzlauf hat sich ein zweites Mal bewegt, und das war der wichtigste Fund des Umbaus.**
S0 hat den `capBinding`-Fehler behoben (7 von 60 Wellen, alle nach unten, der Regler lief vorher ab W20 im
Anschlag ×20). Beim Umstellen des Specs auf den Source kam ein zweiter Unterschied heraus: Der Spec übergab
`decideWave` **keinen Tie-Break**, produktiv tut der Source das, sobald der Regler öffnet oder schließt. Weitere
3 von 60 Wellen haben sich bewegt, alle durch eine andere Template-Wahl (W33, W41, W52). Der eingecheckte
Referenzlauf beschrieb also an zwei Stellen etwas, das das Spiel nie gespielt hat. Jetzt fährt der Spec den
Source, es gibt nur einen Pfad, und dasselbe gilt für `determinism.spec.ts`.

**3. Der Tabellen-Source hat kein eigenes Golden File.** Geplant war `wave-reference.table.json`. Es wäre eine
Kopie der Tabelle: Die Liste **ist** die Referenz. Stattdessen prüft `table-source.spec.ts` über alle Zeilen,
dass die ausgelieferte Welle die Zeile ist, unverändert. Das ist stärker und kann nicht auseinanderlaufen.

**4. Der Vorschau-Request trägt keine Fähigkeits-Flags.** Der unabhängige Review hatte recht (R10): Für den
adaptiven Source sind sie nutzlos, und das Panel hätte sie nur über eine zweite Ableitung derselben Regel
füllen können, die `defense-analyzer` besitzt. Eine Quelle, die sie braucht, bekommt sie, wenn sie existiert.

**5. `templates.ts` ist nur halb geschnitten.** Heraus ist die Maschinerie, die eine Welle bemisst:
`survivableCount`, die `FAIRNESS_*`, die DPS-Rampe, `lerpRange` liegen jetzt in
`sources/adaptive/wave-sizing.ts`. Drin geblieben sind die Templates selbst plus `candidateTemplates` und
`getTemplate`, obwohl das die Auswahlregel des adaptiven Sources ist: Ein Umzug hätte `templates.spec.ts`
mit aufteilen müssen, und außerhalb des Plugins hängt nichts daran. `MAX_WAVE_DURATION_MS` und
`MIN_SPAWN_DELAY_MS` bleiben absichtlich geteilt, weil der Contract-Spec jede Quelle daran messen muss.

Dabei kam ein Fund heraus, den der Review nicht hatte: `defense-analyzer.ts` (geteilt) las
`FAIRNESS_MATCHUP_FLOOR` aus `templates.ts`, und die Konstante wird ausschließlich im Analyzer angewandt. Sie
liegt jetzt dort. Damit importiert kein geteiltes File etwas aus einem Plugin.

**6. Ein Test-Stub für den Director, statt sechs Stubs einzeln zu flicken.** Die Facade ruft jetzt
`useRandomSource`, und sechs Specs stubbten den Director als `{}`. `wave-director.stub.ts` hält den Vertrag
zwischen Facade und Director an einer Stelle fest.

**7. Zwei Specs waren still vom Zufall abhängig.** `pressure-wiring.spec.ts` verglich zwei Batches Wellen, die
aus `Math.random` gezogen wurden. Mit den jetzt fortlaufenden Wellennummern (Endgame-HP, Boss-Kadenz) wurde das
sichtbar. Der Spec setzt jetzt über `useRandomSource` einen geseedeten Strom und plant in beiden Hälften
dieselben Wellennummern, statt die Toleranz zu weiten.

**Neue Befunde des Contract-Specs.** Er hat auf Anhieb einen Fall gefunden, den der Plan zu streng formuliert
hatte: Eine Welle mit **einem** Gegner (die Boss-Wellen der Rotation) liefert `spawnDelay: 0`, was richtig ist,
weil es nichts zu verteilen gibt. Die Zusicherung gilt jetzt ab zwei Gegnern. R4 (Intensität nach dem
Dauer-Deckel) steht als Toleranz im Spec und bleibt ein offener Balance-Punkt.

### Was am Ende steht

| Stück | Datei |
|---|---|
| Vertrag | `director/wave-source.ts` |
| Registry und Standard | `director/wave-source.registry.ts`, `configs/director.config.ts` |
| Service | `director/wave-director.ts` (dünn: Source wählen, `ensurePlanned`, `committed`, `peek`) |
| Adaptiver Source | `director/sources/adaptive/` (9 Dateien plus Specs und Golden File) |
| Tabellen-Source | `director/sources/table/` (`table-source.ts`, `wave-table.ts`, `wave-table.json`) |
| Abnahme für jede Quelle | `director/wave-source.contract.spec.ts` (11 Punkte je Source) |
| Umschalter | Wave-Debug-Fenster, gilt ab dem nächsten Lauf |

Zahlen: 5314 Tests grün, Lint und Build sauber. Außerhalb von `director/` greift kein Produktionscode mehr auf
`sources/adaptive/` zu.
