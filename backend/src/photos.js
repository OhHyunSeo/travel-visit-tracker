const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { HttpError, asyncRoute } = require('./http');

function createPhotos(db, authenticate, uploadsDir) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 },
    fileFilter: (req, file, done) => {
      if (['image/jpeg', 'image/png'].includes(file.mimetype)) done(null, true);
      else done(new HttpError(400, 'INVALID_FILE_TYPE', 'Only JPEG and PNG images are accepted.'));
    },
  });
  router.post(
    '/api/photos',
    authenticate,
    upload.single('file'),
    asyncRoute(async (req, res) => {
      if (!req.file) throw new HttpError(400, 'NO_FILE', 'Provide an image in the file field.');
      const regionId = req.body.region_id;
      if (typeof regionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(regionId))
        throw new HttpError(400, 'INVALID_REGION_ID', 'Provide a valid region_id.');
      let original, thumbnail;
      try {
        const options = { limitInputPixels: 25000000 };
        original = await sharp(req.file.buffer, options).rotate().jpeg({ quality: 90 }).toBuffer();
        thumbnail = await sharp(req.file.buffer, options)
          .rotate()
          .resize(200, 200, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toBuffer();
      } catch {
        throw new HttpError(400, 'INVALID_IMAGE', 'The file is not a supported, readable image.');
      }
      const id = randomUUID(),
        filename = `${id}.jpg`,
        thumbnailFilename = `${id}_thumb.jpg`;
      const originalPath = path.join(uploadsDir, filename);
      const thumbnailPath = path.join(uploadsDir, 'thumbnails', thumbnailFilename);
      const created = [];
      const uploadedAt = new Date().toISOString();
      try {
        await fs.writeFile(originalPath, original, { flag: 'wx' });
        created.push(originalPath);
        await fs.writeFile(thumbnailPath, thumbnail, { flag: 'wx' });
        created.push(thumbnailPath);
        await db.run(
          'INSERT INTO photos(id,user_id,region_id,filename,thumbnail_filename,created_at) VALUES (?,?,?,?,?,?)',
          [id, req.user.id, regionId, filename, thumbnailFilename, uploadedAt],
        );
      } catch (error) {
        // Only files successfully created by this request may be removed on failure.
        await Promise.all(created.map((file) => fs.unlink(file).catch(() => undefined)));
        throw error;
      }
      const base = `${req.protocol}://${req.get('host')}`;
      res.json({
        id,
        url: `${base}/uploads/${filename}`,
        thumbnail_url: `${base}/uploads/thumbnails/${thumbnailFilename}`,
        region_id: regionId,
        uploaded_at: uploadedAt,
      });
    }),
  );
  function servePhoto(thumbnail) {
    return asyncRoute(async (req, res, next) => {
      const column = thumbnail ? 'thumbnail_filename' : 'filename';
      const row = await db.get(
        `SELECT ${column} AS filename FROM photos WHERE ${column}=? AND user_id=?`,
        [req.params.filename, req.user.id],
      );
      if (!row) throw new HttpError(404, 'PHOTO_NOT_FOUND', 'Photo not found.');
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.sendFile(
        row.filename,
        {
          root: thumbnail ? path.join(uploadsDir, 'thumbnails') : uploadsDir,
          dotfiles: 'deny',
          headers: { 'Cache-Control': 'private, no-store' },
        },
        (error) => {
          if (error && !res.headersSent)
            next(new HttpError(404, 'PHOTO_NOT_FOUND', 'Photo not found.'));
        },
      );
    });
  }
  router.get('/uploads/thumbnails/:filename', authenticate, servePhoto(true));
  router.get('/uploads/:filename', authenticate, servePhoto(false));
  return router;
}
module.exports = { createPhotos };
