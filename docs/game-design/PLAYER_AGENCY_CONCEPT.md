# Spieler aktiver einbinden: Entscheidungen und Umsetzung

**Status:** Entschieden am 2026-09-12 (Abschnitt 7). Nuklearschlag gebaut am 2026-09-13 (Abschnitt 8), Held Stufe 1
am 2026-09-14 (Abschnitt 9). Frostbombe, EMP und Orbitallaser gebaut am 2026-09-14, beschrieben nur in
[ABILITIES.md](../ABILITIES.md). Was heute gilt, steht in [ABILITIES.md](../ABILITIES.md) und [HERO.md](../HERO.md);
die Tabellen in 8 und 9 halten fest, was beim Bau entschieden wurde.

Das Konzept davor (Abschnitte 0 bis 6: Kurzfassung, Ist-Stand vom 2026-09-11, Regelkreis, Varianten, Vergleich, MVP,
offene Entscheidungen) liegt in [archive/PLAYER_AGENCY_CONCEPT_2026-09-11.md](../archive/PLAYER_AGENCY_CONCEPT_2026-09-11.md).
Verweise wie "3.2", "Abschnitt 5" oder "6.1 b" meinen die Abschnitte dort; die Nummern sind geblieben.

---

## 7. Entscheidungen (2026-09-12)

Vom Nutzer über den Entscheidungsbogen getroffen (Kurzform
`1a · 2b · 3a · 4a · 5a · 6b · 7a · 8a · 9b · 10a`):

| Frage | Entscheidung |
|---|---|
| Name | **Nuklearschlag** |
| Regelkreis | Fähigkeits-Kills zählen für den Leck-Regler **als Leck**: der Einsatz rettet HP und Gold, die Wellengröße bleibt unberührt (6.1 b) |
| Nachladen | **1 Ladung, eine neue nach je 3 abgeschlossenen Wellen** (6.2) |
| Höchstens | **1 Ladung**, kein Horten |
| Wirkung | **60 % der Max-HP, Bosse 20 %**, matrixfrei (6.3) |
| Radius | **25 m** |
| Zielen | Klick, **1,5 s Vorwarnung** mit Zielmarker, Einschlag auf die **nächste Route-Zelle im Umkreis von 30 m**, sonst abgelehnt |
| Freischaltung | Forschung: 1.000 Gold, 40 s, Voraussetzung `advanced-weaponry`, damit voraussichtlich nach dem ersten Boss (W10); keine eigene Wellensperre. Die Forschungs-ID aus Abschnitt 5 (`orbital-strike`) folgt beim Bau dem Namen |
| Bots | **Sofort eine Bot-Strategie** (abweichend von der Empfehlung in 6.5): einsetzen, wenn viele Gegner im letzten Fünftel der Route stehen, mit neuer Bot-Aktion `use-ability`. Folge: sofern die Strategie in den bisherigen Bot-Konfigurationen aktiv ist, sind die bisherigen Baselines nicht mehr direkt vergleichbar |
| Danach | **Held** (Stufe 1, nur auf den Gegnerrouten, unverwundbar) |

Damit entspricht der MVP Abschnitt 5, ergänzt um die Bot-Strategie und die
Leck-Buchung der Fähigkeits-Kills im `GateController`.

---

## 8. Umsetzung (2026-09-13)

Gebaut wie in Abschnitt 7 entschieden; Aufbau, Ablauf und Dateien in
[ABILITIES.md](../ABILITIES.md). Beim Bau festgelegt, wo Abschnitt 5 und 7
nichts sagen:

| Punkt | Umsetzung |
|---|---|
| Forschungs-ID | `nuclear-strike` (Kategorie `global-perk`, Perk `nuclear-strike`); die Forschung gibt die erste Ladung |
| Einsatz | nur während einer Welle; außerhalb lehnt der Manager mit `no-wave` ab |
| Nachladen | die Welle des Einsatzes zählt mit (Einsatz in W12, wieder bereit ab W15); solange die Ladung steht, sammeln Wellen nichts an |
| Ladung | wird mit dem Befehl verbraucht. Stirbt der Rest der Welle in den 1,5 s, trifft der Einschlag niemanden |
| Bosse | `isBoss` beim Bau nur bei Herbert, heute auch bei Skarnax und der Ooze. Golem und Drache kommen auch in normalen Wellen vor, das Flag gilt pro Typ |
| Name im Spiel | "Nuclear Strike" (Knopf mit Symbol, Tooltip, Forschung) |
| Leck-Buchung im Training | das Backend-Gate zählt die Fähigkeits-Kills genauso (`gate_leak_share`), der Reward nicht |
| Bots | Strategie ab 10 Gegnern mit Pfadfortschritt ab 0,8. In allen Skill-Stufen eingehängt, erforscht wird die Fähigkeit nur von strategist und meta. Deren Baselines sind mit Läufen vor der Umsetzung nicht direkt vergleichbar, beginner und casual spielen unverändert |

Taste K schaltet den Zielmodus wie der Knopf. Nicht gebaut: Warnsirene, Pickups.
Weitere Fähigkeiten kamen am 2026-09-14 dazu: Frostbombe, EMP und Orbitallaser
mit den Tasten F, E und L ([ABILITIES.md](../ABILITIES.md)).

---

## 9. Umsetzung Held (2026-09-14)

Gebaut wie in 3.2 (Stufe 1) beschrieben; Aufbau, Zahlen und Dateien in
[HERO.md](../HERO.md). Vom Nutzer vorgegeben: moderner Söldner, Munition als
Schadensart (Physical, Siege, Magic), Freischaltung per Forschung und
einmaliger Kauf, Tasten G und V, Präsenzfaktor 0,5, Kills füttern den
Leck-Regler normal, Bots kaufen nie. Beim Bau festgelegt:

| Punkt | Umsetzung |
|---|---|
| Forschung | `mercenary-contract`, 600 Credits, 30 s, nach `siege-engineering` |
| Preis | 1000 Credits, einmal |
| Tempo, Reichweite, Leine, Posten, Munition, Stufen, Gate | beim Bau festgelegt, die Werte stehen in [HERO.md](../HERO.md) |
| Commands | `command:hire-hero`, `command:hero-move`, `command:hero-ammo` statt des Arbeitstitels `command:hero-stance` |
