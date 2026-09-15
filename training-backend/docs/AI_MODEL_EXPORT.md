# AI Model Export Guide

**Stand:** 2026-09-15, Schema v5 (208 Features). Der Export ist ein Opt-in-Pfad.

Anleitung zum Exportieren des trainierten PyTorch-Modells für Browser-Inferenz.

> **Das exportierte Modell ist nicht mehr der Standard.** Der Wave Director im
> Spiel ist regelbasiert und clientseitig
> (`src/app/ai/core/rule-director.ts`); beim Start wird nichts geladen. Das ONNX-
> Modell wird nur über den Knopf **„Load ONNX model"** im Training-Debug-Fenster
> aktiviert, zurück geht es über **„Use rules"**. Den Knopf gibt es nur, wenn
> das Modell zum Encoder passt ([Wann der Opt-in erscheint](#wann-der-opt-in-erscheint)).
>
> Grund: Das Netz war in A/B-Läufen statistisch nicht von uniformem Zufall zu
> unterscheiden, und eine 404-kB-Runtime plus Netzwerk-Roundtrip ist dafür bei
> jedem Kaltstart zu teuer. Der Pfad bleibt erreichbar für einen künftigen Lauf,
> der gegen echte Spielerdaten statt gegen einen scripted Bot trainiert wurde.
> Einstieg: [AI_WAVE_DIRECTOR_PLAN.md](../../docs/AI_WAVE_DIRECTOR_PLAN.md); die
> vollständige Begründung mit der Messreihe:
> [HANDOVER_RULE_DIRECTOR.md](../../docs/HANDOVER_RULE_DIRECTOR.md).

> Trotz des historischen Skript-Namens `export_to_tfjs.py` exportieren wir
> direkt nach **ONNX**; TensorFlow.js wird **nicht** verwendet.

---

## ⚠️ Das eingecheckte Modell ist inkompatibel

`public/assets/ai/wave-director/wave-director.onnx` (289.959 Byte) stammt aus
Phase 5.10 (`metadata.json`: `version 5.10.0`, `checkpoint_7350.pt`,
`inputSize 156`, exportiert 2026-04-21). Der Encoder produziert seit Schema v5
**208** Features. Das Training-Debug-Fenster zeigt den Knopf „Load ONNX model"
deshalb gar nicht erst, und `OnnxPolicy.load()` würde das Modell ablehnen,
bevor es die Runtime lädt (`'wrong-input-size'`). Die Wellen kommen vom
Regel-Director ([Wann der Opt-in erscheint](#wann-der-opt-in-erscheint)). Wer
den Pfad benutzen will, muss neu exportieren (`npm run export-ai`) und braucht
dafür einen Checkpoint aus einem Schema-v5-Lauf; danach erscheint der Knopf
beim nächsten Öffnen des Fensters von selbst.

---

## Übersicht

```
Training (Python/PyTorch)
         │
         ▼
    checkpoint.pt
         │
   scripts/export_to_tfjs.py
         │
         ▼
   wave-director.onnx  ──►  Browser (ONNX Runtime Web, on demand)
   metadata.json       ──►  Beleg, welches Schema exportiert wurde
```

## Voraussetzungen

```bash
cd training-backend
pip install -r requirements.txt
```

**Benötigte Packages:**
- `torch` (für Training ohnehin installiert)
- `onnx` >= 1.14.0

> **Achtung:** `tensorflowjs` NICHT installieren: Versionskonflikte und
> tensorflow-decision-forests ist auf Windows broken. ONNX Runtime Web
> reicht vollständig.

## Export durchführen

### NPM-Skript (empfohlen)

```bash
npm run export-ai
```

Erweitert sich zu:
```bash
cd training-backend && python scripts/export_to_tfjs.py \
  --checkpoint checkpoints/checkpoint_latest.pt \
  --output ../public/assets/ai/wave-director
```

### Manuell

```bash
cd training-backend
python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_7350.pt
```

**Output:**
```
Loading checkpoint: checkpoints/checkpoint_latest.pt
Validating model...
  Input shape:  torch.Size([1, 208])
  Output shape: torch.Size([1, 36])
  Validation passed! (36 = 32 templates + 4 params)

Exporting ONNX to: ../public/assets/ai/wave-director/wave-director.onnx
  ONNX file size: ~110 KB

Metadata written to: ../public/assets/ai/wave-director/metadata.json
==================================================
Export complete!
==================================================
```

Die Validierung prüft nur die **Shape**, nicht die Schema-Version des
Checkpoints. Ein Checkpoint aus einem älteren Schema hat eine andere
`INPUT_SIZE` und lässt bereits `load_model` mit einem Shape-Mismatch scheitern;
das ist die eigentliche Absicherung.

### Ergebnis

```
public/assets/ai/wave-director/
├── wave-director.onnx   # Das Modell (das eingecheckte: 289.959 Byte)
├── metadata.json        # Schema-Version, Templates, Ranges, Curriculum, Orders
└── README.md            # Kurzanleitung
```

`metadata.json` enthält Schema-Version, die vollständigen Template-Definitionen
(Slots, IDs, `minWave`, `requiresCapability`, alle vier Ranges), die
Curriculum-Sequenz, die Enemy-Base-HP und die positionsrelevanten Vokabular-
Reihenfolgen.

> **Das Frontend liest davon nur `inputSize`.** Daran hängt, ob das
> Debug-Fenster den Opt-in anbietet und ob `OnnxPolicy.load()` die Runtime
> überhaupt lädt (siehe [Wann der Opt-in erscheint](#wann-der-opt-in-erscheint)). Die Templates und
> Konstanten leben in `src/app/ai/core/templates.ts` und werden per
> `npm run ai-schema` mit dem Backend synchron gehalten. Ansonsten ist die
> Datei der **Beleg**, gegen welches Schema das ausgelieferte `.onnx`
> exportiert wurde.

## Modell-Format (Schema v5)

### Input: 208 Features

`GameStateEncoder` kodiert den Spielzustand in 208 Float-Werte
(`ENCODED_STATE_SIZE`):

| Block | Größe | Inhalt |
|---|---|---|
| Base | 57 | Spieler, Tower-Counts, History, Wave-Signale, Research |
| Awareness | 60 | Typ-/Armor-History, Tower-Level, Capabilities, Unlocks, Near-Miss |
| Effective DPS | 12 | effektive DPS pro Armor (Ground 5 + Air 5) + AoE-Anteil (2) |
| Wave-Context | 39 | Availability-Maske (32) + effektive Ranges (6) + Fairness-Headroom (1) |
| Spatial | 40 | Ground-DPS-Profil (20 Bins) + Air-DPS-Profil (20 Bins) |

Layout-Definitionen: `training-backend/generated/ai-schema.json` (generiert),
`server.py::_encode_state` (Backend-Encoder),
`src/app/ai/core/game-state-encoder.ts` (Frontend-Encoder).

### Output: 36 Werte

Das ONNX-Modell gibt einen flachen Tensor mit 36 Werten zurück
(`OUTPUT_SIZE = MAX_TEMPLATE_SLOTS + NUM_CONTINUOUS = 32 + 4`):

| Index | Bedeutung | Nachbearbeitung im Frontend |
|---|---|---|
| `[0..31]` | Template-Logits (32 Slots, 22 aktiv) | Mask + Softmax + Temperature-Sampling |
| `[32]` | `count` raw | `sigmoid` → lerp in `template.countRange` |
| `[33]` | `spawn_delay` raw | `sigmoid` → lerp in `template.spawnDelayRange` |
| `[34]` | `hp_mult` raw | `sigmoid` → lerp in `template.hpMultRange` |
| `[35]` | `variation` raw | `sigmoid` → lerp in `template.variationRange` |

**Wichtig:** Alles, was danach kommt, ist zwischen Modell und Regel-Director
geteilt: Curriculum-Gates (`minWave`), Capability-Gates (`antiAir`,
`antiEthereal`), Boss-only, Cooldown, DPS-Scaled Range-Caps, Wave-Duration-Cap
und der Fairness-Gate. Das Modell ersetzt genau die fünf Zahlen oben und sonst
nichts.

Diese Logik lebt im Frontend in `src/app/ai/core/wave-config-builder.ts` und
im Backend in `server.py::_decode_action`; beide müssen synchron bleiben.

## Browser-Integration

### ONNX Runtime Web

Wird **lazy** geladen, erst wenn `loadModel()` gerufen wird
(`OnnxPolicy.load()` in `onnx-policy.ts`):

```typescript
const ort = await import('onnxruntime-web');
ort.env.wasm.wasmPaths = 'assets/onnx-wasm/';

const session = await ort.InferenceSession.create(
  'assets/ai/wave-director/wave-director.onnx',
  { executionProviders: ['wasm'] }
);

const inputTensor = new ort.Tensor('float32', encodedState, [1, ENCODED_STATE_SIZE]);
const results = await session.run({ state: inputTensor });
const output = results.action.data; // Float32Array(36)
```

### Wann der Opt-in erscheint

`checkModelFit()` (`onnx-policy.ts`) liest `inputSize` aus `metadata.json` und
vergleicht es mit `ENCODED_STATE_SIZE`. Das kostet eine kleine JSON-Anfrage
(`cache: 'no-cache'`, also neu validiert), keine Runtime und keine Session:

| Ergebnis | Wann |
|---|---|
| `'fits'` | `inputSize` ist genau `ENCODED_STATE_SIZE` |
| `'wrong-input-size'` | `inputSize` ist eine andere Zahl (heute 156 gegen 208) |
| `'no-model'` | `metadata.json` fehlt, ist nicht lesbar oder hat kein numerisches `inputSize` |

Das Training-Debug-Fenster fragt bei jedem Öffnen
(`WaveDirectorService.checkModel()`, Ergebnis im Signal `modelFit`) und zeigt
„Load ONNX model" nur bei `'fits'`. Ein Export mit passender Eingangsbreite
bringt den Knopf deshalb ohne Codeänderung zurück, beim nächsten Öffnen des
Fensters. Ohne lesbares `inputSize` gilt das Modell als nicht vorhanden: der
Export schreibt das Feld immer.

### Was beim Laden passiert

`WaveDirectorService.loadModel()` ruft `OnnxPolicy.load()` (`onnx-policy.ts`).
Das prüft zuerst dieselbe Passung und lädt die Runtime nur bei `'fits'`:

| Ergebnis | Wann | Folge |
|---|---|---|
| `'ready'` | Passung `'fits'`, Runtime geladen, Session angelegt | `modelState = 'ready'`, `aiMode = 'inference'`: das Modell wählt Template und Faktoren |
| `'wrong-input-size'` | `metadata.json` nennt eine andere Eingangsbreite | Runtime wird nicht geladen, Warnung in der Konsole, `modelState = 'rules'`, der Knopf verschwindet |
| `'no-model'` | Kein lesbares `inputSize`, oder `InferenceSession.create` warf, etwa weil die Modelldatei fehlt | Hinweis in der Konsole, `modelState = 'rules'`, der Knopf verschwindet |
| `'runtime-error'` | ONNX Runtime selbst ließ sich nicht laden | `modelState = 'error'`, `aiMode = 'rules'` |

Außer bei `'ready'` kommen die Wellen weiter vom Regel-Director, ohne
Exception. Die Eingangsbreite kommt aus `metadata.json`, weil onnxruntime-web
eine dynamische Batch-Achse nicht verlässlich als feste Größe meldet. „Use
rules" im Training-Debug-Fenster (`forceRuleMode()`) gibt die Session wieder
frei.

### WASM-Files

ONNX Runtime braucht WASM-Dateien (rund 80 MB in `public/assets/onnx-wasm/`, gemessen 2026-09-15). Werden via `npm postinstall`
automatisch nach `public/assets/onnx-wasm/` kopiert:

```bash
npm install      # postinstall läuft automatisch
# oder explizit:
npm run postinstall
```

Diese Files sind in `.gitignore`.

## NPM-Skripte

`package.json`:

```json
{
  "postinstall": "...",                        // kopiert WASM-Files
  "ai-schema": "vitest run tools/ai-schema/generate.spec.ts",
  "export-ai": "cd training-backend && python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_latest.pt --output ../public/assets/ai/wave-director"
}
```

## Troubleshooting

**`No module named 'onnx'`**
```bash
pip install onnx
```

**`WASM files not found` (Browser-Console)**
```bash
npm run postinstall
```

**`Shape mismatch` beim Export**
Der Checkpoint stammt aus einer älteren Architektur. Das aktuelle Modell hat
`INPUT_SIZE = 208` und `OUTPUT_SIZE = 36`. Pre-Phase-5.5-Checkpoints liegen in
`checkpoints/archive-v3.5/` und sind inkompatibel.

**Konsole: `[AI] Model expects 156 inputs, the encoder produces 208`**
Das ausgelieferte `.onnx` passt nicht zum aktuellen Encoder; `load()` lehnt es
ab, das Spiel bleibt auf den Regeln. Neu exportieren (siehe oben).

**Kein Knopf „Load ONNX model" im Training-Debug-Fenster**
Gewollt, solange `metadata.json` keine 208 Eingänge nennt oder fehlt (siehe
[Wann der Opt-in erscheint](#wann-der-opt-in-erscheint)). Neu exportieren und
das Fenster neu öffnen.

**`AI schema version mismatch` beim Serverstart**
```bash
npm run ai-schema
```
Regeneriert `training-backend/generated/ai-schema.json` aus den TS-Configs.

**`DeprecationWarning: legacy TorchScript-based ONNX export`**
Kann ignoriert werden, der Export läuft bewusst mit `dynamo=False`
(Unicode-Probleme des neuen Exporters unter Windows).

## Modell-Architektur ändern

Alle Größen kommen aus `generated/ai-schema.json`; hartkodierte Werte gibt es
weder im Backend noch im Frontend-Encoder. Bei einer Layout-Änderung:

1. `src/app/ai/core/ai-schema.ts` anpassen und `AI_SCHEMA_VERSION` hochziehen.
2. `npm run ai-schema` regeneriert `training-backend/generated/ai-schema.json`.
3. `EXPECTED_SCHEMA_VERSION` in `training-backend/schema.py` mitziehen. Der
   Server startet sonst nicht (bewusst laut statt still).
4. `server.py::_encode_state` und ggf. `_decode_action` aktualisieren; der
   Encoder wirft bei falscher Feature-Anzahl.
5. Frontend-`encodeGameState()` spiegeln; `tests/test_encoder.py` prüft beide
   gegen dieselbe Schema-Datei.
6. **Re-Training nötig**, alte Checkpoints sind inkompatibel.
7. Neu exportieren, damit `metadata.json` die neue `schemaVersion` trägt.
