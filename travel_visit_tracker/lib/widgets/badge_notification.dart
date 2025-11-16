import 'package:flutter/material.dart' hide Badge;
import '../services/stats_manager.dart';

/// Shows a badge earned notification dialog
class BadgeNotification {
  static void show(BuildContext context, VisitBadge badge) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Row(
          children: [
            Icon(
              _getBadgeIcon(badge),
              color: Colors.amber,
              size: 32,
            ),
            const SizedBox(width: 12),
            const Text('Badge Earned!'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              badge.name,
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              badge.description,
              style: const TextStyle(
                fontSize: 16,
                color: Colors.grey,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Congratulations on your achievement!',
              style: TextStyle(fontSize: 14),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Awesome!'),
          ),
        ],
      ),
    );
  }

  static void showSnackBar(BuildContext context, VisitBadge badge) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              _getBadgeIcon(badge),
              color: Colors.amber,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text('Badge Earned: ${badge.name}!'),
            ),
          ],
        ),
        duration: const Duration(seconds: 4),
        action: SnackBarAction(
          label: 'View',
          onPressed: () {
            show(context, badge);
          },
        ),
      ),
    );
  }

  static IconData _getBadgeIcon(VisitBadge badge) {
    switch (badge) {
      case VisitBadge.explorer:
        return Icons.explore;
      case VisitBadge.traveler:
        return Icons.flight;
      case VisitBadge.globetrotter:
        return Icons.public;
    }
  }
}
