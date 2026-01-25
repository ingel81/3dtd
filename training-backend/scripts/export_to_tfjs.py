#!/usr/bin/env python3
"""
Export PyTorch model to TensorFlow.js format.

Usage:
    python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_5000.pt
    python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_5000.pt --output ../public/assets/ai/wave-director
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime
import json

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import torch
import torch.nn as nn

from model import WaveDirectorModel
from config import (
    INPUT_SIZE,
    KILL_TIME_MIN,
    KILL_TIME_MAX,
    ENEMY_BASE_HP,
)


class InferenceModel(nn.Module):
    """
    Wrapper for inference-only export.

    Removes value head and log_std (not needed at inference time).
    Output: [enemy_logits (6), params (4)] = 10 values
    """

    def __init__(self, base_model: WaveDirectorModel):
        super().__init__()
        self.spatial = base_model.spatial
        self.scalar = base_model.scalar
        self.combined = base_model.combined
        self.enemy_head = base_model.enemy_head
        self.params_head = base_model.params_head

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass for inference."""
        # Split input into scalar and spatial
        scalars = x[:, :34]                     # (batch, 34)
        spatial = x[:, 34:]                     # (batch, 40)
        spatial = spatial.view(-1, 2, 20)       # (batch, 2, 20)

        # Process branches
        spatial_out = self.spatial(spatial).squeeze(-1)  # (batch, 32)
        scalar_out = self.scalar(scalars)                # (batch, 64)

        # Combine
        combined = torch.cat([scalar_out, spatial_out], dim=1)  # (batch, 96)
        features = self.combined(combined)                       # (batch, 64)

        # Output heads - concatenate for single output tensor
        enemy_logits = self.enemy_head(features)  # (batch, 6)
        params = self.params_head(features)       # (batch, 4)

        return torch.cat([enemy_logits, params], dim=1)  # (batch, 10)


def export_to_onnx(checkpoint_path: str, output_dir: str, validate: bool = True):
    """Export checkpoint to ONNX and TensorFlow.js."""

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Load model
    print(f"Loading checkpoint: {checkpoint_path}")
    model = WaveDirectorModel()
    model.load_state_dict(torch.load(checkpoint_path, map_location='cpu'))
    model.eval()

    # Wrap for inference
    inference_model = InferenceModel(model)
    inference_model.eval()

    # Validate model with test input
    if validate:
        print("Validating model...")
        test_input = torch.randn(1, INPUT_SIZE)
        with torch.no_grad():
            test_output = inference_model(test_input)
        print(f"  Input shape: {test_input.shape}")
        print(f"  Output shape: {test_output.shape}")
        assert test_output.shape == (1, 10), f"Expected (1, 10), got {test_output.shape}"
        print("  Validation passed!")

    # Export to ONNX
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
            'action': {0: 'batch'}
        },
        opset_version=13,
        do_constant_folding=True,
        dynamo=False,  # Use legacy exporter (avoids Unicode issues on Windows)
    )
    print(f"  ONNX file size: {onnx_path.stat().st_size / 1024:.1f} KB")

    # Note: We use ONNX Runtime Web directly in browser, no TF.js conversion needed

    # Extract episode number from checkpoint name
    ckpt_name = Path(checkpoint_path).stem
    episode = 0
    if ckpt_name.startswith("checkpoint_"):
        try:
            episode = int(ckpt_name.replace("checkpoint_", ""))
        except ValueError:
            pass

    # Write metadata
    metadata = {
        "version": "1.0.0",
        "checkpoint": Path(checkpoint_path).name,
        "trainingEpisodes": episode,
        "exportedAt": datetime.now().isoformat(),
        "inputSize": INPUT_SIZE,
        "outputSize": 10,
        "outputFormat": {
            "enemyLogits": [0, 6],
            "params": [6, 10]
        },
        "enemyTypes": ["zombie", "bat", "tank", "wallsmasher", "penguin", "herbert"],
        "constants": {
            "KILL_TIME_MIN": KILL_TIME_MIN,
            "KILL_TIME_MAX": KILL_TIME_MAX,
            "SPAWN_DELAY_MIN": 500,
            "SPAWN_DELAY_MAX": 2000,
            "VARIATION_MAX": 0.3,
            "HEALTH_MULTIPLIER_MAX": 20.0
        },
        "enemyBaseHP": ENEMY_BASE_HP
    }

    metadata_path = output_path / "metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"\nMetadata written to: {metadata_path}")

    # Optionally clean up ONNX file (keep for debugging)
    # onnx_path.unlink()

    print(f"\n{'=' * 50}")
    print(f"Export complete!")
    print(f"Output directory: {output_path}")
    print(f"Files:")
    for f in sorted(output_path.iterdir()):
        print(f"  - {f.name}")
    print(f"{'=' * 50}")

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Export PyTorch model to TensorFlow.js format"
    )
    parser.add_argument(
        '--checkpoint',
        required=True,
        help='Path to .pt checkpoint file'
    )
    parser.add_argument(
        '--output',
        default='../public/assets/ai/wave-director',
        help='Output directory for TF.js model (default: ../public/assets/ai/wave-director)'
    )
    parser.add_argument(
        '--no-validate',
        action='store_true',
        help='Skip model validation'
    )
    args = parser.parse_args()

    # Verify checkpoint exists
    checkpoint_path = Path(args.checkpoint)
    if not checkpoint_path.exists():
        # Try relative to training-backend
        alt_path = Path(__file__).parent.parent / args.checkpoint
        if alt_path.exists():
            checkpoint_path = alt_path
        else:
            print(f"Error: Checkpoint not found: {args.checkpoint}")
            sys.exit(1)

    export_to_onnx(
        str(checkpoint_path),
        args.output,
        validate=not args.no_validate
    )


if __name__ == '__main__':
    main()
