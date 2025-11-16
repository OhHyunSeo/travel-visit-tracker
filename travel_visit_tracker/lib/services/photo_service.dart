import 'dart:io';
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';
import 'package:image/image.dart' as img;
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as path;
import '../models/photo.dart';
import 'storage_service.dart';

class PhotoService {
  static final PhotoService _instance = PhotoService._internal();
  factory PhotoService() => _instance;
  PhotoService._internal();

  final ImagePicker _picker = ImagePicker();
  final StorageService _storageService = StorageService();

  // Backend URL - should be configured based on environment
  static const String _backendUrl =
      'http://localhost:3000'; // TODO: Configure for production

  // Cache for loaded thumbnails to avoid regenerating
  final Map<String, File> _thumbnailCache = {};

  /// Select a photo from the gallery or camera
  Future<File?> selectPhoto({ImageSource source = ImageSource.gallery}) async {
    try {
      final XFile? pickedFile = await _picker.pickImage(
        source: source,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 85,
      );

      if (pickedFile == null) {
        return null;
      }

      return File(pickedFile.path);
    } catch (e) {
      throw PhotoServiceException('Failed to select photo: $e');
    }
  }

  /// Generate a thumbnail from an image file with lazy loading support
  /// Caches thumbnails to avoid regenerating
  Future<File> generateThumbnail(File imageFile, {int size = 200}) async {
    try {
      // Check cache first
      final cacheKey = '${imageFile.path}_$size';
      if (_thumbnailCache.containsKey(cacheKey)) {
        final cachedFile = _thumbnailCache[cacheKey]!;
        if (await cachedFile.exists()) {
          return cachedFile;
        } else {
          // Cache entry is stale, remove it
          _thumbnailCache.remove(cacheKey);
        }
      }

      // Check if thumbnail already exists on disk
      final thumbnailPath = await _getThumbnailPath(imageFile, size);
      final thumbnailFile = File(thumbnailPath);

      if (await thumbnailFile.exists()) {
        _thumbnailCache[cacheKey] = thumbnailFile;
        return thumbnailFile;
      }

      // Generate new thumbnail
      final bytes = await imageFile.readAsBytes();
      final image = img.decodeImage(bytes);

      if (image == null) {
        throw PhotoServiceException('Failed to decode image');
      }

      // Create thumbnail with optimized settings
      final thumbnail = img.copyResize(
        image,
        width: size,
        height: size,
        interpolation: img.Interpolation.average,
      );

      // Save thumbnail
      await thumbnailFile.writeAsBytes(img.encodeJpg(thumbnail, quality: 80));

      // Cache the result
      _thumbnailCache[cacheKey] = thumbnailFile;

      return thumbnailFile;
    } catch (e) {
      throw PhotoServiceException('Failed to generate thumbnail: $e');
    }
  }

  /// Get the path where a thumbnail should be stored
  Future<String> _getThumbnailPath(File imageFile, int size) async {
    final appDir = await getApplicationDocumentsDirectory();
    final thumbDir = Directory(path.join(appDir.path, 'thumbnails'));
    if (!await thumbDir.exists()) {
      await thumbDir.create(recursive: true);
    }

    final fileName = path.basenameWithoutExtension(imageFile.path);
    return path.join(thumbDir.path, '${fileName}_${size}x$size.jpg');
  }

  /// Load thumbnail lazily - returns immediately if cached, generates if needed
  Future<File?> loadThumbnailLazy(String imagePath, {int size = 200}) async {
    try {
      final imageFile = File(imagePath);
      if (!await imageFile.exists()) {
        return null;
      }

      return await generateThumbnail(imageFile, size: size);
    } catch (e) {
      debugPrint('Failed to load thumbnail lazily: $e');
      return null;
    }
  }

  /// Preload thumbnails for a list of photos in the background
  Future<void> preloadThumbnails(List<Photo> photos, {int size = 200}) async {
    for (final photo in photos) {
      try {
        final imageFile = File(photo.localPath);
        if (await imageFile.exists()) {
          // Generate thumbnail in background without blocking
          generateThumbnail(imageFile, size: size).catchError((e) {
            debugPrint('Failed to preload thumbnail: $e');
            return File(''); // Return empty file on error
          });
        }
      } catch (e) {
        debugPrint('Error preloading thumbnail: $e');
      }
    }
  }

  /// Clear thumbnail cache from memory
  void clearThumbnailCache() {
    _thumbnailCache.clear();
  }

  /// Upload a photo to the backend with configurable timeout
  Future<PhotoUploadResult> uploadPhoto(
    File imageFile,
    String regionId, {
    int timeoutSeconds = 30,
  }) async {
    try {
      // Validate file exists
      if (!await imageFile.exists()) {
        throw PhotoServiceException('Image file does not exist');
      }

      // Validate file size (max 10 MB)
      final fileSize = await imageFile.length();
      if (fileSize > 10 * 1024 * 1024) {
        throw PhotoServiceException(
            'Image file is too large (max 10 MB). File size: ${(fileSize / 1024 / 1024).toStringAsFixed(2)} MB');
      }

      final uri = Uri.parse('$_backendUrl/api/photos');
      final request = http.MultipartRequest('POST', uri);

      // Add the image file
      request.files.add(
        await http.MultipartFile.fromPath(
          'file',
          imageFile.path,
        ),
      );

      // Add region_id field
      request.fields['region_id'] = regionId;

      // Send request with timeout
      final streamedResponse = await request.send().timeout(
        Duration(seconds: timeoutSeconds),
        onTimeout: () {
          throw TimeoutException(
              'Upload timed out after $timeoutSeconds seconds');
        },
      );

      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200) {
        // Parse response
        final responseData = _parseUploadResponse(response.body);
        return PhotoUploadResult(
          url: responseData['url'] as String,
          thumbnailUrl: responseData['thumbnail_url'] as String,
        );
      } else if (response.statusCode == 413) {
        throw PhotoServiceException('Image file is too large');
      } else if (response.statusCode == 400) {
        throw PhotoServiceException('Invalid image file or format');
      } else {
        throw PhotoServiceException(
          'Upload failed with status ${response.statusCode}: ${response.body}',
        );
      }
    } on TimeoutException {
      throw PhotoServiceException(
          'Upload timed out after $timeoutSeconds seconds');
    } on SocketException catch (e) {
      throw PhotoServiceException('Network error: ${e.message}');
    } on PhotoServiceException {
      rethrow;
    } catch (e) {
      throw PhotoServiceException('Upload failed: $e');
    }
  }

  /// Queue a photo for offline upload
  Future<Photo> queueOfflineUpload(File imageFile, String regionId) async {
    try {
      // Copy image to app documents directory for persistence
      final appDir = await getApplicationDocumentsDirectory();
      final photosDir = Directory(path.join(appDir.path, 'photos'));
      if (!await photosDir.exists()) {
        await photosDir.create(recursive: true);
      }

      final timestamp = DateTime.now().millisecondsSinceEpoch;
      final fileName =
          '${regionId}_$timestamp${path.extension(imageFile.path)}';
      final localPath = path.join(photosDir.path, fileName);
      final localFile = await imageFile.copy(localPath);

      // Create photo record
      final photo = Photo(
        regionId: regionId,
        localPath: localFile.path,
        uploaded: false,
      );

      // Save to database
      final photoId = await _storageService.savePhoto(photo);

      return Photo(
        id: photoId,
        regionId: regionId,
        localPath: localFile.path,
        uploaded: false,
        createdAt: photo.createdAt,
      );
    } catch (e) {
      throw PhotoServiceException('Failed to queue photo: $e');
    }
  }

  /// Process pending uploads with exponential backoff retry logic
  Future<void> processPendingUploads() async {
    final pendingPhotos = await _storageService.getPendingPhotos();

    for (final photo in pendingPhotos) {
      await _uploadWithRetry(photo);
    }
  }

  /// Upload a photo with exponential backoff retry
  Future<void> _uploadWithRetry(Photo photo) async {
    const maxRetries = 5;
    const retryDelays = [1, 2, 4, 8, 16]; // seconds

    for (int attempt = 0; attempt < maxRetries; attempt++) {
      try {
        final imageFile = File(photo.localPath);
        if (!await imageFile.exists()) {
          // File no longer exists, mark as failed and skip
          debugPrint('Photo file not found: ${photo.localPath}');
          return;
        }

        final result = await uploadPhoto(imageFile, photo.regionId);

        // Update photo with remote URL and mark as uploaded
        final updatedPhoto = Photo(
          id: photo.id,
          regionId: photo.regionId,
          localPath: photo.localPath,
          remoteUrl: result.url,
          uploaded: true,
          createdAt: photo.createdAt,
        );

        await _storageService.updatePhoto(updatedPhoto);
        debugPrint('Successfully uploaded photo ${photo.id}');
        return;
      } catch (e) {
        debugPrint('Upload attempt ${attempt + 1} failed: $e');

        if (attempt < maxRetries - 1) {
          // Wait before retrying
          await Future.delayed(Duration(seconds: retryDelays[attempt]));
        } else {
          // Max retries reached
          debugPrint('Max retries reached for photo ${photo.id}');
        }
      }
    }
  }

  /// Parse upload response JSON
  Map<String, dynamic> _parseUploadResponse(String responseBody) {
    try {
      // Simple JSON parsing for the expected format
      // In production, use dart:convert
      final urlMatch =
          RegExp(r'"url"\s*:\s*"([^"]+)"').firstMatch(responseBody);
      final thumbnailMatch =
          RegExp(r'"thumbnail_url"\s*:\s*"([^"]+)"').firstMatch(responseBody);

      if (urlMatch == null || thumbnailMatch == null) {
        throw PhotoServiceException('Invalid response format');
      }

      return {
        'url': urlMatch.group(1),
        'thumbnail_url': thumbnailMatch.group(1),
      };
    } catch (e) {
      throw PhotoServiceException('Failed to parse response: $e');
    }
  }

  /// Check if network is available (basic check)
  Future<bool> isNetworkAvailable() async {
    try {
      final result = await InternetAddress.lookup('google.com');
      return result.isNotEmpty && result[0].rawAddress.isNotEmpty;
    } catch (e) {
      return false;
    }
  }
}

/// Result of a photo upload
class PhotoUploadResult {
  final String url;
  final String thumbnailUrl;

  PhotoUploadResult({
    required this.url,
    required this.thumbnailUrl,
  });
}

/// Exception thrown by PhotoService
class PhotoServiceException implements Exception {
  final String message;

  PhotoServiceException(this.message);

  @override
  String toString() => 'PhotoServiceException: $message';
}
