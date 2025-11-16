/**
 * Script to simplify GeoJSON files and measure the reduction
 * This demonstrates the geometry simplification benefits
 */

const fs = require('fs');
const path = require('path');

// Simple Douglas-Peucker implementation for Node.js
function simplifyGeometry(geometry, tolerance = 0.001) {
  if (!geometry || !geometry.coordinates) {
    return geometry;
  }

  const type = geometry.type;

  if (type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: simplifyPolygonCoordinates(geometry.coordinates, tolerance)
    };
  } else if (type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map(polygon => 
        simplifyPolygonCoordinates(polygon, tolerance)
      )
    };
  }

  return geometry;
}

function simplifyPolygonCoordinates(coordinates, tolerance) {
  return coordinates.map(ring => simplifyRing(ring, tolerance));
}

function simplifyRing(ring, tolerance) {
  if (ring.length <= 3) {
    return ring;
  }

  const points = ring.map(coord => ({ x: coord[0], y: coord[1] }));
  const simplified = douglasPeucker(points, tolerance);
  return simplified.map(point => [point.x, point.y]);
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) {
    return points;
  }

  let maxDistance = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  } else {
    return [start, end];
  }
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return distance(point, lineStart);
  }

  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);

  if (t < 0) {
    return distance(point, lineStart);
  } else if (t > 1) {
    return distance(point, lineEnd);
  } else {
    const closestPoint = {
      x: lineStart.x + t * dx,
      y: lineStart.y + t * dy
    };
    return distance(point, closestPoint);
  }
}

function distance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function countCoordinates(geometry) {
  if (!geometry || !geometry.coordinates) {
    return 0;
  }

  function countRecursive(coords) {
    if (!Array.isArray(coords)) return 0;
    
    let count = 0;
    for (const item of coords) {
      if (Array.isArray(item)) {
        if (item.length > 0 && typeof item[0] === 'number') {
          count++;
        } else {
          count += countRecursive(item);
        }
      }
    }
    return count;
  }

  return countRecursive(geometry.coordinates);
}

// Main execution
function main() {
  const inputFile = path.join(__dirname, 'KR_boundaries.geojson');
  const outputFile = path.join(__dirname, 'KR_boundaries_simplified.geojson');

  console.log('Reading GeoJSON file...');
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  console.log(`Original features: ${data.features.length}`);

  let originalCoords = 0;
  let simplifiedCoords = 0;

  console.log('Simplifying geometries...');
  const simplifiedFeatures = data.features.map((feature, index) => {
    const originalCount = countCoordinates(feature.geometry);
    originalCoords += originalCount;

    const simplifiedGeometry = simplifyGeometry(feature.geometry, 0.001);
    const simplifiedCount = countCoordinates(simplifiedGeometry);
    simplifiedCoords += simplifiedCount;

    if ((index + 1) % 10 === 0) {
      console.log(`  Processed ${index + 1}/${data.features.length} features`);
    }

    return {
      ...feature,
      geometry: simplifiedGeometry
    };
  });

  const simplifiedData = {
    ...data,
    features: simplifiedFeatures
  };

  console.log('\nWriting simplified GeoJSON...');
  fs.writeFileSync(outputFile, JSON.stringify(simplifiedData, null, 2));

  const originalSize = fs.statSync(inputFile).size;
  const simplifiedSize = fs.statSync(outputFile).size;

  console.log('\n=== Simplification Results ===');
  console.log(`Original coordinates: ${originalCoords.toLocaleString()}`);
  console.log(`Simplified coordinates: ${simplifiedCoords.toLocaleString()}`);
  console.log(`Reduction: ${((originalCoords - simplifiedCoords) / originalCoords * 100).toFixed(2)}%`);
  console.log(`\nOriginal file size: ${(originalSize / 1024).toFixed(2)} KB`);
  console.log(`Simplified file size: ${(simplifiedSize / 1024).toFixed(2)} KB`);
  console.log(`Size reduction: ${((originalSize - simplifiedSize) / originalSize * 100).toFixed(2)}%`);
  console.log(`\nSimplified file saved to: ${outputFile}`);
}

if (require.main === module) {
  main();
}

module.exports = { simplifyGeometry, countCoordinates };
