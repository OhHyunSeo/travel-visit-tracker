import 'package:sqflite/sqflite.dart';
import 'storage_service.dart';

/// Badge milestone definitions
enum VisitBadge {
  explorer(10, 'Explorer', 'Visit 10 regions'),
  traveler(50, 'Traveler', 'Visit 50 regions'),
  globetrotter(100, 'Globetrotter', 'Visit 100 regions');

  final int visitCount;
  final String name;
  final String description;

  const VisitBadge(this.visitCount, this.name, this.description);
}

/// Country breakdown data
class CountryStats {
  final String countryCode;
  final int visitedCount;
  final int totalCount;

  CountryStats({
    required this.countryCode,
    required this.visitedCount,
    required this.totalCount,
  });

  double get percentage =>
      totalCount > 0 ? (visitedCount / totalCount) * 100 : 0.0;
}

/// Manages statistics and badge achievements
class StatsManager {
  final StorageService _storageService = StorageService();

  /// Get total count of visited regions
  Future<int> getTotalVisited() async {
    final db = await _storageService.database;
    final result = await db.rawQuery(
      'SELECT COUNT(*) as count FROM regions WHERE visited = 1',
    );

    return Sqflite.firstIntValue(result) ?? 0;
  }

  /// Calculate visit percentage for a specific country
  Future<double> getVisitPercentage(String countryCode) async {
    final db = await _storageService.database;

    // Get total regions for country
    final totalResult = await db.rawQuery(
      'SELECT COUNT(*) as count FROM regions WHERE country_code = ?',
      [countryCode],
    );
    final total = Sqflite.firstIntValue(totalResult) ?? 0;

    if (total == 0) return 0.0;

    // Get visited regions for country
    final visitedResult = await db.rawQuery(
      'SELECT COUNT(*) as count FROM regions WHERE country_code = ? AND visited = 1',
      [countryCode],
    );
    final visited = Sqflite.firstIntValue(visitedResult) ?? 0;

    return (visited / total) * 100;
  }

  /// Get breakdown of visits grouped by country
  Future<List<CountryStats>> getCountryBreakdown() async {
    final db = await _storageService.database;

    // Get all countries with their visit counts
    final results = await db.rawQuery('''
      SELECT 
        country_code,
        COUNT(*) as total_count,
        SUM(CASE WHEN visited = 1 THEN 1 ELSE 0 END) as visited_count
      FROM regions
      GROUP BY country_code
      ORDER BY visited_count DESC, country_code ASC
    ''');

    return results.map((row) {
      return CountryStats(
        countryCode: row['country_code'] as String,
        visitedCount: row['visited_count'] as int,
        totalCount: row['total_count'] as int,
      );
    }).toList();
  }

  /// Check which badges have been earned based on visit count
  Future<List<VisitBadge>> checkBadges() async {
    final totalVisited = await getTotalVisited();
    final earnedBadges = <VisitBadge>[];

    for (final badge in VisitBadge.values) {
      if (totalVisited >= badge.visitCount) {
        earnedBadges.add(badge);
      }
    }

    return earnedBadges;
  }

  /// Get the next badge milestone (if any)
  Future<VisitBadge?> getNextBadge() async {
    final totalVisited = await getTotalVisited();

    for (final badge in VisitBadge.values) {
      if (totalVisited < badge.visitCount) {
        return badge;
      }
    }

    return null; // All badges earned
  }

  /// Check if a new badge was just earned
  Future<VisitBadge?> checkNewBadge(int previousVisitCount) async {
    final currentVisitCount = await getTotalVisited();

    for (final badge in VisitBadge.values) {
      if (previousVisitCount < badge.visitCount &&
          currentVisitCount >= badge.visitCount) {
        return badge;
      }
    }

    return null;
  }

  /// Get overall visit percentage across all countries
  Future<double> getOverallPercentage() async {
    final db = await _storageService.database;

    // Get total regions
    final totalResult = await db.rawQuery(
      'SELECT COUNT(*) as count FROM regions',
    );
    final total = Sqflite.firstIntValue(totalResult) ?? 0;

    if (total == 0) return 0.0;

    // Get visited regions
    final visitedResult = await db.rawQuery(
      'SELECT COUNT(*) as count FROM regions WHERE visited = 1',
    );
    final visited = Sqflite.firstIntValue(visitedResult) ?? 0;

    return (visited / total) * 100;
  }
}
