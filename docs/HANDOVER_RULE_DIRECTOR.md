# Handover: Regel-Director ersetzt das Modell

**Stand:** 2026-09-07
**Branch:** `feat/training-backend-refresh`
**Commits:** `3e8fe54` (Gate steuert statt ratscht), `3875d61` (Regel-Director clientseitig)

Dieses Dokument hält den Tag fest, an dem der Wave Director vom trainierten
ONNX-Netz auf eine Regel-Implementierung umgestellt wurde, und dient als
Einstieg für jemanden, der später wieder ernsthaft trainieren will.

Die Begründung ist wichtiger als die Beschreibung: die Messreihe in Abschnitt 2
ist der eigentliche Inhalt. Wer nur wissen will, wie der Code heute aussieht,
liest Abschnitt 1 und ist fertig.

---

## 1. Was heute läuft

**Im Spiel entscheidet Code, kein Modell.** Der Director sitzt vollständig im
Client:

| Datei | Rolle |
|---|---|
| `src/app/ai/core/rule-director.ts` | wählt Template + die vier Formfaktoren (count, spawn_delay, hp_mult, variation) |
| `src/app/ai/core/gate-controller.ts` | Regelkreis auf dem Fairness-Cap, per Run |
| `src/app/ai/core/wave-director.service.ts` | gemeinsamer Pfad: Maske, Range-Interpolation, DPS-Ramp, Endgame-Multiplier, Fairness-Cap |

Der Regel-Director ist ein 1:1-Ersatz für die fünf Zahlen, die das Netz
ausgegeben hat — alles danach ist unverändert und wird geteilt. Zwei bewusste
Entscheidungen stecken darin:

- **Vielfalt wird erzwungen, nicht belohnt.** Es gewinnt das *älteste* erlaubte
  Template (`staleness`). Der Reward hatte einen Variation-Faktor und die Maske
  einen Template-Cooldown, und die Wellen kamen trotzdem repetitiv heraus.
- **Schwierigkeit ist eine Kurve, keine Wave-Entscheidung.** `RAMP_FULL_WAVE = 60`,
  darüber gehalten. Der Spieler heilt nie, seine HP sind das Budget des ganzen
  Runs — das ist etwas, das man aufschreibt, und nichts, was man aus einem
  skalaren Per-Wave-Reward ableitet.

**Betriebsfolge:** Das Spiel braucht im Normalbetrieb keinen Python-Server, kein
Modell und keine ONNX-Runtime. Es wird beim Kaltstart nichts nachgeladen
(`WaveDirectorService`-Konstruktor: kein eager `loadModel()`), und
`GameStore.useAIDirector` startet auf `true` — vorher stand das Signal auf
`false` und wurde von einem Effect umgelegt, sobald das ONNX-Modell geladen war.

**Der ONNX-Pfad bleibt erreichbar** — als Opt-in über den Knopf
„ONNX-Modell laden" im Debug-Fenster (`training-debugger.component.ts`),
zurück über „Regeln nutzen". Details und der Stand des ausgelieferten Modells:
[AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md).

**Das Trainings-Backend bleibt bestehen — als Messinstrument, nicht als
Produktionsabhängigkeit.** Es ist die einzige Umgebung, in der sich Wave-Designs
gegen Bots über hunderte Runs vergleichen lassen. Technische Referenz:
[AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md).

---

## 2. Die Messreihe, die den Wechsel begründet

Aufbau: vier Directors laufen gleichzeitig gegen dieselben Bots, dasselbe
Curriculum, denselben Fairness-Gate (`config.DIRECTOR_ROSTER`, `directors.py`).
Unterschiedlich ist ausschließlich die Wahl von Template und Faktoren.

| Director | Was er tut |
|---|---|
| `model` | die Policy (Status quo) |
| `random` | uniform über die erlaubten Templates, uniforme Faktoren |
| `rules` | ältestes erlaubtes Template, Faktoren aus einer festen Rampe |
| `maxgate` | zufälliges Template, aber immer so groß, wie der Gate erlaubt |

### 2.1 Das Netz war nicht von Zufall zu unterscheiden

Über einen Tag A/B-Läufe, **dreimal** hintereinander reproduziert:

| Metrik | `model` | `random` |
|---|---|---|
| mittlere Runlänge | 45,6 [42, 49] | 44,7 [41, 48] |

Die Konfidenzintervalle überlappen fast vollständig. Zwei triviale Heuristiken
(`rules`, `maxgate`) erzeugten dabei **mehr** Spannung als die Policy:
near-miss 0,067–0,069 gegen 0,045.

`random` ist dabei kein schwacher Gegner: die Maske trägt Curriculum,
Capability-Gates und Boss-Kadenz, und der Fairness-Gate deckelt danach die
Größe. Es ist „keine Intelligenz obendrauf" — und genau das ist der Boden, den
eine gelernte Policy überschreiten müsste, um ihren Unterhalt zu verdienen.

### 2.2 Das Netz hatte nie gelernt

Nach mehreren tausend Episoden:

- `log_std` unverändert auf dem Initialwert `LOG_STD_INIT = -0.5` (`model.py`).
- Alle vier Faktor-Mittelwerte auf `sigmoid(0) = 0.5`.

Statistisch war die Policy also noch immer ihre eigene Initialisierung. Jede
Verbesserung, die an diesen Tagen gemessen wurde, kam aus deterministischem
Code (ein fehlender State-Reset, ein korrigiertes Regelsignal) — nicht aus dem
Lernen.

### 2.3 Die Ursache liegt **vor** dem Lernen

Das ist der Kern des ganzen Dokuments. Der Aktionsraum war praktisch leer:

- Das **Curriculum** nagelt das Template fest. Strukturell auf den Waves 1–30
  (`curriculum.forcedThroughWave = 30`); über die beobachteten Runs gemessen
  waren das **49 % aller Wellen**, weil die typische Runlänge in derselben
  Größenordnung lag.
- Der **Fairness-Cap** band auf **63 %** der Wellen. Ein Deckel, der auf der
  Mehrheit der Wellen greift, ist keine Sicherheitsgrenze mehr — er *ist* die
  Policy.
- Was übrig blieb: der volle Regelbereich des `count`-Faktors bewegte eine Wave
  von **19 auf 28 Gegner**.

Es gab fast nichts zu entscheiden, also nichts zu lernen. Ein Reward-Redesign
oder ein Hyperparameter-Tuning hätte daran nichts geändert — beides sitzt hinter
dem Problem.

### 2.4 Und selbst wenn: der Gegner war einer

`BOT_WEIGHTS = {"strategist": 1.0}` — trainiert wird gegen **einen** scripted
Bot. Alles, was ein Agent über dessen Schwächen lernt, ist gegen einen Menschen
wertlos. Das ist keine Feinheit, sondern eine Obergrenze für den Wert des
gesamten Verfahrens in seiner heutigen Form.

### 2.5 Zwei Fehler im Gate, die die Messung vorher unmöglich machten

Beide sind repariert (`3e8fe54`), aber sie erklären, warum ältere Zahlen aus
diesem Projekt nicht vergleichbar sind:

1. **Der Multiplikator wurde zwischen Episoden nicht zurückgesetzt.** Er war
   damit eine Ratsche *pro Client* statt pro Run: er stieg bei jeder
   gemeisterten Wave und wurde nur bei einem Tod heruntergeteilt. Gemessen:
   Mittel 7,0, Max 40,0, Caps von 4761 Gegnern. Der Gate war faktisch aus, und
   frische Runs starteten gegen Wellen, die für eine längst abgebaute
   Verteidigung dimensioniert waren. Mediane Runlänge **6** Waves gegen ein Ziel
   von 80; nach dem Fix **62**.
2. **Das Regelsignal war die Kill-Quote** („die Verteidigung hat alles getötet,
   also mehr erlauben"). Das liest die eigene Vorsicht als Spielraum — eine
   kleine Wave wird gemeistert, *weil* sie klein ist. Einseitiger Druck, der den
   Multiplikator an jede gegebene Obergrenze klebte.

Heute steuert der Gate zweiseitig auf die **Leak-Quote** gegen ein Zielband
(`GATE_LEAK_TARGET_LO/HI = 0.08 / 0.16`) und konvergiert. Die feste Schrittweite
ist durch einen Proportionalregler ersetzt (`GATE_GAIN = 0.35`): der
Kill-Realism-Discount `FAIRNESS_KILL_REALISM = 0.65` wurde auf den Waves 1–10
gemessen, ab Wave 11 töten Verteidigungen fast die volle Vorhersage — der
Multiplikator muss ~1,6 erreichen, nur um diesen bekannten Bias auszugleichen.
Bei 5 % pro Fenster sind das ~170 Waves gegen Runs von ~60, die nach dem
Per-Run-Reset bei 1,0 starten. Gemessener Median: **1,28** — er kam nie an.

---

## 3. Wenn jemand das Modell wieder ernsthaft trainieren will

**Die Reihenfolge ist nicht verhandelbar: erst der Aktionsraum, dann alles
andere.** Solange die Entscheidungen des Directors das Ergebnis nachweislich
nicht beeinflussen, misst jede Reward- oder Hyperparameter-Änderung Rauschen.
Genau das ist in diesem Projekt monatelang passiert.

### Schritt 1 — Die Prüfung, und sie ist billig

```python
# training-backend/config.py
DIRECTOR_ROSTER = ["model", "rules", "random", "maxgate"]
```

Server starten, vier Clients verbinden (round-robin über die Rosterliste),
laufen lassen, dann `random` gegen `model` vergleichen — Runlänge und
`near_miss_ratio`.

**Sind sie gleich, liegt das Problem vor dem Lernen.** Dann ist nichts am Reward
und nichts an PPO zu reparieren, sondern am Handlungsspielraum:

- Curriculum verkürzen (`wave-curriculum.config.ts`, `forcedThroughWave`) oder
  innerhalb des Curriculums mehr als ein Template zulassen.
- Fairness-Zielband weiten (`GATE_LEAK_TARGET_LO/HI`), bis der Cap nicht mehr
  auf der Mehrheit der Wellen bindet.
- Template-Ranges prüfen: wenn `count_range` nach allen Caps effektiv 19–28
  ergibt, ist der Faktor ein Platzhalter.

Erst wenn `model` und `random` messbar auseinanderlaufen, lohnt sich der Blick
auf Reward und Hyperparameter.

**Auswertung:** Es gibt kein fertiges Tool dafür. Der Director steht in den
JSONL-Logs (`logs/training_*.jsonl`) an den Einträgen `wave_result` und
`episode_end` im Feld `director`; `scripts/analyze_log.py` gruppiert **nicht**
danach. Die Gruppierung ist ein Dreizeiler, aber sie muss geschrieben werden.

**Wichtig:** Nicht-lernende Directors speisen PPO nicht
(`server.py::_process_result`, Guard über `director.is_learner`). Ihre Wellen
kamen nie aus der Policy-Verteilung; sie mit einem PPO-Ratio zu paaren wäre
Off-Policy-Daten mit On-Policy-Etikett. Ihre Ergebnisse landen in den
Eval-Metriken.

### Schritt 2 — erst danach

Wenn Schritt 1 einen Unterschied zeigt, sind die Baustellen in dieser
Reihenfolge dokumentiert:

1. `training-backend/docs/AI_TRAINING_BACKEND.md` — aktuelle Reward-Terme,
   Hyperparameter, Decoder-Constraints.
2. `training-backend/docs/AI_TRAINING_SESSION_NOTES.md` — was schon versucht
   wurde und warum es gescheitert ist. Spart mindestens zwei Wiederholungen.
3. Der Gegner (siehe 2.4). Ein zweiter Bot mit anderem Bauverhalten ist die
   kleinste sinnvolle Verbesserung; Daten aus echten Spielerläufen wären die
   richtige.

---

## 4. Offene Punkte, ehrlich benannt

**Die Zielgröße `NEAR_MISS_TARGET = 0.20` wurde nie validiert.** Sie ist
geraten, nicht gemessen — hergeleitet aus dem 90. Perzentil einer Verteilung,
die von einer Policy erzeugt wurde, die nicht gelernt hatte, und nie dagegen
geprüft, ob ein Mensch eine Wave mit 20 % Near-Missern als „spannend"
empfindet. Aktueller Ist-Wert: ~0,058. Ob die Lücke ein Problem ist oder ob das
Ziel falsch ist, weiß niemand. Solange das offen ist, ist jede Reward-Feinarbeit
an dieser Zahl Optimierung auf einen unbestätigten Sollwert.

**Niemand hat den Regel-Director je selbst gespielt.** Er lief ausschließlich
gegen Bots. Bots bauen anders als Menschen, reagieren anders auf Druck und
verkaufen keine Tower aus Panik. Die Aussage „die Regeln sind besser als das
Modell" ist gegen Bots gemessen und gilt streng genommen nur dort. Ein
Playtest ist der nächste Schritt, der wirklich neue Information liefert.

**Training gegen einen scripted Bot lernt dessen Schwächen, nicht die eines
Menschen.** Siehe 2.4. Das gilt für das Modell und in schwächerer Form auch für
die Kalibrierung des Regel-Directors und des Gates — der Regelkreis
re-kalibriert sich zwar an dem, was tatsächlich durchkommt, aber die Rampen
(`RAMP_FULL_WAVE`, die Faktor-Startwerte) sind an Bot-Läufen entstanden.

---

## 5. Einstiegspunkte

| Frage | Datei |
|---|---|
| Wie entscheidet der Director heute? | `src/app/ai/core/rule-director.ts` |
| Wie wird der Fairness-Cap korrigiert? | `src/app/ai/core/gate-controller.ts` |
| Wo werden beide verdrahtet? | `src/app/ai/core/wave-director.service.ts` |
| Wie schalte ich das ONNX-Modell an? | Debug-Fenster → „ONNX-Modell laden" |
| Wie sieht der A/B-Aufbau aus? | `training-backend/directors.py`, `config.DIRECTOR_ROSTER` |
| Warum ist der Gate so gebaut? | `training-backend/tests/test_gate_loop.py` |
| Backend-Referenz | `training-backend/docs/AI_TRAINING_BACKEND.md` |
| Vorgeschichte | `training-backend/docs/AI_TRAINING_SESSION_NOTES.md` |
| Vorheriger Handover | [HANDOVER_TRAINING_REFRESH.md](HANDOVER_TRAINING_REFRESH.md) |
