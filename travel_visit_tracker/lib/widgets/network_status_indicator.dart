import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/connectivity_state.dart';

/// Widget that displays network connectivity status in the app header
class NetworkStatusIndicator extends StatelessWidget {
  const NetworkStatusIndicator({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<ConnectivityState>(
      builder: (context, connectivityState, child) {
        if (connectivityState.isOnline) {
          // Don't show anything when online (default state)
          return const SizedBox.shrink();
        }

        // Show offline indicator
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          color: Colors.red.shade700,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.cloud_off,
                size: 16,
                color: Colors.white,
              ),
              const SizedBox(width: 6),
              Text(
                'Offline',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
