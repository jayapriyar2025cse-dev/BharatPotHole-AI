// src/routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const {
  getStats,
  getRecentDetections,
  getMapData,
  getChartData,
} = require('../controllers/dashboardController');
const { verifyToken } = require('../middleware/authMiddleware');

// All dashboard routes require authentication
router.use(verifyToken);

// GET /api/dashboard/stats   — Overview counts (total, severity breakdown)
router.get('/stats', getStats);

// GET /api/dashboard/recent  — Recent detection feed
router.get('/recent', getRecentDetections);

// GET /api/dashboard/map     — Lat/lng markers for Leaflet map
router.get('/map', getMapData);

// GET /api/dashboard/chart   — Detection counts per day
router.get('/chart', getChartData);

module.exports = router;
