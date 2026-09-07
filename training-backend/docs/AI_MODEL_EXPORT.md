# AI Model Export Guide

**Stand:** 2026-09-07 — Schema v3 (203 Features). Der Export ist ein Opt-in-Pfad.

Anleitung zum Exportieren des trainierten PyTorch-Modells für Browser-Inferenz.

> **Das exportierte Modell ist nicht mehr der Standard.** Der Wave Director im
> Spiel ist regelbasiert und clientseitig
> (`src/app/ai/core/rule-director.ts`); beim Start wird nichts geladen. Das ONNX-
> Modell wird nur über den Knopf **„ONNX-Modell laden"** im Debug-Fenster
> aktiviert, zurück geht es über **„Regeln nutzen"**.
>
> Grund: Das Netz war in A/B-Läufen statistisch nicht von uniformem Zufall zu
> unterscheiden, und eine 404-kB-Runtime plus Netzwerk-Roundtrip ist dafür bei
> jedem Kaltstart zu teuer. Der Pfad bleibt erreichbar für einen künftigen Lauf,
> der gegen echte Spielerdaten statt gegen einen scripted Bot trainiert wurde.
> Vollständige Begründung: [../../docs/HANDOVER_RULE_DIRECTOR.md](../../docs/HANDOVER_RULE_DIRECTOR.md).

> Trotz des historischen Skript-Namens `export_to_tfjs.py` exportieren wir
> direkt nach **ONNX** — TensorFlow.js wird **nicht** verwendet.

---

## ⚠️ Das eingecheckte Modell ist inkompatibel

`public/assets/ai/wave-director/wave-director.onnx` stammt aus Phase 5.10
(`metadata.json`: `version 5.10.0`, `checkpoint_7350.pt`, `inputSize 156`,
exportiert 2026-04-21). Der Encoder produziert seit Schema v3 **203** Features.

Die Datei selbst ist ein gültiges Modell, `InferenceSession.create` dürfte also
durchgehen; der Konflikt schlägt beim ersten `session.run()` zu, und
`runInference` hat keinen Fallback (nicht nachgemessen — der Pfad wurde seit dem
Schema-Sprung nicht mehr benutzt). Wer ihn heute benutzen will, muss vorher neu
exportieren (`npm run export-ai`) und braucht dafür einen Checkpoint aus einem
Schema-v3-Lauf.

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

> **Achtung:** `tensorflowjs` NICHT installieren — Versionskonflikte und
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
  Input shape:  torch.Size([1, 203])
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
`INPUT_SIZE` und lässt bereits `load_model` mit einem Shape-Mismatch scheitern —
das ist die eigentliche Absicherung.

### Ergebnis

```
public/assets/ai/wave-director/
├── wave-director.onnx   # ~110 KB — Das Modell
├── metadata.json        # Schema-Version, Templates, Ranges, Curriculum, Orders
└── README.md            # Kurzanleitung
```

`metadata.json` enthält Schema-Version, die vollständigen Template-Definitionen
(Slots, IDs, `minWave`, `requiresCapability`, alle vier Ranges), die
Curriculum-Sequenz, die Enemy-Base-HP und die positionsrelevanten Vokabular-
Reihenfolgen.

> **Das Frontend liest diese Datei nicht.** Kein Modul unter `src/` referenziert
> `metadata.json`; die Templates und Konstanten leben in
> `src/app/ai/core/templates.ts` und werden per `npm run ai-schema` mit dem
> Backend synchron gehalten. Die Datei ist der **Beleg**, gegen welches Schema
> das ausgelieferte `.onnx` exportiert wurde — genau die Frage, die oben den
> Inkompatibilitäts-Kasten begründet.

## Modell-Format (Schema v3)

### Input — 203 Features

`GameStateEncoder` kodiert den Spielzustand in 203 Float-Werte
(`ENCODED_STATE_SIZE`):

| Block | Größe | Inhalt |
|---|---|---|
| Base | 55 | Spieler, Tower-Counts, History, Wave-Signale, Research |
| Awareness | 57 | Typ-/Armor-History, Tower-Level, Capabilities, Unlocks, Near-Miss |
| Effective DPS | 12 | effektive DPS pro Armor (Ground 5 + Air 5) + AoE-Anteil (2) |
| Wave-Context | 39 | Availability-Maske (32) + effektive Ranges (6) + Fairness-Headroom (1) |
| Spatial | 40 | Ground-DPS-Profil (20 Bins) + Air-DPS-Profil (20 Bins) |

Layout-Definitionen: `training-backend/generated/ai-schema.json` (generiert),
`server.py::_encode_state` (Backend-Encoder),
`src/app/ai/core/game-state-encoder.ts` (Frontend-Encoder).

### Output — 36 Werte

Das ONNX-Modell gibt einen flachen Tensor mit 36 Werten zurück
(`OUTPUT_SIZE = MAX_TEMPLATE_SLOTS + NUM_CONTINUOUS = 32 + 4`):

| Index | Bedeutung | Nachbearbeitung im Frontend |
|---|---|---|
| `[0..31]` | Template-Logits (32 Slots, 19 aktiv) | Mask + Softmax + Temperature-Sampling |
| `[32]` | `count` raw | `sigmoid` → lerp in `template.countRange` |
| `[33]` | `spawn_delay` raw | `sigmoid` → lerp in `template.spawnDelayRange` |
| `[34]` | `hp_mult` raw | `sigmoid` → lerp in `template.hpMultRange` |
| `[35]` | `variation` raw | `sigmoid` → lerp in `template.variationRange` |

**Wichtig:** Alles, was danach kommt, ist zwischen Modell und Regel-Director
geteilt — Curriculum-Gates (`minWave`), Capability-Gates (`antiAir`,
`antiEthereal`), Boss-only, Cooldown, DPS-Scaled Range-Caps, Wave-Duration-Cap
und der Fairness-Gate. Das Modell ersetzt genau die fünf Zahlen oben und sonst
nichts.

Diese Logik lebt im Frontend in `src/app/ai/core/wave-director.service.ts` und
im Backend in `server.py::_decode_action` — beide müssen synchron bleiben.

## Browser-Integration

### ONNX Runtime Web

Wird **lazy** geladen, erst wenn `loadModel()` gerufen wird
(`wave-director.service.ts`):

```typescript
const ort = await import('onnxruntime-web');
ort.env.wasm.wasmPaths = '/assets/onnx-wasm/';

const session = await ort.InferenceSession.create(
  '/assets/ai/wave-director/wave-director.onnx',
  { executionProviders: ['wasm'] }
);

const inputTensor = new ort.Tensor('float32', encodedState, [1, ENCODED_STATE_SIZE]);
const results = await session.run({ state: inputTensor });
const output = results.action.data; // Float32Array(36)
```

Fehlt die Modelldatei, ist das kein Fehler: `aiMode` bleibt auf `'rules'`.

### WASM-Files

ONNX Runtime braucht WASM-Dateien (~60 MB). Werden via `npm postinstall`
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
`INPUT_SIZE = 203` und `OUTPUT_SIZE = 36`. Pre-Phase-5.5-Checkpoints liegen in
`checkpoints/archive-v3.5/` und sind inkompatibel.

**`Failed to load model` oder Shape-Fehler beim ersten `session.run()` im Browser**
Das ausgelieferte `.onnx` passt nicht zum aktuellen Encoder — siehe den
Inkompatibilitäts-Kasten oben. Neu exportieren.

**`AI schema version mismatch` beim Serverstart**
```bash
npm run ai-schema
```
Regeneriert `training-backend/generated/ai-schema.json` aus den TS-Configs.

**`DeprecationWarning: legacy TorchScript-based ONNX export`**
Kann ignoriert werden — der Export läuft bewusst mit `dynamo=False`
(Unicode-Probleme des neuen Exporters unter Windows).

## Modell-Architektur ändern

Alle Größen kommen aus `generated/ai-schema.json`; hartkodierte Werte gibt es
weder im Backend noch im Frontend-Encoder. Bei einer Layout-Änderung:

1. `src/app/ai/core/ai-schema.ts` anpassen und `AI_SCHEMA_VERSION` hochziehen.
2. `npm run ai-schema` — regeneriert `training-backend/generated/ai-schema.json`.
3. `EXPECTED_SCHEMA_VERSION` in `training-backend/schema.py` mitziehen. Der
   Server startet sonst nicht (bewusst laut statt still).
4. `server.py::_encode_state` und ggf. `_decode_action` aktualisieren; der
   Encoder wirft bei falscher Feature-Anzahl.
5. Frontend-`encodeGameState()` spiegeln — `tests/test_encoder.py` prüft beide
   gegen dieselbe Schema-Datei.
6. **Re-Training nötig** — alte Checkpoints sind inkompatibel.
7. Neu exportieren, damit `metadata.json` die neue `schemaVersion` trägt.
