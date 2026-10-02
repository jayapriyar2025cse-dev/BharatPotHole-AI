// src/app.js
// ─────────────────────────────────────────────────────────
// Express application setup.
// Registers all middleware and routes.
// Does NOT start the server — that's done in server.js.
// ─────────────────────────────────────────────────────────

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes      = require('./routes/authRoutes');
const vehicleRoutes   = require('./routes/vehicleRoutes');
const detectionRoutes = require('./routes/detectionRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const errorHandler    = require('./middleware/errorMiddleware');

const app = express();

// ─── Middleware ───────────────────────────────────────────

// Enable cross-origin requests (required for React dashboard + Expo mobile)
app.use(cors({
  origin: '*', // In production, restrict to your domain
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded form data
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images as static files
// Example: GET http://localhost:5000/uploads/abc123.jpg
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Routes ───────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/vehicles',   vehicleRoutes);
app.use('/api/detections', detectionRoutes);
app.use('/api/dashboard',  dashboardRoutes);

// ─── Health Check ─────────────────────────────────────────
// Use this to verify the server is running
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'SIH26124 Urban Intelligence API',
    timestamp: new Date().toISOString(),
    aiServiceEnabled: process.env.AI_SERVICE_ENABLED === 'true',
  });
});

// ─── 404 Handler ──────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ─── Global Error Handler (must be last) ──────────────────
app.use(errorHandler);

module.exports = app;
