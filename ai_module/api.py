"""
BharatPotHole — FastAPI YOLO inference service.

Confidence threshold is configured in ONE place (see CONF_THRESHOLD below).
Default 0.01 because the current trained model produces detections in the
0.01–0.21 confidence range — a 0.25 default silently filters ALL of them out
and makes the API report "no pothole" for images that do contain potholes.
Tune via the YOLO_CONF_THRESHOLD environment variable without code changes.
"""

import os

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from inference import PotholeDetector
import cv2
import numpy as np

app = FastAPI()

# ─────────────────────────────────────────────────────────────
# CONFIGURABLE CONFIDENCE THRESHOLD — the single place to tune.
#   env YOLO_CONF_THRESHOLD (default 0.01 for the current weak model)
# ─────────────────────────────────────────────────────────────
CONF_THRESHOLD = float(os.getenv("YOLO_CONF_THRESHOLD", "0.05"))
MODEL_PATH = r".\runs\train\pothole-yolo11n-10ep\weights\best.pt"

# Load the trained model ONCE at startup (never per request).
detector = PotholeDetector(MODEL_PATH, conf_threshold=CONF_THRESHOLD)


@app.get("/")
def home():
    return {
        "message": "BharatPotHole AI API is running",
        "model": MODEL_PATH,
        "confidenceThreshold": CONF_THRESHOLD,
    }


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    image_bytes = await file.read()
    print(
        f"[AI] received image: {file.filename!r} "
        f"({len(image_bytes)} bytes)",
        flush=True,
    )

    image_array = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

    if image is None:
        print("[AI] decode failed -> Invalid image", flush=True)
        # Real error status so the Node backend can never mistake
        # a failed decode for a genuine "no pothole" result.
        return JSONResponse(status_code=400, content={"error": "Invalid image"})

    height, width = image.shape[:2]
    print(f"[AI] image dimensions: {width}x{height}", flush=True)

    # The EXACT decoded pixels of the uploaded image go to YOLO.
    result = detector.predict(image)

    print(
        f"[AI] detection count: {result['count']} | "
        f"highest confidence: {result['confidence']} | "
        f"threshold: {result['conf_threshold']} | "
        f"latency: {result['latency_ms']} ms",
        flush=True,
    )

    # camelCase contract expected by the Node backend / frontend.
    # Never rename or drop any of these fields.
    return {
        "potholeDetected": result["detected"],
        "potholeCount": result["count"],
        # Requirement: no detection ⇒ confidence 0 (UI shows "0%")
        "confidence": result["confidence"]
        if result["confidence"] is not None
        else 0.0,
        "confidences": result["confidences"],
        "detections": result["boxes"],
        "imageSize": result["image_size"],
        "confidenceThreshold": result["conf_threshold"],
        "model": result["model"],
        "latencyMs": result["latency_ms"],
        "aiSource": "yolo",
    }
