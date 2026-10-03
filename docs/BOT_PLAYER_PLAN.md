# Bot-Spieler: Plan für einen menschenähnlichen Bot

**Stand:** 2026-10-03, entschieden (P1 bis P6), B1 gebaut
**Code heute:** `src/app/bots/`, Beschreibung in [BOT_SYSTEM.md](BOT_SYSTEM.md)

## Ziel

Ein Bot, der spielt wie ein Mensch: sieht, was ein Spieler sieht, entscheidet nach Nutzen statt nach fester
Reihenfolge, nutzt die Werkzeuge des Spiels und lernt innerhalb eines Laufs aus Lecks. Er dient allen vier Zwecken:

- **Mitspieler im Coop:** besetzt einen Platz, hält seine Spur, hilft dem Partner.
- **Messgegner:** Bot-Läufe sollen wieder etwas über menschliche Spieler sagen.
- **Stufen:** ein Kern, darüber Profile (Anfänger, Normal, Könner), gegen echte Run-Logs kalibriert.
- **Showcase:** stark und sehenswert, für Videos, Demo im Menü, später Versus.

## Befund: was der Bot heute nicht kann

**Sieht nicht, was ein Mensch sieht**

- **Sichtlinien:** Die Platzierung (`StrategicPlacementService`) bewertet Pfadlage (U-Gewicht), Abdeckung und
  Abstand zur Straße. Ob Gebäude die Sicht verdecken, prüft sie nicht. Der Mensch nutzt dafür die LOS-Vorschau beim
  Bauen. Auf echten Karten steht der Bot damit oft hinter Fassaden.
- **Kommende Welle:** Außer einem Luft-Zuschlag in der Forschung liest er das Wellen-Panel nicht (Arten, Rüstung,
  Luft, Bosse).
- **Lecks und Leistung:** Wo Gegner durchkommen und welcher Tower nichts tötet, fließt in keine Entscheidung ein.

**Nutzt Werkzeuge nicht:** Zielwahl (`set-targeting`), Feuerpause, Tower bemannen, Forschungs-Warteschlange. Verkauf
nur für unaufgerüstete Archer ab 2000 Gold.

**Entscheidet grob:** Die erste Strategie in der Prioritätsliste, die kann, gewinnt. Kein Abwägen zwischen Upgrade,
neuem Tower und Sparen. Upgrades abwechselnd an Spawn- und HQ-Ende statt beim Tower, der trägt oder an der Leckstelle
steht. Feste Prozente (70 % Upgrade, 30/70 Sparen), fester Tower-Deckel (10 und 40), Wellenstart nach Timer.

**Neues fehlt:** Camo (E100), Tower-Pfade (E101), Bauzeit (E104) kennt er nicht; im Coop schickt er kein Gold.

## Aufbau

Vier Schichten, die bestehenden Strategien werden umgebaut, nicht daneben gestellt.

```
Wahrnehmung (BotView)        was ein Spieler sieht: Gold, HP, Wellen-Panel, Lecks, Tower-Leistung, Sichtlinie
  └─ Vorschläge              jede Strategie liefert Kandidaten mit geschätztem Nutzen statt "ich darf zuerst"
       └─ Abwägung           ein Schiedsrichter wählt nach Nutzen je Gold, mit Sparziel
            └─ Profil        Reaktionszeit, Aktionen je Minute, Aufmerksamkeit, Fehler, Wissen
```

### 1. Wahrnehmung

- **Wellen-Panel:** Arten, Rüstung, Luftanteil, Bosse der nächsten Welle, dieselben Daten wie die UI.
- **Leckkarte:** je Welle, wo Gegner sterben und wo sie durchkommen (Pfadfortschritt beim Tod, Lecks aus dem Run-Log).
- **Tower-Leistung:** Schaden und Kills je Tower über die letzten Wellen.
- **Sichtlinie für Kandidaten:** die besten N Bauplätze bekommen eine echte LOS-Probe über den `TowerShadowMapper`
  (wie die Bauvorschau), Ergebnis: sichtbare Routen-Meter Boden und Luft, gewichtet nach Pfadlage. Kosten je Probe:
  sechs Würfelflächen, deshalb nur wenige Kandidaten je Entscheidung und ein Cache je Rasterpunkt.

### 2. Vorschläge mit Nutzen

Jede Strategie gibt keine Aktion mehr, sondern Kandidaten mit Kosten und Nutzen. Nutzen in einer Einheit:
**effektiver Schaden gegen die erwartete nächste Welle an den Stellen, die sie erreicht**, plus Zuschläge für
Lückenschluss (Luft, Ethereal, Camo, Splash). Grundlage sind die vorhandenen Helfer (`computeTowerDPSFromLevels`,
`getTowerValueVsArmor`, `damageMetres`).

- **Bauen:** Typ mal Platz, Platz mit sichtbaren Metern statt nur Pfadnähe.
- **Upgrade:** Tower mit hohem Anteil an Kills oder an der Leckstelle zuerst.
- **Verkaufen und Umbauen:** Tower ohne Sicht oder ohne Kills über mehrere Wellen.
- **Forschung:** wie heute adaptiv, aber gegen das Wellen-Panel und die Leckkarte.
- **Zielwahl:** Bosse auf "stärkster", Schwärme auf "erster".
- **Fähigkeiten und Held:** wie heute, sie sind schon gut.
- **Coop:** Gold an den Partner, wenn er leckt oder knapp ist und man selbst übrig hat; bereit erst, wenn das eigene
  Gold verplant ist.

### 3. Abwägung

Ein Schiedsrichter ersetzt die Prioritätsliste: höchster Nutzen je Gold gewinnt. Ist der beste Kandidat noch zu teuer,
wird er **Sparziel**, kleine Käufe dürfen es nur unterbieten, wenn sie die nächste Welle sicherer machen. Wellenstart,
wenn das Gold verplant ist oder nichts Sinnvolles mehr geht. Lebenswichtiges (HP niedrig, Luftwelle ohne Abwehr)
schlägt alles.

### 4. Profile

Der Kern spielt so gut er kann; das Profil macht ihn menschlich:

| Regler | Wirkung |
|---|---|
| Reaktionszeit | Spielzeit zwischen Entscheidungen |
| Aktionen je Minute | Deckel, auch im schnellen Tempo |
| Aufmerksamkeit | sieht Leckkarte und Wellen-Panel nur mit einer Wahrscheinlichkeit |
| Rauschen | Nutzen mit Streuung, wählt nicht immer den besten |
| Wissen | welche Werkzeuge er kennt (Zielwahl, Verkaufen, LOS-Probe, Forschungsplan) |

Kalibriert gegen echte Run-Logs (`tmp/runs/`, Replay W1 bis W60 Binswangen): Tower je Welle, Gold auf dem Konto,
Verhältnis Bauen zu Upgrade, Zeitpunkt der Forschung, Verkäufe. Ein Werkzeug vergleicht Bot-Lauf und Mensch-Lauf in
diesen Zahlen.

## Pakete

| Paket | Inhalt | Prüfung |
|---|---|---|
| B1 | Wahrnehmung: Wellen-Panel, Leckkarte, Tower-Leistung im Snapshot | Specs |
| B2 | LOS-Probe für Bauplätze, Cache, Bewertung nach sichtbaren Metern | Spec mit Kulisse, DevWorld im Browser |
| B3 | Nutzen-Vorschläge und Schiedsrichter, Strategien umgebaut, Prioritätsliste entfernt | Specs, Kurzlauf DevWorld |
| B4 | Neue Werkzeuge: Zielwahl, Verkaufen und Umbauen, Forschungs-Warteschlange | Specs |
| B5 | Profile und Vergleichswerkzeug Bot gegen Mensch | Vergleich gegen Run-Logs |
| B6 | Coop-Partner: Gold senden, bereit nach eigenem Urteil | DevWorld zu zweit |
| B7 | Neue Mechaniken, sobald gebaut: Camo, Tower-Pfade, Bauzeit | je Mechanik |

## Stand der Pakete

**B1 Wahrnehmung (gebaut 2026-10-03):** `bots/perception/bot-perception.ts`, gelesen über `BotWorld.perception`.
Die Session speist sie aus dem Bus (`wave:started`, `enemy:died`, `enemy:leaking`, `enemy:reached-base`,
`wave:completed`), auch wenn der Bot nicht spielt. Sie merkt sich die letzten drei Wellen: Kills je Zehntel der Route,
Lecks je Route, geleckte HP nach Rüstung, Luftlecks, und je Tower Kills und Schaden pro Welle. `leakingRoutes()` nennt
die Routen mit Lecks und ab wo vor dem HQ die Kills ausdünnen. Die kommenden Wellen liest `BotWorld.peekWaves` wie das
Wellen-Panel (`WaveDirector.peek`). Im Coop nur die eigenen Spuren. Noch liest keine Strategie davon; das kommt mit B3.

## Entscheidungen

Alle sechs am 2026-10-03 per Einzelfrage entschieden.

- **P1 Entschieden (User, 2026-10-03):** Nutzen-Schiedsrichter. Alle Strategien liefern Vorschläge mit Nutzen und
  Kosten, die Prioritätsliste fällt weg; Notfälle haben Vorrang. Ein Planer über mehrere Wellen kann später darauf
  aufsetzen.
- **P2 Entschieden (User, 2026-10-03):** GPU-Probe über den `TowerShadowMapper` für die besten 3 bis 5 Plätze je
  Entscheidung, Cache je Rasterpunkt. Keine CPU-Näherung.
- **P3 Entschieden (User, 2026-10-03):** Profile mit menschlichen Grenzen: Wissen, Tempo, Aktionen je Minute,
  Aufmerksamkeit, Streuung. Zufall nur aus dem `bot`-Strom des Laufs (`BotWorld.rng`), damit Läufe reproduzierbar
  bleiben.
- **P4 Entschieden (User, 2026-10-03):** drei Profile, `beginner`, `normal`, `expert`. Der Könner wird gegen die
  Läufe des Users kalibriert (Run-Logs und Replay W1 bis W60 in `tmp/runs/`), Normal und Anfänger abgeleitet (weniger
  Wissen, langsamer, mehr Streuung); nachjustiert, sobald Läufe anderer Spieler da sind.
- **P5 Entschieden (User, 2026-10-03):** Der Coop-Bot schickt Gold an einen Partner, der leckt oder knapp ist, wenn er
  selbst übrig hat, und meldet sich erst bereit, wenn sein Gold verplant ist. Keine Absprache der Fähigkeiten, kein
  Bauen an fremden Spuren.
- **P6 Entschieden (User, 2026-10-03):** Sehen zuerst, Reihenfolge B1 bis B7 wie in der Tabelle.
