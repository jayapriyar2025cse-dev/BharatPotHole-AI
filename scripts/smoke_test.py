"""
Quick end-to-end sanity check of the inference package (run after training).

Loads ai_module/best.pt and runs one prediction on a test image.
Usage:  python scripts/smoke_test.py
"""

import sys
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[1]      # .../ai_module
sys.path.insert(0, str(MODULE_DIR))

from inference import PotholeDetector                 # noqa: E402


def main() -> None:
    model_path = MODULE_DIR / "best.pt"
    if not model_path.is_file():
        raise SystemExit(f"best.pt not found at {model_path} - train first (scripts/train.py)")

    detector = PotholeDetector(model_path=model_path)
    print("Loaded:", detector.model_path.name, "| classes:", detector.class_names)

    images = sorted((MODULE_DIR / "dataset_clean" / "test" / "images").glob("*.jpg"))
    if not images:
        raise SystemExit("No test images found - run scripts/prepare_dataset.py first")
    sample = images[0]

    result = detector.predict(sample)
    print("sample:", sample.name)
    print("detected:", result["detected"], "| count:", result["count"],
          "| confidence:", result["confidence"], "| latency_ms:", result["latency_ms"])
    assert isinstance(result["detected"], bool)
    assert result["count"] == len(result["boxes"])
    assert result["count"] == len(result["confidences"])
    if result["count"]:
        assert 0.0 <= result["confidence"] <= 1.0
    print("SMOKE TEST PASSED")


if __name__ == "__main__":
    main()
