#!/usr/bin/env python3
"""
Export PyTorch model to ONNX (for frontend inference).

Usage:
    python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_5000.pt
    python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_5000.pt --output ../public/assets/ai/wave-director

Phase 5.10 output format (34 values per sample):
  [0..MAX_TEMPLATE_SLOTS-1]               = template_logits (32)
  [MAX_TEMPLATE_SLOTS..+NUM_CONTINUOUS-1] = raw continuous params (strength, count)

The frontend WaveDirectorService consumes this tensor in decodeModelOutput().
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import torch
import torch.nn as nn

from model import WaveDirectorModel
from config import (
    INPUT_SIZE,
    NUM_SCALAR,
    NUM_SPATIAL,
    MAX_TEMPLATE_SLOTS,
    NUM_CONTINUOUS,
    OUTPUT_SIZE,
    CONTINUOUS_PARAM_NAMES,
    MAX_WAVE_DURATION_MS,
    MIN_SPAWN_DELAY_MS,
    ENEMY_BASE_HP,
)
from templates import TEMPLATES, NUM_ACTIVE_TEMPLATES


class InferenceModel(nn.Module):
    """
    Inference wrapper for ONNX export.

    Strips value head and log_std (not needed at inference time). Returns the
    raw policy outputs as a single concatenated tensor:
      template_logits (MAX_TEMPLATE_SLOTS) + raw params (NUM_CONTINUOUS)
      = OUTPUT_SIZE values per sample.
    """

    def __init__(self, base_model: WaveDirectorModel):
        super().__init__()
        self.spatial = base_model.spatial
        self.scalar = base_model.scalar
        self.combined = base_model.combined
        self.template_head = base_model.template_head
        self.params_head = base_model.params_head

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        scalars = x[:, :NUM_SCALAR]
        spatial = x[:, NUM_SCALAR:]
        spatial = spatial.view(-1, 2, 20)

        spatial_out = self.spatial(spatial).squeeze(-1)
        scalar_out = self.scalar(scalars)

        combined = torch.cat([scalar_out, spatial_out], dim=1)
        features = self.combined(combined)

        template_logits = self.template_head(features)
        params = self.params_head(features)

        return torch.cat([template_logits, params], dim=1)


def export_to_onnx(checkpoint_path: str, output_dir: str, validate: bool = True):
    """Export checkpoint to ONNX."""

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print(f"Loading checkpoint: {checkpoint_path}")
    model = WaveDirectorModel()
    model.load_state_dict(torch.load(checkpoint_path, map_location='cpu'))
    model.eval()

    inference_model = InferenceModel(model)
    inference_model.eval()

    if validate:
        print("Validating model...")
        test_input = torch.randn(1, INPUT_SIZE)
        with torch.no_grad():
            test_output = inference_model(test_input)
        print(f"  Input shape:  {test_input.shape}")
        print(f"  Output shape: {test_output.shape}")
        expected_shape = (1, OUTPUT_SIZE)
        assert test_output.shape == expected_shape, f"Expected {expected_shape}, got {test_output.shape}"
        print(f"  Validation passed! ({OUTPUT_SIZE} = {MAX_TEMPLATE_SLOTS} templates + {NUM_CONTINUOUS} params)")

    onnx_path = output_path / "wave-director.onnx"
    dummy_input = torch.zeros(1, INPUT_SIZE)

    print(f"\nExporting ONNX to: {onnx_path}")
    torch.onnx.export(
        inference_model,
        dummy_input,
        str(onnx_path),
        input_names=['state'],
        output_names=['action'],
        dynamic_axes={
            'state': {0: 'batch'},
            'action': {0: 'batch'},
        },
        opset_version=13,
        do_constant_folding=True,
        dynamo=False,  # Legacy exporter — avoids Unicode issues on Windows.
    )
    print(f"  ONNX file size: {onnx_path.stat().st_size / 1024:.1f} KB")

    # Extract episode number from checkpoint name
    ckpt_name = Path(checkpoint_path).stem
    episode = 0
    if ckpt_name.startswith("checkpoint_"):
        try:
            episode = int(ckpt_name.replace("checkpoint_", ""))
        except ValueError:
            pass

    # Write metadata (Phase 5.10 schema)
    metadata = {
        "version": "5.10.0",
        "architecture": "template-based-wave-director",
        "checkpoint": Path(checkpoint_path).name,
        "trainingEpisodes": episode,
        "exportedAt": datetime.now().isoformat(),
        "inputSize": INPUT_SIZE,
        "outputSize": OUTPUT_SIZE,
        "outputFormat": {
            "templateLogits": [0, MAX_TEMPLATE_SLOTS],
            "params": [MAX_TEMPLATE_SLOTS, OUTPUT_SIZE],
        },
        "stateLayout": {
            "scalarFeatures": NUM_SCALAR,
            "spatialFeatures": NUM_SPATIAL,
        },
        "templateCount": {
            "active": NUM_ACTIVE_TEMPLATES,
            "maxSlots": MAX_TEMPLATE_SLOTS,
        },
        "templates": [
            {
                "slot": i,
                "id": t["id"],
                "name": t["name"],
                "minWave": t["min_wave"],
                "requiresCapability": t.get("requires_capability"),
                "countRange": list(t["count_range"]),
                "spawnDelayRange": list(t["spawn_delay_range"]),
                "hpMultRange": list(t["hp_mult_range"]),
                "variationRange": list(t["variation_range"]),
            }
            for i, t in enumerate(TEMPLATES)
        ],
        "continuousParams": CONTINUOUS_PARAM_NAMES,
        "waveDurationCap": {
            "maxMs": MAX_WAVE_DURATION_MS,
            "minSpawnDelayMs": MIN_SPAWN_DELAY_MS,
        },
        "enemyBaseHP": ENEMY_BASE_HP,
    }

    metadata_path = output_path / "metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"\nMetadata written to: {metadata_path}")

    print(f"\n{'=' * 50}")
    print("Export complete!")
    print(f"Output directory: {output_path}")
    print("Files:")
    for f in sorted(output_path.iterdir()):
        print(f"  - {f.name}")
    print(f"{'=' * 50}")

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Export PyTorch Phase-5.10 model to ONNX"
    )
    parser.add_argument(
        '--checkpoint',
        required=True,
        help='Path to .pt checkpoint file',
    )
    parser.add_argument(
        '--output',
        default='../public/assets/ai/wave-director',
        help='Output directory (default: ../public/assets/ai/wave-director)',
    )
    parser.add_argument(
        '--no-validate',
        action='store_true',
        help='Skip model validation',
    )
    args = parser.parse_args()

    checkpoint_path = Path(args.checkpoint)
    if not checkpoint_path.exists():
        alt_path = Path(__file__).parent.parent / args.checkpoint
        if alt_path.exists():
            checkpoint_path = alt_path
        else:
            print(f"Error: Checkpoint not found: {args.checkpoint}")
            sys.exit(1)

    export_to_onnx(
        str(checkpoint_path),
        args.output,
        validate=not args.no_validate,
    )


if __name__ == '__main__':
    main()
