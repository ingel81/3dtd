# Sound-Paket

**Status:** Plan, abgestimmt am 2026-09-23 (vier AUQ-Runden). Noch nichts gebaut.
**Grundlage:** Bestandsaufnahme vom 2026-09-23 über Code, Assets, Doku und `tmp/`. Das System selbst beschreibt
[SPATIAL_AUDIO.md](SPATIAL_AUDIO.md).

Heute klingen Tower-Schüsse, die Fähigkeiten, der HQ-Treffer, Platzieren und Verkaufen sowie ein Teil der Gegner.
Stumm sind Tode und Treffer, zehn Gegnertypen, die meisten Spielmomente und die ganze UI. Die Musik kennt nur
Hauptthema, Bauphase und Welle.

---

## Phasen

| Phase | Inhalt | Braucht Assets |
|-------|--------|----------------|
| 1 | Bugs und Technik (Abschnitt 1 und 2) | nein |
| 2 | Assets erzeugen: SFX per ElevenLabs Sound Effects, Musik per Eleven Music; Auswahlseite zum Anhören | ja |
| 3 | Einbau der gewählten SFX (Abschnitt 3 bis 5) | ja |
| 4 | Musikzustände und Ducking (Abschnitt 6) | ja |

Phase 1 läuft unabhängig. Phase 2 erzeugt je Sound mehrere Varianten, schneidet und normalisiert sie und legt sie
auf eine Auswahlseite; der User wählt, erst dann kommen sie ins Repo. Der API-Key liegt außerhalb des Repos
(`~/.claude/skills/video-use/.env`), in kein Skript und keinen Commit.

---

## 1. Bugs

| # | Was | Beleg |
|---|-----|-------|
| 1.1 | Zufallsrufe der Gegner zu leise: registriert mit `randomSoundVolumeMax`, abgespielt mit einem Faktor zwischen Min und Max, die Lautstärke wirkt doppelt (Wallsmasher 0,12 bis 0,36 statt 0,2 bis 0,6; auch Bär, Mammut, Drache) | `enemy.entity.ts:157`, `:303` |
| 1.2 | Zufallsrufe laufen per `setTimeout` auf Echtzeit: rufen in der Pause weiter, folgen der Spielgeschwindigkeit nicht. Auf Spielzeit umstellen wie Wurm und Ooze | `enemy.entity.ts:291` |
| 1.3 | Nach einem Neustart vermutlich keine Musik in der Bauphase: `game:reset` stoppt, Build-Musik startet nur nach dem Ladebildschirm oder einer Welle. Erst nachhören, dann beheben | `background-music.service.ts:269-297` |
| 1.4 | Wettlauf beim Überblenden: startet eine Welle, während das Hauptthema ausblendet, kann der Timer der Build-Musik die Wellenmusik später überschreiben | `background-music.service.ts` (`mainThemeGapTimer`) |
| 1.5 | Hauptthema im Browser oft stumm: eine Autoplay-Ablehnung wird verschluckt und nie nachgeholt. Beim ersten Klick oder Tastendruck starten (nur Web, Electron erlaubt Autoplay) | `background-music.service.ts:85-87` |
| 1.6 | Hauptthema folgt den Reglern nicht: Stumm und Musik-Regler greifen nicht, es läuft am Limiter vorbei und etwa 12 dB lauter als die Build-Musik | `tower-defense.component.ts:517`, `background-music.config.ts:48` |
| 1.7 | Lücke im Musik-Loop bei verstecktem Tab: das Überblenden hängt an `setTimeout`, der im Hintergrund gedrosselt wird. Auf AudioContext-Zeit umstellen | `music-mixer.ts:246-259` |
| 1.8 | Der Boss ist in seinem eigenen Intro stumm: das Intro nutzt die Pause, die Pause hält seine Loops und seine Stimme an | `boss-intro.service.ts:231-239` |

## 2. Technik und Einstellungen

- **Master-Regler und Stumm-Taste.** Gesamtlautstärke neben Musik und SFX; eine Taste schaltet alles stumm
  (Vorschlag `M`, in `hotkey-map.ts` frei). Das verwaiste Flag `td_music_enabled` fällt weg.
- **Tempo und Bots.** Bot-Tabs stumm; bei 2x und 4x werden gleichzeitige Effekte ausgedünnt; bei 75x kein
  Musikwechsel je Welle.
- **Budget nach Nähe.** Die 12 Plätze für Gegner-Sounds gehen an die nächsten Gegner statt an die, deren Update
  zuerst kommt.
- **Aufräumen.**
  - `AudioPoolManager` umbenennen (er poolt nicht).
  - Doku-Pfade in ENEMY_CREATION.md und SPATIAL_AUDIO.md, die auf nicht vorhandene Dateien zeigen, sowie
    zwei überholte "nicht angehört"-Vermerke korrigieren.
  - Tote Dateien löschen: die 14 Herbert-Dateien (Entscheidung: Herbert bleibt stumm),
    `wallsmasher/spawn.mp3`. `main01` und `main02` erst nach Phase 4, falls die Musikzustände sie nicht nutzen.
  - Prüfen, ob Skarnax- und Ooze-Sounds bei `EnemyManager.destroy()` hängen bleiben (nur `clear()` räumt sie ab,
    früher C6).

## 3. Kampf

- **Todes-Sounds** für alle Gegner, je Klasse statt je Typ (Vorschlag: organisch, Untote, mechanisch, Knochen,
  Schleim, Luft, Boss je eigener). Budget gegen Massentode: je Klasse höchstens ein Tod pro Zeitfenster.
- **Treffer-Sounds**, kurz und stark gedrosselt, sonst rauscht es bei Hunderten Gegnern.
- **Tower-Upgrade-Sound.**
- **Teilung:** Skelett zerfällt in Minions, der Wurm teilt sich oder verliert Segmente.
- **Auslöse- und Vorwarn-Sounds** für Frostbombe (0,5 s), EMP und Orbitallaser (1 s Aufladen).
- **E4 Golem:** einzelne schwere Schritte zum vorhandenen Loop, leichter Screen Shake in Kameranähe.
- **E5 Rakete:** neues Abschuss-Asset statt `towers/rocket/launch.mp3`.
- **Chaos-Tower:** eigener Sound statt des geliehenen Magic-Casts.

## 4. Gegner und Held

- **Stumme Gegner vertonen, alle:** Fledermaus, Pinguin, Skelett, Skelett-Minion, Spinne, Geist, Mech, Wraith,
  Schleimklumpen, Wurmsegmente. Je nach Art Bewegungs-Loop oder Zufallsrufe.
- **Held:** eigene Waffensounds für die drei Munitionsarten; Anheuern, Stufenaufstieg, Munitionswechsel,
  Bestätigung eines Laufbefehls.

## 5. Spielmomente und UI

- Wellenstart (Horn), Wellenende (Fanfare)
- Game Over: HQ-Zerstörung hörbar, kurzer Niederlage-Stinger
- Blutmond-Sting, Brüllen beim Boss-Intro
- Forschung fertig
- Kopfgeld (stark gedrosselt), "zu wenig Geld"
- Fehlerton bei abgelehnter Aktion und ungültiger Platzierung
- Fähigkeit wieder bereit
- Eigener Leck-Sound, wenn ein Gegner das HQ erreicht
- **UI-Sounds:** kleines System mit eigenem Regler: Klick, Bauauswahl, Dialog auf und zu

## 6. Musik

- **Zustände:** eigene Musik für Boss-Welle, Blutmond und Game Over; in der Pause gedämpft.
- **Ducking:** die Musik weicht unter großen Effekten (Atombombe, HQ-Treffer, Stinger) kurz aus, statt über den
  gemeinsamen Limiter zu pumpen.
- Tracks per Eleven Music API, Entwürfe zur Auswahl.

---

## Bewusst nicht im Paket

- Herbert-Sprachdateien wieder anschalten (sie werden gelöscht)
- Einschlag-Sounds der Flächenwaffen (Kanone, Rakete, Gift, Eis, Explosivmunition)
- Loop für gefrorene oder betäubte Gegner, Cues beim Anbringen von Statuseffekten
- Eigene Platzier- und Verkaufs-Sounds je Tower
- Countdown-Ticken vor der automatischen Welle, Low-HP-Warnung
- Weitere Build-Musik

## Offene Detailfragen (vor Phase 3 klären)

1. Gegnerklassen für die Todes-Sounds: passt die Einteilung in Abschnitt 3, wer gehört wohin?
2. Treffer-Sounds: je Gegnerklasse oder je Schadenstyp (Pfeil, Kugel, Magie)?
3. UI-Sounds: welche Elemente genau, und startet der Regler bei 0,5?
4. Game Over: Zerstörung und Stinger nacheinander, und die Musik davor ganz aus?
5. Stumm-Taste `M` bestätigen.
