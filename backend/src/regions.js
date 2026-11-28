const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { HttpError, asyncRoute } = require('./http');

function createRegions(dataDir) {
  const router = express.Router();
  router.get(
    '/:countryCode',
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

  return router;
}
module.exports = { createRegions };
