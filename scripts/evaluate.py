"""
Step 3 - Evaluate a trained model on the validation and test splits.

Reports: Precision, Recall, mAP50, mAP50-95 (overall + per-class),
saves the confusion matrix and F1 curve as images.

Outputs:
  * reports/metrics.json
  * reports/confusion_matrix_valid.png / confusion_matrix_test.png
  * reports/f1_curve_valid.png / f1_curve_test.png

Usage:
  python scripts/evaluate.py                       # valid + test, uses best.pt
  python scripts/evaluate.py --model runs/train/pothole-yolo11n/weights/best.pt
"""

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[1]      # .../ai_module
DEFAULT_MODEL = MODULE_DIR / "best.pt"
DEFAULT_DATA = MODULE_DIR / "config" / "data.yaml"
DEFAULT_OUT = MODULE_DIR / "reports"
SPLIT_MAP = {"valid": "val", "test": "test", "train": "train"}


def evaluate_split(model, args, split: str) -> dict:
    results = model.val(
        data=str(args.data),
        split=SPLIT_MAP[split],
        imgsz=args.imgsz,
        batch=args.batch,
        conf=args.conf,
        iou=args.iou,
        device=args.device,
        plots=True,
        verbose=True,
    )
    # Ultralytics versions differ: val() may return Results (.box) or DetMetrics.
    box = getattr(results, "box", results)
    names = getattr(results, "names", None) or getattr(box, "names", None) or model.names
    ap50 = list(getattr(box, "ap50", []))
    ap = list(getattr(box, "ap", []))
    per_class = {}
    for cls_id, cls_name in names.items():
        per_class[cls_name] = {
            "mAP50": round(float(ap50[cls_id]), 4) if cls_id < len(ap50) else None,
            "mAP50-95": round(float(ap[cls_id]), 4) if cls_id < len(ap) else None,
        }
    results_dict = getattr(results, "results_dict", None) or getattr(box, "results_dict", {})
    metrics = {
        "split": split,
        "precision": round(float(box.mp), 4),
        "recall": round(float(box.mr), 4),
        "mAP50": round(float(box.map50), 4),
        "mAP50-95": round(float(box.map), 4),
        "per_class": per_class,
        "raw_results_dict": {k: round(float(v), 6) for k, v in results_dict.items()},
    }

    # Copy the plots we need into reports/
    save_dir = getattr(results, "save_dir", None) or getattr(box, "save_dir", None)
    if save_dir:
        for src_name, dst_name in (
            ("confusion_matrix_normalized.png", f"confusion_matrix_{split}.png"),
            ("F1_curve.png", f"f1_curve_{split}.png"),
        ):
            src = Path(save_dir) / src_name
            if src.exists():
                shutil.copy2(src, args.out / dst_name)
    return metrics


def main() -> None:
    p = argparse.ArgumentParser(description="Evaluate pothole detector")
    p.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    p.add_argument("--data", type=Path, default=DEFAULT_DATA)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--conf", type=float, default=0.001,
                   help="conf threshold for evaluation; keep at 0.001 (Ultralytics "
                        "default) so mAP is computed over the full confidence range; "
                        "the deploy threshold (0.25) lives in predict/detector")
    p.add_argument("--iou", type=float, default=0.45, help="NMS IoU threshold")
    p.add_argument("--device", default="cpu")
    p.add_argument("--split", choices=["valid", "test", "both"], default="both")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = p.parse_args()

    if not args.model.is_file():
        raise SystemExit(f"ERROR: model not found: {args.model} (train first)")
    if not args.data.is_file():
        raise SystemExit(f"ERROR: dataset config not found: {args.data}")

    from ultralytics import YOLO
    model = YOLO(str(args.model))
    args.out.mkdir(parents=True, exist_ok=True)

    splits = ["valid", "test"] if args.split == "both" else [args.split]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": str(args.model),
        "data": str(args.data),
        "imgsz": args.imgsz,
        "conf_threshold": args.conf,
        "iou_threshold": args.iou,
        "splits": {},
    }

    header = f"{'split':>7} | {'Precision':>9} | {'Recall':>7} | {'mAP50':>7} | {'mAP50-95':>9}"
    print("\n" + header)
    print("-" * len(header))
    for split in splits:
        report["splits"][split] = evaluate_split(model, args, split)
        m = report["splits"][split]
        print(f"{split:>7} | {m['precision']:>9} | {m['recall']:>7} | "
              f"{m['mAP50']:>7} | {m['mAP50-95']:>9}")

    out_path = args.out / "metrics.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nMetrics written to: {out_path}")
    print(f"Plots written to:   {args.out}/confusion_matrix_<split>.png, "
          f"f1_curve_<split>.png")


if __name__ == "__main__":
    main()
