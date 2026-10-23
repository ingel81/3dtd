# Versionen der mitgelieferten Karten (Plan, E134)

Stand 2026-10-23, entschieden mit dem User, nicht gebaut. Ziel: Updates mitgelieferter Karten verteilen, ohne dass
Spielstände und Replays still auseinanderlaufen.

## Entschieden

- **Auslieferung nur mit Spiel-Releases.** Karten ändern sich nicht unabhängig vom Spiel; keine Mindest-Spielversion je
  Karte.
- **Desktop bündelt die Karten** (`public/maps`, rund 194 MB, im Installer; das Auto-Update lädt per Blockmap nur
  Geändertes). Kippt die Entscheidung vom 2026-10-11 (Daten nicht im Installer). Damit braucht die Desktop-App weder
  CORS noch einen `connect-src`-Eintrag und läuft offline.
- **Web lädt die Karten von `/play/maps/`**, mit dem normalen Deploy hochgeladen (der Sync schreibt nur Geändertes);
  gleiche Herkunft, kein CORS, kein `mapData` in der runtime-config. Der Cache nach Inhalts-Hash
  (`map-data.ts`, `maps/manifest.json`) bleibt.
- **Version je Karte:** eine laufende Nummer in `maps/index.json`, die der Bake hochzählt, sobald sich der
  `contentHash` einer Karte ändert. In der Kartenliste klein sichtbar („v3“). Keine „Was ist neu“-Notiz (vorerst).
- **Sim-Hash je Karte** neben dem `contentHash`: nur über das, was die Simulation liest (Raster, Wege, Gebäude,
  Sichtsperren, Spawns, Spielregeln der Karte). Optik (Texturen, Deko, Wasser, Farben) ändert ihn nicht; ein Test
  prüft das.
- **Spielstände (Continue) und Replays** merken sich den Sim-Hash. Gleicher Sim-Hash: weiterspielen auf der neuen
  Fassung. Anderer: Fortsetzen bzw. Abspielen abgelehnt mit Hinweis „auf einer älteren Fassung der Karte“, wie heute
  bei anderer Balance.
- **Coop** braucht nichts Neues: beide Spieler haben denselben Release.
- **Kopien im Editor** sind unabhängig von ihrer Vorlage, kein Hinweis auf neue Fassungen.
- Der Schalter `CUSTOM_MAPS_RELEASED` bleibt aus, bis der User ihn freigibt.

## Bauschritte

1. Sim-Hash und Version im Bake (`tools/maps/`), `index.json`, Test „Optik ändert den Sim-Hash nicht“.
2. Spielstände und Replay-Datei tragen den Sim-Hash; Prüfung beim Fortsetzen und Laden, Hinweistext (i18n).
3. Version in der Kartenliste.
4. Web-Build ohne `maps/**`-Ausnahme bzw. Deploy kopiert `public/maps` nach `/play/maps/`; Desktop-Build bündelt sie.
5. Probe: Production-Build web und Desktop ohne Netz, eine Karte öffnen.
