const express = require('express');
const { createSync } = require('./sync');
const { HttpError, asyncRoute } = require('./http');

function createVisits(db, authenticate) {
  const router = express.Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.use('/sync', createSync(db));
  router.get(
    '/',
    asyncRoute(async (req, res) => {
      if (Object.keys(req.query).some((key) => !['after', 'limit'].includes(key)))
        throw new HttpError(400, 'INVALID_CURSOR', 'Use after and limit pagination parameters.');
      const number = (value, fallback) =>
        value === undefined
          ? fallback
          : typeof value === 'string' && /^\d+$/.test(value)
            ? Number(value)
            : NaN;
      const after = number(req.query.after, 0);
      const limit = number(req.query.limit, 100);
      if (
        !Number.isSafeInteger(after) ||
        after < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
      )
        throw new HttpError(
          400,
          'INVALID_CURSOR',
          'Provide a nonnegative after cursor and a limit from 1 to 500.',
        );
      const rows = await db.all(
        'SELECT id,session_id AS sessionId,region_id AS regionId,started_at AS startedAt,confirmed_at AS confirmedAt,source,deleted_at AS deletedAt,revision FROM visits WHERE user_id=? AND revision>? ORDER BY revision LIMIT ?',
        [req.user.id, after, limit + 1],
      );
      const visits = rows.slice(0, limit);
      res.json({
        visits,
        cursor: visits.at(-1)?.revision ?? after,
        hasMore: rows.length > limit,
      });
    }),
  );
  return router;
}
module.exports = { createVisits };
