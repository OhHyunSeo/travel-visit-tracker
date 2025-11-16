# Travel Visit Tracker Backend

Backend service for the Travel Visit Tracker app. Provides GeoJSON boundary data and photo upload functionality.

## Features

- Serve country-specific GeoJSON boundary packs
- Handle photo uploads with automatic thumbnail generation
- ETag support for efficient caching
- CORS enabled for Flutter app
- Gzip compression for responses
- Request logging

## Installation

```bash
npm install
```

## Running the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server runs on port 3000 by default. Set the `PORT` environment variable to use a different port.

## API Endpoints

### Health Check

**GET** `/health`

Returns server status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-14T10:30:00.000Z",
  "service": "travel-visit-tracker-backend"
}
```

### Get GeoJSON Pack

**GET** `/api/geojson/:countryCode`

Retrieves the GeoJSON boundary pack for a specific country.

**Parameters:**
- `countryCode` (path): 2-3 uppercase letter country code (e.g., KR, US, JP)

**Headers:**
- `If-None-Match` (optional): ETag for conditional requests

**Response Headers:**
- `Content-Type: application/geo+json`
- `Cache-Control: public, max-age=86400`
- `ETag: <hash>`
- `Content-Encoding: gzip`

**Success Response (200):**
```json
{
  "type": "FeatureCollection",
  "features": [...]
}
```

**Not Modified (304):**
Returns empty body if ETag matches.

**Error Responses:**
- `400`: Invalid country code format
- `404`: GeoJSON pack not found for country
- `500`: Server error

### Upload Photo

**POST** `/api/photos`

Uploads a photo and generates a thumbnail.

**Content-Type:** `multipart/form-data`

**Parameters:**
- `file` (file): Image file (JPEG or PNG, max 10 MB)
- `region_id` (string): ID of the region to attach photo to

**Success Response (200):**
```json
{
  "url": "http://localhost:3000/uploads/abc123.jpg",
  "thumbnail_url": "http://localhost:3000/uploads/thumbnails/abc123_thumb.jpg",
  "region_id": "KR-11-680",
  "uploaded_at": "2025-11-14T10:30:00.000Z"
}
```

**Error Responses:**
- `400`: No file uploaded, missing region_id, or invalid file type
- `413`: File too large (> 10 MB)
- `500`: Server error

## Directory Structure

```
backend/
├── server.js           # Main server file
├── package.json        # Dependencies
├── data/              # GeoJSON pack files
│   └── KR_boundaries.geojson
│   └── US_boundaries.geojson
│   └── JP_boundaries.geojson
└── uploads/           # Uploaded photos (auto-created)
    └── thumbnails/    # Generated thumbnails
```

## Adding GeoJSON Packs

Place GeoJSON files in the `data/` directory with the naming convention:
```
{COUNTRY_CODE}_boundaries.geojson
```

For example:
- `KR_boundaries.geojson` for South Korea
- `US_boundaries.geojson` for United States
- `JP_boundaries.geojson` for Japan

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode (development/production)

## Testing

Test the health endpoint:
```bash
curl http://localhost:3000/health
```

Test GeoJSON endpoint:
```bash
curl http://localhost:3000/api/geojson/KR
```

Test photo upload:
```bash
curl -X POST http://localhost:3000/api/photos \
  -F "file=@photo.jpg" \
  -F "region_id=KR-11-680"
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Configure CORS origin to your Flutter app domain
3. Use a reverse proxy (nginx) for HTTPS
4. Consider using S3 or CDN for photo storage
5. Set up proper logging and monitoring
