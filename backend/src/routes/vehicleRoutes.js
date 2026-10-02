// src/routes/vehicleRoutes.js
const express = require('express');
const router = express.Router();
const {
  getAllVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} = require('../controllers/vehicleController');
const { verifyToken, requireAdmin } = require('../middleware/authMiddleware');

// All vehicle routes require authentication
router.use(verifyToken);

// GET /api/vehicles         — List all vehicles
router.get('/', getAllVehicles);

// GET /api/vehicles/:id     — Get single vehicle
router.get('/:id', getVehicleById);

// POST /api/vehicles        — Create vehicle (admin only)
router.post('/', requireAdmin, createVehicle);

// PUT /api/vehicles/:id     — Update vehicle (admin only)
router.put('/:id', requireAdmin, updateVehicle);

// DELETE /api/vehicles/:id  — Delete vehicle (admin only)
router.delete('/:id', requireAdmin, deleteVehicle);

module.exports = router;
