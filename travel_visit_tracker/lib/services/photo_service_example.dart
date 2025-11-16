// Example usage of PhotoService
//
// This file demonstrates how to use the PhotoService for photo attachment,
// upload, and offline queueing functionality.

import 'package:image_picker/image_picker.dart';
import 'photo_service.dart';

void examplePhotoServiceUsage() async {
  final photoService = PhotoService();

  // Example 1: Select and upload a photo
  print('Example 1: Select and upload photo');
  final imageFile = await photoService.selectPhoto(source: ImageSource.gallery);
  if (imageFile != null) {
    try {
      final result = await photoService.uploadPhoto(imageFile, 'region-123');
      print('Photo uploaded: ${result.url}');
      print('Thumbnail: ${result.thumbnailUrl}');
    } catch (e) {
      print('Upload failed: $e');
    }
  }

  // Example 2: Queue photo for offline upload
  print('\nExample 2: Queue photo for offline upload');
  if (imageFile != null) {
    try {
      final photo =
          await photoService.queueOfflineUpload(imageFile, 'region-456');
      print('Photo queued: ${photo.id}');
      print('Local path: ${photo.localPath}');
      print('Uploaded: ${photo.uploaded}');
    } catch (e) {
      print('Queue failed: $e');
    }
  }

  // Example 3: Process pending uploads
  print('\nExample 3: Process pending uploads');
  try {
    await photoService.processPendingUploads();
    print('Pending uploads processed');
  } catch (e) {
    print('Processing failed: $e');
  }

  // Example 4: Check network availability
  print('\nExample 4: Check network availability');
  final isOnline = await photoService.isNetworkAvailable();
  print('Network available: $isOnline');

  // Example 5: Generate thumbnail
  print('\nExample 5: Generate thumbnail');
  if (imageFile != null) {
    try {
      final thumbnail =
          await photoService.generateThumbnail(imageFile, size: 200);
      print('Thumbnail generated: ${thumbnail.path}');
    } catch (e) {
      print('Thumbnail generation failed: $e');
    }
  }
}

// Example integration with region detail panel
void exampleRegionDetailIntegration() {
  print('''
Example: Integration with Region Detail Panel

The RegionDetailPanel widget now includes:

1. "Attach Photo" button (enabled only for visited regions)
   - Shows source selection dialog (Gallery/Camera)
   - Displays upload progress indicator while uploading
   
2. Photo thumbnail display
   - Shows all photos attached to the region
   - Displays upload status badge for pending uploads
   - Tap to view full-size photo
   
3. Automatic offline handling
   - Detects network availability
   - Queues photos when offline
   - Shows appropriate feedback messages
   
4. Error handling
   - Graceful fallback for upload failures
   - Retry logic with exponential backoff
   - User-friendly error messages

Usage in your app:
- The RegionDetailPanel is already integrated
- Photos are automatically saved to the database
- Pending uploads sync when network is restored
  ''');
}

// Example backend configuration
void exampleBackendConfiguration() {
  print('''
Backend Configuration:

The PhotoService expects a backend endpoint at:
POST /api/photos

Request format (multipart/form-data):
- file: Image file (JPEG/PNG, max 10 MB)
- region_id: String

Response format (JSON):
{
  "url": "https://cdn.example.com/photos/abc123.jpg",
  "thumbnail_url": "https://cdn.example.com/photos/abc123_thumb.jpg"
}

To configure the backend URL, update the constant in photo_service.dart:
static const String _backendUrl = 'https://your-backend.com';

Error responses:
- 400: Invalid request
- 413: File too large
- 500: Server error
  ''');
}
