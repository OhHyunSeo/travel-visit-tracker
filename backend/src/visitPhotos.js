const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { HttpError, asyncRoute } = require('./http');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () =>
  new HttpError(400, 'INVALID_PHOTO', 'Provide valid photo, visit, operation IDs and createdAt.');
const columns = `p.id,p.visit_id,p.created_at,p.sha256,p.byte_length,p.mime_type,p.revision`;
function photoMetadata(row) {
  return {
    id: row.id,
    visitId: row.visit_id,
    createdAt: row.created_at,
    sha256: row.sha256,
    byteLength: row.byte_length,
    mimeType: row.mime_type,
    revision: row.revision,
    originalPath: `/api/visit-photos/${row.id}/original`,
    thumbnailPath: `/api/visit-photos/${row.id}/thumbnail`,
  };
}
function metadata(body) {
  const keys = ['id', 'visitId', 'operationId', 'createdAt'];
  if (
    !body ||
    Object.keys(body).length !== keys.length ||
    Object.keys(body).some((key) => !keys.includes(key)) ||
    ['id', 'visitId', 'operationId'].some(
      (key) => typeof body[key] !== 'string' || !uuidPattern.test(body[key]),
    ) ||
    typeof body.createdAt !== 'string' ||
    !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(body.createdAt)
  )
    throw invalid();
  const createdAt = Number(body.createdAt);
  if (!Number.isFinite(createdAt) || createdAt < 0 || createdAt > Number.MAX_SAFE_INTEGER)
    throw invalid();
  return {
    id: body.id.toLowerCase(),
    visitId: body.visitId.toLowerCase(),
    operationId: body.operationId.toLowerCase(),
    createdAt,
  };
}
async function writeCreated(filename, buffer, created) {
  const file = await fs.open(filename, 'wx', 0o600);
  created.push(filename);
  try {
    await fs.writeFile(file, buffer);
  } finally {
    await file.close();
  }
}
function createVisitPhotos(db, authenticate, uploadsDir) {
  const router = express.Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      // Busboy reports its limit at equality, so reserve one byte for inclusive validation.
      fileSize: 10 * 1024 * 1024 + 1,
      files: 1,
      fields: 4,
      fieldSize: 160,
    },
    fileFilter: (req, file, done) => {
      if (['image/jpeg', 'image/png'].includes(file.mimetype)) done(null, true);
      else
        done(
          new HttpError(400, 'INVALID_FILE_TYPE', 'Only JPEG and PNG attachments are accepted.'),
        );
    },
  });
  router.post(
    '/',
    upload.single('file'),
    asyncRoute(async (req, res) => {
      if (!req.file) throw new HttpError(400, 'NO_FILE', 'Provide an image in the file field.');
      if (req.file.buffer.length > 10 * 1024 * 1024)
        throw new HttpError(413, 'FILE_TOO_LARGE', 'The attachment exceeds the size limit.');
      const values = metadata(req.body);
      let thumbnail, mimeType;
      try {
        const image = sharp(req.file.buffer, { limitInputPixels: 25000000 });
        const info = await image.metadata();
        mimeType = { jpeg: 'image/jpeg', png: 'image/png' }[info.format];
        if (
          !mimeType ||
          mimeType !== req.file.mimetype ||
          !info.width ||
          !info.height ||
          info.width * info.height * (info.pages || 1) > 25000000
        )
          throw new Error('unsupported attachment');
        thumbnail = await image
          .rotate()
          .resize(200, 200, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toBuffer();
      } catch {
        throw new HttpError(
          400,
          'INVALID_IMAGE',
          'The attachment is not a readable JPEG or PNG image.',
        );
      }
      const sha256 = createHash('sha256').update(req.file.buffer).digest('hex');
      const byteLength = req.file.buffer.length;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ ...values, sha256, byteLength, mimeType }))
        .digest('hex');
      const created = [];
      let photo;
      try {
        photo = await db.transaction(async (transaction) => {
          // A stored receipt must never bypass a later parent tombstone.
          const visit = await transaction.get(
            'SELECT source,deleted_at FROM visits WHERE user_id=? AND id=?',
            [req.user.id, values.visitId],
          );
          if (!visit)
            throw new HttpError(
              404,
              'PHOTO_VISIT_NOT_FOUND',
              'The visit is unavailable to this account.',
            );
          if (visit.deleted_at !== null)
            throw new HttpError(409, 'PHOTO_VISIT_DELETED', 'The parent visit has been deleted.');
          if (visit.source !== 'gps')
            throw new HttpError(
              404,
              'PHOTO_VISIT_NOT_FOUND',
              'The visit is unavailable to this account.',
            );
          const receipt = await transaction.get(
            'SELECT photo_id,request_hash FROM photo_sync_operations WHERE user_id=? AND operation_id=?',
            [req.user.id, values.operationId],
          );
          if (receipt && receipt.request_hash !== requestHash)
            throw new HttpError(
              409,
              'PHOTO_OPERATION_CONFLICT',
              'The operation ID was already used with different data.',
            );
          const existing = await transaction.get(
            'SELECT * FROM visit_photos WHERE user_id=? AND id=?',
            [req.user.id, values.id],
          );
          if (
            existing &&
            (existing.visit_id !== values.visitId ||
              existing.created_at !== values.createdAt ||
              existing.sha256 !== sha256 ||
              existing.byte_length !== byteLength ||
              existing.mime_type !== mimeType)
          )
            throw new HttpError(
              409,
              'PHOTO_CONFLICT',
              'The photo ID was already used with different data.',
            );
          if (receipt) {
            if (!existing || receipt.photo_id !== existing.id)
              throw new Error('Photo receipt has no matching attachment.');
            return existing;
          }
          let stored = existing;
          if (!stored) {
            const filename = `${randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
            const thumbnailFilename = `${randomUUID()}_thumb.jpg`;
            // The attachment stays byte-for-byte intact; only its thumbnail is re-encoded.
            await writeCreated(path.join(uploadsDir, filename), req.file.buffer, created);
            await writeCreated(
              path.join(uploadsDir, 'thumbnails', thumbnailFilename),
              thumbnail,
              created,
            );
            const change = await transaction.run(
              'INSERT INTO visit_photo_changes(user_id,photo_id) VALUES (?,?)',
              [req.user.id, values.id],
            );
            await transaction.run(
              'INSERT INTO visit_photos(user_id,id,visit_id,created_at,sha256,byte_length,mime_type,filename,thumbnail_filename,revision) VALUES (?,?,?,?,?,?,?,?,?,?)',
              [
                req.user.id,
                values.id,
                values.visitId,
                values.createdAt,
                sha256,
                byteLength,
                mimeType,
                filename,
                thumbnailFilename,
                change.lastID,
              ],
            );
            stored = {
              id: values.id,
              visit_id: values.visitId,
              created_at: values.createdAt,
              sha256,
              byte_length: byteLength,
              mime_type: mimeType,
              revision: change.lastID,
            };
          }
          await transaction.run(
            'INSERT INTO photo_sync_operations(user_id,operation_id,photo_id,request_hash) VALUES (?,?,?,?)',
            [req.user.id, values.operationId, values.id, requestHash],
          );
          return stored;
        });
      } catch (error) {
        let committed;
        try {
          committed = await db.get(
            'SELECT filename,thumbnail_filename FROM visit_photos WHERE user_id=? AND id=?',
            [req.user.id, values.id],
          );
        } catch {
          // An uncertain commit/read must preserve private files for later inspection.
          throw error;
        }
        const referenced = new Set(
          committed
            ? [
                path.join(uploadsDir, committed.filename),
                path.join(uploadsDir, 'thumbnails', committed.thumbnail_filename),
              ]
            : [],
        );
        // Only remove our exclusively created paths that are not committed attachments.
        await Promise.all(
          created
            .filter((filename) => !referenced.has(filename))
            .map((filename) => fs.unlink(filename).catch(() => undefined)),
        );
        throw error;
      }
      res.json({
        acknowledgedId: values.operationId,
        photo: photoMetadata(photo),
      });
    }),
  );
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
      const after = number(req.query.after, 0),
        limit = number(req.query.limit, 100);
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
          'Provide a nonnegative cursor and a limit from 1 to 500.',
        );
      const rows = await db.all(
        `SELECT ${columns} FROM visit_photos p JOIN visits v ON v.user_id=p.user_id AND v.id=p.visit_id WHERE p.user_id=? AND v.source='gps' AND v.deleted_at IS NULL AND p.revision>? ORDER BY p.revision LIMIT ?`,
        [req.user.id, after, limit + 1],
      );
      const photos = rows.slice(0, limit).map(photoMetadata);
      res.json({
        photos,
        cursor: photos.at(-1)?.revision ?? after,
        hasMore: rows.length > limit,
      });
    }),
  );
  function servePhoto(thumbnail) {
    return asyncRoute(async (req, res, next) => {
      if (!uuidPattern.test(req.params.id))
        throw new HttpError(404, 'PHOTO_NOT_FOUND', 'Photo not found.');
      const row = await db.get(
        `SELECT p.filename,p.thumbnail_filename,p.mime_type FROM visit_photos p JOIN visits v ON v.user_id=p.user_id AND v.id=p.visit_id WHERE p.user_id=? AND p.id=? AND v.source='gps' AND v.deleted_at IS NULL`,
        [req.user.id, req.params.id.toLowerCase()],
      );
      if (!row) throw new HttpError(404, 'PHOTO_NOT_FOUND', 'Photo not found.');
      res.type(thumbnail ? 'image/jpeg' : row.mime_type);
      res.sendFile(
        thumbnail ? row.thumbnail_filename : row.filename,
        {
          root: thumbnail ? path.join(uploadsDir, 'thumbnails') : uploadsDir,
          dotfiles: 'deny',
          cacheControl: false,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        },
        (error) => {
          if (error && !res.headersSent)
            next(new HttpError(404, 'PHOTO_NOT_FOUND', 'Photo not found.'));
        },
      );
    });
  }
  router.get('/:id/original', servePhoto(false));
  router.get('/:id/thumbnail', servePhoto(true));
  return router;
}
module.exports = { createVisitPhotos };
