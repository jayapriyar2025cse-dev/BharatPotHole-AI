// src/middleware/authMiddleware.js
// ─────────────────────────────────────────────────────────
// JWT Authentication Middleware
// Protects routes by verifying the Bearer token in the
// Authorization header. Attaches the decoded user to req.user.
// ─────────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const { sendError } = require('../utils/response');

/**
 * Middleware: verifyToken
 * Use on any route that requires a logged-in user.
 *
 * Expected header:
 *   Authorization: Bearer <jwt_token>
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  // Check that header exists and starts with "Bearer "
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'Access denied. No token provided.');
  }

  const token = authHeader.split(' ')[1]; // Extract the token part

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, role } now available in route handlers
    next();
  } catch (err) {
    return sendError(res, 401, 'Invalid or expired token. Please log in again.');
  }
};

/**
 * Middleware: requireAdmin
 * Use AFTER verifyToken to restrict a route to ADMIN users only.
 */
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return sendError(res, 403, 'Forbidden. Admin access required.');
  }
  next();
};

module.exports = { verifyToken, requireAdmin };
