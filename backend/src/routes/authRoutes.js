// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

// POST /api/auth/register — Create account
router.post('/register', register);

// POST /api/auth/login — Login and get token
router.post('/login', login);

// GET /api/auth/me — Get current user's profile (protected)
router.get('/me', verifyToken, getMe);

module.exports = router;
