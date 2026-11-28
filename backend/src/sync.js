const express = require('express');
const { createHash } = require('node:crypto');
const { HttpError, asyncRoute } = require('./http');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () =>
  new HttpError(400, 'INVALID_VISIT_BATCH', 'Provide up to 100 valid visit operations.');
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) =>
  object(value) && Object.keys(value).every((key) => keys.includes(key));
const uuid = (value) => typeof value === 'string' && uuidPattern.test(value);
const timestamp = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8640000000000000;

function normalize(operation) {
  if (
    !onlyKeys(operation, ['id', 'entityType', 'entityId', 'operation', 'payload']) ||
    !uuid(operation.id) ||
    !uuid(operation.entityId) ||
    operation.entityType !== 'visit' ||
    !['upsert', 'delete'].includes(operation.operation)
  )
    throw invalid();
  const payload = operation.payload;
  if (
    !object(payload) ||
    !uuid(payload.id) ||
    payload.id.toLowerCase() !== operation.entityId.toLowerCase()
  )
    throw invalid();
  let normalized;
  if (operation.operation === 'delete') {
    if (!onlyKeys(payload, ['id', 'deletedAt']) || !timestamp(payload.deletedAt)) throw invalid();
    normalized = { id: payload.id.toLowerCase(), deletedAt: payload.deletedAt };
  } else {
    if (
      !onlyKeys(payload, [
        'id',
        'sessionId',
        'regionId',
        'startedAt',
        'confirmedAt',
        'source',
        'deletedAt',
      ]) ||
      !uuid(payload.sessionId) ||
      typeof payload.regionId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(payload.regionId) ||
      !timestamp(payload.startedAt) ||
      !timestamp(payload.confirmedAt) ||
      payload.confirmedAt - payload.startedAt < 300000 ||
      payload.source !== 'gps' ||
      payload.deletedAt !== null
    )
      throw invalid();
    normalized = {
      id: payload.id.toLowerCase(),
      sessionId: payload.sessionId.toLowerCase(),
      regionId: payload.regionId,
      startedAt: payload.startedAt,
      confirmedAt: payload.confirmedAt,
      source: 'gps',
      deletedAt: null,
    };
  }
  return {
    id: operation.id.toLowerCase(),
    entityType: 'visit',
    entityId: normalized.id,
    operation: operation.operation,
    payload: normalized,
  };
}

function createSync(db) {
  const router = express.Router();
  router.post(
    '/',
    asyncRoute(async (req, res) => {
      if (
        !onlyKeys(req.body, ['operations']) ||
        !Array.isArray(req.body.operations) ||
        req.body.operations.length > 100
      )
        throw invalid();
      const operations = req.body.operations.map(normalize);
      const acknowledgedIds = await db.transaction(async (transaction) => {
        const acknowledged = [];
        for (const operation of operations) {
          const hash = createHash('sha256').update(JSON.stringify(operation)).digest('hex');
          const receipt = await transaction.get(
            'SELECT request_hash FROM visit_sync_operations WHERE user_id=? AND operation_id=?',
            [req.user.id, operation.id],
          );
          if (receipt) {
            if (receipt.request_hash !== hash)
              throw new HttpError(
                409,
                'OPERATION_CONFLICT',
                'This operation ID was already used with different data.',
              );
            acknowledged.push(operation.id);
            continue;
          }
          const existing = await transaction.get('SELECT * FROM visits WHERE user_id=? AND id=?', [
            req.user.id,
            operation.entityId,
          ]);
          // Deletion wins even if it arrives before the original visit or another device retries it.
          if (existing?.deleted_at == null) {
            const payload = operation.payload;
            if (operation.operation === 'upsert' && existing) {
              if (
                existing.session_id !== payload.sessionId ||
                existing.region_id !== payload.regionId ||
                existing.started_at !== payload.startedAt ||
                existing.confirmed_at !== payload.confirmedAt
              )
                throw new HttpError(
                  409,
                  'VISIT_CONFLICT',
                  'Confirmed visit metadata cannot be overwritten.',
                );
            } else {
              if (operation.operation === 'upsert') {
                const session = await transaction.get(
                  'SELECT id FROM visits WHERE user_id=? AND session_id=?',
                  [req.user.id, payload.sessionId],
                );
                if (session)
                  throw new HttpError(
                    409,
                    'SESSION_CONFLICT',
                    'The session already belongs to a different visit.',
                  );
              }
              const change = await transaction.run(
                'INSERT INTO visit_changes(user_id,visit_id) VALUES (?,?)',
                [req.user.id, operation.entityId],
              );
              if (operation.operation === 'upsert') {
                await transaction.run(
                  'INSERT INTO visits(user_id,id,session_id,region_id,started_at,confirmed_at,source,revision) VALUES (?,?,?,?,?,?,?,?)',
                  [
                    req.user.id,
                    payload.id,
                    payload.sessionId,
                    payload.regionId,
                    payload.startedAt,
                    payload.confirmedAt,
                    'gps',
                    change.lastID,
                  ],
                );
              } else if (existing) {
                await transaction.run(
                  'UPDATE visits SET deleted_at=?,revision=? WHERE user_id=? AND id=?',
                  [payload.deletedAt, change.lastID, req.user.id, payload.id],
                );
              } else {
                await transaction.run(
                  'INSERT INTO visits(user_id,id,deleted_at,revision) VALUES (?,?,?,?)',
                  [req.user.id, payload.id, payload.deletedAt, change.lastID],
                );
              }
            }
          }
          await transaction.run(
            'INSERT INTO visit_sync_operations(user_id,operation_id,request_hash) VALUES (?,?,?)',
            [req.user.id, operation.id, hash],
          );
          acknowledged.push(operation.id);
        }
        return [...new Set(acknowledged)];
      });
      // Acknowledgement means the operation committed, not that an old upsert can restore a tombstone.
      res.json({ acknowledgedIds });
    }),
  );
  return router;
}
module.exports = { createSync };
