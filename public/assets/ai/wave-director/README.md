# Wave Director AI Model

ONNX Model für Browser-Inference via ONNX Runtime Web.

**Stand des aktuell deployten Modells:** Phase 5.10 (Template-Based), Checkpoint 7350.

## Dateien

- `wave-director.onnx` - Das trainierte AI Model (~108 KB)
- `metadata.json` - Templates, Ranges, Enemy-Base-HP, Decoder-Konstanten

## Model aktualisieren

Nach Training mit neuem Checkpoint:

```bash
npm run export-ai
```

Wrapper für `python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_latest.pt --output ../public/assets/ai/wave-director` aus `training-backend/`.

Siehe `training-backend/docs/AI_MODEL_EXPORT.md` für Details (Skript exportiert ONNX, nicht TF.js — Name ist historisch).

## Model Format (Phase 5.10/5.11)

**Input:** 156 Features (encoded game state)
- Tensor Name: `state`
- Shape: `[1, 156]`
- Layout: 116 scalar features + 40 spatial features

**Output:** 36 Werte
- Tensor Name: `action`
- Shape: `[1, 36]`

| Index | Bedeutung |
|-------|-----------|
| 0–31 | Template Logits (32 Slots; 18 aktive Templates, Rest reserviert) |
| 32–35 | Continuous Params: count_factor, spawn_delay_factor, hp_mult_factor, variation |

Die continuous Params werden im Frontend pro gewähltem Template auf die Template-spezifischen Ranges aus `metadata.json` gemappt. Constraints (Curriculum-Gates, Capability-Gates, Boss-Cooldown, DPS-Caps, Wave-Duration-Cap) werden im Decoder angewendet — siehe `docs/PHASE_5.11_RANGES.md`.

## WASM Runtime

Benötigt ONNX Runtime Web WASM-Dateien in `/assets/onnx-wasm/`.
Diese werden automatisch bei `npm install` kopiert (postinstall script).

## Live-Stand

- **Frontend-Architektur:** Phase 5.11 (Range-Based Templates) + Phase 5.16 (Wave-Curriculum, Endgame-Knobs, Gold-Budget) — siehe `docs/PHASE_5.11_RANGES.md` und `docs/HANDOVER_PLAYTEST_PHASE5.16.md`.
- **Deployed Modell:** stammt aus Phase 5.10 (vor 5.11/5.16-Erweiterungen). Frontend-Decoder respektiert die zusätzlichen Constraints, das Modell ist zu den Phase-5.11-Schnittstellen rückwärtskompatibel.
