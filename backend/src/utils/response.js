// src/utils/response.js
// ─────────────────────────────────────────────────────────
// Standardized API response helpers.
// Every API response uses one of these two functions
// so the frontend always sees a consistent JSON shape.
// ─────────────────────────────────────────────────────────

/**
 * Send a successful response.
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code (e.g. 200, 201)
 * @param {string} message - Human-readable success message
 * @param {object|null} data - The payload to return
 */
const sendSuccess = (res, statusCode, message, data = null) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send an error response.
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code (e.g. 400, 404, 500)
 * @param {string} message - Human-readable error message
 * @param {string|null} error - Technical error detail (optional)
 */
const sendError = (res, statusCode, message, error = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error: error || null,
  });
};

module.exports = { sendSuccess, sendError };
