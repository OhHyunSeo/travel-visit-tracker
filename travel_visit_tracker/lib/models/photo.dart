class Photo {
  final int? id;
  final String regionId;
  final String localPath;
  String? remoteUrl;
  bool uploaded;
  final DateTime createdAt;

  Photo({
    this.id,
    required this.regionId,
    required this.localPath,
    this.remoteUrl,
    this.uploaded = false,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  // Serialization: fromJson
  factory Photo.fromJson(Map<String, dynamic> json) {
    return Photo(
      id: json['id'] as int?,
      regionId: json['region_id'] as String,
      localPath: json['local_path'] as String,
      remoteUrl: json['remote_url'] as String?,
      uploaded: (json['uploaded'] as int?) == 1,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  // Serialization: toJson
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'region_id': regionId,
      'local_path': localPath,
      'remote_url': remoteUrl,
      'uploaded': uploaded ? 1 : 0,
      'created_at': createdAt.toIso8601String(),
    };
  }
}
