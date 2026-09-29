# Laufplan: ein Weg für alle Wellen

**Stand:** 2026-09-29, gebaut: der Budget-Source ist der Standard, der adaptive Director ist entfernt
(Abschnitt 13, [WAVE_SOURCE_PLAN.md](WAVE_SOURCE_PLAN.md), Abschnitt 18). Die Abschnitte 1 bis 12 sind das
Konzept vom 2026-09-28.

Verwandt: [WAVE_SOURCE_PLAN.md](WAVE_SOURCE_PLAN.md) (Quellen, Vertrag), [WAVE_DIRECTOR.md](WAVE_DIRECTOR.md)
(adaptiver Director, archiviert), [WAVE_SYSTEM.md](WAVE_SYSTEM.md) (Boss-Wellen), TODO E54, E67.

## 1. Anlass

Skarnax war nach der Kampagne mal zu hart, mal zu leicht, und keine Zahl stellt ihn direkt ein. Seine Stärke hängt
an einer Golem-Welle, die der Director plant und die nie gespielt wird. Gewünscht (User, 2026-09-28): den Verlauf
über den ganzen Lauf fest planen, Boss-Wellen mit eigener, einstellbarer Stärke, ein einheitlicher Weg für alle
Wellen. Die Anpassung an die Abwehr bleibt; der Tabellen-Source passt nicht, er ist komplett fest.

## 2. Heute: drei Wege zu einer Welle

| Wellen | Was kommt | Wie groß und zäh |
|---|---|---|
| W1 bis W30 außer Boss | Template fest aus der Kampagne (`campaign.config.ts`) | Director: Deckel, DPS-Rampe, Intensität der Kampagne, Druck-Regler |
| W10 | Herbert-Template, fest | wie oben, ein Herbert plus Begleiter |
| W20, W30 | Ooze bzw. Skarnax **ersetzt** eine geplante Herbert-Welle | Gesamt-HP der geplanten Herbert-Welle |
| ab W31 außer Boss | Director wählt das Template selbst (Kandidaten, Abklingzeit, Tie-Break) | Director, dazu Endgame-HP `1 + 0,05 · (W − 20)`, höchstens ×4 |
| W40, W50, … | Director wählt ein Boss-Template (Herbert, Golem, Drache) | Director |
| W35, W55, … / W45, W65, … | Skarnax bzw. Ooze **ersetzt** das geplante Boss-Template | seit `a06cb4bc` Gesamt-HP der geplanten Welle, vorher deren Faktor je Segment |

Folgen:
- Die Stärke der Varianten ist eine Nebenwirkung. Im Referenzlauf ging W35 durch die Normierung von ×17,6 auf ×1,16
  je Segment; in 140 Bot-Läufen verlor der Bot in 48 von 51 Wellen 35 keine HP (vorher im Median 85 bis 101).
- Boss-Varianten laufen am Deckel vorbei (ihre Größe ist fest), die Templates nicht.
- Ab W31 steht nirgends, was kommt. Die Vorschau kennt es erst, wenn der Director geplant hat.

## 3. Grundsatz (User, 2026-09-28)

- Der Director bleibt adaptiv: Er reagiert auf die Stärke der Abwehr und den HP-Verlust.
- Ein Grundprinzip für jede Welle, Boss oder nicht. Keine Welle wird durch eine andere ersetzt, keine Sonderregel für
  einzelne Wellen oder Gegner. Jede Sonderregel ist ein Zeichen, dass das Prinzip nicht trägt.
- Der Tabellen-Source ist nicht das Ziel (komplett fest).
- Überblick zurückgewinnen (User): Die Planung soll so klein sein, dass eine Seite beschreibt, was sie tut, und
  jede Regel darauf steht. Heute weiß niemand mehr genau, was die Logik alles macht. Maßstab für den Umbau: Was sich
  nicht in diese eine Seite fügt, fällt weg oder wird Teil des Prinzips.

## 4. Vorschlag: ein Laufplan, der Director regelt darin

Ein Plan über den ganzen Lauf, eine Zeile je Welle, im Stil der Kampagne:
- **Was:** ein Template oder ein Boss. Bosse sind Zeilen wie alle anderen, nichts ersetzt mehr eine andere Welle.
- **Wie stark gedacht:** eine Soll-Stärke je Zeile. Für Bosse die einstellbare Zahl, die heute fehlt.
- **Wie viel Gold:** wie heute in der Kampagne.
- **Danach:** eine Regel statt einer endlosen Liste (zum Beispiel ab Welle X den Abschnitt wiederholen, Stärke je
  Runde mal einen Faktor).

Der Director bleibt und macht in jeder Welle dasselbe: Er misst die Abwehr und passt Anzahl und HP an, aber nur in
einem Band um die Soll-Stärke. Damit gibt es einen Weg für alle Wellen: Zeile lesen, anpassen, ausliefern.

Was wegfällt: die Rotation der Boss-Varianten, das Ersetzen einer geplanten Welle, die freie Template-Wahl ab W31
(oder sie bleibt als Werkzeug, um die Zeilen einmalig vorzuschlagen). Was bleibt: Deckel, DPS-Rampe, Druck-Regler,
Run-Log, Vorschau (sie kann jetzt jede Welle vorher nennen).

## 5. Entscheidungen (User, 2026-09-28, Entscheidungsseite)

| Frage | Entscheidung |
|---|---|
| Grundmodell | **Budget je Welle prüfen** (Vorbild Risk of Rain 2): Budget aus einer stetigen Kurve, verschoben vom Regler; jeder Gegner kostet nach seiner Zähigkeit, ein Boss ist nur teuer; der Deckel bleibt die Grenze. Ausarbeiten und gegen den Referenzlauf nachrechnen. |
| Was nach Welle 30 kommt | Plan-Zeilen bis Welle 60, danach läuft ein Abschnitt erneut, je Runde stärker gedacht. |
| Stärke einer Plan-Zeile | Faktor auf die Spannungskurve: 1 normal, 0,5 Atempause, 1,5 fordernd; für jede Zeile gleich gemeint, Boss oder nicht. |
| Boss-Wellen | Genau wie jede Welle: Deckel und Regler bemessen um die gedachte Stärke. |
| Spielraum des Reglers | Etwa halb bis doppelt um die gedachte Stärke. |
| Luft oder Geister ohne passende Abwehr | Plan hat Vorrang, der Deckel hält sie überlebbar, die Vorschau warnt eine Welle vorher. |
| Drei Kurven nach Wellennummer | Auf eine zurückführen (die Spannungskurve); vorher nachrechnen, dass der Verlauf gleich bleibt. |
| Skarnax fordernder | Nach dem Umbau, eigenes Konzept (E67). |
| Bestandsliste | Vorschläge gelten, wo nicht umgeklickt (Abschnitt 7). |
| Weiter | Konzept ausarbeiten, User liest, dann Umbau in Schritten mit Referenzlauf und Bot-Messung je Schritt. |
| Was aus dem Plan kommt | Die Anzahl; die HP füllen das Budget. Ein Schwarm bleibt ein Schwarm, ein Boss bleibt einer. |
| Budget-Kurve bei Stärke 1 | Heutiger Median als Start, dann per Bot-Messung justieren. |

Nicht Teil davon: der Tabellen-Source bleibt, wie er ist.

## 6. Ideen des Users (2026-09-28, aus der Entscheidungsseite)

- **Spawn-Abstand als Gestaltungsmittel:** Der Abstand entscheidet mit, ob etwas tötbar ist. Ein Zombie-Schwarm mit
  30 bis 100 ms ist etwas ganz anderes als heute und macht Laune. Offen: wie das sinnvoll ins Prinzip kommt.
- **Golems brauchen deutlich mehr Abstand** als heute (Vorlage 600 ms, Typ 1200 ms).
- **180 s Höchstdauer ist fraglich:** Sie arbeitet gegen einen sinnvollen Abstand, der eine Welle ausmachen kann, und
  der Tausch „weniger Gegner, mehr HP“ ändert mühsam Designtes. Beide Regeln auf „prüfen“.
- **DPS-Rampe:** Irgendwas muss aus einer Liste kommen; die Frage ist, ob Anzahl oder HP.
- **Vorschau:** Dass sie nach Welle 30 nichts weiß, ist eine Folge der freien Wahl; mit Plan kennt sie jede Welle.

## 7. Bestand der Sonderregeln und was aus ihnen wird

Erhoben 2026-09-28 (42 Regeln, Einzelheiten und Fundstellen auf der Entscheidungsseite). Stand nach den Klicks des
Users; „prüfen“ heißt erst messen oder besprechen.

- **Fällt weg:** Mindestwelle je Vorlage, Rückfälle auf Boss-Wellen, Abklingzeit und Wiederholungsverbot, Herbert
  genau einmal, Welle 20/30 tauschen Herbert, Boss-Rotation, Variante ersetzt geplante Welle, Wurm zählt mit voller
  Länge, Golem-Vorlagen mit 600 ms, Endgame-HP, ungültige Vorlage, Anti-Windup nach Varianten, Vorlagenwahl nach
  Reglerzustand.
- **Geht im Prinzip auf:** Kampagne legt die Vorlage fest (wird der Plan), Boss-Takt (Plan-Zeilen), Vorschau (kennt
  jede Welle), Kampagnen-Intensität (wird die gedachte Stärke je Zeile).
- **Prüfen:** Schwierigkeitsrampe bis W60, Kill-Realismus mit Sprung bei W10, Leckschaden-Sprung bei W31/W61,
  Luft und Geister nur mit Abwehr (entschieden: Plan hat Vorrang), DPS-Rampe, Band des Reglers (entschieden: halb bis
  doppelt), Höchstdauer 180 s, Tausch weniger Gegner mehr HP, Ausreißer gedeckelt.
- **Bleibt:** Spannungskurve des Reglers, Planung am Ende der Vorwelle, Luft gegen eigenen Schaden, Untergrenze beim
  Boden-Matchup, Splitter mit ganzem Baum, Leckkosten je Typ, Spawn-Mindestabstand je Typ, Coop je Spur, mindestens
  5 Gegner, immer 1 HP Leck, Deckel durch Dauer begrenzt, Deckel unter dem Vorlagen-Minimum, Aufwärmen, geschummelte
  Wellen, Anti-Windup, Neustart je Lauf.

Stand nach dem Entfernen des adaptiven Directors (2026-09-29):
- **Weg** (mit dem Code): alle 13 aus „Fällt weg“ außer dem Wurm mit voller Länge; die 4 aus „Geht im Prinzip
  auf“ (jetzt Laufplan und Stärke je Zeile); aus „Prüfen“ Schwierigkeitsrampe, Kill-Realismus mit Sprung (das
  Budget rechnet mit einem Wert, `BUDGET_REALISM`), Luft und Geister nur mit Abwehr, DPS-Rampe, Tausch weniger
  Gegner mehr HP; aus „Bleibt“ die Untergrenze beim Boden-Matchup (das Budget liest die reine Matrix),
  mindestens 5 Gegner und der Deckel unter dem Vorlagen-Minimum (beides Teil des alten Deckels).
- **Bleibt** im Budget-Source oder geteilt: Wurm mit voller Länge (`enemyHp`), Band des Reglers (halb bis
  doppelt), Ausreißer gedeckelt, Spannungskurve, Planung am Ende der Vorwelle, Luft gegen eigenen Schaden,
  Splitter mit ganzem Baum, Leckkosten je Typ, Spawn-Mindestabstand je Typ, Coop je Spur, immer 1 HP Leck,
  Deckel durch die Dauer der Welle, Aufwärmen, geschummelte Wellen, Anti-Windup, Neustart je Lauf.
- **Nur noch im Tabellen-Source:** der Leckschaden-Sprung bei W31/W61 (dort unverändert) und die Höchstdauer
  von 180 s als Prüfung der Zeilen; das Budget kennt beide nicht mehr.

## 8. Nachgerechnet: was eine Welle heute kostet

Referenzlauf W1 bis W60 gegen seine künstliche Abwehr (Schaden `120 + 90 · (W − 1)`, Rüstung abgestuft), je Welle die
Sekunden Abwehr-Schaden für alle HP (Skript `tmp/nightly-2026-09-28/budget-probe.tmp.spec.ts`, nicht im Repo):
- Innerhalb von zehn Wellen kostet die teuerste normale Welle das 3- bis 55-Fache der billigsten (W2 0,6 s, W18 262 s).
- Bosse sind nie die Spitzen: W20 Ooze 39 s gegen W18 262 s, W35 Skarnax 50 s gegen W32 309 s.
- Gleitender Median: rund 14 s bei W1, 55 bis 62 s von W11 bis W30, rund 100 s bei W60.
- Grenzen: künstliche Abwehr, Luft so stark wie Boden, Lecks und Laufzeit nicht drin; ein Teil der Spreizung ist
  gewollt (Konter).

## 9. Budget-Modell (Entwurf, noch nicht gebaut)

Für jede Welle N dieselben Schritte:

1. **Plan-Zeile:** Vorlage (Gegnermischung), Anzahl je Gegnertyp, Stärke k (1 normal, 0,5 Atempause, 1,5 fordernd),
   Gold. Ein Boss ist eine Zeile mit einem Boss und optional Begleitern.
2. **Budget** in Sekunden Abwehr-Schaden: `B = S(N) · k · R`.
   - `S(N)` eine stetige Kurve, Start beim heutigen Median, etwa `15 + 85 · (1 − e^(−(N−1)/15))` Sekunden.
   - `R` der Druck-Regler, zwischen 0,5 und 2, aus dem HP-Verlust der letzten Wellen gegen die Spannungskurve.
3. **Abwehr messen:** Schaden je Sekunde gegen jede Rüstung, Boden und Luft getrennt (wie heute).
4. **HP verteilen:** ein gemeinsamer HP-Faktor für die ganze Welle, so dass alle Gegner zusammen `B` Sekunden kosten:
   `hpMult = B / Σ (Anzahl_t · HP_t / Schaden gegen t)`.
5. **Grenze:** der Deckel begrenzt `B` auf das, was die Abwehr in der Laufzeit der Welle plus erlaubtem Leck schafft.
6. **Physik:** Spawn-Abstände je Gegnertyp (Idee des Users: auch aus der Plan-Zeile, zum Beispiel 30 bis 100 ms für
   einen Zombie-Schwarm), dann ausliefern; die Vorschau kennt jede Welle.

Damit fallen weg: Endgame-HP, Schwierigkeitsrampe, DPS-Rampe (geht in `S` und `R` auf), Kampagnen-Intensität (wird
`k`), alle Boss-Sonderwege.

Entschieden (User, 2026-09-28):
- **Leckschaden** wächst stetig mit der Budget-Kurve, ohne Sprünge; wie stark, per Bot-Messung.
- **Spawn-Abstände:** Standard je Gegnertyp, eine Plan-Zeile darf ihn für ihre Welle überschreiben; der Deckel
  rechnet mit dem echten Abstand.
- **Höchstdauer 180 s fällt weg.** Eine Welle dauert, was Anzahl mal Abstand ergibt; der Deckel rechnet mit der
  echten Dauer, die Plan-Zeile ist dafür verantwortlich.
- **Coop:** jede Spur bekommt die ganze Zeile, mit eigenem Budget gegen die Abwehr an dieser Spur.
- **Nachrechnen jetzt,** vor dem Bau: den Referenzlauf mit dem Modell durchspielen und gegen heute zeigen.

## 10. Durchgerechnet: Budget-Modell gegen heute (Rechenwerte, keine Bot-Messung)

Referenzlauf W1 bis W60 mit Anzahl und Spawn-Abständen der heutigen Folge, `k = 1` (W24 bis W27 mit der heutigen
Intensität), `R = 1`, Deckel = Spawn-Dauer plus Zeit unter Feuer ohne erlaubtes Leck (Skript
`tmp/nightly-2026-09-28/budget-sim.tmp.spec.ts`, nicht im Repo):
- Normale Wellen liegen enger: innerhalb von zehn Wellen das 1,2- bis 4,2-Fache statt heute 3- bis 55-Fache.
- Der Deckel greift auf 34 von 60 Wellen, darunter alle neun Boss-Wellen: die heutigen Anzahlen und Abstände sind
  für die Kurve oft zu kurz.
- Einzelne Bosse bekommen nur die geschätzte Zeit unter Feuer (60 m durch Tempo), 13 bis 20 s gegen 90 s der
  Nachbarn. Das liegt an der Schätzung, nicht an einer Boss-Regel.
- Der HP-Faktor streut von 0,3 bis 63; Rattenwellen mit 1200 Ratten bekommen 55 bis 63 (heute 19 bis 25).

Entschieden (User, 2026-09-28):
- **Welle zu kurz für ihr Budget:** Plan-Zeilen werden passend gemacht (Anzahl und Abstände), das Skript prüft jede
  Zeile; der Deckel lässt wie heute einen bezahlten Teil als HP-Verlust durch und fängt sonst nur Fehler im Plan.
- **Zeit unter Feuer** wird aus der Route gemessen: Meter des Wegs in Reichweite der Tower durch das Tempo des
  Gegners, gleich für alle Wellen.

## 11. Entwurf des Laufplans W1 bis W60 (Rechenwerte)

Skript `tmp/nightly-2026-09-28/plan-draft.tmp.spec.ts` (nicht im Repo), gleiche künstliche Abwehr. Festlegungen des
Entwurfs, alle änderbar:
- Reihenfolge wie die heutige Testfolge; ein Boss alle zehn Wellen, ohne Wechsel bei W30 (Herbert, Ooze, Skarnax,
  Steingolem, Drachenflug, Skarnax); W35, W45, W55 werden normale Wellen.
- Stärke `k` 1, Boss-Zeilen 1,3, die Welle nach einem Boss 0,7; die Intensität W24 bis W27 entfällt.
- Abstände: Schwärme 100 ms, Golems doppelt so weit wie heute, sonst wie heute. Anzahl so, dass die Welle lange
  genug auf dem Weg ist, um ihr Budget abzuarbeiten.
- Zeit unter Feuer bis zur Messung aus der Route: 150 m durch das Tempo; Kill-Realismus einheitlich 0,9.
- Neu, für jeden Gegner in jeder Welle: kein Gegner bekommt mehr HP, als die Abwehr in seiner Zeit unter Feuer
  schafft (90 %). Wer daran stößt, bleibt dort, der Rest des Budgets geht an mehr Gegner der Zeile. Das ersetzt die
  Boss-Sonderwege.

Ergebnis: alle 60 Zeilen passen zu ihrem Budget. Schwärme werden größer und dichter, schwere Vorlagen kleiner und
zäher (W16 Chaos Wave 89 statt 267 Gegner, W15 Golem Squad 6 statt 33). Bosse tragen 21 bis 44 % des Budgets, den
Rest ihr Gefolge; Skarnax selbst bleibt bei HP-Faktor 0,5 bis 1,1. Ratten bekommen HP-Faktor 74 bis 84, weil die
Rechnung Schaden kennt, aber nicht die Schusszahl; das prüft erst die Bot-Messung. Nach W60 offen (Vorschlag: die
letzten zehn Zeilen wiederholen).

## 12. Trennung der Wellenquelle geprüft (2026-09-28)

Umgeschaltet wird an einer Stelle (`DEFAULT_WAVE_SOURCE` in `configs/director.config.ts`, dazu das Debug-Fenster),
jede Quelle hat ihren Ordner unter `director/sources/`. Außerhalb der Quellen lesen aber noch Stellen Regeln einer
bestimmten Quelle direkt nach der Wellennummer; bei einem Tausch liefen sie weiter nach der alten Logik:

| Stelle | liest direkt | gehört in |
|--------|--------------|-----------|
| `managers/enemy.manager.ts`, `managers/ooze-bodies.ts` | Leckschaden je Welle (`enemyBaseDamageForWave`) | geplante Welle |
| `managers/game-state/wave-preview.ts`, `wave-panel/upcoming-waves.ts` | Leckschaden je Welle | Vorschau der Quelle |
| `managers/enemy.manager.ts`, `services/economy.service.ts` | Gold je Welle (`waveGold`) | geplante Welle |
| `game-engine/background-music.service.ts` | Boss-Welle (`isBossWave`) | geplante Welle |
| `wave-panel/wave-alert.ts` | Luftwarnung aus der Kampagnen-Vorlage | Vorschau der Quelle (Luft und ätherisch) |
| `director/state-snapshot-parts.ts` | kommende Gegner aus der Kampagnen-Vorlage | Vorschau der Quelle |
| `bots/strategies/research/research-pick.strategy.ts` | kommende Luftwelle aus der Kampagne | Vorschau der Quelle |
| `debug-window/wave-debugger.component.ts` | Name der Sprungwelle aus Kampagne und Boss-Varianten | Vorschau der Quelle |
| `run-log/config-hash.ts` | Kampagne, Vorlagen, Boss-Varianten im Hash | Hash der aktiven Quelle |
| `bots/bot-session.ts`, `run-log/run-log.facade.ts` | Stellschrauben des adaptiven Directors | nur, wenn die Quelle welche hat |

Sauber geteilt sind `director/defense-analyzer.ts` (Abwehr messen, von allen genutzt) und der Vertrag selbst.

Geschlossen am 2026-09-28 (WAVE_SOURCE_PLAN.md, Abschnitt 17): die Stellen lesen jetzt `waveRules()` der aktiven
Quelle. Bleiben bewusst geteilt: der Konfigurations-Hash und die Stellschrauben des adaptiven Directors.

## 13. Stand des Baus (2026-09-28)

- Regeln je Welle über den Vertrag (Abschnitt 12), gebaut.
- Druck-Regler geteilt (`director/pressure-controller.ts`), Spielraum je Quelle; Budget-Quelle halb bis doppelt.
- Zeit unter Feuer aus der Route: `metersUnderFire` im Schnappschuss, gemessen mit der Sichtlinie der Tower,
  Boden und Luft getrennt, gemittelt über die Spuren.
- `sources/budget/`: `run-plan.json` (der Entwurf aus Abschnitt 11), `budget.ts` (die Schritte aus Abschnitt 9 mit
  Grenze je Gegner), `budget-source.ts`. Leckschaden wächst stetig mit der Kurve (`LEAK_GROWTH`), Boss-Gold nach dem
  Plan.
- 2026-09-29: Standard (`DEFAULT_WAVE_SOURCE = 'budget'`), der adaptive Source mit Templates, Kampagnen-Pins,
  Boss-Rotation und Endgame-HP entfernt; `table` bleibt, `?waves=table` schaltet einen Tab um.

## 14. Kalibrierung mit Bots (Nacht 2026-09-28/29, Bot-Werte)

Solo-Läufe in der DevWorld, Tempo 16, je Stand 3 bis 6 Läufe, verglichen mit 12 Läufen des adaptiven Directors
(Todeswelle 25 bis 42, HP nach W10/W20/W30: 353/277/223). Was sich dabei an der Rechnung geändert hat, jeweils für jeden
Gegner in jeder Welle:

| Befund der Bots | Änderung |
|---|---|
| Frühe Wellen kosteten 40 bis 60 HP, obwohl die HP schon bei 0,3 bis 0,9 lagen | Anzahl W2 bis W30 aus dem, was Bots unter dem adaptiven Director schaffen; Treffer-Anteil 0,6; Regler ab Welle 2 |
| Die Ooze kostete mit einem Durchbruch 91 HP | Ooze und Skarnax ohne Begleiter; wessen eines Leck mehr kostet als die Welle darf, bekommt ein Viertel des Schadens unter Feuer |
| 62 Mammuts mit HP-Faktor 4 bis 7 kosteten 133 bis 184 HP | Rechnung gegen die reine Schadenstabelle statt der Werte mit Mindestanteil gegen Festung |
| Zeit unter Feuer war die Vereinigung aller Strecken mal dem ganzen Schaden (Review) | Grenze je Gegner aus Schaden mal Strecke je Tower; das Zeitfenster der Welle aus der Vereinigung |
| Skarnax rechnete als ein Gegner mit 240 Segmenten, 0 HP Verlust in 17 Läufen | Jedes Segment ist ein Körper, das Zeitfenster enthält das Herauskommen der Kette |
| Dichte schnelle Schwärme leckten bei niedrigen HP | Versucht: Körper zugleich in Reichweite teilen sich das Feuer. Zurückgenommen, damit hing fast jeder Gegner an seiner Grenze, der Regler kam nicht mehr an, die Bots hatten bei W40 noch 456 HP |
| Welle 1 kostete im Coop 58 HP (geplant, bevor ein Tower steht) | Zeile 1 leichter; was die Abwehr nicht treffen kann, bekommt die Stärke der Zeile als HP-Faktor |

| Regler am Anschlag (doppelt) ab W23, dann kosteten die schlechtesten Paarungen 60 bis 210 HP | Regler halb bis 1,5 statt halb bis doppelt |
| Geister (W24, W35), Mammuts (W25), Spinnenschwarm (W6) blieben die teuersten Wellen, im Coop je Spur doppelt | Stärke dieser Zeilen 0,8; Welle 1 mit zehn Zombies |

Endstand mit dem neuen Bot (je 6 Solo-Läufe, Bot-Werte):

| | Todeswelle | HP nach W10/W20/W30 |
|---|---|---|
| Adaptiver Director | 30 bis 36 | 436/325/225 |
| Budget-Quelle | 37 bis 40 | 405/321/235 |

Coop zu zweit (Chromium gegen Firefox, 3 Räume je Stand): keine Abweichung zwischen den Browsern; Todeswelle vor der
letzten Anpassung 23, 34 und 35, der adaptive Director (alter Bot) 27 bis 41. Die Budget-Quelle ist damit bei den Bots
mindestens gleichauf; wie sie sich gegen einen Menschen anfühlt, zeigen erst dessen Läufe.

Der Bot baut seit 2026-09-28 erst aus, dann rüstet er auf (vier Tower und einer mehr je Welle, Obergrenze 20):
vorher standen bis W10 nur 3 bis 4 Tower.

## 15. Nächster Schritt

Spielen und messen: menschliche Läufe und Bot-Läufe mit dem Budget-Source als Standard, dann Laufplan,
`BUDGET_REALISM` und `LEAK_GROWTH` justieren.
