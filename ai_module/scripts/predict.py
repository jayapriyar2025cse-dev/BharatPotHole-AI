"""
Step 4 - Run the trained model on unseen images / folders / videos (CLI demo).

For each source the script prints a JSON summary and (optionally) saves an
annotated image to --save-dir. For videos it writes an annotated video and
prints measured (real, not claimed) per-frame latency.

Usage:
  python scripts/predict.py --source "C:/path/image.jpg"
  python scripts/predict.py --source "C:/path/test_images_dir" --save-dir samples
  python scripts/predict.py --source "C:/path/video.mp4" --save-dir samples
  python scripts/predict.py --source image.jpg --conf 0.4 --no-save
"""

import argparse
import json
import sys
import time
from pathlib import Path

import cv2

MODULE_DIR = Path(__file__).resolve().parents[1]      # .../ai_module
sys.path.insert(0, str(MODULE_DIR))                   # make `inference` importable
from inference import PotholeDetector                 # noqa: E402

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
DEFAULT_SAVE = MODULE_DIR / "samples"


def collect_images(source: Path) -> list[Path]:
    if source.is_dir():
        return sorted(p for p in source.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    return [source]


def run_images(detector: PotholeDetector, source: Path, args) -> None:
    images = collect_images(source)
    if not images:
        raise SystemExit(f"No images found at: {source}")
    total = hits = 0
    for img_path in images:
        result = detector.predict(img_path)
        total += 1
        hits += 1 if result["detected"] else 0
        print(json.dumps({
            "source": str(img_path),
            "detected": result["detected"],
            "count": result["count"],
            "confidence": result["confidence"],
            "boxes": result["boxes"],
            "latency_ms": result["latency_ms"],
        }))
        if not args.no_save:
            image = cv2.imread(str(img_path))
            annotated = detector.draw(image, result)
            args.save_dir.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(args.save_dir / img_path.name), annotated)
    print(json.dumps({"summary": f"{hits}/{total} images contained potholes"}))


def run_video(detector: PotholeDetector, video_path: Path, args) -> None:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise SystemExit(f"Could not open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    writer = None
    if not args.no_save:
        args.save_dir.mkdir(parents=True, exist_ok=True)
        out_path = args.save_dir / f"annotated_{video_path.name}"
        writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    frames = with_pothole = total_count = 0
    latencies = []
    t_start = time.perf_counter()
    while True:
        ok, frame = cap.read()
        if not ok or (args.max_frames and frames >= args.max_frames):
            break
        result = detector.predict(frame)
        frames += 1
        latencies.append(result["latency_ms"])
        if result["detected"]:
            with_pothole += 1
            total_count += result["count"]
        if writer is not None:
            writer.write(detector.draw(frame, result))
    wall = time.perf_counter() - t_start
    cap.release()
    if writer is not None:
        writer.release()

    if not frames:
        raise SystemExit("Video contained no readable frames.")
    latencies.sort()
    print(json.dumps({
        "video": str(video_path),
        "frames": frames,
        "frames_with_pothole": with_pothole,
        "avg_potholes_per_flagged_frame": round(total_count / max(1, with_pothole), 2),
        "latency_ms_avg": round(sum(latencies) / len(latencies), 2),
        "latency_ms_median": round(latencies[len(latencies) // 2], 2),
        "processed_fps": round(frames / wall, 2),
        "note": "measured on this machine; not a real-time guarantee",
    }, indent=2))


def main() -> None:
    p = argparse.ArgumentParser(description="Pothole detection on image/folder/video")
    p.add_argument("--source", required=True, help="image, folder, or video path")
    p.add_argument("--model", type=Path, default=MODULE_DIR / "best.pt")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--iou", type=float, default=0.45)
    p.add_argument("--device", default=None, help="cpu / 0 / None=auto")
    p.add_argument("--save-dir", type=Path, default=DEFAULT_SAVE)
    p.add_argument("--no-save", action="store_true", help="do not write annotated output")
    p.add_argument("--max-frames", type=int, default=0, help="limit video frames (0 = all)")
    args = p.parse_args()

    source = Path(args.source)
    if not source.exists():
        raise SystemExit(f"Source not found: {source}")

    detector = PotholeDetector(
        model_path=args.model, conf_threshold=args.conf,
        iou_threshold=args.iou, device=args.device,
    )
    if source.suffix.lower() in VIDEO_EXTS:
        run_video(detector, source, args)
    else:
        run_images(detector, source, args)


if __name__ == "__main__":
    main()
