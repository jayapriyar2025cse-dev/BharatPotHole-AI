"""
Step 1b - Prepare a training-safe copy of the dataset labels (derived tree).

Why this is needed: the original Roboflow export mixes two label row styles
inside the SAME files (verified: 24 files):
  * YOLO bbox rows:        0 cx cy w h              (5 fields)
  * polygon/segment rows:  0 x1 y1 x2 y2 ... xn yn  (odd fields > 5)
Ultralytics raises "labels mix segment and detection rows" on mixed files,
so training must not read the original labels directly.

This script builds a DERIVED tree (originals are NEVER written to):
  * every label file is rewritten with polygon rows converted to bounding
    boxes using min/max of the polygon points (simple, our own math)
  * image folders are rebuilt with per-file HARDLINKS (no disk space used;
    unlike junctions, hardlinks are not followed by Path.resolve(), so
    Ultralytics reads labels from this derived tree, not the original)

Output:  ai_module/dataset_clean/{train,valid,test}/{images,labels}
         ai_module/reports/dataset_prepare_report.json
Usage:   python scripts/prepare_dataset.py [--src PATH] [--dst PATH]
"""

import argparse
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[1]            # .../ai_module
DEFAULT_SRC = MODULE_DIR.parent / "BharatPotHole"           # original dataset
DEFAULT_DST = MODULE_DIR / "dataset_clean"                  # derived tree
DEFAULT_REPORT = MODULE_DIR / "reports" / "dataset_prepare_report.json"
SPLITS = ("train", "valid", "test")
REPARSE_POINT = 0x400        # FILE_ATTRIBUTE_REPARSE_POINT (junction/symlink)


def polygon_to_bbox(cls_token: str, coord_tokens: list) -> str:
    """Convert one polygon row (class x1 y1 ... xn yn) to a YOLO bbox row."""
    vals = [float(v) for v in coord_tokens]
    if len(vals) % 2 != 0:
        raise ValueError("odd number of coordinates in polygon")
    xs, ys = vals[0::2], vals[1::2]
    x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
    w, h = x2 - x1, y2 - y1
    if w <= 0 or h <= 0:
        raise ValueError("degenerate polygon (zero width/height)")
    return f"{cls_token} {(x1 + x2) / 2:.6f} {(y1 + y2) / 2:.6f} {w:.6f} {h:.6f}"


def convert_label_file(src: Path, dst: Path) -> tuple:
    """Rewrite one label file. Returns (bbox_rows_kept, polygon_rows_converted, errors)."""
    kept = converted = 0
    errors = []
    out_lines = []
    for i, raw in enumerate(src.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) == 5:
            out_lines.append(" ".join(parts))
            kept += 1
        elif len(parts) > 5 and len(parts) % 2 == 1:      # 1 class + 2n coords
            try:
                out_lines.append(polygon_to_bbox(parts[0], parts[1:]))
                converted += 1
            except ValueError as exc:
                errors.append(f"{src.name}:{i} {exc}")
        else:
            errors.append(f"{src.name}:{i} unexpected field count {len(parts)}")
    text = "\n".join(out_lines)
    dst.write_text(text + ("\n" if text else ""), encoding="utf-8")
    return kept, converted, errors


def relink_images(src_images: Path, dst_images: Path) -> str:
    """Expose every image file under dst_images as a hardlink (copy fallback).

    Hardlinks share the original data blocks (zero extra disk usage) and are
    plain files to Path.resolve(), so Ultralytics derives label paths from THIS
    tree instead of following a directory link back into the original dataset.
    """
    if os.path.lexists(str(dst_images)):
        try:
            attrs = os.lstat(str(dst_images)).st_file_attributes
        except OSError:
            attrs = 0
        if attrs & REPARSE_POINT:                 # remove old junction/symlink
            subprocess.run(["cmd", "/c", "rmdir", str(dst_images)],
                           capture_output=True, check=False)
        if os.path.lexists(str(dst_images)) and not dst_images.is_dir():
            raise RuntimeError(f"Unexpected path type: {dst_images}")
    dst_images.mkdir(parents=True, exist_ok=True)

    linked = copied = reused = 0
    for src_file in src_images.iterdir():
        if not src_file.is_file():
            continue
        dst_file = dst_images / src_file.name
        if os.path.lexists(str(dst_file)):
            try:
                if os.path.samefile(src_file, dst_file):
                    reused += 1
                    continue
            except OSError:
                pass
            dst_file.unlink()
        try:
            os.link(src_file, dst_file)
            linked += 1
        except OSError:
            shutil.copy2(src_file, dst_file)
            copied += 1
    if linked + copied + reused == 0:
        raise RuntimeError(f"No images linked from {src_images}")
    return f"hardlinks={linked} copies={copied} reused={reused}"


def main() -> None:
    ap = argparse.ArgumentParser(description="Build derived dataset tree with clean labels")
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC, help="ORIGINAL dataset (read-only)")
    ap.add_argument("--dst", type=Path, default=DEFAULT_DST, help="derived output tree")
    ap.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = ap.parse_args()

    report = {"generated_at": datetime.now(timezone.utc).isoformat(),
              "source_read_only": str(args.src), "destination": str(args.dst),
              "splits": {}, "errors": []}

    for split in SPLITS:
        src_split = args.src / split
        if not src_split.is_dir():
            report["errors"].append(f"missing split: {src_split}")
            continue
        dst_labels = args.dst / split / "labels"
        dst_labels.mkdir(parents=True, exist_ok=True)
        # Real folder owned by us -> safe to clear and rebuild.
        for old in dst_labels.glob("*.txt"):
            old.unlink()

        kept = converted = files = 0
        for src_label in sorted((src_split / "labels").glob("*.txt")):
            k, c, errs = convert_label_file(src_label, dst_labels / src_label.name)
            kept += k
            converted += c
            files += 1
            report["errors"] += [f"[{split}] {e}" for e in errs]

        link_mode = relink_images(src_split / "images", args.dst / split / "images")
        report["splits"][split] = {"label_files": files, "bbox_rows_kept": kept,
                                   "polygon_rows_converted": converted,
                                   "images": link_mode}

    report["passed"] = not report["errors"]
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")

    for split, info in report["splits"].items():
        print(f"{split:>6}: files={info['label_files']} bbox_rows={info['bbox_rows_kept']} "
              f"polygon_converted={info['polygon_rows_converted']} images={info['images']}")
    if report["errors"]:
        print("ERRORS:")
        for e in report["errors"][:20]:
            print("  -", e)
    print(f"\nDerived tree: {args.dst}")
    print(f"Report:       {args.report}")
    print("Original dataset was only read, never modified.")


if __name__ == "__main__":
    main()
