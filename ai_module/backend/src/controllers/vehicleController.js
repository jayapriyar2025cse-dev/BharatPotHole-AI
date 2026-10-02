// src/controllers/vehicleController.js
// ─────────────────────────────────────────────────────────
// CRUD operations for Vehicles (buses / fleet)
// All routes require authentication. Create/Update/Delete
// require ADMIN role.
// ─────────────────────────────────────────────────────────

const prisma = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * GET /api/vehicles
 * Fetch all vehicles. Optionally filter by route.
 * Query: ?route=101
 */
const getAllVehicles = async (req, res) => {
  try {
    const { route } = req.query;

    const vehicles = await prisma.vehicle.findMany({
      where: route ? { routeNumber: route } : {},
      include: {
        driver: {
          select: { id: true, name: true, email: true }, // Never return password
        },
        _count: { select: { detections: true } }, // How many detections this vehicle has
      },
      orderBy: { createdAt: 'desc' },
    });

    return sendSuccess(res, 200, 'Vehicles fetched.', { vehicles });
  } catch (error) {
    return sendError(res, 500, 'Could not fetch vehicles.', error.message);
  }
};

/**
 * GET /api/vehicles/:id
 * Fetch a single vehicle by ID with its recent detections.
 */
const getVehicleById = async (req, res) => {
  try {
    const { id } = req.params;

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        driver: { select: { id: true, name: true, email: true } },
        detections: {
          orderBy: { timestamp: 'desc' },
          take: 10, // Last 10 detections for this vehicle
        },
      },
    });

    if (!vehicle) return sendError(res, 404, 'Vehicle not found.');

    return sendSuccess(res, 200, 'Vehicle fetched.', { vehicle });
  } catch (error) {
    return sendError(res, 500, 'Could not fetch vehicle.', error.message);
  }
};

/**
 * POST /api/vehicles
 * Create a new vehicle. (Admin only)
 * Body: { busNumber, routeNumber, driverId? }
 */
const createVehicle = async (req, res) => {
  try {
    const { busNumber, routeNumber, driverId } = req.body;

    if (!busNumber || !routeNumber) {
      return sendError(res, 400, 'busNumber and routeNumber are required.');
    }

    // Check duplicate bus number
    const existing = await prisma.vehicle.findUnique({ where: { busNumber } });
    if (existing) {
      return sendError(res, 409, `Vehicle with bus number "${busNumber}" already exists.`);
    }

    // If driverId is provided, validate the user exists and is a DRIVER
    if (driverId) {
      const driver = await prisma.user.findUnique({ where: { id: driverId } });
      if (!driver) return sendError(res, 404, 'Driver user not found.');
    }

    const vehicle = await prisma.vehicle.create({
      data: { busNumber, routeNumber, driverId: driverId || null },
    });

    return sendSuccess(res, 201, 'Vehicle created.', { vehicle });
  } catch (error) {
    return sendError(res, 500, 'Could not create vehicle.', error.message);
  }
};

/**
 * PUT /api/vehicles/:id
 * Update vehicle details. (Admin only)
 * Body: { busNumber?, routeNumber?, driverId? }
 */
const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { busNumber, routeNumber, driverId } = req.body;

    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) return sendError(res, 404, 'Vehicle not found.');

    const updated = await prisma.vehicle.update({
      where: { id },
      data: {
        ...(busNumber && { busNumber }),
        ...(routeNumber && { routeNumber }),
        ...(driverId !== undefined && { driverId }),
      },
    });

    return sendSuccess(res, 200, 'Vehicle updated.', { vehicle: updated });
  } catch (error) {
    return sendError(res, 500, 'Could not update vehicle.', error.message);
  }
};

/**
 * DELETE /api/vehicles/:id
 * Delete a vehicle. (Admin only)
 */
const deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) return sendError(res, 404, 'Vehicle not found.');

    await prisma.vehicle.delete({ where: { id } });

    return sendSuccess(res, 200, 'Vehicle deleted successfully.', null);
  } catch (error) {
    return sendError(res, 500, 'Could not delete vehicle.', error.message);
  }
};

module.exports = {
  getAllVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  deleteVehicle,
};
