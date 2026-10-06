// src/services/aiService.js

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// ============================================================
// MAIN ANALYZE FUNCTION
// ============================================================

const analyzeImage = async (imagePath, metadata = {}) => {
  const aiEnabled = process.env.AI_SERVICE_ENABLED === 'true';

  console.log('==========================================');
  console.log('[AI] analyzeImage()');
  console.log('[AI] AI_SERVICE_ENABLED:', process.env.AI_SERVICE_ENABLED);
  console.log('[AI] imagePath:', imagePath);
  console.log('[AI] image exists:', imagePath ? fs.existsSync(imagePath) : false);
  console.log('==========================================');

  if (!aiEnabled) {
    console.log('[AI] Real AI disabled -> using mock detection');
    return getMockDetection(metadata);
  }

  return await callRealAIService(imagePath, metadata);
};

// ============================================================
// MOCK DETECTION
// ============================================================

const getMockDetection = (metadata = {}) => {
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
        confidence: parseFloat(
          Math.max(confidence - i * 0.03, 0).toFixed(2)
        ),
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
    confidences: detections.map((d) => d.confidence),
    detections,
    imageSize: null,
    confidenceThreshold: null,
    model: null,
    latencyMs: null,
    source: 'mock',
  };
};

// ============================================================
// REAL YOLO AI SERVICE
// ============================================================

const callRealAIService = async (imagePath, metadata = {}) => {
  if (!imagePath) {
    const error = new Error('Image path is missing');
    error.publicMessage = 'Image file missing';
    error.statusCode = 400;
    throw error;
  }

  if (!fs.existsSync(imagePath)) {
    console.error('[AI] Image file does not exist:', imagePath);

    const error = new Error(`Image file not found: ${imagePath}`);
    error.publicMessage = 'Image file not found';
    error.statusCode = 400;
    throw error;
  }

  const aiServiceUrl =
    process.env.AI_SERVICE_URL || 'http://127.0.0.1:8002';

  const aiUrl = `${aiServiceUrl.replace(/\/$/, '')}/analyze`;

  const form = new FormData();

  /*
   * IMPORTANT:
   *
   * FastAPI api.py expects:
   *
   *     file: UploadFile = File(...)
   *
   * Therefore the multipart field MUST be "file".
   */
  form.append(
    'file',
    fs.createReadStream(imagePath),
    {
      filename: path.basename(imagePath),
    }
  );

  console.log('==========================================');
  console.log('[AI] Forwarding image to YOLO');
  console.log('[AI] Image:', imagePath);
  console.log('[AI] AI URL:', aiUrl);
  console.log('[AI] Form field: file');
  console.log('==========================================');

  let response;

  try {
    response = await axios.post(aiUrl, form, {
      headers: {
        ...form.getHeaders(),
      },

      timeout: 60000,

      maxContentLength: Infinity,
      maxBodyLength: Infinity,

      validateStatus: () => true,
    });
  } catch (err) {
    console.error('==========================================');
    console.error('[AI] REQUEST ERROR');
    console.error('[AI] code:', err.code);
    console.error('[AI] message:', err.message);
    console.error('==========================================');

    if (err.code === 'ECONNABORTED') {
      const mapped = new Error('AI analysis timed out');
      mapped.publicMessage = 'AI analysis failed';
      mapped.statusCode = 504;
      throw mapped;
    }

    if (
      err.code === 'ECONNREFUSED' ||
      err.code === 'ENOTFOUND' ||
      err.code === 'EAI_AGAIN'
    ) {
      const mapped = new Error(
        `AI service unreachable: ${err.message}`
      );

      mapped.publicMessage = 'AI service unavailable';
      mapped.statusCode = 503;
      throw mapped;
    }

    const mapped = new Error(
      `AI request failed: ${err.message}`
    );

    mapped.publicMessage = 'AI analysis failed';
    mapped.statusCode = 502;

    throw mapped;
  }

  // ==========================================================
  // AI HTTP ERROR
  // ==========================================================

  console.log('==========================================');
  console.log('[AI] HTTP STATUS:', response.status);
  console.log('[AI] RESPONSE:');
  console.log(JSON.stringify(response.data, null, 2));
  console.log('==========================================');

  if (response.status < 200 || response.status >= 300) {
    const detail =
      response.data?.detail ||
      response.data?.error ||
      JSON.stringify(response.data);

    console.error('[AI] AI returned error:', detail);

    const isInvalidImage =
      /invalid image/i.test(String(detail));

    const mapped = new Error(
      isInvalidImage
        ? 'Invalid image'
        : `AI service returned HTTP ${response.status}`
    );

    mapped.publicMessage = isInvalidImage
      ? 'Invalid image'
      : 'AI analysis failed';

    mapped.statusCode = isInvalidImage
      ? 400
      : 502;

    throw mapped;
  }

  const aiData = response.data;

  // ==========================================================
  // AI ERROR PAYLOAD
  // ==========================================================

  if (aiData && aiData.error) {
    console.error(
      '[AI] AI error payload:',
      aiData.error
    );

    const isInvalidImage =
      /invalid image/i.test(String(aiData.error));

    const mapped = new Error(String(aiData.error));

    mapped.publicMessage = isInvalidImage
      ? 'Invalid image'
      : 'AI analysis failed';

    mapped.statusCode = isInvalidImage
      ? 400
      : 502;

    throw mapped;
  }

  // ==========================================================
  // NORMALIZE YOLO RESPONSE
  // ==========================================================

  const potholeDetected =
    aiData.potholeDetected === true ||
    aiData.detected === true ||
    Number(
      aiData.potholeCount ??
      aiData.count ??
      0
    ) > 0;

  const potholeCount = Number(
    aiData.potholeCount ??
    aiData.count ??
    0
  );

  const confidence =
    aiData.confidence !== null &&
    aiData.confidence !== undefined
      ? Number(aiData.confidence)
      : 0;

  // YOLO returns "detections"
  const rawBoxes =
    Array.isArray(aiData.detections)
      ? aiData.detections
      : Array.isArray(aiData.boxes)
        ? aiData.boxes
        : [];

  const detections = rawBoxes.map((box) => {
    const bbox = Array.isArray(box.bbox_xyxy)
      ? box.bbox_xyxy
      : null;

    return {
      class:
        box.class_name ||
        box.class ||
        'pothole',

      confidence:
        Number(box.confidence ?? 0),

      x1:
        bbox?.[0] ??
        box.x1 ??
        0,

      y1:
        bbox?.[1] ??
        box.y1 ??
        0,

      x2:
        bbox?.[2] ??
        box.x2 ??
        0,

      y2:
        bbox?.[3] ??
        box.y2 ??
        0,

      class_id:
        box.class_id ?? 0,

      bbox_xyxy:
        bbox,
    };
  });

  const confidences =
    Array.isArray(aiData.confidences)
      ? aiData.confidences.map((c) => Number(c))
      : detections.map((d) => d.confidence);

  const result = {
    potholeDetected,

    potholeCount,

    confidence,

    confidences,

    detections,

    imageSize:
      aiData.imageSize ??
      aiData.image_size ??
      null,

    confidenceThreshold:
      aiData.confidenceThreshold ??
      aiData.confThreshold ??
      aiData.conf_threshold ??
      null,

    model:
      aiData.model ??
      null,

    latencyMs:
      aiData.latencyMs ??
      aiData.latency_ms ??
      null,

    source: 'yolo',

    aiSource:
      aiData.aiSource ??
      'yolo',
  };

  console.log('==========================================');
  console.log('[AI] NORMALIZED RESULT');
  console.log(JSON.stringify(result, null, 2));
  console.log('==========================================');

  return result;
};

// ============================================================
// EXPORT
// ============================================================

module.exports = {
  analyzeImage,
};