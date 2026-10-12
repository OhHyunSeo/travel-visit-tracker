import 'dart:math';

class Point {
  final double x;
  final double y;

  Point(this.x, this.y);
}

class PathSmoothingUtils {
  /// Generates a Catmull-Rom spline passing through the given points.
  /// [points] List of control points (lat/lng as x/y).
  /// [segments] Number of segments between each pair of control points.
  static List<Point> generateCatmullRomSpline(List<Point> points, {int segments = 10}) {
    if (points.length < 2) return points;

    List<Point> result = [];
    
    // Duplicate start and end points to ensure the curve passes through them
    // Catmull-Rom needs p0, p1, p2, p3 to calculate between p1 and p2.
    // So we pad the list.
    List<Point> paddedPoints = [
      points.first,
      ...points,
      points.last
    ];

    for (int i = 0; i < paddedPoints.length - 3; i++) {
      Point p0 = paddedPoints[i];
      Point p1 = paddedPoints[i + 1];
      Point p2 = paddedPoints[i + 2];
      Point p3 = paddedPoints[i + 3];

      for (int t = 0; t <= segments; t++) {
        // Last point is included in the next segment's start, avoid duplicate unless it's the very last segment
        if (i < paddedPoints.length - 4 && t == segments) continue;
        
        double tNorm = t / segments;
        result.add(_calculateCatmullRom(p0, p1, p2, p3, tNorm));
      }
    }

    return result;
  }

  static Point _calculateCatmullRom(Point p0, Point p1, Point p2, Point p3, double t) {
    double t2 = t * t;
    double t3 = t2 * t;

    double x = 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );

    double y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );

    return Point(x, y);
  }
}
