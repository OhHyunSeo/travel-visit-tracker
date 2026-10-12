class Region {
  final String id;
  final String name;
  final DateTime? visitedAt;

  Region({
    required this.id,
    required this.name,
    this.visitedAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'visitedAt': visitedAt?.toIso8601String(),
    };
  }

  factory Region.fromMap(Map<String, dynamic> map) {
    return Region(
      id: map['id'],
      name: map['name'],
      visitedAt: map['visitedAt'] != null ? DateTime.parse(map['visitedAt']) : null,
    );
  }
}
