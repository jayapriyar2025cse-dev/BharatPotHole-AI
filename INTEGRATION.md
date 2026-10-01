# BharatPothole AI Module — Integration Interface

Short guide for connecting **another application** (e.g., a Django/Node backend) to this
completed AI module. **No integration code is shipped here** — this document only defines
the boundary. Everything below already works and was verified (training 4/4 epochs,
evaluation, smoke test, image prediction, video prediction).

- Model: `best.pt` (YOLO11n, single class `pothole`, SHA256 `9C6DF638…C5751C`)
- Runtime: Python 3.11, CPU is enough (~0.5–5 s per image, measured)

---

## 1. Input

| Input kind | Format | Notes |
|---|---|---|
| Image file | Path (`str` / `Path`) to `.jpg .jpeg .png .bmp .webp` | read with OpenCV (BGR) |
| Image in memory | `numpy.ndarray`, shape `HxW` or `HxWxC`, **BGR** order | exactly what `cv2.imread()` / `cv2.imdecode()` returns |
| Video | **not accepted by `predict()` directly** | decode frames yourself (`cv2.VideoCapture`) and call `predict(frame)` per frame, or use the CLI in §2b |

Invalid image → `ValueError`. Missing model → `FileNotFoundError` (with instructions).

## 2. AI prediction call

### 2a. Python (simplest — in-process import)

```python
import sys
sys.path.insert(0, r"<path-to>\ai_module")     # folder that contains best.pt
from inference import PotholeDetector

detector = PotholeDetector()                   # create ONCE at app startup; loads best.pt
# options: model_path, conf_threshold=0.25, iou_threshold=0.45, device=None (auto), max_det=100

result = detector.predict("road.jpg")          # path OR numpy BGR image
# result is a plain dict -> JsonResponse(result) works directly

annotated = detector.draw(image, result)       # optional: copy of image with boxes drawn
```

### 2b. CLI (any language can shell out to this)

```powershell
python scripts/predict.py --source "C:\path\image.jpg" --no-save
python scripts/predict.py --source "C:\path\video.mp4" --save-dir samples
# options: --model (default best.pt) --conf 0.25 --iou 0.45 --device cpu --no-save --max-frames N
```

Prints one JSON object per line on stdout.

## 3. Output

### 3a. `detector.predict()` full contract (use this for integrations)

```json
{
  "detected": true,
  "count": 2,
  "confidence": 0.87,
  "confidences": [0.87, 0.41],
  "boxes": [
    {"bbox_xyxy": [120.5, 300.2, 415.0, 512.7], "confidence": 0.87, "class_id": 0, "class_name": "pothole"},
    {"bbox_xyxy": [50.1, 88.0, 210.4, 199.9],  "confidence": 0.41, "class_id": 0, "class_name": "pothole"}
  ],
  "image_size": {"width": 1280, "height": 720},
  "conf_threshold": 0.25,
  "model": "best.pt",
  "latency_ms": 42.3
}
```

Guarantees (asserted by the passing smoke test):
- plain, JSON-serializable `dict`
- `detected == (count >= 1)`; `count == len(boxes) == len(confidences)`
- `boxes` sorted **highest confidence first** → `boxes[0]` is the best detection
- `confidence` is `null` when nothing detected; `"class_name": "pothole"` always
- `bbox_xyxy = [left, top, right, bottom]` in **pixels** of the input image

### 3b. CLI per-image line (subset of the above, plus `source`)

```json
{"source": "C:\\...\\frame.jpg", "detected": false, "count": 0, "confidence": null, "boxes": [], "latency_ms": 3484.54}
{"summary": "0/1 images contained potholes"}
```

### 3c. CLI video summary (verified run, 24-frame demo)

```json
{
  "video": "samples\\demo_test_frames.mp4",
  "frames": 24,
  "frames_with_pothole": 20,
  "avg_potholes_per_flagged_frame": 1.4,
  "latency_ms_avg": 516.98,
  "latency_ms_median": 219.17,
  "processed_fps": 1.86,
  "note": "measured on this machine; not a real-time guarantee"
}
```

## 4. Example request

**Python caller (recommended):**

```python
result = detector.predict(numpy_bgr_image)      # e.g. from cv2.imdecode(upload_bytes)
return JsonResponse(result, status=200)         # Django example — no post-processing needed
```

**Hypothetical HTTP endpoint** the host application would expose (NOT provided by this
module — the host builds it):

```
POST /api/detect-image/
Content-Type: multipart/form-data
Field: image = <file: jpg/png/…>
```

## 5. Example response (real output from this model)

```json
{
  "detected": false, "count": 0, "confidence": null, "confidences": [],
  "boxes": [], "image_size": {"width": 640, "height": 480},
  "conf_threshold": 0.25, "model": "best.pt", "latency_ms": 4841.68
}
```

(When potholes are found, `detected: true`, and `boxes`/`confidences` are filled, best first.)

## 6. What the receiving application must send

1. **One image per call** — as a file upload (decode with `cv2.imdecode`) or a path this
   process can read. Nothing else is required (no API key, no config).
2. **A confidence threshold decision** — default `0.25` (deploy threshold). Keep `0.25`
   unless too many false positives appear → raise to `0.4–0.5`.
3. **For video:** either decode frames and call `predict(frame)` in a loop, or shell out to
   `scripts/predict.py --source video.mp4`.
4. **Error handling:** expect the host to wrap failures as `{"error": ...}` for:
   missing file (400), unreadable image (`ValueError`), missing `best.pt`
   (`FileNotFoundError`), timeout (CPU inference can take seconds).
5. **Deployment checklist:** transfer only `best.pt` + `inference/` + `requirements*.txt`
   (~5.5 MB — see README §1/§6); install deps for Python 3.11; create **one** detector at
   startup (loading the model per request wastes seconds); run `scripts/smoke_test.py` once
   after install as a health check.

---

### What exists vs. what is still needed

| Already exists ✅ | Not included (by design — host app's job) ❌ |
|---|---|
| `inference.PotholeDetector` import API | HTTP server / endpoint wrapper |
| `scripts/predict.py` CLI (image/folder/video → JSON) | Upload handling, storage, auth |
| JSON result contract (§3) | Persisting results to a database |
| `best.pt` default path resolution | GPU provisioning (CPU works) |
| `scripts/smoke_test.py` post-install check | The actual integration (awaiting confirmation) |

Future flow: Frontend → Host Backend → **this module (`inference.PotholeDetector`)** →
`best.pt` → Detection JSON → Host Backend → Frontend.

