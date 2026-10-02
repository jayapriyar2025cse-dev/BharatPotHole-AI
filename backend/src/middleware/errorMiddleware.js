// src/middleware/errorMiddleware.js
// ─────────────────────────────────────────────────────────
// Global Error Handler — must be the LAST middleware in app.js
// Catches any error passed via next(err) in route handlers.
// ─────────────────────────────────────────────────────────

const { sendError } = require('../utils/response');

const errorHandler = (err, req, res, next) => {
  console.error('[ERROR]', err.message);

  // Multer-specific errors (file size, wrong type)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return sendError(res, 400, 'File too large. Maximum allowed size is 10 MB.');
  }

  if (err.message && err.message.includes('Only JPEG')) {
    return sendError(res, 400, err.message);
  }

  // Default internal server error
  const statusCode = err.status || 500;
  const message = err.message || 'Something went wrong on the server.';
  return sendError(res, statusCode, message);
};

module.exports = errorHandler;
