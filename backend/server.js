// server.js
// ─────────────────────────────────────────────────────────
// Entry point — loads env vars, starts the HTTP server.
// Run: node server.js  (or: npm run dev)
// ─────────────────────────────────────────────────────────

require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log('─────────────────────────────────────────────');
  console.log(`  SIH26124 Urban Intelligence API`);
  console.log(`  Server running on http://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  AI Mode: ${process.env.AI_SERVICE_ENABLED === 'true' ? 'REAL (YOLO)' : 'MOCK'}`);
  console.log('─────────────────────────────────────────────');
});
