# GeoJSON Data Directory

This directory contains GeoJSON boundary packs for different countries used by the Travel Visit Tracker app.

## File Format

Files should follow the naming convention: `{COUNTRY_CODE}_boundaries.geojson`

Example: `KR_boundaries.geojson`, `US_boundaries.geojson`, `JP_boundaries.geojson`

## GeoJSON Structure

Each GeoJSON file must be a FeatureCollection with the following structure:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "unique-region-id",
      "properties": {
        "name": "Region Name",
        "admin_level": 8,
        "country_code": "KR"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[lng, lat], [lng, lat], ...]]
      }
    }
  ]
}
```

### Required Properties

- **id**: Unique identifier for the region (e.g., "KR-11-680")
- **name**: Human-readable region name (e.g., "Gangnam-gu")
- **admin_level**: Administrative level (8 for districts, 7 for cities, 4 for provinces)
- **country_code**: ISO 3166-1 alpha-2 country code (e.g., "KR", "US", "JP")

### Geometry

- Polygons should use simplified coordinates to reduce file size
- Coordinates are in [longitude, latitude] format (GeoJSON standard)
- First and last coordinate must be identical to close the polygon

## Available Packs

### KR_boundaries.geojson (South Korea - Seoul Districts)

Contains 15 Seoul districts (gu) with admin_level 8:

| ID | Name | Centroid (approx) |
|---|---|---|
| KR-11-680 | Gangnam-gu | 127.0585, 37.506 |
| KR-11-650 | Seocho-gu | 127.0285, 37.4825 |
| KR-11-230 | Songpa-gu | 127.095, 37.5075 |
| KR-11-545 | Gangdong-gu | 127.135, 37.535 |
| KR-11-440 | Mapo-gu | 126.920, 37.555 |
| KR-11-380 | Eunpyeong-gu | 126.930, 37.620 |
| KR-11-305 | Gangbuk-gu | 127.025, 37.640 |
| KR-11-260 | Jungnang-gu | 127.085, 37.600 |
| KR-11-200 | Seongdong-gu | 127.045, 37.560 |
| KR-11-170 | Yongsan-gu | 126.985, 37.535 |
| KR-11-140 | Jung-gu | 126.990, 37.565 |
| KR-11-110 | Jongno-gu | 126.980, 37.585 |
| KR-11-590 | Dongjak-gu | 126.990, 37.5025 |
| KR-11-500 | Gwanak-gu | 126.960, 37.475 |
| KR-11-620 | Geumcheon-gu | 126.910, 37.4575 |

**File size**: ~3.5 KB (uncompressed), ~1 KB (gzipped)

**Coverage area**: Central Seoul metropolitan area

## Testing

To test the GeoJSON endpoint:

```bash
# Start the backend server
cd backend
npm start

# Request the KR pack
curl http://localhost:3000/api/geojson/KR

# Test with ETag caching
curl -H "If-None-Match: <etag-from-previous-response>" http://localhost:3000/api/geojson/KR
```

## Adding New Packs

1. Create a new GeoJSON file following the naming convention
2. Ensure all required properties are present
3. Simplify polygon geometries to reduce file size (use tools like mapshaper)
4. Calculate centroid coordinates for each region
5. Test the endpoint to verify proper serving

## Admin Level Mapping

Different countries use different admin_level values:

- **South Korea (KR)**:
  - 8: District (구, gu) - e.g., Gangnam-gu
  - 7: City (시, si) - e.g., Suwon-si
  - 4: Province (도, do) - e.g., Gyeonggi-do

- **United States (US)**:
  - 6: County
  - 4: State

- **Japan (JP)**:
  - 7: City (市, shi)
  - 4: Prefecture (県, ken)

These mappings are handled by the Flutter app's GeoJSON service.
