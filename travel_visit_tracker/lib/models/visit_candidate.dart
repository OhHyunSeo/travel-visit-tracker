class VisitCandidate {
  final String regionId;
  final DateTime enterTime;
  DateTime lastUpdate;

  VisitCandidate({
    required this.regionId,
    required this.enterTime,
    DateTime? lastUpdate,
  }) : lastUpdate = lastUpdate ?? DateTime.now();

  // Computed property: dwellTime
  Duration get dwellTime => DateTime.now().difference(enterTime);

  // Computed property: isConfirmed
  bool get isConfirmed => dwellTime.inSeconds >= 300;

  // Serialization: fromJson
  factory VisitCandidate.fromJson(Map<String, dynamic> json) {
    return VisitCandidate(
      regionId: json['region_id'] as String,
      enterTime: DateTime.parse(json['enter_time'] as String),
      lastUpdate: DateTime.parse(json['last_update'] as String),
    );
  }

  // Serialization: toJson
  Map<String, dynamic> toJson() {
    return {
      'region_id': regionId,
      'enter_time': enterTime.toIso8601String(),
      'last_update': lastUpdate.toIso8601String(),
    };
  }
}
