import 'dart:math';

/// Utility class for simplifying GeoJSON geometries to reduce coordinate count
/// Uses the Ramer-Douglas-Peucker algorithm for line simplification
class GeometrySimplifier {
  /// Simplify a GeoJSON geometry object
  /// Returns a new geometry with reduced coordinate count
  static Map<String, dynamic> simplifyGeometry(
    Map<String, dynamic> geometry, {
    double tolerance = 0.001, // ~111 meters at equator
  }) {
    final type = geometry['type'] as String?;
    final coordinates = geometry['coordinates'];

    if (type == null || coordinates == null) {
      return geometry;
    }

    switch (type) {
      case 'Polygon':
        return {
          'type': 'Polygon',
          'coordinates': _simplifyPolygonCoordinates(coordinates, tolerance),
        };
      case 'MultiPolygon':
        return {
          'type': 'MultiPolygon',
          'coordinates':
              _simplifyMultiPolygonCoordinates(coordinates, tolerance),
        };
      default:
        return geometry; // Return unchanged for unsupported types
    }
  }

  /// Simplify polygon coordinates (array of rings)
  static List<dynamic> _simplifyPolygonCoordinates(
    dynamic coordinates,
    double tolerance,
  ) {
    if (coordinates is! List) return coordinates;

    return coordinates.map((ring) {
      if (ring is List) {
        return _simplifyRing(ring, tolerance);
      }
      return ring;
    }).toList();
  }

  /// Simplify multi-polygon coordinates (array of polygons)
  static List<dynamic> _simplifyMultiPolygonCoordinates(
    dynamic coordinates,
    double tolerance,
  ) {
    if (coordinates is! List) return coordinates;

    return coordinates.map((polygon) {
      if (polygon is List) {
        return _simplifyPolygonCoordinates(polygon, tolerance);
      }
      return polygon;
    }).toList();
  }

  /// Simplify a coordinate ring using Ramer-Douglas-Peucker algorithm
  static List<dynamic> _simplifyRing(List<dynamic> ring, double tolerance) {
    if (ring.length <= 3) {
      return ring; // Can't simplify further
    }

    // Convert to Point objects for easier calculation
    final points = ring
        .map((coord) {
          if (coord is List && coord.length >= 2) {
            return _Point(
              (coord[0] as num).toDouble(),
              (coord[1] as num).toDouble(),
            );
          }
          return null;
        })
        .whereType<_Point>()
        .toList();

    if (points.length <= 3) {
      return ring;
    }

    // Apply Douglas-Peucker algorithm
    final simplified = _douglasPeucker(points, tolerance);

    // Convert back to coordinate format
    return simplified.map((point) => [point.x, point.y]).toList();
  }

  /// Ramer-Douglas-Peucker algorithm implementation
  static List<_Point> _douglasPeucker(List<_Point> points, double tolerance) {
    if (points.length <= 2) {
      return points;
    }

    // Find the point with maximum distance from the line segment
    double maxDistance = 0;
    int maxIndex = 0;
    final start = points.first;
    final end = points.last;

    for (int i = 1; i < points.length - 1; i++) {
      final distance = _perpendicularDistance(points[i], start, end);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }

    // If max distance is greater than tolerance, recursively simplify
    if (maxDistance > tolerance) {
      // Recursive call on both segments
      final left = _douglasPeucker(
        points.sublist(0, maxIndex + 1),
        tolerance,
      );
      final right = _douglasPeucker(
        points.sublist(maxIndex),
        tolerance,
      );

      // Combine results (remove duplicate point at junction)
      return [...left.sublist(0, left.length - 1), ...right];
    } else {
      // All points between start and end can be removed
      return [start, end];
    }
  }

  /// Calculate perpendicular distance from point to line segment
  static double _perpendicularDistance(
    _Point point,
    _Point lineStart,
    _Point lineEnd,
  ) {
    final dx = lineEnd.x - lineStart.x;
    final dy = lineEnd.y - lineStart.y;

    if (dx == 0 && dy == 0) {
      // Line segment is a point
      return _distance(point, lineStart);
    }

    // Calculate the parameter t that determines the closest point on the line
    final t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) /
        (dx * dx + dy * dy);

    if (t < 0) {
      // Closest point is lineStart
      return _distance(point, lineStart);
    } else if (t > 1) {
      // Closest point is lineEnd
      return _distance(point, lineEnd);
    } else {
      // Closest point is on the line segment
      final closestPoint = _Point(
        lineStart.x + t * dx,
        lineStart.y + t * dy,
      );
      return _distance(point, closestPoint);
    }
  }

  /// Calculate Euclidean distance between two points
  static double _distance(_Point p1, _Point p2) {
    final dx = p2.x - p1.x;
    final dy = p2.y - p1.y;
    return sqrt(dx * dx + dy * dy);
  }

  /// Calculate the reduction percentage after simplification
  static double calculateReduction(
    Map<String, dynamic> original,
    Map<String, dynamic> simplified,
  ) {
    final originalCount = _countCoordinates(original);
    final simplifiedCount = _countCoordinates(simplified);

    if (originalCount == 0) return 0;

    return ((originalCount - simplifiedCount) / originalCount) * 100;
  }

  /// Count total coordinates in a geometry
  static int _countCoordinates(Map<String, dynamic> geometry) {
    final coordinates = geometry['coordinates'];
    return _countCoordinatesRecursive(coordinates);
  }

  static int _countCoordinatesRecursive(dynamic coords) {
    if (coords is! List) return 0;

    int count = 0;
    for (final item in coords) {
      if (item is List) {
        if (item.isNotEmpty && item[0] is num) {
          // This is a coordinate pair
          count++;
        } else {
          // This is a nested array
          count += _countCoordinatesRecursive(item);
        }
      }
    }
    return count;
  }
}

/// Internal point class for calculations
class _Point {
  final double x;
  final double y;

  _Point(this.x, this.y);
}
