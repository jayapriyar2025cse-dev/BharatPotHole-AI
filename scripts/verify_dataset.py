"""
Step 1 - Verify the BharatPothole YOLO dataset (read-only, never modifies it).

Checks per split (train/valid/test):
  * every image has a matching label file (and vice versa)
  * label lines have exactly 5 values:  class cx cy w h
  * class id is 0 (only the 'pothole' class allowed)
  * box coordinates normalized to [0,1] with w>0, h>0
  * counts empty label files (negative images)
  * samples image dimensions (header read only -> fast)

Output: reports/dataset_report.json
Usage:  python scripts/verify_dataset.py [--dataset-root PATH]
"""

import argparse
import json
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
MODULE_DIR = Path(__file__).resolve().parents[1]           # .../ai_module
DEFAULT_DATASET_ROOT = MODULE_DIR.parent / "BharatPotHole"  # dataset = sibling folder
DEFAULT_OUT = MODULE_DIR / "reports" / "dataset_report.json"


def verify_split(split_dir: Path, sample_size: int = 50) -> dict:
    images = sorted(p for p in (split_dir / "images").iterdir() if p.suffix.lower() in IMAGE_EXTS)
    labels = sorted((split_dir / "labels").glob("*.txt"))
    img_stems, lbl_stems = {p.stem for p in images}, {p.stem for p in labels}

    empty = total = invalid = bad_cls = oor = 0
    class_ids: Counter = Counter()
    for lf in labels:
        if lf.stem not in img_stems:
            continue
        lines = [ln for ln in lf.read_text(encoding="utf-8").splitlines() if ln.strip()]
        if not lines:
            empty += 1
        for line in lines:
            parts = line.split()
            try:
                cls = int(float(parts[0])) if len(parts) == 5 else -1
                cx, cy, w, h = (float(v) for v in parts[1:5]) if len(parts) == 5 else (0,) * 4
            except ValueError:
                invalid += 1
                continue
            if len(parts) != 5:
                invalid += 1
                continue
            class_ids[cls] += 1
            total += 1
            if cls != 0:
                bad_cls += 1
            if not (0 <= cx <= 1 and 0 <= cy <= 1 and 0 < w <= 1 and 0 < h <= 1):
                oor += 1

    sizes: Counter = Counter()
    for img in random.sample(images, min(sample_size, len(images))):
        try:
            with Image.open(img) as im:
                sizes[f"{im.width}x{im.height}"] += 1
        except Exception as exc:
            sizes[f"unreadable: {exc}"] += 1

    issues = []
    missing, orphans = sorted(img_stems - lbl_stems), sorted(lbl_stems - img_stems)
    if missing:
        issues.append(f"{len(missing)} images w/o label (e.g. {missing[:2]})")
    if orphans:
        issues.append(f"{len(orphans)} labels w/o image (e.g. {orphans[:2]})")
    if invalid:
        issues.append(f"{invalid} malformed label lines")
    if bad_cls:
        issues.append(f"{bad_cls} lines with class id != 0")
    if oor:
        issues.append(f"{oor} boxes outside [0,1] range")

    return {
        "images": len(images), "labels": len(labels),
        "paired": len(img_stems & lbl_stems),
        "missing_labels": missing[:20], "orphan_labels": orphans[:20],
        "empty_label_files": empty, "total_boxes": total,
        "boxes_per_image_avg": round(total / max(1, len(images)), 2),
        "class_ids": dict(class_ids), "invalid_lines": invalid,
        "non_class0_lines": bad_cls, "out_of_range_boxes": oor,
        "sampled_image_sizes": dict(sizes.most_common(5)),
        "issues": issues,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Verify YOLO pothole dataset (read-only)")
    ap.add_argument("--dataset-root", type=Path, default=DEFAULT_DATASET_ROOT)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--sample-size", type=int, default=50)
    args = ap.parse_args()

    report = {"generated_at": datetime.now(timezone.utc).isoformat(),
              "dataset_root": str(args.dataset_root), "splits": {}, "issues": []}
    for split in ("train", "valid", "test"):
        d = args.dataset_root / split
        if not d.is_dir():
            report["issues"].append(f"missing split folder: {d}")
            continue
        report["splits"][split] = verify_split(d, args.sample_size)
        report["issues"] += [f"[{split}] {i}" for i in report["splits"][split]["issues"]]
    report["passed"] = not report["issues"]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")

    for split, info in report["splits"].items():
        print(f"{split:>6}: images={info['images']} labels={info['labels']} "
              f"paired={info['paired']} boxes={info['total_boxes']} "
              f"empty={info['empty_label_files']} sizes={info['sampled_image_sizes']}")
    print("\nISSUES FOUND:" if report["issues"] else "\nAll checks passed: format OK, no missing files.")
    for issue in report["issues"]:
        print(f"  - {issue}")
    print(f"\nReport written to: {args.out}")


if __name__ == "__main__":
    main()
