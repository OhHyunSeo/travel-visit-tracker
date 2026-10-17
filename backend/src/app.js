const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRegions } = require('./regions');
const { validateSecret } = require('./config');
const { openDatabase } = require('./database');
const { createAuth } = require('./auth');
const { createPhotos } = require('./photos');
const { createVisits } = require('./visits');
const { createLegacyTrips } = require('./legacyTrips');
const { HttpError, errorHandler } = require('./http');

async function createBackend(config) {
  validateSecret(config.jwtSecret);
  const root = path.resolve(__dirname, '..');
  const dbPath = config.dbPath || path.join(root, 'data/database.sqlite');
  const uploadsDir = path.resolve(config.uploadsDir || path.join(root, 'uploads'));
  const dataDir = path.resolve(config.dataDir || path.join(root, 'data'));
  if (dbPath !== ':memory:') await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.mkdir(path.join(uploadsDir, 'thumbnails'), { recursive: true });
  const db = await openDatabase(dbPath);
  const app = express();
  app.disable('x-powered-by');
  if (config.logging) app.use(morgan('combined'));
  app.use(compression());
  const allowed = new Set(config.corsOrigins || []);
  app.use(
    cors({
      origin: (origin, done) => done(null, !origin || allowed.has(origin)),
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'If-None-Match', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  const { router: auth, authenticate } = createAuth(db, config.jwtSecret);
  app.use('/api/auth', auth);
  app.use('/api/visits', createVisits(db, authenticate));
  app.use(createPhotos(db, authenticate, uploadsDir));

  app.use('/api/geojson', createRegions(dataDir));

  app.use('/api/trips', createLegacyTrips(db, authenticate));
  app.get('/health', (req, res) =>
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'travel-visit-tracker-backend',
    }),
  );
  app.use((req, res, next) => next(new HttpError(404, 'NOT_FOUND', 'Route not found.')));
  app.use(errorHandler);
  return { app, db, close: () => db.close() };
}
module.exports = { createBackend };
