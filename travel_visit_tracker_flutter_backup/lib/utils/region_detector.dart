import 'package:maplibre_gl/maplibre_gl.dart';

class RegionDetector {
  /// Check if a point is inside a polygon using Ray Casting algorithm
  static bool isPointInPolygon(LatLng point, List<LatLng> polygon) {
    int intersectCount = 0;
    for (int j = 0; j < polygon.length - 1; j++) {
      if (_rayCastIntersect(point, polygon[j], polygon[j + 1])) {
        intersectCount++;
      }
    }
    return (intersectCount % 2) == 1; // Odd = inside, Even = outside
  }

  static bool _rayCastIntersect(LatLng point, LatLng vertA, LatLng vertB) {
    final double aY = vertA.latitude;
    final double bY = vertB.latitude;
    final double aX = vertA.longitude;
    final double bX = vertB.longitude;
    final double pY = point.latitude;
    final double pX = point.longitude;

    if ((aY > pY && bY > pY) || (aY < pY && bY < pY) || (aX < pX && bX < pX)) {
      return false; // The segment is strictly above, below, or to the left of the point
    }

    if (aY == bY) {
      return false; // Horizontal segment
    }

    final double m = (bY - aY) / (bX - aX); // Slope
    final double bee = (-aX) * m + aY; // Y-intercept
    final double x = (pY - bee) / m; // X-coordinate of intersection

    return x > pX;
  }
}
