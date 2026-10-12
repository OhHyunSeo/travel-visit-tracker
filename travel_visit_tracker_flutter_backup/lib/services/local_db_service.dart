import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';

class LocalDbService {
  static final LocalDbService _instance = LocalDbService._internal();
  static Database? _database;

  factory LocalDbService() {
    return _instance;
  }

  LocalDbService._internal();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  Future<Database> _initDatabase() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'travel_tracker.db');

    return await openDatabase(
      path,
      version: 2,
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute('ALTER TABLE steps ADD COLUMN photo_path TEXT');
          await db.execute('ALTER TABLE steps ADD COLUMN message TEXT');
        }
      },
      onCreate: (db, version) async {
        // Trips table
        await db.execute('''
          CREATE TABLE trips(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            start_date TEXT,
            end_date TEXT,
            cover_photo_path TEXT,
            sync_status INTEGER DEFAULT 0 -- 0: pending, 1: synced, 2: error
          )
        ''');

        // Steps (Location points) table
        await db.execute('''
          CREATE TABLE steps(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER,
            latitude REAL,
            longitude REAL,
            timestamp TEXT,
            accuracy REAL,
            altitude REAL,
            type TEXT, -- 'point' or 'stay'
            photo_path TEXT, -- Local path to photo
            message TEXT, -- Optional journal note
            sync_status INTEGER DEFAULT 0,
            FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE
          )
        ''');
      },
    );
  }

  // Insert a new step (location point)
  Future<int> insertStep({
    required int? tripId,
    required double latitude,
    required double longitude,
    required DateTime timestamp,
    required double accuracy,
    required double altitude,
    String type = 'point',
    String? photoPath,
    String? message,
  }) async {
    final db = await database;
    return await db.insert(
      'steps',
      {
        'trip_id': tripId,
        'latitude': latitude,
        'longitude': longitude,
        'timestamp': timestamp.toIso8601String(),
        'accuracy': accuracy,
        'altitude': altitude,
        'type': type,
        'photo_path': photoPath,
        'message': message,
        'sync_status': 0, // Pending
      },
    );
  }

  // Get unsynced steps
  Future<List<Map<String, dynamic>>> getUnsyncedSteps() async {
    final db = await database;
    return await db.query(
      'steps',
      where: 'sync_status = ?',
      whereArgs: [0],
      orderBy: 'timestamp ASC',
    );
  }

  // Mark steps as synced
  Future<void> markStepsAsSynced(List<int> stepIds) async {
    final db = await database;
    final batch = db.batch();
    for (final id in stepIds) {
      batch.update(
        'steps',
        {'sync_status': 1},
        where: 'id = ?',
        whereArgs: [id],
      );
    }
    await batch.commit(noResult: true);
  }

  // Mark steps as error (conflict or failed)
  Future<void> markStepsAsError(List<int> stepIds) async {
    final db = await database;
    final batch = db.batch();
    for (final id in stepIds) {
      batch.update(
        'steps',
        {'sync_status': 2},
        where: 'id = ?',
        whereArgs: [id],
      );
    }
    await batch.commit(noResult: true);
  }

  // Get all steps for visualization (ordered by timestamp)
  Future<List<Map<String, dynamic>>> getAllSteps() async {
    final db = await database;
    return await db.query(
      'steps',
      orderBy: 'timestamp ASC',
    );
  }
}
