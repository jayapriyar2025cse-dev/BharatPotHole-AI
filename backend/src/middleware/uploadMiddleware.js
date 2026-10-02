// src/middleware/uploadMiddleware.js
// ─────────────────────────────────────────────────────────
// Multer configuration for handling image file uploads.
// Files are saved to /uploads/ directory.
// Only JPEG and PNG images are accepted.
// Max file size: 10 MB.
// ─────────────────────────────────────────────────────────

const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Where to save uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },

  // Give each file a unique name: uuid + original extension
  // This prevents filename collisions
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase(); // e.g. ".jpg"
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

// Filter: only allow image files
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true); // Accept the file
  } else {
    cb(new Error('Only JPEG and PNG images are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max
  },
});

module.exports = upload;
