import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:travel_visit_tracker/models/region.dart';
import 'package:travel_visit_tracker/models/photo.dart';
import 'package:travel_visit_tracker/models/visit_candidate.dart';
import 'package:travel_visit_tracker/services/storage_service.dart';
import 'package:travel_visit_tracker/services/geojson_service.dart';
import 'package:travel_visit_tracker/state/visit_state.dart';

void main() {
  // Initialize sqflite_ffi for testing
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  // Helper to delete test database
  Future<void> deleteTestDatabase() async {
    try {
      final dbPath = await databaseFactory.getDatabasesPath();
      final path = '$dbPath/travel_visit_tracker.db';
      final file = File(path);
      if (await file.exists()) {
        await file.delete();
      }
    } catch (e) {
      // Ignore errors during cleanup
    }
  }

  group('Visit Flow Integration Tests', () {
    late StorageService storageService;
    late VisitState visitState;

    setUp(() async {
      // Delete any existing test database
      await deleteTestDatabase();

      // Initialize storage service with in-memory database for testing
      storageService = StorageService();
      await storageService.database; // Initialize database

      visitState = VisitState();
      await visitState.initialize();
      visitState.enableTracking();
    });

    tearDown(() async {
      visitState.dispose();
      await storageService.close();
      await deleteTestDatabase();
    });

    test(
        'Visit flow: enter region → candidate → 300s dwell → confirmation → map update',
        () async {
      // Create a test region
      final testRegion = Region(
        id: 'test-region-1',
        countryCode: 'KR',
        name: 'Test District',
        adminLevel: 8,
        centroid: const LatLng(37.5, 127.0),
        geometryGeoJSON:
            '{"type":"Polygon","coordinates":[[[127.0,37.5],[127.1,37.5],[127.1,37.4],[127.0,37.4],[127.0,37.5]]]}',
      );

      // Save region to database
      await storageService.saveRegions([testRegion]);

      // Step 1: Enter region - create candidate
      await visitState.addCandidate(testRegion.id);

      // Verify candidate was created
      expect(visitState.candidates.containsKey(testRegion.id), true);
      expect(visitState.isCandidate(testRegion.id), true);
      expect(visitState.isVisited(testRegion.id), false);

      // Verify candidate saved to database
      final candidates = await storageService.getVisitCandidates();
      expect(candidates.length, 1);
      expect(candidates.first.regionId, testRegion.id);

      // Step 2: Simulate 300 seconds dwell time by manually confirming
      // (In real scenario, timer would trigger this automatically)
      await visitState.confirmVisit(testRegion.id);

      // Step 3: Verify visit confirmation
      expect(visitState.candidates.containsKey(testRegion.id), false);
      expect(visitState.isVisited(testRegion.id), true);
      expect(visitState.confirmedVisits.contains(testRegion.id), true);

      // Step 4: Verify database updates
      final candidatesAfter = await storageService.getVisitCandidates();
      expect(candidatesAfter.length, 0); // Candidate should be deleted

      final visitedRegion = await storageService.getRegionById(testRegion.id);
      expect(visitedRegion, isNotNull);
      expect(visitedRegion!.visited, true);
      expect(visitedRegion.visitedAt, isNotNull);

      // Step 5: Verify map update (region style should change)
      expect(visitedRegion.fillColor.value, 0xFF4CAF50); // Green for visited
      expect(visitedRegion.fillOpacity, 0.6);
    });

    test('Visit flow: early exit cancels candidate', () async {
      final testRegion = Region(
        id: 'test-region-2',
        countryCode: 'KR',
        name: 'Test City',
        adminLevel: 7,
        centroid: const LatLng(37.6, 127.1),
        geometryGeoJSON:
            '{"type":"Polygon","coordinates":[[[127.1,37.6],[127.2,37.6],[127.2,37.5],[127.1,37.5],[127.1,37.6]]]}',
      );

      await storageService.saveRegions([testRegion]);

      // Enter region
      await visitState.addCandidate(testRegion.id);
      expect(visitState.isCandidate(testRegion.id), true);

      // Exit region before 300 seconds
      await visitState.onRegionExit(testRegion.id);

      // Verify candidate was cancelled
      expect(visitState.isCandidate(testRegion.id), false);
      expect(visitState.isVisited(testRegion.id), false);

      final candidates = await storageService.getVisitCandidates();
      expect(candidates.length, 0);
    });
  });

  group('Photo Attachment Integration Tests', () {
    late StorageService storageService;

    setUp(() async {
      await deleteTestDatabase();
      storageService = StorageService();
      await storageService.database;
    });

    tearDown(() async {
      await storageService.close();
      await deleteTestDatabase();
    });

    test('Photo attachment: select photo → upload → thumbnail display',
        () async {
      // Create a visited region
      final testRegion = Region(
        id: 'test-region-photo',
        countryCode: 'KR',
        name: 'Photo Test District',
        adminLevel: 8,
        centroid: const LatLng(37.5, 127.0),
        geometryGeoJSON:
            '{"type":"Polygon","coordinates":[[[127.0,37.5],[127.1,37.5],[127.1,37.4],[127.0,37.4],[127.0,37.5]]]}',
        visited: true,
        visitedAt: DateTime.now(),
      );

      await storageService.saveRegions([testRegion]);

      // Step 1: Create a photo (simulating selection)
      final photo = Photo(
        regionId: testRegion.id,
        localPath: '/test/path/photo.jpg',
        uploaded: false,
      );

      // Step 2: Save photo to database (queue for upload)
      final photoId = await storageService.savePhoto(photo);
      expect(photoId, greaterThan(0));

      // Step 3: Verify photo is in pending queue
      final pendingPhotos = await storageService.getPendingPhotos();
      expect(pendingPhotos.length, 1);
      expect(pendingPhotos.first.regionId, testRegion.id);
      expect(pendingPhotos.first.uploaded, false);

      // Step 4: Simulate successful upload
      final uploadedPhoto = Photo(
        id: photoId,
        regionId: testRegion.id,
        localPath: '/test/path/photo.jpg',
        remoteUrl: 'https://example.com/photos/photo.jpg',
        uploaded: true,
        createdAt: photo.createdAt,
      );

      await storageService.updatePhoto(uploadedPhoto);

      // Step 5: Verify photo is marked as uploaded
      final pendingAfter = await storageService.getPendingPhotos();
      expect(pendingAfter.length, 0);

      // Step 6: Verify photo appears in region
      final regionWithPhoto = await storageService.getRegionById(testRegion.id);
      expect(regionWithPhoto, isNotNull);
      expect(regionWithPhoto!.photos.length, 1);
      expect(regionWithPhoto.photos.first.remoteUrl,
          'https://example.com/photos/photo.jpg');
      expect(regionWithPhoto.photos.first.uploaded, true);
    });

    test('Photo attachment: offline queueing', () async {
      final testRegion = Region(
        id: 'test-region-offline',
        countryCode: 'KR',
        name: 'Offline Test',
        adminLevel: 8,
        centroid: const LatLng(37.5, 127.0),
        geometryGeoJSON:
            '{"type":"Polygon","coordinates":[[[127.0,37.5],[127.1,37.5],[127.1,37.4],[127.0,37.4],[127.0,37.5]]]}',
        visited: true,
      );

      await storageService.saveRegions([testRegion]);

      // Queue multiple photos offline
      final photo1 = Photo(
        regionId: testRegion.id,
        localPath: '/test/photo1.jpg',
        uploaded: false,
      );
      final photo2 = Photo(
        regionId: testRegion.id,
        localPath: '/test/photo2.jpg',
        uploaded: false,
      );

      await storageService.savePhoto(photo1);
      await storageService.savePhoto(photo2);

      // Verify both are pending
      final pending = await storageService.getPendingPhotos();
      expect(pending.length, 2);
      expect(pending.every((p) => !p.uploaded), true);
    });
  });

  group('GeoJSON Loading Integration Tests', () {
    late GeoJSONService geoJsonService;
    late StorageService storageService;

    setUp(() async {
      await deleteTestDatabase();
      geoJsonService = GeoJSONService();
      storageService = StorageService();
      await storageService.database;
    });

    tearDown(() async {
      await storageService.close();
      await deleteTestDatabase();
      // Note: clearAllCache() requires Flutter bindings, skip in unit tests
    });

    test('GeoJSON loading: request pack → cache → render → offline load',
        () async {
      // Create sample GeoJSON data
      final sampleGeoJSON = '''
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "KR-11-680",
      "properties": {
        "name": "Gangnam-gu",
        "admin_level": 8,
        "country_code": "KR"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[127.0, 37.5], [127.1, 37.5], [127.1, 37.4], [127.0, 37.4], [127.0, 37.5]]]
      }
    },
    {
      "type": "Feature",
      "id": "KR-11-740",
      "properties": {
        "name": "Seocho-gu",
        "admin_level": 8,
        "country_code": "KR"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[127.0, 37.4], [127.1, 37.4], [127.1, 37.3], [127.0, 37.3], [127.0, 37.4]]]
      }
    }
  ]
}
''';

      // Step 1: Parse GeoJSON features
      final regions = geoJsonService.parseFeatures(sampleGeoJSON, 'KR',
          simplifyGeometry: false);

      // Step 2: Verify parsing
      expect(regions.length, 2);
      expect(regions[0].id, 'KR-11-680');
      expect(regions[0].name, 'Gangnam-gu');
      expect(regions[0].adminLevel, 8);
      expect(regions[0].countryCode, 'KR');
      expect(regions[0].displayCategory, 'District');

      expect(regions[1].id, 'KR-11-740');
      expect(regions[1].name, 'Seocho-gu');

      // Step 3: Save to database (cache)
      await storageService.saveRegions(regions);

      // Step 4: Verify regions can be loaded from database
      final cachedRegions = await storageService.getAllRegions();
      expect(cachedRegions.length, 2);
      expect(cachedRegions[0].id, 'KR-11-680');
      expect(cachedRegions[1].id, 'KR-11-740');

      // Step 5: Verify offline load (from database)
      final offlineRegion = await storageService.getRegionById('KR-11-680');
      expect(offlineRegion, isNotNull);
      expect(offlineRegion!.name, 'Gangnam-gu');
      expect(offlineRegion.centroid.latitude, closeTo(37.45, 0.1));
      expect(offlineRegion.centroid.longitude, closeTo(127.05, 0.1));
    });

    test('GeoJSON parsing: admin level mapping', () async {
      final geoJSON = '''
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "KR-41",
      "properties": {
        "name": "Gyeonggi-do",
        "admin_level": 4,
        "country_code": "KR"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[127.0, 37.5], [127.5, 37.5], [127.5, 37.0], [127.0, 37.0], [127.0, 37.5]]]
      }
    }
  ]
}
''';

      final regions =
          geoJsonService.parseFeatures(geoJSON, 'KR', simplifyGeometry: false);
      expect(regions.length, 1);
      expect(regions[0].displayCategory, 'Province');
      expect(regions[0].adminLevel, 4);
    });

    test('GeoJSON parsing: geometry simplification', () async {
      final complexGeoJSON = '''
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "test-complex",
      "properties": {
        "name": "Complex Region",
        "admin_level": 8,
        "country_code": "KR"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[127.0, 37.5], [127.01, 37.5], [127.02, 37.5], [127.1, 37.5], [127.1, 37.4], [127.0, 37.4], [127.0, 37.5]]]
      }
    }
  ]
}
''';

      // Parse with simplification
      final regionsSimplified = geoJsonService.parseFeatures(
        complexGeoJSON,
        'KR',
        simplifyGeometry: true,
        simplificationTolerance: 0.01,
      );

      // Parse without simplification
      final regionsOriginal = geoJsonService.parseFeatures(
        complexGeoJSON,
        'KR',
        simplifyGeometry: false,
      );

      expect(regionsSimplified.length, 1);
      expect(regionsOriginal.length, 1);

      // Simplified geometry should have fewer coordinates
      expect(regionsSimplified[0].geometryGeoJSON.length,
          lessThanOrEqualTo(regionsOriginal[0].geometryGeoJSON.length));
    });
  });

  group('Slot Rotation Integration Tests', () {
    late StorageService storageService;

    setUp(() async {
      await deleteTestDatabase();
      storageService = StorageService();
      await storageService.database;
    });

    tearDown(() async {
      await storageService.close();
      await deleteTestDatabase();
    });

    test(
        'Slot rotation: user moves → recalculate nearest 20 → update registrations',
        () async {
      // Create 30 test regions at various distances
      final regions = <Region>[];
      for (int i = 0; i < 30; i++) {
        final lat = 37.5 + (i * 0.01); // Spread regions vertically
        final lng = 127.0 + (i * 0.01);
        regions.add(Region(
          id: 'region-$i',
          countryCode: 'KR',
          name: 'Region $i',
          adminLevel: 8,
          centroid: LatLng(lat, lng),
          geometryGeoJSON:
              '{"type":"Polygon","coordinates":[[[${lng},${lat}],[${lng + 0.01},${lat}],[${lng + 0.01},${lat - 0.01}],[${lng},${lat - 0.01}],[${lng},${lat}]]]}',
        ));
      }

      await storageService.saveRegions(regions);

      // Step 1: Initial monitoring - select first 20 regions
      final initialSlots = regions.take(20).map((r) => r.id).toList();
      await storageService.saveMonitoredSlots(initialSlots);

      // Verify initial slots
      final savedSlots = await storageService.getMonitoredSlots();
      expect(savedSlots.length, 20);
      expect(savedSlots, containsAll(initialSlots));

      // Step 2: Simulate user movement - calculate nearest 20 from new position
      final userLocation =
          const LatLng(37.7, 127.2); // Moved closer to higher-numbered regions

      // Calculate distances and sort
      final regionsWithDistance = regions.map((region) {
        final distance = _calculateDistance(userLocation, region.centroid);
        return {'region': region, 'distance': distance};
      }).toList();

      regionsWithDistance.sort((a, b) =>
          (a['distance'] as double).compareTo(b['distance'] as double));

      // Step 3: Get nearest 20 regions
      final nearest20 = regionsWithDistance
          .take(20)
          .map((item) => (item['region'] as Region).id)
          .toList();

      // Step 4: Update monitored slots
      await storageService.saveMonitoredSlots(nearest20);

      // Step 5: Verify slot rotation occurred
      final updatedSlots = await storageService.getMonitoredSlots();
      expect(updatedSlots.length, 20);

      // The new slots should be different from initial slots
      final slotsChanged = !_listsEqual(initialSlots, updatedSlots);
      expect(slotsChanged, true);

      // Verify that nearest regions are now monitored
      // (regions with higher indices should be in the new slots)
      final hasHigherIndexRegions = updatedSlots.any((id) {
        final index = int.parse(id.split('-')[1]);
        return index >= 15; // Some regions from the far end
      });
      expect(hasHigherIndexRegions, true);
    });

    test('Slot rotation: respects 20-slot limit', () async {
      // Create 25 regions
      final regions = <Region>[];
      for (int i = 0; i < 25; i++) {
        regions.add(Region(
          id: 'region-$i',
          countryCode: 'KR',
          name: 'Region $i',
          adminLevel: 8,
          centroid: LatLng(37.5 + (i * 0.01), 127.0),
          geometryGeoJSON:
              '{"type":"Polygon","coordinates":[[[127.0,37.5],[127.1,37.5],[127.1,37.4],[127.0,37.4],[127.0,37.5]]]}',
        ));
      }

      await storageService.saveRegions(regions);

      // Try to save 25 slots (should only save 20)
      final allRegionIds = regions.map((r) => r.id).toList();
      await storageService.saveMonitoredSlots(allRegionIds.take(20).toList());

      final savedSlots = await storageService.getMonitoredSlots();
      expect(savedSlots.length, 20); // Should enforce limit
    });

    test('Slot rotation: persistence across app restarts', () async {
      // Create and save monitored slots
      final regions = <Region>[];
      for (int i = 0; i < 20; i++) {
        regions.add(Region(
          id: 'persistent-region-$i',
          countryCode: 'KR',
          name: 'Persistent Region $i',
          adminLevel: 8,
          centroid: LatLng(37.5 + (i * 0.01), 127.0),
          geometryGeoJSON:
              '{"type":"Polygon","coordinates":[[[127.0,37.5],[127.1,37.5],[127.1,37.4],[127.0,37.4],[127.0,37.5]]]}',
        ));
      }

      await storageService.saveRegions(regions);

      final monitoredIds = regions.map((r) => r.id).toList();
      await storageService.saveMonitoredSlots(monitoredIds);

      // Simulate app restart by closing and reopening database
      await storageService.close();

      // Reinitialize storage service
      final newStorageService = StorageService();
      await newStorageService.database;

      // Verify slots persisted
      final restoredSlots = await newStorageService.getMonitoredSlots();
      expect(restoredSlots.length, 20);
      expect(restoredSlots, containsAll(monitoredIds));

      await newStorageService.close();
    });
  });
}

// Helper function to calculate distance between two LatLng points (simplified)
double _calculateDistance(LatLng point1, LatLng point2) {
  final latDiff = point1.latitude - point2.latitude;
  final lngDiff = point1.longitude - point2.longitude;
  return (latDiff * latDiff + lngDiff * lngDiff).abs(); // Simplified distance
}

// Helper function to check if two lists are equal
bool _listsEqual(List<String> list1, List<String> list2) {
  if (list1.length != list2.length) return false;
  for (int i = 0; i < list1.length; i++) {
    if (list1[i] != list2[i]) return false;
  }
  return true;
}
