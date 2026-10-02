// src/controllers/detectionController.js
// ─────────────────────────────────────────────────────────
// Core detection workflow:
//   1. Receive image + GPS from mobile app
//   2. Save image to /uploads/
//   3. Pass image to AI service (mock or real)
//   4. Map confidence → severity
//   5. Store result in database
//   6. Return full detection record to caller
// ─────────────────────────────────────────────────────────

const path = require('path');
const prisma = require('../config/database');
const { analyzeImage } = require('../services/aiService');
const { getSeverity, VALID_STATUSES } = require('../utils/severity');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * POST /api/detections/analyze
 * ★ PRIMARY ENDPOINT — The main integration point for the mobile app and AI.
 *
 * Accepts: multipart/form-data
 *   - image      (file)   Required — road image
 *   - latitude   (float)  Required — GPS latitude
 *   - longitude  (float)  Required — GPS longitude
 *   - timestamp  (string) Optional — ISO datetime (defaults to now)
 *   - vehicleId  (string) Optional — linked bus/vehicle
 */
const analyzeDetection = async (req, res) => {
  try {
    // 1. Validate that an image was uploaded
    if (!req.file) {
      return sendError(res, 400, 'An image file is required. Upload a JPEG or PNG.');
    }

    const { latitude, longitude, timestamp, vehicleId } = req.body;

    // 2. Validate GPS coordinates
    if (!latitude || !longitude) {
      return sendError(res, 400, 'latitude and longitude are required.');
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return sendError(res, 400, 'latitude and longitude must be valid numbers.');
    }

    // 3. Build the image path (relative URL for API responses)
    const imagePath = `/uploads/${req.file.filename}`;
    const absoluteImagePath = path.join(__dirname, '../../uploads', req.file.filename);

    // 4. Call AI service (mock or real — caller doesn't know which)
    const aiResult = await analyzeImage(absoluteImagePath, { latitude: lat, longitude: lng });

    // 5. Map confidence to a human-readable severity level
    const severity = getSeverity(aiResult.confidence);

    // 6. Store the detection record in the database
    const detection = await prisma.detection.create({
      data: {
        imagePath,
        latitude: lat,
        longitude: lng,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        potholeDetected: aiResult.potholeDetected,
        potholeCount: aiResult.potholeCount,
        confidence: aiResult.confidence,
        severity,
        status: 'PENDING',
        rawAiResponse: JSON.stringify(aiResult), // Store full AI output for debugging
        vehicleId: vehicleId || null,
        userId: req.user?.id || null,
      },
      include: {
        vehicle: { select: { id: true, busNumber: true, routeNumber: true } },
        user: { select: { id: true, name: true } },
      },
    });

    // 7. Return the full result
    return sendSuccess(res, 201, 'Detection analysis complete.', {
      detection: {
        id: detection.id,
        imagePath: detection.imagePath,
        imageUrl: `${process.env.BASE_URL}${detection.imagePath}`,
        latitude: detection.latitude,
        longitude: detection.longitude,
        timestamp: detection.timestamp,
        potholeDetected: detection.potholeDetected,
        potholeCount: detection.potholeCount,
        confidence: detection.confidence,
        severity: detection.severity,
        status: detection.status,
        vehicle: detection.vehicle,
        submittedBy: detection.user,
        // Return bounding boxes from AI for the mobile app to display
        detections: aiResult.detections,
        aiSource: aiResult.source, // 'mock' or 'yolo'
      },
    });
  } catch (error) {
    console.error('[detectionController.analyzeDetection]', error);
    return sendError(res, 500, 'Detection analysis failed.', error.message);
  }
};

/**
 * GET /api/detections
 * Get all detection records with optional filters.
 * Query params:
 *   - vehicleId  — filter by vehicle
 *   - status     — PENDING | REVIEWED | RESOLVED | FLAGGED
 *   - severity   — LOW | MEDIUM | HIGH | CRITICAL
 *   - startDate  — ISO date string
 *   - endDate    — ISO date string
 *   - page       — page number (default: 1)
 *   - limit      — results per page (default: 20)
 */
const getAllDetections = async (req, res) => {
  try {
    const {
      vehicleId,
      status,
      severity,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    // Build dynamic Prisma where clause from query params
    const where = {};
    if (vehicleId)  where.vehicleId = vehicleId;
    if (status)     where.status = status.toUpperCase();
    if (severity)   where.severity = severity.toUpperCase();
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate);
      if (endDate)   where.timestamp.lte = new Date(endDate);
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Run count and data fetch in parallel for efficiency
    const [total, detections] = await Promise.all([
      prisma.detection.count({ where }),
      prisma.detection.findMany({
        where,
        include: {
          vehicle: { select: { id: true, busNumber: true, routeNumber: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    return sendSuccess(res, 200, 'Detections fetched.', {
      detections: detections.map((d) => ({
        ...d,
        imageUrl: `${process.env.BASE_URL}${d.imagePath}`,
      })),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    return sendError(res, 500, 'Could not fetch detections.', error.message);
  }
};

/**
 * GET /api/detections/:id
 * Get a single detection by ID with full details.
 */
const getDetectionById = async (req, res) => {
  try {
    const detection = await prisma.detection.findUnique({
      where: { id: req.params.id },
      include: {
        vehicle: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!detection) return sendError(res, 404, 'Detection not found.');

    return sendSuccess(res, 200, 'Detection fetched.', {
      detection: {
        ...detection,
        imageUrl: `${process.env.BASE_URL}${detection.imagePath}`,
        rawAiResponse: detection.rawAiResponse
          ? JSON.parse(detection.rawAiResponse)
          : null,
      },
    });
  } catch (error) {
    return sendError(res, 500, 'Could not fetch detection.', error.message);
  }
};

/**
 * PATCH /api/detections/:id/status
 * Update the review status of a detection. (Admin/Analyst only)
 * Body: { status }
 */
const updateDetectionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status.toUpperCase())) {
      return sendError(
        res,
        400,
        `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`
      );
    }

    const detection = await prisma.detection.findUnique({ where: { id } });
    if (!detection) return sendError(res, 404, 'Detection not found.');

    const updated = await prisma.detection.update({
      where: { id },
      data: { status: status.toUpperCase() },
    });

    return sendSuccess(res, 200, 'Detection status updated.', {
      detection: updated,
    });
  } catch (error) {
    return sendError(res, 500, 'Could not update detection status.', error.message);
  }
};

module.exports = {
  analyzeDetection,
  getAllDetections,
  getDetectionById,
  updateDetectionStatus,
};
