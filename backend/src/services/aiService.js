
// src/services/aiService.js

const axios = require('axios');

// Analyze a road image for pothole detection
const analyzeImage = async (imagePath, metadata = {}) => {
  const aiEnabled = process.env.AI_SERVICE_ENABLED === 'true';

  if (aiEnabled) {
    return await callRealAIService(imagePath, metadata);
  } else {
    return getMockDetection(metadata);
  }
};

// MOCK DETECTION
const getMockDetection = (metadata) => {
  const potholeDetected = Math.random() > 0.3;
  const potholeCount = potholeDetected
    ? Math.floor(Math.random() * 3) + 1
    : 0;

  const confidence = potholeDetected
    ? parseFloat((0.60 + Math.random() * 0.38).toFixed(2))
    : 0.0;

  const detections = potholeDetected
    ? Array.from({ length: potholeCount }, (_, i) => ({
        class: 'pothole',
        confidence: parseFloat((confidence - i * 0.03).toFixed(2)),
        x1: Math.floor(Math.random() * 100),
        y1: Math.floor(Math.random() * 100),
        x2: Math.floor(Math.random() * 300 + 150),
        y2: Math.floor(Math.random() * 200 + 100),
      }))
    : [];

  return {
    potholeDetected,
    potholeCount,
    confidence,
    detections,
    source: 'mock',
  };
};

// REAL AI SERVICE CALL
const callRealAIService = async (imagePath, metadata) => {
  const fs = require('fs');
  const FormData = require('form-data');

  const form = new FormData();

  // FastAPI expects the image field name as "file"
  form.append('file', fs.createReadStream(imagePath));

  const response = await axios.post(
    `${process.env.AI_SERVICE_URL}/analyze`,
    form,
    {
      headers: form.getHeaders(),
      timeout: 30000,
    }
  );

  const aiData = response.data;

  return {
    potholeDetected: aiData.potholeDetected,
    potholeCount: aiData.potholeCount,
    confidence: aiData.confidence,
    detections: aiData.detections || [],
    source: 'yolo',
  };
};

module.exports = { analyzeImage };