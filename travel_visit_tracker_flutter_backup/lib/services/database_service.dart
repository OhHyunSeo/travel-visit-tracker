import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import '../models/region.dart';

class DatabaseService {
  static final DatabaseService _instance = DatabaseService._internal();
  static Database? _database;

  factory DatabaseService() => _instance;

  DatabaseService._internal();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  Future<Database> _initDatabase() async {
    String path = join(await getDatabasesPath(), 'travel_tracker.db');
    return await openDatabase(
      path,
      version: 1,
      onCreate: _onCreate,
    );
  }

  Future<void> _onCreate(Database db, int version) async {
    await db.execute('''
      CREATE TABLE visited_regions(
        id TEXT PRIMARY KEY,
        name TEXT,
        visitedAt TEXT
      )
    ''');
  }

  Future<void> insertRegion(Region region) async {
    final db = await database;
    await db.insert(
      'visited_regions',
      region.toMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<Region>> getVisitedRegions() async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query('visited_regions');
    return List.generate(maps.length, (i) {
      return Region.fromMap(maps[i]);
    });
  }
  
  Future<bool> isRegionVisited(String id) async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      'visited_regions',
      where: 'id = ?',
      whereArgs: [id],
    );
    return maps.isNotEmpty;
  }
}
