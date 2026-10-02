// src/controllers/authController.js
// ─────────────────────────────────────────────────────────
// Authentication — Register and Login
// Passwords are hashed with bcrypt before storing.
// Login returns a JWT token used for all protected routes.
// ─────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { sendSuccess, sendError } = require('../utils/response');
const { VALID_ROLES } = require('../utils/severity');

/**
 * POST /api/auth/register
 * Create a new user account.
 * Body: { name, email, password, role? }
 */
const register = async (req, res) => {
  try {
    const { name, email, password, role = 'DRIVER' } = req.body;

    // Basic validation
    if (!name || !email || !password) {
      return sendError(res, 400, 'Name, email, and password are required.');
    }

    if (!VALID_ROLES.includes(role.toUpperCase())) {
      return sendError(res, 400, `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return sendError(res, 409, 'An account with this email already exists.');
    }

    // Hash password (never store plain text)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user in database
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role.toUpperCase(),
      },
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return sendSuccess(res, 201, 'Account created successfully.', {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('[authController.register]', error);
    return sendError(res, 500, 'Registration failed.', error.message);
  }
};

/**
 * POST /api/auth/login
 * Authenticate a user and return a JWT token.
 * Body: { email, password }
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(res, 400, 'Email and password are required.');
    }

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return sendError(res, 401, 'Invalid email or password.');
    }

    // Compare provided password against stored hash
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return sendError(res, 401, 'Invalid email or password.');
    }

    // Issue JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return sendSuccess(res, 200, 'Login successful.', {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('[authController.login]', error);
    return sendError(res, 500, 'Login failed.', error.message);
  }
};

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile.
 * Requires: verifyToken middleware
 */
const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    if (!user) return sendError(res, 404, 'User not found.');

    return sendSuccess(res, 200, 'User profile fetched.', { user });
  } catch (error) {
    return sendError(res, 500, 'Could not fetch profile.', error.message);
  }
};

module.exports = { register, login, getMe };
