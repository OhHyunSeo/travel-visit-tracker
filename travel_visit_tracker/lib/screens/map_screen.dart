import 'dart:math';
import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:provider/provider.dart';
import '../state/map_state.dart';
import '../widgets/region_detail_panel.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  MaplibreMapController? _mapController;

  // Initial camera position (centered on Seoul, South Korea)
  static const CameraPosition _initialPosition = CameraPosition(
    target: LatLng(37.5665, 126.9780),
    zoom: 10.0,
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          MaplibreMap(
            styleString: 'https://demotiles.maplibre.org/style.json',
            initialCameraPosition: _initialPosition,
            onMapCreated: _onMapCreated,
            myLocationEnabled: true,
            myLocationTrackingMode: MyLocationTrackingMode.tracking,
            myLocationRenderMode: MyLocationRenderMode.normal,
            onStyleLoadedCallback: _onStyleLoaded,
            onMapClick: _onMapClick,
          ),
          // Region detail panel
          Consumer<MapState>(
            builder: (context, mapState, child) {
              if (mapState.selectedRegion != null) {
                return const RegionDetailPanel();
              }
              return const SizedBox.shrink();
            },
          ),
        ],
      ),
    );
  }

  void _onMapCreated(MaplibreMapController controller) {
    _mapController = controller;

    // Notify MapState that the map is ready
    final mapState = context.read<MapState>();
    mapState.setMapController(controller);
  }

  void _onStyleLoaded() {
    // Style has been loaded, ready to add sources and layers
    final mapState = context.read<MapState>();
    mapState.onStyleLoaded();
  }

  void _onMapClick(Point<double> point, LatLng coordinates) async {
    if (_mapController == null) return;

    try {
      // Query rendered features at the tap point
      final features = await _mapController!.queryRenderedFeatures(
        point,
        ['regions-fill'],
        null,
      );

      if (features.isNotEmpty) {
        // Get the first feature's ID
        final feature = features.first;
        final regionId = feature['id']?.toString() ??
            feature['properties']?['id']?.toString();

        if (regionId != null && mounted) {
          // Show region detail panel (may show interstitial ad first)
          final mapState = context.read<MapState>();
          await mapState.selectRegion(regionId);
        }
      } else {
        // Clicked on empty area, deselect region
        if (mounted) {
          final mapState = context.read<MapState>();
          await mapState.selectRegion(null);
        }
      }
    } catch (e) {
      debugPrint('Error handling map click: $e');
    }
  }
}
