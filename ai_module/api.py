from fastapi import FastAPI, File, UploadFile
from inference import PotholeDetector
import cv2
import numpy as np

app = FastAPI()

detector = PotholeDetector()


@app.get("/")
def home():
    return {
        "message": "BharatPotHole AI API is running"
    }


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):

    image_bytes = await file.read()

    image_array = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

    if image is None:
        return {
            "error": "Invalid image file"
        }

    result = detector.predict(image)

    return {
        "potholeDetected": result["detected"],
        "potholeCount": result["count"],
        "confidence": result["confidence"],
        "detections": result["boxes"]
    }