# AI Model Export Guide

**Stand:** 2026-05-08 — Phase 5.11 Range-Based Templates.

Anleitung zum Exportieren des trainierten PyTorch-Modells für Browser-Inferenz.

> Trotz des historischen Skript-Namens `export_to_tfjs.py` exportieren wir
> direkt nach **ONNX** — TensorFlow.js wird **nicht** verwendet.

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
   wave-director.onnx  ──►  Browser (ONNX Runtime Web)
   metadata.json       ──►  Frontend-Decoder-Konstanten
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
Loading checkpoint: checkpoints/checkpoint_7350.pt
Validating model...
  Input shape:  torch.Size([1, 156])
  Output shape: torch.Size([1, 36])
  Validation passed!

Exporting ONNX to: ../public/assets/ai/wave-director/wave-director.onnx
  ONNX file size: ~110 KB

Metadata written to: ../public/assets/ai/wave-director/metadata.json
==================================================
Export complete!
==================================================
```

### Ergebnis

```
public/assets/ai/wave-director/
├── wave-director.onnx   # ~110 KB — Das Modell
├── metadata.json        # Konstanten, Templates, Ranges, Enemy-Base-HP
└── README.md            # Kurzanleitung
```

`metadata.json` enthält die vollständigen Template-Definitionen
(Slots, IDs, min_wave, requires_capability, alle 4 Ranges) — das Frontend
braucht diese, um die NN-Outputs in eine Wave-Config zu übersetzen.

## Modell-Format (Phase 5.11)

### Input — 156 Features

`GameStateEncoder` kodiert den Spielzustand in 156 Float-Werte:

| Range | Inhalt |
|---|---|
| `[0..52]` | Base-Scalar (Spieler, Towers, Enemies, Counters) |
| `[53..105]` | Phase-5.6-Awareness (History, Skill-Heuristik, Type-History) |
| `[106..115]` | Effective DPS pro Armor-Typ (10 Werte) |
| `[116..135]` | Ground-DPS-Profile (20 Bins) |
| `[136..155]` | Air-DPS-Profile (20 Bins) |

Layout-Definitionen: `training-backend/config.py` (Header) +
`server.py::_build_state` (Backend-Encoder) +
`src/app/ai/core/game-state-encoder.ts` (Frontend-Encoder).

### Output — 36 Werte

Das ONNX-Modell gibt eine flache Tensor mit 36 Werten zurück
(`OUTPUT_SIZE = MAX_TEMPLATE_SLOTS + NUM_CONTINUOUS = 32 + 4`):

| Index | Bedeutung | Nachbearbeitung im Frontend |
|---|---|---|
| `[0..31]` | Template-Logits (32 Slots, 18 aktiv) | Mask + Softmax + Temperature-Sampling |
| `[32]` | `count` raw | `sigmoid` → lerp in `template.count_range` |
| `[33]` | `spawn_delay` raw | `sigmoid` → lerp in `template.spawn_delay_range` |
| `[34]` | `hp_mult` raw | `sigmoid` → lerp in `template.hp_mult_range` |
| `[35]` | `variation` raw | `sigmoid` → lerp in `template.variation_range` |

**Wichtig:** Das Frontend muss zusätzliche Hard-Constraints anwenden, die
das NN nicht direkt lernt:
- Curriculum-Gates (`min_wave`)
- Capability-Gates (`antiAir`, `antiEthereal`)
- Boss-only-Gates
- Cooldown
- DPS-Scaled Range-Caps für `count` + `hp_mult`
- Wave-Duration-Cap

Diese Logik lebt im Frontend in `src/app/ai/wave-director/wave-director.service.ts`
und im Backend in `server.py::_decode_action` — beide müssen synchron bleiben.

## Browser-Integration

### ONNX Runtime Web

```typescript
const ort = await import('onnxruntime-web');
ort.env.wasm.wasmPaths = '/assets/onnx-wasm/';

const session = await ort.InferenceSession.create(
  '/assets/ai/wave-director/wave-director.onnx',
  { executionProviders: ['wasm'] }
);

const inputTensor = new ort.Tensor('float32', encodedState, [1, 156]);
const results = await session.run({ state: inputTensor });
const output = results.action.data; // Float32Array(36)
```

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
Checkpoint stammt aus älterer Architektur. Phase-5.11-Modell hat
`INPUT_SIZE=156` und `OUTPUT_SIZE=36`. Pre-Phase-5.5-Checkpoints liegen in
`checkpoints/archive-v3.5/` und sind inkompatibel.

**`DeprecationWarning: legacy TorchScript-based ONNX export`**
Kann ignoriert werden — funktioniert weiterhin.

## Modell-Architektur ändern

Bei Änderungen an `model.py`:
1. `INPUT_SIZE` / `MAX_TEMPLATE_SLOTS` / `NUM_CONTINUOUS` in `config.py` anpassen
2. Frontend-`ENCODED_STATE_SIZE` anpassen (`game-state-encoder.ts`)
3. Backend-`_build_state` und `_decode_action` aktualisieren
4. Frontend-`decodeModelOutput()` (`wave-director.service.ts`) anpassen
5. Re-Training nötig — alte Checkpoints sind inkompatibel
6. `metadata.json`-Versionsnummer hochziehen, Frontend-Decoder gegen die
   neue Version prüfen lassen
