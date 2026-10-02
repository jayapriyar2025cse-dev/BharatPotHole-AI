"""
Utility - Build a short demo video from test-split frames.

The BharatPothole dataset contains no video files, so this script stitches
consecutive dashcam frames into an .mp4. This lets us honestly exercise the
video branch of scripts/predict.py (frame-by-frame detection + measured
latency) without pretending we tested on a real traffic clip.

Usage:
  python scripts/make_demo_video.py --pattern 20250404112203 --frames 24
  python scripts/make_demo_video.py            # first 24 sorted test frames
"""

import argparse
from pathlib import Path

import cv2

MODULE_DIR = Path(__file__).resolve().parents[1]          # .../ai_module
DEFAULT_SRC = MODULE_DIR / "dataset_clean" / "test" / "images"
DEFAULT_OUT = MODULE_DIR / "samples" / "demo_test_frames.mp4"
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def main() -> None:
    ap = argparse.ArgumentParser(description="Stitch test frames into a demo video")
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC, help="image folder")
    ap.add_argument("--pattern", default="", help="only use files containing this text")
    ap.add_argument("--frames", type=int, default=24, help="max frames to include")
    ap.add_argument("--fps", type=float, default=10.0)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    images = sorted(p for p in args.src.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if args.pattern:
        images = [p for p in images if args.pattern in p.name]
    images = images[: args.frames]
    if not images:
        raise SystemExit(f"No matching images in {args.src}")

    first = cv2.imread(str(images[0]))
    if first is None:
        raise SystemExit(f"Could not read {images[0]}")
    height, width = first.shape[:2]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(args.out), cv2.VideoWriter_fourcc(*"mp4v"),
                             args.fps, (width, height))
    used = 0
    for path in images:
        img = cv2.imread(str(path))
        if img is None or img.shape[:2] != (height, width):
            continue
        writer.write(img)
        used += 1
    writer.release()
    print(f"Wrote {used} frames ({width}x{height} @ {args.fps} fps) -> {args.out}")


if __name__ == "__main__":
    main()
