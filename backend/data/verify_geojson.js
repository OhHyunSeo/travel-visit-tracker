#!/usr/bin/env node

/**
 * Verification script for GeoJSON boundary files
 * Validates structure and calculates centroids
 */

const fs = require('fs');
const path = require('path');

function calculateCentroid(coordinates) {
  // For a simple polygon, calculate the centroid of the bounding box
  const ring = coordinates[0]; // First ring (outer boundary)
  
  let sumLng = 0;
  let sumLat = 0;
  let count = ring.length - 1; // Exclude the closing point
  
  for (let i = 0; i < count; i++) {
    sumLng += ring[i][0];
    sumLat += ring[i][1];
  }
  
  return {
    lng: (sumLng / count).toFixed(4),
    lat: (sumLat / count).toFixed(4)
  };
}

function verifyGeoJSON(filename) {
  const filePath = path.join(__dirname, filename);
  
  console.log(`\n📍 Verifying ${filename}...\n`);
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const geojson = JSON.parse(content);
    
    // Validate structure
    if (geojson.type !== 'FeatureCollection') {
      console.error('❌ Invalid type: must be FeatureCollection');
      return false;
    }
    
    if (!Array.isArray(geojson.features)) {
      console.error('❌ Missing or invalid features array');
      return false;
    }
    
    console.log(`✓ Valid FeatureCollection with ${geojson.features.length} features\n`);
    
    // Validate and display each feature
    console.log('Region Details:\n');
    console.log('ID'.padEnd(15) + 'Name'.padEnd(20) + 'Admin'.padEnd(8) + 'Centroid');
    console.log('-'.repeat(70));
    
    for (const feature of geojson.features) {
      // Validate required fields
      if (!feature.id) {
        console.error(`❌ Feature missing id`);
        continue;
      }
      
      if (!feature.properties) {
        console.error(`❌ Feature ${feature.id} missing properties`);
        continue;
      }
      
      const { name, admin_level, country_code } = feature.properties;
      
      if (!name || !admin_level || !country_code) {
        console.error(`❌ Feature ${feature.id} missing required properties`);
        continue;
      }
      
      if (!feature.geometry || feature.geometry.type !== 'Polygon') {
        console.error(`❌ Feature ${feature.id} missing or invalid geometry`);
        continue;
      }
      
      // Calculate centroid
      const centroid = calculateCentroid(feature.geometry.coordinates);
      
      console.log(
        feature.id.padEnd(15) +
        name.padEnd(20) +
        admin_level.toString().padEnd(8) +
        `${centroid.lng}, ${centroid.lat}`
      );
    }
    
    // File size info
    const stats = fs.statSync(filePath);
    console.log(`\n📊 File size: ${stats.size} bytes (${(stats.size / 1024).toFixed(2)} KB)`);
    
    console.log('\n✅ Verification complete!\n');
    return true;
    
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    return false;
  }
}

// Run verification
const filename = process.argv[2] || 'KR_boundaries.geojson';
verifyGeoJSON(filename);
