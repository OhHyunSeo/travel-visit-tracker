const express = require('express');
const { HttpError, asyncRoute } = require('./http');

function createLegacyTrips(db, authenticate) {
  const router = express.Router();
  // Legacy location-point endpoint. The Expo visits/outbox client is not connected to this route.
  router.post(
    '/sync',
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
  return router;
}
module.exports = { createLegacyTrips };
