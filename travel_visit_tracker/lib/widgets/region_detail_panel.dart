import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:image_picker/image_picker.dart';
import '../state/map_state.dart';
import '../models/region.dart';
import '../models/photo.dart';
import '../services/photo_service.dart';
import '../services/storage_service.dart';

class RegionDetailPanel extends StatefulWidget {
  const RegionDetailPanel({super.key});

  @override
  State<RegionDetailPanel> createState() => _RegionDetailPanelState();
}

class _RegionDetailPanelState extends State<RegionDetailPanel> {
  final PhotoService _photoService = PhotoService();
  final StorageService _storageService = StorageService();
  bool _isUploading = false;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: Consumer<MapState>(
        builder: (context, mapState, child) {
          final region = mapState.selectedRegion;

          if (region == null) {
            return const SizedBox.shrink();
          }

          return _buildPanel(context, region, mapState);
        },
      ),
    );
  }

  Widget _buildPanel(BuildContext context, Region region, MapState mapState) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(16),
          topRight: Radius.circular(16),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Container(
            margin: const EdgeInsets.only(top: 8),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.grey[300],
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          // Header with close button
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        region.name,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        region.displayCategory,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: Colors.grey[600],
                            ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () async {
                    await mapState.selectRegion(null);
                  },
                ),
              ],
            ),
          ),

          const Divider(height: 1),

          // Visit status
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(
                  region.visited ? Icons.check_circle : Icons.circle_outlined,
                  color: region.visited ? Colors.green : Colors.grey,
                  size: 24,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        region.visited ? 'Visited' : 'Not Visited',
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w600,
                                ),
                      ),
                      if (region.visited && region.visitedAt != null)
                        Text(
                          _formatDate(region.visitedAt!),
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: Colors.grey[600],
                                  ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Attach Photo button (only for visited regions)
          if (region.visited) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _isUploading
                      ? null
                      : () => _attachPhoto(context, region, mapState),
                  icon: _isUploading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            valueColor:
                                AlwaysStoppedAnimation<Color>(Colors.white),
                          ),
                        )
                      : const Icon(Icons.add_photo_alternate),
                  label: Text(_isUploading ? 'Uploading...' : 'Attach Photo'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
            ),
          ],

          // Photo thumbnails
          if (region.photos.isNotEmpty) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Photos (${region.photos.length})',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 80,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: region.photos.length,
                      itemBuilder: (context, index) {
                        final photo = region.photos[index];
                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: GestureDetector(
                            onTap: () => _viewFullPhoto(context, photo),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: Container(
                                width: 80,
                                height: 80,
                                color: Colors.grey[200],
                                child: Stack(
                                  children: [
                                    _buildPhotoThumbnail(photo),
                                    if (!photo.uploaded)
                                      Positioned(
                                        top: 4,
                                        right: 4,
                                        child: Container(
                                          padding: const EdgeInsets.all(4),
                                          decoration: BoxDecoration(
                                            color: Colors.orange,
                                            borderRadius:
                                                BorderRadius.circular(4),
                                          ),
                                          child: const Icon(
                                            Icons.cloud_upload,
                                            size: 12,
                                            color: Colors.white,
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Bottom padding for safe area
          SizedBox(height: MediaQuery.of(context).padding.bottom),
        ],
      ),
    );
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);

    if (difference.inDays == 0) {
      return 'Today at ${DateFormat.jm().format(date)}';
    } else if (difference.inDays == 1) {
      return 'Yesterday at ${DateFormat.jm().format(date)}';
    } else if (difference.inDays < 7) {
      return '${difference.inDays} days ago';
    } else {
      return DateFormat.yMMMd().format(date);
    }
  }

  Future<void> _attachPhoto(
      BuildContext context, Region region, MapState mapState) async {
    try {
      // Show source selection dialog
      final source = await showDialog<ImageSource>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Select Photo Source'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.photo_library),
                title: const Text('Gallery'),
                onTap: () => Navigator.pop(context, ImageSource.gallery),
              ),
              ListTile(
                leading: const Icon(Icons.camera_alt),
                title: const Text('Camera'),
                onTap: () => Navigator.pop(context, ImageSource.camera),
              ),
            ],
          ),
        ),
      );

      if (source == null) return;

      // Select photo
      final imageFile = await _photoService.selectPhoto(source: source);
      if (imageFile == null) return;

      setState(() {
        _isUploading = true;
      });

      // Check network availability
      final isOnline = await _photoService.isNetworkAvailable();

      Photo photo;
      if (isOnline) {
        // Try to upload immediately
        try {
          final result = await _photoService.uploadPhoto(imageFile, region.id);

          // Create photo record with remote URL
          photo = Photo(
            regionId: region.id,
            localPath: imageFile.path,
            remoteUrl: result.url,
            uploaded: true,
          );

          final photoId = await _storageService.savePhoto(photo);
          photo = Photo(
            id: photoId,
            regionId: region.id,
            localPath: imageFile.path,
            remoteUrl: result.url,
            uploaded: true,
            createdAt: photo.createdAt,
          );

          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Photo uploaded successfully'),
                backgroundColor: Colors.green,
              ),
            );
          }
        } catch (e) {
          // Upload failed, queue for later
          photo = await _photoService.queueOfflineUpload(imageFile, region.id);

          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Photo saved. Will upload when online.'),
                backgroundColor: Colors.orange,
              ),
            );
          }
        }
      } else {
        // Offline, queue for later
        photo = await _photoService.queueOfflineUpload(imageFile, region.id);

        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Photo saved. Will upload when online.'),
              backgroundColor: Colors.orange,
            ),
          );
        }
      }

      // Update region with new photo
      region.photos.add(photo);

      // Trigger UI update by re-selecting the region
      await mapState.selectRegion(region.id);

      setState(() {
        _isUploading = false;
      });
    } catch (e) {
      setState(() {
        _isUploading = false;
      });

      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to attach photo: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  Widget _buildPhotoThumbnail(Photo photo) {
    // Show remote URL if uploaded, otherwise show local file
    if (photo.uploaded && photo.remoteUrl != null) {
      return Image.network(
        photo.remoteUrl!,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) {
          return _buildLocalImage(photo);
        },
      );
    } else {
      return _buildLocalImage(photo);
    }
  }

  Widget _buildLocalImage(Photo photo) {
    final file = File(photo.localPath);
    return Image.file(
      file,
      fit: BoxFit.cover,
      errorBuilder: (context, error, stackTrace) {
        return const Icon(Icons.broken_image);
      },
    );
  }

  void _viewFullPhoto(BuildContext context, Photo photo) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppBar(
              title: const Text('Photo'),
              leading: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              ),
            ),
            Expanded(
              child: InteractiveViewer(
                child: Center(
                  child: _buildPhotoThumbnail(photo),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
