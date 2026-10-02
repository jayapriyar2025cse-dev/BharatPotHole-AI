# BharatPothole AI Module — Pothole Detection (SIH26124, BEL)

Computer-vision module for the "AI-Powered Mobile Urban Intelligence Platform
using Public Transport Fleet" problem statement. This folder is **independent**
of the mobile app and backend: it only produces a model file (`best.pt`), an
inference class, and reports.

## 1. What this module contains

```
ai_module/
├── best.pt                      # trained model (copy, produced by training)
├── config/
│   └── data.yaml                # corrected dataset paths (original file untouched)
├── scripts/
│   ├── verify_dataset.py        # step 1: dataset + annotation checks (read-only)
│   ├── prepare_dataset.py       # step 1b: build derived tree (fix polygon labels)
│   ├── train.py                 # step 2: training wrapper (reproducible config)
│   ├── evaluate.py              # step 3: Precision/Recall/mAP + confusion matrix
│   ├── predict.py               # step 4: run on images / folders / videos
│   ├── smoke_test.py            # quick end-to-end check of the inference package
│   └── make_demo_video.py       # stitch test frames into a demo clip
├── inference/
│   ├── __init__.py
│   └── pothole_detector.py      # API-ready class (import this in the backend)
├── dataset_clean/               # DERIVED training tree (labels fixed; images are
│                                # hardlinks -> no extra disk space used)
├── reports/                     # dataset reports, training_report.json,
│                                # metrics.json, confusion matrices, curves
├── samples/                     # sample annotated prediction outputs
├── runs/train/<run>/            # full Ultralytics run (weights, curves, args)
├── requirements.txt             # human-readable dependencies
├── requirements-lock.txt        # exact versions from this machine
└── README.md                    # this file
```

## 2. Environment setup

```powershell
cd <path-to>\ai_module
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt
```

All commands below assume `.venv\Scripts\python` is the interpreter
(prefix them or activate the venv with `.venv\Scripts\Activate.ps1`).

## 3. Usage (the exact order we used)

```powershell
# 1. Verify original dataset (read-only) - reports any annotation problems
python scripts/verify_dataset.py

# 1b. Build the derived training tree (fixes mixed polygon/bbox labels,
#     original dataset stays untouched; images exposed via hardlinks)
python scripts/prepare_dataset.py

# 2. Train (benchmark: 1 epoch took 43m37s on this CPU, so the full run used 4)
python scripts/train.py --epochs 4 --batch 16 --imgsz 640 --seed 42 --name pothole-yolo11n

# 3. Evaluate on validation + test splits
python scripts/evaluate.py --model best.pt --split both

# 4. Inference on unseen data
python scripts/predict.py --source <image-or-folder-or-video>
```

Every script accepts `--help` and exposes paths as CLI arguments — nothing is
hardcoded except sensible defaults.

### Dataset quirk we found (important for the viva)

The Roboflow export mixes two label row styles — plain YOLO bboxes
(`0 cx cy w h`) and **polygon rows** (`0 x1 y1 ... xn yn`). 371 polygon rows
exist, and **24 files mix both styles in one file**, which makes Ultralytics
abort with *"labels mix segment and detection rows"*. `prepare_dataset.py`
converts every polygon row to its bounding box (min/max of the points) into
`dataset_clean/`, so training reads only uniform 5-column labels.
See `reports/dataset_report_original.json` (problems found) vs
`reports/dataset_report.json` (clean tree: all checks passed).

## 4. Model & reproducibility record

| Item | Value |
|---|---|
| Model | YOLO11n — `yolo11n.pt` (COCO-pretrained transfer learning) |
| Input size | 640×640 |
| Epochs | 4 — chosen from a measured 1-epoch benchmark: 43 min 37 s/epoch on this CPU (3 ≈ 2.4 h, 4 ≈ 3.2 h, 5 ≈ 4 h). For higher accuracy re-run with `--epochs 15..30` on a GPU. |
| Batch size | 16 |
| Seed | 42 |
| Device | CPU only — Intel Core i5-1334U (no GPU on this machine) |
| Optimizer | AdamW, chosen automatically by Ultralytics (`optimizer=auto`) |
| Framework | ultralytics 8.4.168, torch 2.14.0+cpu, Python 3.11.8 |
| Full lock file | `requirements-lock.txt` |
| Dataset | BharatPothole (Roboflow export v14, CC BY 4.0), 7074 images (5067/1345/662) |
| Labels | 1 class `pothole`; 12,221 bboxes after polygon→bbox conversion |

## 5. Evaluation metrics

(filled after evaluation — from reports/metrics.json)

## 6. Integration instructions / API contract (for the backend developer)

### 6.1 What you need

- This repo folder `ai_module` (or just `best.pt` + `inference/pothole_detector.py`)
- Python packages from `requirements.txt`
- One detector instance created **once** at server startup, then reused

### 6.2 Python contract

```python
from inference import PotholeDetector

detector = PotholeDetector(            # loads best.pt once
    model_path="path/to/best.pt",      # default: ai_module/best.pt
    conf_threshold=0.25,               # detections below this are dropped
    iou_threshold=0.45,                # NMS IoU
)

result = detector.predict("road.jpg")  # file path OR numpy BGR image (cv2)
```

`result` is a plain `dict`, JSON-serializable as-is:

```json
{
  "detected": true,
  "count": 2,
  "confidence": 0.87,
  "confidences": [0.87, 0.41],
  "boxes": [
    {"bbox_xyxy": [120.5, 300.2, 415.0, 512.7], "confidence": 0.87,
     "class_id": 0, "class_name": "pothole"}
  ],
  "image_size": {"width": 1280, "height": 720},
  "conf_threshold": 0.25,
  "model": "best.pt",
  "latency_ms": 42.3
}
```

Field meanings:

| Field | Type | Meaning |
|---|---|---|
| `detected` | bool | `true` if at least one pothole found |
| `count` | int | number of potholes detected |
| `confidence` | float/null | highest confidence score (null if none) |
| `boxes[].bbox_xyxy` | [x1,y1,x2,y2] | pixels: left, top, right, bottom of input image |
| `latency_ms` | float | measured wall-clock time for this call (not a guarantee) |

### 6.3 Example FastAPI route (documentation only — we do not ship backend code)
```python
import cv2, numpy as np
from fastapi import FastAPI, UploadFile
from inference import PotholeDetector

app = FastAPI()
detector = PotholeDetector()            # single instance at startup

@app.post("/detect")
async def detect(image: UploadFile):
    data = np.frombuffer(await image.read(), np.uint8)
    frame = cv2.imdecode(data, cv2.IMREAD_COLOR)
    return detector.predict(frame)      # return the dict as JSON
```

### 6.4 Integration notes

- Keep `conf_threshold` at 0.25 first; raise it (e.g. 0.5) if the app gets
  too many false positives.
- `predict()` accepts any OpenCV BGR numpy image, so video frames from the
  public-transport feed can be passed frame-by-frame.
- Latency depends on hardware: we measured it on our machine only
  (see README §7). Do not advertise "real-time" without testing on target hardware.

## 7. Honest performance notes

(filled after evaluation)

## 8. Known notes & limitations

- **Original dataset integrity**: images and label files were never modified.
  During an early aborted training attempt, Ultralytics regenerated the
  machine-readable index files `train/labels.cache` and `valid/labels.cache`
  inside the original folder (these are cache files, not annotations; every
  image/label file hash-equivalent count was re-verified afterwards — see
  `reports/dataset_report_original.json`). All later runs read exclusively
  from `dataset_clean/`.
- **Hardware**: this machine has no GPU. All timings below are CPU-only
  measurements on an Intel Core i5-1334U and will not transfer to other
  hardware. We do not claim real-time performance.
- **Demo video**: the dataset ships no video files, so
  `samples/demo_test_frames.mp4` is stitched from consecutive test frames to
  exercise the video inference path — it is not an independent traffic video.
- **Class scope**: only the single `pothole` class is used, per the scope of
  this first AI module.
