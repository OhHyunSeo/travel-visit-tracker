import 'dart:ui';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'photo.dart';

class Region {
  final String id;
  final String countryCode;
  final String name;
  final int adminLevel;
  final LatLng centroid;
  final String geometryGeoJSON;
  bool visited;
  DateTime? visitedAt;
  List<Photo> photos;

  Region({
    required this.id,
    required this.countryCode,
    required this.name,
    required this.adminLevel,
    required this.centroid,
    required this.geometryGeoJSON,
    this.visited = false,
    this.visitedAt,
    List<Photo>? photos,
  }) : photos = photos ?? [];

  // Admin level mapping rules
  static const Map<String, Map<int, String>> _adminLevelRules = {
    'KR': {
      8: 'District',
      7: 'City',
      4: 'Province',
    },
    'US': {
      6: 'County',
      4: 'State',
    },
    'JP': {
      7: 'City',
      4: 'Prefecture',
    },
  };

  // Computed property: displayCategory
  String get displayCategory {
    final countryRules = _adminLevelRules[countryCode];
    if (countryRules != null && countryRules.containsKey(adminLevel)) {
      return countryRules[adminLevel]!;
    }
    return 'Region';
  }

  // Computed property: fillColor
  Color get fillColor {
    return visited ? const Color(0xFF4CAF50) : const Color(0xFFBDBDBD);
  }

  // Computed property: fillOpacity
  double get fillOpacity {
    return visited ? 0.6 : 0.3;
  }

  // Serialization: fromJson
  factory Region.fromJson(Map<String, dynamic> json) {
    return Region(
      id: json['id'] as String,
      countryCode: json['country_code'] as String,
      name: json['name'] as String,
      adminLevel: json['admin_level'] as int,
      centroid: LatLng(
        json['centroid_lat'] as double,
        json['centroid_lng'] as double,
      ),
      geometryGeoJSON: json['geometry'] as String,
      visited: (json['visited'] as int?) == 1,
      visitedAt: json['visited_at'] != null
          ? DateTime.parse(json['visited_at'] as String)
          : null,
      photos: (json['photos'] as List<dynamic>?)
              ?.map((p) => Photo.fromJson(p as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  // Serialization: toJson
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'country_code': countryCode,
      'name': name,
      'admin_level': adminLevel,
      'centroid_lat': centroid.latitude,
      'centroid_lng': centroid.longitude,
      'geometry': geometryGeoJSON,
      'visited': visited ? 1 : 0,
      'visited_at': visitedAt?.toIso8601String(),
      'photos': photos.map((p) => p.toJson()).toList(),
    };
  }
}
