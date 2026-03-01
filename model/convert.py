"""
Convert the trained Keras .h5 model to TensorFlow.js LayersModel format.
Copies vocab.json and labels.json alongside the model artifacts.
"""

import shutil
import subprocess
import sys
from pathlib import Path

MODEL_PATH = Path("/Volumes/wintermute/docs/fhegis/pii_ner.h5")
DATA_DIR = Path(__file__).parent / "data"
OUTPUT_DIR = Path(__file__).parent / "tfjs_model"
EXTENSION_MODEL_DIR = Path(__file__).parent.parent / "extension" / "public" / "model"


def main():
    if not MODEL_PATH.exists():
        print(f"Error: {MODEL_PATH} not found. Run train.py first.")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Converting Keras .h5 → TF.js LayersModel...")
    subprocess.run(
        [
            sys.executable, "-m", "tensorflowjs.converters.converter",
            "--input_format=keras",
            "--output_format=tfjs_layers_model",
            str(MODEL_PATH),
            str(OUTPUT_DIR),
        ],
        check=True,
    )

    # Copy vocab and labels alongside model
    for name in ("vocab.json", "labels.json"):
        src = DATA_DIR / name
        if src.exists():
            shutil.copy2(src, OUTPUT_DIR / name)
            print(f"  Copied {name}")
        else:
            print(f"  Warning: {src} not found")

    print(f"\nTF.js model written to {OUTPUT_DIR}")

    # Also copy into extension/public/model/ so the extension build includes it
    EXTENSION_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for item in OUTPUT_DIR.iterdir():
        dst = EXTENSION_MODEL_DIR / item.name
        if item.is_file():
            shutil.copy2(item, dst)
    print(f"Copied to {EXTENSION_MODEL_DIR}")


if __name__ == "__main__":
    main()
