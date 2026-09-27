---
description: Release vorbereiten und ausliefern: Changelog-Text (immer dem User vorlegen), Version, Tag, Workflow verfolgen, Live-Stand prüfen
argument-hint: <Version, z. B. 0.3.2>
---

Bereite das Release **$ARGUMENTS** von 3DTD vor. Hintergrund: docs/ELECTRON_DESKTOP_PLAN.md (Abschnitt "Reihenfolge", Punkt 8; E45, E46).

## 1. Stand prüfen

- Arbeitsbaum sauber, aktueller Branch und letzter Tag (`git describe --tags --abbrev=0`).
- `$ARGUMENTS` ist höher als die Version in `package.json`.
- Tests grün: `npx vitest run` im Root, `npm test` in `desktop/`.

## 2. Changelog-Text entwerfen

Material: `git log <letzter Tag>..HEAD --no-merges --format=%s` und die Abschnitte in `DONE.md` seit dem letzten Release.

Schreibe einen Abschnitt für `CHANGELOG.md`:

- Englisch, für Spieler, nicht für Entwickler. Was sie merken, nicht wie es gebaut ist.
- Überschrift `## $ARGUMENTS (<heutiges Datum>)`, Gruppen `### New`, `### Better`, `### Fixed` (leere weglassen).
- 3 bis 8 Punkte insgesamt, je ein, zwei Sätze. Nüchtern, keine Werbesprache, keine Em-Dashes.
- Zahlen nur, wenn sie belegt sind (Commit-Text, Messung), mit ihrer Bedingung.

## 3. Text vorlegen

**Lege dem User den Abschnitt vollständig vor und warte auf seine Freigabe. Ohne ausdrückliches OK geht es nicht
weiter.** Änderungswünsche einarbeiten und erneut vorlegen.

## 4. Release-Commit

Nach der Freigabe:

- Den Abschnitt oben in `CHANGELOG.md` einfügen (unter der Einleitung, über dem letzten Release).
- `npm version $ARGUMENTS --no-git-tag-version` im Root (ändert `package.json` und `package-lock.json`; das Spiel,
  der Installer und der Updater lesen die Version dort).
- Commit `chore(release): version $ARGUMENTS` mit genau diesen drei Dateien. Keine Co-Author-Zeile.

## 5. Tag

Frage vor dem Tag: "Tag v$ARGUMENTS pushen?" Erst auf ein ausdrückliches Ja:

- `git tag v$ARGUMENTS` und `git push origin v$ARGUMENTS` (nur der Tag; einen Branch pushen nur auf eigenen Zuruf).
- `release.yml` prüft Tag gegen Version und Changelog, testet, baut Installer und AppImage und veröffentlicht
  selbst (Abschnitt 6). Vorher fragen heißt deshalb: der Tag ist das Go für live.

## 6. Live

`release.yml` veröffentlicht selbst, sobald Installer und AppImage oben sind (Job `publish`), legt die Kopien ohne
Version im Namen dazu und ruft danach `deploy.yml` (Web-Version und Landing) und `relay-image.yml` (`:<version>`,
`:latest`) auf. Es gibt keinen Entwurf zum Anspielen mehr: wer vorher testen will, baut lokal einen Installer mit
niedrigerer Version (`npm version 0.x.y-beta.n --no-git-tag-version`, `npm run dist` in `desktop/`, Version danach
zurück). Mit `gh run watch` verfolgen, danach Landing, `/play/` und beide Download-Links prüfen und dem User melden.
Hat sich am Relay etwas geändert, zieht der User auf dem Server `:latest` neu.
