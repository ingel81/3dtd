# Modelle packen

Packt die GLB-Modelle des Spiels (V9, [CUSTOM_WORLD_PERF_VISUAL_PLAN.md](../../docs/CUSTOM_WORLD_PERF_VISUAL_PLAN.md)):
Geometrie mit meshopt, Texturen als KTX2. Das Spiel lädt beides über einen Weg (`createModelLoader`,
`src/app/three-engine/models/model-loader.ts`) und einen Transcoder (`ktx2-transcoder.ts`); im Grafikspeicher
liegt eine KTX2-Textur als BC7 oder ASTC, ein Viertel von RGBA8.

```bash
cd tools/model-pack && npm install         # glTF Transform, meshoptimizer, sharp
# ktx.exe aus KTX-Software 4.4 (gebaut oder heruntergeladen): --ktx <pfad> oder KTX_TOOL

npm run models:pack                         # Spielmodelle in public/assets/models, an Ort und Stelle
node tools/model-pack/pack-map-models.mjs public/maps/assets [<id> ...]   # Kartenmodelle (pack_models.py und update_catalog.py rufen es)
```

Beide sind wiederholbar: ein gepacktes Modell bleibt, wie es ist. Ein neues ungepacktes Modell lässt
`src/app/three-engine/models/packed-models.spec.ts` fehlschlagen, bis es gepackt ist.

**Texturen** (`textures.mjs`): wie die Materialien eine Textur nutzen, bestimmt ihre Kodierung.

- Farbe (Grundfarbe, Emission) sRGB, Daten (Metall/Rauheit, Verdeckung) linear. Kanäle, die kein Material liest (Rot
  einer Metall/Rauheit-Karte, Grün und Blau einer Verdeckung), tragen eine Kopie eines gelesenen, so kostet ETC1S
  nichts für sie. Alpha bleibt nur, wo ein geblendetes oder maskiertes Material es liest und ein Texel nicht deckt; das
  Spiel liest „deckend“ aus der Datei (`ktx2Opaque`).
- Basis ETC1S, wo es über den gelesenen Kanälen `MIN_PSNR` erreicht (Farbe 30 dB, Daten 28 dB; Spielmodelle 28 dB,
  ihre Atlanten sieht man auf 100 bis 200 Pixeln), sonst UASTC mit RDO und Zstandard. Normalen immer UASTC.
  `"textureCodec": "uastc"` in `tools/map-assets/objects.json` gibt einem Kartenmodell UASTC für alles (Druck,
  Plakate: `advertising-column`).
- Mipmaps hier, umlaufend bei kachelnden Texturen; Kanten auf Vielfache von 4 (BC7- und ASTC-Blöcke).

**Kartenmodelle** (`pack-map-models.mjs`): jede Textur liegt als `textures/<name>-<hash>.ktx2` neben `models/`, der
Hash ist ihr Inhalt samt Kodierung. Die GLBs nennen sie per URI (`../textures/...`), der Katalog je Datei unter
`textures` (`update_catalog.py`), damit das Spiel sie neben dem GLB holt. Ziegel oder Putz, den dreißig Häuser
tragen, ist so eine Datei und im Spiel eine Textur (`MapAssetLibrary`, geteilt über `sharedTexture`). Größe 512 px,
1024 px mit `"textureSize": 1024`, Fernstufen die Hälfte. Dateien, die kein Modell mehr nennt, gehen am Ende.

**Spielmodelle** (`pack-game-models.mjs`): Texturen im GLB. Positionen bleiben float (quantisiert bräuchten sie eine
Skalierung am Knoten, die Kinder und gelesene Transforms verschiebt: die Mündung des Helden, die Höhen des
Gegner-Backens), Animationen verlustfrei (meshopts Quaternion-Filter dreht Knochen bis 0,8 Grad), Knoten, Namen und
Morph-Targets bleiben. Geblendete Modelle behalten die Reihenfolge ihrer Dreiecke. Paletten (bis 64 px oder nearest)
bleiben PNG; `TEXTURES_AS_BUILT` behält die Texturen eines Modells, wie sein Bauskript sie gemacht hat (Spawn-Portal:
Datenkarte verlustfrei). Ordner `candidates` werden übersprungen.
