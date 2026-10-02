"""
API-ready pothole detection module.

This module is INDEPENDENT of any frontend/backend code. It only needs the
trained model file (best.pt) and the installed requirements.

Typical use (e.g. inside a FastAPI/Flask route):

    from inference import PotholeDetector

    detector = PotholeDetector()            # loads best.pt once at startup
    result = detector.predict("road.jpg")   # path OR numpy BGR image
    # result is a plain dict -> can be returned directly as JSON

Result contract (JSON-serializable):

    {
      "detected": true,                       # true if count >= 1
      "count": 2,                             # number of potholes
      "confidence": 0.87,                     # highest confidence (null if none)
      "confidences": [0.87, 0.41],            # one score per box, best first
      "boxes": [                              # pixel coordinates, best first
        {"bbox_xyxy": [x1, y1, x2, y2], "confidence": 0.87,
         "class_id": 0, "class_name": "pothole"}
      ],
      "image_size": {"width": 1280, "height": 720},
      "conf_threshold": 0.25,                 # threshold used for this call
      "model": "best.pt",
      "latency_ms": 42.3                      # wall-clock time for this call
    }

bbox_xyxy = [left, top, right, bottom] in pixels of the input image.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Union

import cv2
import numpy as np

# Default model location: ai_module/best.pt (next to this package's parent)
_MODULE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = _MODULE_DIR / "best.pt"


class PotholeDetector:
    """Loads a trained YOLO model once and runs pothole detection."""

    def __init__(
        self,
        model_path: Union[str, Path] = DEFAULT_MODEL_PATH,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45,
        device: str | None = None,
        max_det: int = 100,
    ) -> None:
        # Imported here so importing this module stays cheap.
        from ultralytics import YOLO

        self.model_path = Path(model_path)
        if not self.model_path.is_file():
            raise FileNotFoundError(
                f"Model file not found: {self.model_path}. "
                "Train one first (scripts/train.py) or pass model_path=..."
            )
        self.conf_threshold = float(conf_threshold)
        self.iou_threshold = float(iou_threshold)
        self.device = device          # None = let Ultralytics pick (cpu/cuda)
        self.max_det = int(max_det)
        self.model = YOLO(str(self.model_path))
        self.class_names: dict = self.model.names  # e.g. {0: 'pothole'}

    # ------------------------------------------------------------------ #
    def predict(self, source: Union[str, Path, np.ndarray]) -> dict:
        """Detect potholes in a single image. Returns a JSON-serializable dict."""
        if isinstance(source, (str, Path)):
            image = cv2.imread(str(source))
            if image is None:
                raise ValueError(f"Could not read image: {source}")
        else:
            image = np.asarray(source)
            if image.ndim not in (2, 3):
                raise ValueError("numpy image must be HxW or HxWxC")

        start = time.perf_counter()
        results = self.model.predict(
            source=image,
            conf=self.conf_threshold,
            iou=self.iou_threshold,
            max_det=self.max_det,
            device=self.device,
            verbose=False,
        )[0]
        latency_ms = (time.perf_counter() - start) * 1000.0

        height, width = image.shape[:2]
        boxes = []
        for box in results.boxes:
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
            cls_id = int(box.cls[0])
            boxes.append(
                {
                    "bbox_xyxy": [round(v, 2) for v in (x1, y1, x2, y2)],
                    "confidence": round(float(box.conf[0]), 4),
                    "class_id": cls_id,
                    "class_name": self.class_names.get(cls_id, str(cls_id)),
                }
            )
        # Highest confidence first -> backend can use boxes[0] as "best" box.
        boxes.sort(key=lambda b: b["confidence"], reverse=True)

        return {
            "detected": len(boxes) > 0,
            "count": len(boxes),
            "confidence": boxes[0]["confidence"] if boxes else None,
            "confidences": [b["confidence"] for b in boxes],
            "boxes": boxes,
            "image_size": {"width": width, "height": height},
            "conf_threshold": self.conf_threshold,
            "model": self.model_path.name,
            "latency_ms": round(latency_ms, 2),
        }

    # ------------------------------------------------------------------ #
    @staticmethod
    def draw(image: np.ndarray, result: dict, copy: bool = True) -> np.ndarray:
        """Draw boxes from predict() result onto a BGR image. Returns the image."""
        canvas = image.copy() if copy else image
        for i, box in enumerate(result["boxes"]):
            x1, y1, x2, y2 = (int(round(v)) for v in box["bbox_xyxy"])
            label = f"#{i + 1} {box['class_name']} {box['confidence']:.2f}"
            cv2.rectangle(canvas, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(
                canvas, label, (x1, max(0, y1 - 8)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2, cv2.LINE_AA,
            )
        return canvas
