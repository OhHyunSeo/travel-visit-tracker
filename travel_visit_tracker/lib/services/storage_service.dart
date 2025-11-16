import 'dart:io';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import '../models/region.dart';
import '../models/photo.dart';
import '../models/visit_candidate.dart';

/// Exception for database corruption
class DatabaseCorruptionException implements Exception {
  final String message;
  DatabaseCorruptionException(this.message);

  @override
  String toString() => 'DatabaseCorruptionException: $message';
}

class StorageService {
  static final StorageService _instance = StorageService._internal();
  factory StorageService() => _instance;
  StorageService._internal();

  Database? _database;

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  Future<Database> _initDatabase() async {
    final databasesPath = await getDatabasesPath();
    final path = join(databasesPath, 'travel_visit_tracker.db');

    try {
      return await openDatabase(
        path,
        version: 1,
        onCreate: _onCreate,
        onOpen: (db) async {
          // Verify database integrity on open
          try {
            await db.rawQuery('PRAGMA integrity_check');
          } catch (e) {
            throw DatabaseCorruptionException(
                'Database integrity check failed: $e');
          }
        },
      );
    } catch (e) {
      if (e.toString().contains('corrupt') ||
          e is DatabaseCorruptionException) {
        // Database is corrupted, attempt to rebuild
        throw DatabaseCorruptionException(
            'Database is corrupted and needs to be rebuilt');
      }
      rethrow;
    }
  }

  Future<void> _onCreate(Database db, int version) async {
    // Create regions table
    await db.execute('''
      CREATE TABLE regions (
        id TEXT PRIMARY KEY,
        country_code TEXT NOT NULL,
        name TEXT NOT NULL,
        admin_level INTEGER,
        centroid_lat REAL,
        centroid_lng REAL,
        geometry TEXT,
        visited INTEGER DEFAULT 0,
        visited_at TEXT
      )
    ''');

    // Create photos table
    await db.execute('''
      CREATE TABLE photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region_id TEXT NOT NULL,
        local_path TEXT NOT NULL,
        remote_url TEXT,
        uploaded INTEGER DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY (region_id) REFERENCES regions(id)
      )
    ''');

    // Create indexes on regions table for performance optimization
    await db.execute('''
      CREATE INDEX idx_country ON regions(country_code)
    ''');

    await db.execute('''
      CREATE INDEX idx_visited ON regions(visited)
    ''');

    // Composite index for common query patterns
    await db.execute('''
      CREATE INDEX idx_country_visited ON regions(country_code, visited)
    ''');

    // Index on photos table for faster region lookups
    await db.execute('''
      CREATE INDEX idx_photo_region ON photos(region_id)
    ''');

    // Index on photos table for pending uploads query
    await db.execute('''
      CREATE INDEX idx_photo_uploaded ON photos(uploaded)
    ''');

    // Create visit_candidates table
    await db.execute('''
      CREATE TABLE visit_candidates (
        region_id TEXT PRIMARY KEY,
        enter_time TEXT NOT NULL,
        last_update TEXT
      )
    ''');

    // Create monitored_slots table
    await db.execute('''
      CREATE TABLE monitored_slots (
        region_id TEXT PRIMARY KEY,
        registered_at TEXT
      )
    ''');

    // Create app_state table
    await db.execute('''
      CREATE TABLE app_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    ''');
  }

  // Bulk insert/update regions
  Future<void> saveRegions(List<Region> regions) async {
    final db = await database;
    final batch = db.batch();

    for (final region in regions) {
      batch.insert(
        'regions',
        {
          'id': region.id,
          'country_code': region.countryCode,
          'name': region.name,
          'admin_level': region.adminLevel,
          'centroid_lat': region.centroid.latitude,
          'centroid_lng': region.centroid.longitude,
          'geometry': region.geometryGeoJSON,
          'visited': region.visited ? 1 : 0,
          'visited_at': region.visitedAt?.toIso8601String(),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await batch.commit(noResult: true);
  }

  // Mark region as visited
  Future<void> markVisited(String regionId, DateTime timestamp) async {
    final db = await database;
    await db.update(
      'regions',
      {
        'visited': 1,
        'visited_at': timestamp.toIso8601String(),
      },
      where: 'id = ?',
      whereArgs: [regionId],
    );
  }

  // Get all visited regions
  Future<List<Region>> getVisitedRegions() async {
    final db = await database;
    final results = await db.query(
      'regions',
      where: 'visited = ?',
      whereArgs: [1],
    );

    final regions = <Region>[];
    for (final row in results) {
      final region = Region.fromJson(row);

      // Load photos for this region
      final photoResults = await db.query(
        'photos',
        where: 'region_id = ?',
        whereArgs: [region.id],
      );

      region.photos.addAll(
        photoResults.map((p) => Photo.fromJson(p)).toList(),
      );

      regions.add(region);
    }

    return regions;
  }

  // Get pending photos (not uploaded)
  Future<List<Photo>> getPendingPhotos() async {
    final db = await database;
    final results = await db.query(
      'photos',
      where: 'uploaded = ?',
      whereArgs: [0],
    );

    return results.map((row) => Photo.fromJson(row)).toList();
  }

  // Save photo
  Future<int> savePhoto(Photo photo) async {
    final db = await database;
    return await db.insert(
      'photos',
      photo.toJson(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // Update photo
  Future<void> updatePhoto(Photo photo) async {
    final db = await database;
    await db.update(
      'photos',
      photo.toJson(),
      where: 'id = ?',
      whereArgs: [photo.id],
    );
  }

  // Save visit candidate
  Future<void> saveVisitCandidate(VisitCandidate candidate) async {
    final db = await database;
    await db.insert(
      'visit_candidates',
      candidate.toJson(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // Delete visit candidate
  Future<void> deleteVisitCandidate(String regionId) async {
    final db = await database;
    await db.delete(
      'visit_candidates',
      where: 'region_id = ?',
      whereArgs: [regionId],
    );
  }

  // Get all visit candidates
  Future<List<VisitCandidate>> getVisitCandidates() async {
    final db = await database;
    final results = await db.query('visit_candidates');
    return results.map((row) => VisitCandidate.fromJson(row)).toList();
  }

  // Save monitored slot
  Future<void> saveMonitoredSlot(String regionId, DateTime registeredAt) async {
    final db = await database;
    await db.insert(
      'monitored_slots',
      {
        'region_id': regionId,
        'registered_at': registeredAt.toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // Delete monitored slot
  Future<void> deleteMonitoredSlot(String regionId) async {
    final db = await database;
    await db.delete(
      'monitored_slots',
      where: 'region_id = ?',
      whereArgs: [regionId],
    );
  }

  // Get all monitored slots
  Future<List<String>> getMonitoredSlots() async {
    final db = await database;
    final results = await db.query('monitored_slots');
    return results.map((row) => row['region_id'] as String).toList();
  }

  // Save multiple monitored slots (batch operation)
  Future<void> saveMonitoredSlots(List<String> regionIds) async {
    final db = await database;
    final batch = db.batch();

    // Clear existing slots
    batch.delete('monitored_slots');

    // Insert new slots
    final now = DateTime.now().toIso8601String();
    for (final regionId in regionIds) {
      batch.insert(
        'monitored_slots',
        {
          'region_id': regionId,
          'registered_at': now,
        },
      );
    }

    await batch.commit(noResult: true);
  }

  // Get app state value
  Future<String?> getAppState(String key) async {
    final db = await database;
    final results = await db.query(
      'app_state',
      where: 'key = ?',
      whereArgs: [key],
    );

    if (results.isEmpty) return null;
    return results.first['value'] as String?;
  }

  // Set app state value
  Future<void> setAppState(String key, String value) async {
    final db = await database;
    await db.insert(
      'app_state',
      {'key': key, 'value': value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // Get region by ID
  Future<Region?> getRegionById(String regionId) async {
    final db = await database;
    final results = await db.query(
      'regions',
      where: 'id = ?',
      whereArgs: [regionId],
    );

    if (results.isEmpty) return null;

    final region = Region.fromJson(results.first);

    // Load photos for this region
    final photoResults = await db.query(
      'photos',
      where: 'region_id = ?',
      whereArgs: [region.id],
    );

    region.photos.addAll(
      photoResults.map((p) => Photo.fromJson(p)).toList(),
    );

    return region;
  }

  // Get all regions
  Future<List<Region>> getAllRegions() async {
    final db = await database;
    final results = await db.query('regions');

    final regions = <Region>[];
    for (final row in results) {
      final region = Region.fromJson(row);

      // Load photos for this region
      final photoResults = await db.query(
        'photos',
        where: 'region_id = ?',
        whereArgs: [region.id],
      );

      region.photos.addAll(
        photoResults.map((p) => Photo.fromJson(p)).toList(),
      );

      regions.add(region);
    }

    return regions;
  }

  // Close database
  Future<void> close() async {
    final db = await database;
    await db.close();
    _database = null;
  }

  /// Rebuild database from scratch (use when corrupted)
  Future<void> rebuildDatabase() async {
    try {
      // Close existing database
      if (_database != null) {
        await _database!.close();
        _database = null;
      }

      // Delete corrupted database file
      final databasesPath = await getDatabasesPath();
      final path = join(databasesPath, 'travel_visit_tracker.db');
      final dbFile = File(path);

      if (await dbFile.exists()) {
        await dbFile.delete();
      }

      // Reinitialize database
      _database = await _initDatabase();
    } catch (e) {
      throw DatabaseCorruptionException('Failed to rebuild database: $e');
    }
  }

  /// Check database health
  Future<bool> checkDatabaseHealth() async {
    try {
      final db = await database;
      final result = await db.rawQuery('PRAGMA integrity_check');
      return result.isNotEmpty && result.first.values.first == 'ok';
    } catch (e) {
      return false;
    }
  }

  /// Execute query with error handling
  Future<T> executeWithErrorHandling<T>(
    Future<T> Function() operation, {
    String operationName = 'Database operation',
  }) async {
    try {
      return await operation();
    } on DatabaseException catch (e) {
      if (e.toString().contains('corrupt')) {
        throw DatabaseCorruptionException(
            '$operationName failed: Database is corrupted');
      }
      throw DatabaseCorruptionException(
          '$operationName failed: ${e.toString()}');
    } catch (e) {
      throw DatabaseCorruptionException(
          '$operationName failed: ${e.toString()}');
    }
  }
}
