import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:provider/provider.dart';
import '../state/map_state.dart';
import '../widgets/timeline_card.dart';
import '../config/app_config.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  // Initial position: Seoul, South Korea
  // Initial position from Config
  static const CameraPosition _initialPosition = CameraPosition(
    target: LatLng(AppConfig.initialLat, AppConfig.initialLng),
    zoom: AppConfig.initialZoomLevel,
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          MaplibreMap(
            // Use style from config
            styleString: AppConfig.mapStyleUrl,
            initialCameraPosition: _initialPosition,
            onMapCreated: _onMapCreated,
            onStyleLoadedCallback: _onStyleLoaded,
            myLocationEnabled: true,
            myLocationRenderMode: MyLocationRenderMode.normal,
            trackCameraPosition: true,
          ),
          
          // Timeline Overlay
          // Top Gradient Overlay (for Status Bar visibility)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: 100,
            child: IgnorePointer(
              child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.black.withOpacity(0.6),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ),
          
          // Timeline Overlay
          Positioned(
            left: 0,
            right: 0,
            bottom: 32,
            height: 160, // Increased height for better card ratio
            child: Consumer<MapState>(
              builder: (context, mapState, child) {
                final steps = mapState.allSteps;
                if (steps.isEmpty) {
                  return const SizedBox.shrink();
                }

                return PageView.builder(
                  controller: PageController(viewportFraction: 0.85),
                  itemCount: steps.length,
                  onPageChanged: (index) {
                    final step = steps[index];
                    mapState.flyToLocation(
                      step['latitude'] as double,
                      step['longitude'] as double,
                    );
                  },
                  itemBuilder: (context, index) {
                    final step = steps[index];
                    return TimelineCard(
                      step: step,
                      index: index,
                      onTap: () {
                         mapState.flyToLocation(
                          step['latitude'] as double,
                          step['longitude'] as double,
                        );
                      },
                    );
                  },
                );
              },
            ),
          ),
          // Floating Action Buttons (Positioned above Timeline)
          Positioned(
            right: 16,
            bottom: 210, // 160 (Card Height) + 32 (Bottom Margin) + 18 (Padding)
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                FloatingActionButton(
                  heroTag: 'camera_btn',
                  onPressed: () {
                    context.read<MapState>().capturePhoto();
                  },
                  child: const Icon(Icons.camera_alt),
                ),
                const SizedBox(height: 16),
                FloatingActionButton(
                  heroTag: 'location_btn',
                  onPressed: () {
                    context.read<MapState>().moveToUserLocation();
                  },
                  child: const Icon(Icons.my_location),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _onMapCreated(MaplibreMapController controller) {
    debugPrint('MapScreen: Map created');
    context.read<MapState>().setMapController(controller);
  }

  void _onStyleLoaded() {
    debugPrint('MapScreen: Style loaded');
    context.read<MapState>().onStyleLoaded();
  }
}
