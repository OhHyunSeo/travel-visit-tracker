const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateSecret } = require('./config');
const { openDatabase } = require('./database');
const { createAuth } = require('./auth');
const { createPhotos } = require('./photos');
const { HttpError, asyncRoute, errorHandler } = require('./http');

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
  app.use(createPhotos(db, authenticate, uploadsDir));

  app.get(
    '/api/geojson/:countryCode',
    asyncRoute(async (req, res) => {
      if (!/^[A-Z]{2,3}$/.test(req.params.countryCode))
        throw new HttpError(400, 'INVALID_COUNTRY', 'Country code must be 2-3 uppercase letters.');
      let content;
      try {
        content = await fs.readFile(
          path.join(dataDir, `${req.params.countryCode}_boundaries.geojson`),
        );
      } catch (error) {
        if (error.code === 'ENOENT')
          throw new HttpError(404, 'PACK_NOT_FOUND', 'GeoJSON pack not found.');
        throw error;
      }
      const etag = `"${createHash('sha256').update(content).digest('hex')}"`;
      if (req.get('If-None-Match') === etag) return res.status(304).end();
      res.set({
        'Content-Type': 'application/geo+json',
        'Cache-Control': 'public, max-age=86400',
        ETag: etag,
      });
      res.send(content);
    }),
  );

  // Legacy location-point endpoint. The Expo visits/outbox client is not connected to this route.
  app.post(
    '/api/trips/sync',
    authenticate,
    asyncRoute(async (req, res) => {
      const steps = req.body?.steps;
      if (!Array.isArray(steps) || steps.length > 1000)
        throw new HttpError(
          400,
          'INVALID_DATA',
          'Provide a steps array with at most 1000 location points.',
        );
      for (const step of steps) {
        if (
          !step ||
          typeof step !== 'object' ||
          Array.isArray(step) ||
          typeof step.latitude !== 'number' ||
          !Number.isFinite(step.latitude) ||
          Math.abs(step.latitude) > 90 ||
          typeof step.longitude !== 'number' ||
          !Number.isFinite(step.longitude) ||
          Math.abs(step.longitude) > 180 ||
          (step.trip_id != null && (!Number.isSafeInteger(step.trip_id) || step.trip_id <= 0)) ||
          (step.accuracy != null &&
            (typeof step.accuracy !== 'number' ||
              !Number.isFinite(step.accuracy) ||
              step.accuracy < 0)) ||
          (step.altitude != null &&
            (typeof step.altitude !== 'number' || !Number.isFinite(step.altitude))) ||
          (step.timestamp != null && !['string', 'number'].includes(typeof step.timestamp)) ||
          (step.type != null && (typeof step.type !== 'string' || step.type.length > 80)) ||
          !['string', 'number'].includes(typeof step.local_id)
        )
          throw new HttpError(
            400,
            'INVALID_LOCATION',
            'Each step must contain valid coordinates, optional trip metadata and a local_id.',
          );
      }
      const syncedIds = await db.transaction(async (transaction) => {
        const trips = new Set(
          steps.filter((step) => step.trip_id != null).map((step) => step.trip_id),
        );
        for (const id of trips) {
          const trip = await transaction.get('SELECT id FROM trips WHERE id=? AND user_id=?', [
            id,
            req.user.id,
          ]);
          if (!trip)
            throw new HttpError(403, 'TRIP_FORBIDDEN', 'The trip is unavailable to this account.');
        }
        const ids = [];
        for (const step of steps) {
          await transaction.run(
            'INSERT INTO steps(user_id,trip_id,latitude,longitude,timestamp,accuracy,altitude,type) VALUES (?,?,?,?,?,?,?,?)',
            [
              req.user.id,
              step.trip_id ?? null,
              step.latitude,
              step.longitude,
              step.timestamp ?? null,
              step.accuracy ?? null,
              step.altitude ?? null,
              step.type ?? null,
            ],
          );
          ids.push(step.local_id);
        }
        return ids;
      });
      res.json({
        success: true,
        synced_ids: syncedIds,
        message: `Synced ${syncedIds.length} location points`,
      });
    }),
  );
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
