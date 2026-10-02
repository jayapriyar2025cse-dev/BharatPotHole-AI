// src/controllers/dashboardController.js
// ─────────────────────────────────────────────────────────
// Dashboard endpoints — aggregated statistics for the
// React admin dashboard. All data is read-only.
// ─────────────────────────────────────────────────────────

const prisma = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * GET /api/dashboard/stats
 * Summary statistics for the dashboard overview cards.
 * Response includes totals by severity and status.
 */
const getStats = async (req, res) => {
  try {
    // Run all counts in parallel using Promise.all for speed
    const [
      totalDetections,
      totalPotholes,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      pendingCount,
      resolvedCount,
      totalVehicles,
    ] = await Promise.all([
      prisma.detection.count(),
      prisma.detection.aggregate({ _sum: { potholeCount: true } }),
      prisma.detection.count({ where: { severity: 'CRITICAL' } }),
      prisma.detection.count({ where: { severity: 'HIGH' } }),
      prisma.detection.count({ where: { severity: 'MEDIUM' } }),
      prisma.detection.count({ where: { severity: 'LOW' } }),
      prisma.detection.count({ where: { status: 'PENDING' } }),
      prisma.detection.count({ where: { status: 'RESOLVED' } }),
      prisma.vehicle.count(),
    ]);

    return sendSuccess(res, 200, 'Dashboard stats fetched.', {
      stats: {
        totalDetections,
        totalPotholes: totalPotholes._sum.potholeCount || 0,
        bySeverity: {
          critical: criticalCount,
          high: highCount,
          medium: mediumCount,
          low: lowCount,
        },
        byStatus: {
          pending: pendingCount,
          resolved: resolvedCount,
        },
        totalVehicles,
      },
    });
  } catch (error) {
    return sendError(res, 500, 'Could not fetch stats.', error.message);
  }
};

/**
 * GET /api/dashboard/recent
 * Fetch the most recent detections for the dashboard feed.
 * Query: ?limit=10 (default: 10)
 */
const getRecentDetections = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const detections = await prisma.detection.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        vehicle: { select: { busNumber: true, routeNumber: true } },
        user: { select: { name: true } },
      },
    });

    return sendSuccess(res, 200, 'Recent detections fetched.', {
      detections: detections.map((d) => ({
        ...d,
        imageUrl: `${process.env.BASE_URL}${d.imagePath}`,
      })),
    });
  } catch (error) {
    return sendError(res, 500, 'Could not fetch recent detections.', error.message);
  }
};

/**
 * GET /api/dashboard/map
 * Returns lightweight map data (lat/lng + severity) for rendering
 * pothole markers on the Leaflet map in the dashboard.
 * Intentionally minimal — no image data, just location + metadata.
 */
const getMapData = async (req, res) => {
  try {
    // Optional filter: only show detections where potholes were found
    const detections = await prisma.detection.findMany({
      where: { potholeDetected: true },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        severity: true,
        potholeCount: true,
        confidence: true,
        timestamp: true,
        status: true,
        vehicle: { select: { busNumber: true, routeNumber: true } },
      },
      orderBy: { timestamp: 'desc' },
    });

    return sendSuccess(res, 200, 'Map data fetched.', { markers: detections });
  } catch (error) {
    return sendError(res, 500, 'Could not fetch map data.', error.message);
  }
};

/**
 * GET /api/dashboard/chart
 * Returns detection counts grouped by date for the line/bar chart.
 * Query: ?days=7 (last N days, default 7)
 */
const getChartData = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const detections = await prisma.detection.findMany({
      where: { timestamp: { gte: since } },
      select: { timestamp: true, potholeDetected: true, severity: true },
      orderBy: { timestamp: 'asc' },
    });

    // Group by date string (YYYY-MM-DD)
    const grouped = {};
    for (const d of detections) {
      const dateKey = d.timestamp.toISOString().split('T')[0];
      if (!grouped[dateKey]) {
        grouped[dateKey] = { date: dateKey, total: 0, potholes: 0 };
      }
      grouped[dateKey].total += 1;
      if (d.potholeDetected) grouped[dateKey].potholes += 1;
    }

    return sendSuccess(res, 200, 'Chart data fetched.', {
      chartData: Object.values(grouped),
    });
  } catch (error) {
    return sendError(res, 500, 'Could not fetch chart data.', error.message);
  }
};

module.exports = { getStats, getRecentDetections, getMapData, getChartData };
