// src/routes/detectionRoutes.js
const express = require('express');
const router = express.Router();
const {
  analyzeDetection,
  getAllDetections,
  getDetectionById,
  updateDetectionStatus,
} = require('../controllers/detectionController');
const { verifyToken } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// All detection routes require a valid JWT
router.use(verifyToken);

// ★ POST /api/detections/analyze
// Main AI integration endpoint — upload image + GPS → detection result
// upload.single('image') processes the multipart image file
router.post('/analyze', upload.single('image'), analyzeDetection);

// GET /api/detections        — List all with filters
router.get('/', getAllDetections);

// GET /api/detections/:id    — Get one detection
router.get('/:id', getDetectionById);

// PATCH /api/detections/:id/status — Update review status
router.patch('/:id/status', updateDetectionStatus);

module.exports = router;
