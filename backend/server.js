const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Database setup
const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

// Middleware
app.use(morgan('combined'));
app.use(compression());
app.use(cors({
  origin: '*', // Allow all origins for MVP - restrict in production
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'If-None-Match', 'Authorization']
}));
app.use(express.json());

// Ensure upload directories exist
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');
const DATA_DIR = path.join(__dirname, 'data');

async function ensureDirectories() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(THUMBNAILS_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// Initialize database
async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const schemaPath = path.join(__dirname, 'data', 'schema.sql');
    fs.readFile(schemaPath, 'utf8')
      .then(schema => {
        db.exec(schema, (err) => {
          if (err) {
            console.error('Error initializing database:', err);
            reject(err);
          } else {
            console.log('Database initialized successfully');
            resolve();
          }
        });
      })
      .catch(reject);
  });
}


// Helper function to generate ETag from file content
function generateETag(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'NO_TOKEN',
      message: 'Access token is required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        error: 'Forbidden',
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
}

// Auth endpoints
// POST /api/auth/signup - User registration
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Validate input
    if (!email || !password || !username) {
      return res.status(400).json({
        error: 'Validation error',
        code: 'MISSING_FIELDS',
        message: 'Email, password, and username are required'
      });
    }

    // Check if user already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({
          error: 'Internal server error',
          code: 'SERVER_ERROR',
          message: 'Failed to create user'
        });
      }

      if (row) {
        return res.status(409).json({
          error: 'User already exists',
          code: 'USER_EXISTS',
          message: 'A user with this email already exists'
        });
      }

      // Hash password
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Insert user
      db.run(
        'INSERT INTO users (email, password_hash, username) VALUES (?, ?, ?)',
        [email, passwordHash, username],
        function (err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({
              error: 'Internal server error',
              code: 'SERVER_ERROR',
              message: 'Failed to create user'
            });
          }

          // Generate JWT token
          const token = jwt.sign(
            { id: this.lastID, email, username },
            JWT_SECRET,
            { expiresIn: '30d' }
          );

          res.status(201).json({
            token,
            user: {
              id: this.lastID,
              email,
              username
            }
          });
        }
      );
    });
  } catch (err) {
    console.error('Error in signup:', err);
    res.status(500).json({
      error: 'Internal server error',
      code: 'SERVER_ERROR',
      message: 'Failed to create user'
    });
  }
});

// POST /api/auth/login - User login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        error: 'Validation error',
        code: 'MISSING_FIELDS',
        message: 'Email and password are required'
      });
    }

    // Find user
    db.get(
      'SELECT id, email, password_hash, username FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({
            error: 'Internal server error',
            code: 'SERVER_ERROR',
            message: 'Failed to login'
          });
        }

        if (!user) {
          return res.status(401).json({
            error: 'Invalid credentials',
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password'
          });
        }

        // Check password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
          return res.status(401).json({
            error: 'Invalid credentials',
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password'
          });
        }

        // Generate JWT token
        const token = jwt.sign(
          { id: user.id, email: user.email, username: user.username },
          JWT_SECRET,
          { expiresIn: '30d' }
        );

        res.json({
          token,
          user: {
            id: user.id,
            email: user.email,
            username: user.username
          }
        });
      }
    );
  } catch (err) {
    console.error('Error in login:', err);
    res.status(500).json({
      error: 'Internal server error',
      code: 'SERVER_ERROR',
      message: 'Failed to login'
    });
  }
});

// GET /api/auth/me - Get current user (requires authentication)
app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get(
    'SELECT id, email, username, created_at FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({
          error: 'Internal server error',
          code: 'SERVER_ERROR',
          message: 'Failed to get user'
        });
      }

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        });
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          createdAt: user.created_at
        }
      });
    }
  );
});

// GeoJSON pack endpoint
app.get('/api/geojson/:countryCode', async (req, res) => {
  try {
    const { countryCode } = req.params;

    // Validate country code format (2-3 uppercase letters)
    if (!/^[A-Z]{2,3}$/.test(countryCode)) {
      return res.status(400).json({
        error: 'Invalid country code',
        code: 'INVALID_COUNTRY',
        message: 'Country code must be 2-3 uppercase letters (e.g., KR, US, JP)'
      });
    }

    const filename = `${countryCode}_boundaries.geojson`;
    const filePath = path.join(DATA_DIR, filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (err) {
      return res.status(404).json({
        error: 'GeoJSON pack not found',
        code: 'PACK_NOT_FOUND',
        message: `No GeoJSON pack available for country code: ${countryCode}`
      });
    }

    // Read file content
    const fileContent = await fs.readFile(filePath, 'utf8');
    const etag = generateETag(fileContent);

    // Handle conditional request (If-None-Match)
    const clientETag = req.headers['if-none-match'];
    if (clientETag && clientETag === etag) {
      return res.status(304).end();
    }

    // Set response headers
    res.set({
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'public, max-age=86400',
      'ETag': etag
    });

    // Send GeoJSON (compression middleware will handle gzip)
    res.send(fileContent);

  } catch (err) {
    console.error('Error serving GeoJSON pack:', err);
    res.status(500).json({
      error: 'Internal server error',
      code: 'SERVER_ERROR',
      message: 'Failed to serve GeoJSON pack'
    });
  }
});

// Configure multer for photo uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB limit
  },
  fileFilter: (req, file, cb) => {
    // Validate MIME type
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG and PNG are allowed.'));
    }
  }
});

// Photo upload endpoint
app.post('/api/photos', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded',
        code: 'NO_FILE',
        message: 'Please provide a file in the "file" field'
      });
    }

    const { region_id } = req.body;
    if (!region_id) {
      return res.status(400).json({
        error: 'Missing region_id',
        code: 'MISSING_REGION_ID',
        message: 'Please provide a region_id in the request body'
      });
    }

    // Generate unique filename
    const fileExtension = req.file.mimetype === 'image/jpeg' ? 'jpg' : 'png';
    const uniqueFilename = `${uuidv4()}.${fileExtension}`;
    const thumbnailFilename = `${uuidv4()}_thumb.${fileExtension}`;

    const originalPath = path.join(UPLOADS_DIR, uniqueFilename);
    const thumbnailPath = path.join(THUMBNAILS_DIR, thumbnailFilename);

    // Save original image
    await sharp(req.file.buffer)
      .jpeg({ quality: 90 }) // Optimize quality
      .toFile(originalPath);

    // Create thumbnail (200x200)
    await sharp(req.file.buffer)
      .resize(200, 200, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 80 })
      .toFile(thumbnailPath);

    // Generate URLs (in production, these would be CDN URLs)
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const photoUrl = `${baseUrl}/uploads/${uniqueFilename}`;
    const thumbnailUrl = `${baseUrl}/uploads/thumbnails/${thumbnailFilename}`;

    res.json({
      url: photoUrl,
      thumbnail_url: thumbnailUrl,
      region_id: region_id,
      uploaded_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('Error uploading photo:', err);

    if (err.message.includes('Invalid file type')) {
      return res.status(400).json({
        error: 'Invalid file type',
        code: 'INVALID_FILE_TYPE',
        message: err.message
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      code: 'SERVER_ERROR',
      message: 'Failed to upload photo'
    });
  }
});

// Handle multer file size errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        code: 'FILE_TOO_LARGE',
        message: 'File size must be less than 10 MB'
      });
    }
  }
  next(err);
});

// POST /api/trips/sync - Sync location steps
app.post('/api/trips/sync', authenticateToken, async (req, res) => {
  try {
    const { steps } = req.body;

    if (!steps || !Array.isArray(steps)) {
      return res.status(400).json({
        error: 'Validation error',
        code: 'INVALID_DATA',
        message: 'Steps array is required'
      });
    }

    const userId = req.user.id;
    const syncedIds = [];

    // Process transactions
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      const stmt = db.prepare(`
        INSERT INTO steps (user_id, trip_id, latitude, longitude, timestamp, accuracy, altitude, type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      steps.forEach(step => {
        // Map local trip_id to server trip_id if needed.
        // For MVP, we might treat trip_id=1 as a default or creating a new trip.
        // Simplified: Insert step
        stmt.run(
          userId,
          step.trip_id, // This might need mapping logic in real app
          step.latitude,
          step.longitude,
          step.timestamp,
          step.accuracy,
          step.altitude,
          step.type,
          function (err) {
            if (!err) {
              syncedIds.push(step.local_id);
            } else {
              console.error('Error inserting step:', err);
            }
          }
        );
      });

      stmt.finalize(() => {
        db.run('COMMIT', (err) => {
          if (err) {
            console.error('Commit error:', err);
            return res.status(500).json({ error: 'Database error' });
          }

          res.json({
            success: true,
            synced_ids: syncedIds,
            message: `Synced ${syncedIds.length} steps`
          });
        });
      });
    });

  } catch (err) {
    console.error('Error in sync:', err);
    res.status(500).json({
      error: 'Internal server error',
      code: 'SERVER_ERROR',
      message: 'Failed to sync data'
    });
  }
});

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOADS_DIR));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'travel-visit-tracker-backend'
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    code: 'SERVER_ERROR',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Start server
Promise.all([ensureDirectories(), initializeDatabase()])
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Travel Visit Tracker Backend running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
    });
  })
  .catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
