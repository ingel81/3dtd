# Run-Log

**Stand:** 2026-09-20, Phase 2a des [Balancing-Plans](BALANCING_PLAN.md) gebaut.

Ein Lauf als Daten: was gebaut wurde, was eine Welle gekostet hat, wo es knapp wurde. Ein Format für menschliche
Läufe und für Bot-Läufe, damit die Auswertung beide gleich liest.

## 1. Wozu

Ohne Daten wird nichts getunt. Der Plan nennt zwei Löcher: Niemand sieht, wie eine Partie verläuft, und die Zahlen
für Mensch und Bot kamen aus verschiedenen Quellen. Das Run-Log schließt beides: Es hängt am Event-Bus, stempelt
jeden Eintrag mit dem Sub-Step, und schreibt je Welle einen Block.

Der Seed steht im Kopf, bleibt aber intern (Entscheidung D11): Spieler sehen ihn nicht und teilen ihn nicht.

## 2. Format

JSONL, eine Zeile je Datensatz, in der Reihenfolge, in der sie entstanden sind. Fünf Arten:

| `kind` | Wann | Inhalt |
|---|---|---|
| `head` | einmal, als erste Zeile | Version, Commit, Config-Hash, Seed, Karte, Ort, wer spielt |
| `event` | je Entscheidung oder Moment | Bau, Upgrade, Verkauf, Forschung, Fähigkeit, Held, Leck, Boss, Tempo, Pause, Cheat, Wellensprung |
| `sample` | einmal je Sekunde Spielzeit | Gold, HQ-HP, lebende Gegner, Gesamt-DPS |
| `wave` | am Ende jeder Welle | die ganze Welle: Gold, Kills, Lecks, Tower, Director-Entscheidung |
| `end` | einmal, als letzte Zeile | erreichte Welle und Grund |

`RUN_LOG_FORMAT` steht in `src/app/run-log/run-log.types.ts` und wird erhöht, sobald ein Leser sich ändern müsste.

### Jeder Datensatz trägt den Sub-Step

`step` ist der fortlaufende Zähler aus `GameClock.subStep`, `timeMs` die Spielzeit zum Mitlesen. Die Spielzeit ist
eine Summe aus 16,667 ms und driftet im Float; der Schritt-Index tut das nicht. Ein Replay als Neu-Simulation
(Stufe 2 in [BALANCING_PLAN.md](BALANCING_PLAN.md), Abschnitt 5) braucht den Schritt, nicht die Zeit.

### Der Kopf

```json
{"kind":"head","format":2,"runId":"2026-09-20T13-40-12-345Z-devworld","startedAt":"2026-09-20T13:40:12.345Z",
 "gameVersion":"v0.3.2","commit":"d227323b-dirty","configHash":"3f2a91c7","seed":2748193746,
 "player":"bot","botSkill":"strategist","map":"devworld"}
```

- **`commit`** kommt aus `public/build-info.json`, das `tools/build-info.mjs` vor `npm run build` und `npm start`
  aus git schreibt. Ohne git steht dort `unknown`; das Log behauptet dann nichts.
- **`configHash`** ist ein fnv1a über alle balance-relevanten Configs (Tower, Gegner, Balance, Kampagne, Templates,
  Forschung, Fähigkeiten, Held, Boss-Varianten, Schadensmatrix). Die Auswertung gruppiert danach und warnt bei
  gemischten Ständen. Er deckt die Tabellen ab, nicht den Code; dafür steht der Commit daneben.
- **`seed`** ist der Lauf-Seed aus `GameRng` (Phase 1c).

### Ein Wellenblock

Ein Block läuft **vom Ende der letzten Welle bis zum Ende der nächsten**. Die Aufbauphase gehört also zu der Welle,
die sie vorbereitet: Dort gibt der Spieler aus, und ein Block, der erst bei `wave:started` begann, verlor jede
dieser Buchungen.

Er enthält Gold zu Start und Ende, Einnahmen und Ausgaben je Quelle, die Ausgaben je Tower-Typ, die Aufteilung
des Abschlussgolds, die Entscheidung des Directors mit Begründung, Zusammensetzung, Kills nach Verursacher,
Lecks, HQ-HP vorher und nachher, je Tower Typ, Stufen, Schaden und Kills, und die Dauer.

Die Welle, in der die Basis fällt, bekommt ihren Block ebenfalls: `wave:completed` kommt dort nie, deshalb schreibt
`flushOpenWave()` ihn beim Game Over.

### Ausgaben je Tower-Typ

`spending` sagt, wofür das Gold war, nicht, worauf. `towerSpending` schließt die Lücke: Bau- und Upgrade-Preis je
Tower-Typ, brutto, so wie `spending` die Erstattung eines Verkaufs als Einnahme verbucht und nicht abzieht. Das
ist der Nenner von **Schaden je Gold je Typ**, und die entscheidet, ob ein Typ stark ist oder nur oft gewählt
wird (`BALANCING_PLAN.md`, 3b): Ein Anteil am Schaden sagt nichts, solange der Anteil am Gold unbekannt ist.

Das kostenlose Max-Upgrade aus dem Dev-Menü steht nicht drin, genau wie es nicht in `spending` steht.

Gegner leben über die Naht hinweg. Ein Block hält deshalb beides fest: `enemiesAtStart`, was zu Blockbeginn noch
stand, und `enemiesAlive`, was am Ende übrig ist. Was die letzte Welle übrig ließ, stirbt in dieser.

Gezählt wird über `EnemyManager.getAliveCount()`, nicht über die Länge der Gegnerliste: Ein Gegner in seiner
Sterbeanimation steht noch in der Liste, obwohl er längst als Kill gebucht ist, und die Welle zählte ihn doppelt.

Ist der Lauf geschlossen, bleibt er lesbar, bis der nächste öffnet. Das Game Over erreicht zwei Zuhörer: Das Log
schließt den Lauf, die Bot-Session schickt den Rest an den Server. Wer zweiter war, fand früher einen leeren
Sammler vor, und jedem Bot-Lauf auf dem Server fehlten seine letzte Welle und sein Ende.

### Die Abgleiche

Jeder Block prüft sich selbst (`reconcileWave`). Was nicht aufgeht, steht als `mismatches` **im Block**, statt eine
Ausnahme zu werfen: Ein Lauf mit einem Loch in der Buchführung ist trotzdem brauchbar, und das Loch ist genau das,
was die Auswertung sehen muss.

| Prüfung | Regel |
|---|---|
| Gold | Startgold plus Einnahmen minus Ausgaben ist das Endgold |
| Körper | was zu Beginn stand plus gespawnt ist getötet plus geleckt plus noch lebend |
| Tower | die Kills der Tower übersteigen nicht die Tower-Kills der Welle |

## 3. Woher die Daten kommen

Das Log rechnet nichts selbst nach, es liest Ereignisse. Dafür wurden in Phase 2a einige erweitert:

| Ereignis | Neu |
|---|---|
| `credits:changed` | `source`: Kill, Abschlussgold, Bau, Upgrade, Verkauf, Forschung, Erstattung, Held, Cheat, Sprung, Reset |
| `enemy:died` | `killedBy`: Tower (mit Id), Held, Fähigkeit, Debug oder niemand |
| `tower:upgraded` | `upgradeId`, also welcher Zweig |
| `wave:completed` | `credits` mit dem echten Betrag und `creditsBreakdown` mit den Teilen |

Tempo und Pause sind Store-Signale, keine Ereignisse; das Log folgt ihnen per Effect. Das Anheuern des Helden liest
es aus `hero:state-changed`, den Boss-Spawn aus `enemy:spawned`.

Der Schaden je Tower ist die Differenz der Zähler auf dem Tower (`CombatComponent.damageDealt`, `kills`) zwischen
Blockbeginn und Blockende. Ein verkaufter Tower behält die Zahlen vom Moment des Verkaufs.

## 4. Was es kostet

Ein paar Zähler je Ereignis, eine Stichprobe je Sekunde Spielzeit und ein Durchlauf über die Tower am Wellenende.
Nichts je Treffer, nichts je Sub-Step. Die Stichprobe liest die Gesamt-DPS über `calculateTotalDPS`, eine Schleife
über die Tower; bei 1 Hz fällt das nicht ins Gewicht.

## 5. Wo die Läufe liegen

- **Browser:** die letzten 20 Läufe in IndexedDB (`3dtd-run-logs`), fortgeschrieben nach jeder Welle. Ein
  geschlossener Tab verliert höchstens die laufende Welle. Kein `beforeunload`-Haken.
- **Desktop:** zusätzlich als Datei in `%APPDATA%/3DTD/runs/`, geschrieben über die Preload-Funktion `saveRun`.
  Der Dateiname wird im Hauptprozess bereinigt, die Seite erfährt keinen Pfad.
- **Export:** Knopf im Game-Over-Bildschirm ("Save the run") und die Liste "Runs" in der Sidebar, beides als
  Download.
- **Kein Upload** (Entscheidung D6). Wer seinen Lauf teilen will, schickt die Datei.

## 6. Dateien

| Datei | Zweck |
|---|---|
| `run-log/run-log.types.ts` | Datensätze, Format-Version, `reconcileWave` |
| `run-log/run-log.service.ts` | der Sammler: hört am Bus, stempelt, schreibt Blöcke |
| `run-log/run-log.facade.ts` | der Sammler im Spiel: öffnet, speichert, schließt |
| `run-log/run-log.store.ts` | IndexedDB, die letzten 20 Läufe |
| `run-log/run-log.export.ts` | JSONL schreiben und lesen, Download |
| `run-log/run-summary.ts` | die Zahlen des Game-Over-Bildschirms, aus dem Log gefaltet |
| `run-log/config-hash.ts` | der Hash über die Balance-Configs |
| `run-log/build-commit.ts` | der Commit aus `build-info.json` |
| `tools/build-info.mjs` | schreibt `public/build-info.json` vor Build und Start |
| `components/runs-dialog/` | die Liste der gespeicherten Läufe |

## 7. Offen

- Der Korridor-Fingerprint steht im Kopf als optionales Feld, wird aber noch nicht gefüllt.
- Läufe aus Format 1 haben `towerSpending` nicht. `bot-server/analysis/run_reader.py` summiert für sie die Bau-
  und Upgrade-Ereignisse; der Zweig kann weg, sobald keine Format-1-Läufe mehr ausgewertet werden.
