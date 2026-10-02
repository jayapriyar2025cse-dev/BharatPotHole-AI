// src/utils/severity.js
// ─────────────────────────────────────────────────────────
// Maps an AI confidence score (0.0 – 1.0) to a severity label.
// This is the ONLY place severity logic lives.
// If requirements change, update only here.
// ─────────────────────────────────────────────────────────

/**
 * Derive severity from confidence score.
 *
 * Thresholds:
 *   >= 0.85  → CRITICAL
 *   >= 0.70  → HIGH
 *   >= 0.50  → MEDIUM
 *   < 0.50   → LOW
 *
 * @param {number} confidence - Float between 0.0 and 1.0
 * @returns {string} Severity label
 */
const getSeverity = (confidence) => {
  if (confidence == null || isNaN(confidence)) return 'LOW';
  if (confidence >= 0.85) return 'CRITICAL';
  if (confidence >= 0.70) return 'HIGH';
  if (confidence >= 0.50) return 'MEDIUM';
  return 'LOW';
};

// Valid values accepted in filters / status updates
const VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const VALID_STATUSES   = ['PENDING', 'REVIEWED', 'RESOLVED', 'FLAGGED'];
const VALID_ROLES      = ['ADMIN', 'ANALYST', 'DRIVER'];

module.exports = { getSeverity, VALID_SEVERITIES, VALID_STATUSES, VALID_ROLES };
