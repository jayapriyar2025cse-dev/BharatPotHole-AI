"""
Step 2 - Train a YOLO pothole detector (our own thin, configurable wrapper).

Reproducible: model name, image size, epochs, batch size, seed and the
resulting metrics are all recorded in a JSON report.

Outputs:
  * runs/train/<name>/weights/last.pt and best.pt   (Ultralytics run folder)
  * ai_module/best.pt                               (copy of best.pt)
  * reports/training_report.json                    (config + metrics)

Usage:
  python scripts/train.py --epochs 1 --name benchmark      # speed benchmark
  python scripts/train.py --epochs 30 --batch 16           # full training
"""

import argparse
import csv
import json
import platform
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[1]     # .../ai_module
DEFAULT_DATA = MODULE_DIR / "config" / "data.yaml"
DEFAULT_PROJECT = MODULE_DIR / "runs" / "train"
DEFAULT_REPORT = MODULE_DIR / "reports" / "training_report.json"
DEFAULT_COPY_TO = MODULE_DIR / "best.pt"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train YOLO pothole detector")
    p.add_argument("--data", type=Path, default=DEFAULT_DATA, help="dataset yaml")
    p.add_argument("--model", default="yolo11n.pt",
                   help="base weights: yolo11n.pt (pretrained) or yolov8n.pt")
    p.add_argument("--imgsz", type=int, default=640, help="training image size")
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--batch", type=int, default=16, help="batch size (-1 = auto)")
    p.add_argument("--seed", type=int, default=42, help="random seed")
    p.add_argument("--device", default="cpu", help="cpu, 0, 0,1 ...")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--name", default="pothole-yolo11n", help="run name")
    p.add_argument("--resume", action="store_true",
                   help="resume the last run of the same --name from last.pt")
    p.add_argument("--project", type=Path, default=DEFAULT_PROJECT)
    p.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    p.add_argument("--copy-best-to", type=Path, default=DEFAULT_COPY_TO,
                   help="where to copy best.pt ('' to disable)")
    return p.parse_args()


def read_results_csv(save_dir: Path):
    """Return (best_epoch_row, last_epoch_row) dicts from results.csv."""
    path = save_dir / "results.csv"
    if not path.exists():
        return None, None
    with path.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        return None, None
    key = "metrics/mAP50-95(B)"
    best = max(rows, key=lambda r: float(r.get(key) or 0))
    return best, rows[-1]


def main() -> None:
    args = parse_args()
    if not args.data.is_file():
        sys.exit(f"ERROR: dataset config not found: {args.data}")

    config = {k: (str(v) if isinstance(v, Path) else v)
              for k, v in vars(args).items() if k != "copy_best_to"}
    config["copy_best_to"] = str(args.copy_best_to)
    print("=== Training configuration ===")
    print(json.dumps(config, indent=2))

    from ultralytics import YOLO          # import after arg parsing (venv check)

    start = time.time()
    model = YOLO(args.model)
    results = model.train(
        data=str(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        seed=args.seed,
        device=args.device,
        workers=args.workers,
        project=str(args.project),
        name=args.name,
        exist_ok=True,
        resume=args.resume,
        verbose=True,
    )
    duration = round(time.time() - start, 1)

    save_dir = Path(model.trainer.save_dir)
    best_pt = save_dir / "weights" / "best.pt"
    if args.copy_best_to and str(args.copy_best_to) and best_pt.exists():
        args.copy_best_to.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best_pt, args.copy_best_to)
        print(f"Copied best model -> {args.copy_best_to}")

    best_row, last_row = read_results_csv(save_dir)

    import torch
    import ultralytics
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "config": config,
        "environment": {
            "python": platform.python_version(),
            "ultralytics": ultralytics.__version__,
            "torch": torch.__version__,
            "platform": platform.platform(),
            "cpu": platform.processor() or platform.machine(),
        },
        "duration_seconds": duration,
        "run_dir": str(save_dir),
        "best_model": str(args.copy_best_to) if str(args.copy_best_to) else str(best_pt),
        "best_epoch_metrics_from_csv": best_row,
        "last_epoch_metrics_from_csv": last_row,
        "note": "Authoritative Precision/Recall/mAP numbers come from "
                "scripts/evaluate.py (reports/metrics.json) on val and test splits.",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"\nTraining finished in {duration}s")
    if best_row:
        print("Best epoch (by mAP50-95) validation metrics:",
              {k: v for k, v in best_row.items() if k.startswith("metrics/")})
    print(f"Report: {args.report}")


if __name__ == "__main__":
    main()
