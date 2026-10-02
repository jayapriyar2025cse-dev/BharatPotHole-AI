// src/config/database.js
// ─────────────────────────────────────────────────────────
// Prisma Client — single shared instance across the app.
// Import this wherever you need database access.
// ─────────────────────────────────────────────────────────

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['error', 'warn'], // Set to ['query'] to see every SQL statement in dev
});

module.exports = prisma;
