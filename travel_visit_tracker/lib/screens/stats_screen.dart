import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/stats_manager.dart';
import '../services/storage_service.dart';
import '../services/ad_service.dart';
import '../services/sync_service.dart';
import '../state/ad_state.dart';
import '../state/connectivity_state.dart';

class StatsScreen extends StatefulWidget {
  const StatsScreen({Key? key}) : super(key: key);

  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  final StatsManager _statsManager = StatsManager();
  final StorageService _storageService = StorageService();
  final AdService _adService = AdService();
  final SyncService _syncService = SyncService();

  int _totalVisited = 0;
  double _overallPercentage = 0.0;
  List<CountryStats> _countryBreakdown = [];
  List<VisitBadge> _earnedBadges = [];
  int _pendingPhotoCount = 0;
  DateTime? _lastSynced;
  bool _isLoading = true;
  bool _isSyncing = false;

  @override
  void initState() {
    super.initState();
    _loadStats();
    _loadLastSyncTime();

    // Listen to sync status changes
    _syncService.syncStatusStream.listen((status) {
      if (mounted) {
        setState(() {
          _isSyncing = status == SyncStatus.syncing;
        });

        if (status == SyncStatus.success) {
          _loadStats();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Sync completed successfully'),
              backgroundColor: Colors.green,
            ),
          );
        } else if (status == SyncStatus.error) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Sync failed. Will retry later.'),
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    });
  }

  Future<void> _loadLastSyncTime() async {
    await _syncService.loadLastSyncTime();
    setState(() {
      _lastSynced = _syncService.lastSyncTime;
    });
  }

  Future<void> _manualSync() async {
    final connectivityState = context.read<ConnectivityState>();

    if (!connectivityState.isOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Cannot sync while offline'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    await _syncService.processPendingUploads();
  }

  Future<void> _loadStats() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final totalVisited = await _statsManager.getTotalVisited();
      final overallPercentage = await _statsManager.getOverallPercentage();
      final countryBreakdown = await _statsManager.getCountryBreakdown();
      final earnedBadges = await _statsManager.checkBadges();
      final pendingPhotos = await _storageService.getPendingPhotos();

      setState(() {
        _totalVisited = totalVisited;
        _overallPercentage = overallPercentage;
        _countryBreakdown = countryBreakdown;
        _earnedBadges = earnedBadges;
        _pendingPhotoCount = pendingPhotos.length;
        _lastSynced = _syncService.lastSyncTime;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error loading stats: $e')),
        );
      }
    }
  }

  String _formatLastSynced() {
    if (_lastSynced == null) return 'Never';

    final now = DateTime.now();
    final difference = now.difference(_lastSynced!);

    if (difference.inMinutes < 1) {
      return 'Just now';
    } else if (difference.inMinutes < 60) {
      return '${difference.inMinutes} minutes ago';
    } else if (difference.inHours < 24) {
      return '${difference.inHours} hours ago';
    } else {
      return '${difference.inDays} days ago';
    }
  }

  IconData _getBadgeIcon(VisitBadge badge) {
    switch (badge) {
      case VisitBadge.explorer:
        return Icons.explore;
      case VisitBadge.traveler:
        return Icons.flight;
      case VisitBadge.globetrotter:
        return Icons.public;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Statistics'),
        actions: [
          if (_pendingPhotoCount > 0)
            Padding(
              padding: const EdgeInsets.only(right: 16.0),
              child: Center(
                child: Badge(
                  label: Text('$_pendingPhotoCount'),
                  child: const Icon(Icons.cloud_upload),
                ),
              ),
            ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadStats,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Overall stats card
                    _buildOverallStatsCard(),
                    const SizedBox(height: 16),

                    // Premium unlock section
                    _buildPremiumSection(),
                    const SizedBox(height: 16),

                    // Badges section
                    _buildBadgesSection(),
                    const SizedBox(height: 16),

                    // Country breakdown section
                    _buildCountryBreakdownSection(),
                    const SizedBox(height: 16),

                    // Last synced info
                    _buildLastSyncedInfo(),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildPremiumSection() {
    final adState = context.watch<AdState>();

    return Card(
      elevation: 4,
      color: adState.isPremiumUnlocked ? Colors.amber[50] : null,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.star,
                  color: adState.isPremiumUnlocked ? Colors.amber : Colors.grey,
                ),
                const SizedBox(width: 8),
                Text(
                  adState.isPremiumUnlocked
                      ? 'Premium Active'
                      : 'Premium Features',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (adState.isPremiumUnlocked) ...[
              Text(
                'Premium unlocked for ${adState.premiumHoursRemaining} more hours',
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey[700],
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                '✓ Custom themes\n✓ High-resolution export',
                style: TextStyle(fontSize: 14),
              ),
            ] else ...[
              const Text(
                'Unlock premium features for 24 hours by watching an ad',
                style: TextStyle(fontSize: 14),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed:
                      _adService.isRewardedAdReady ? _watchAdForPremium : null,
                  icon: const Icon(Icons.play_circle_outline),
                  label: Text(_adService.isRewardedAdReady
                      ? 'Watch Ad to Unlock Premium'
                      : 'Loading ad...'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.amber,
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _watchAdForPremium() async {
    final adState = context.read<AdState>();

    await _adService.showRewardedAd(
      onComplete: () async {
        await adState.unlockPremium();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Premium features unlocked for 24 hours!'),
              backgroundColor: Colors.green,
            ),
          );
        }
      },
    );
  }

  Widget _buildOverallStatsCard() {
    return Card(
      elevation: 4,
      child: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            const Text(
              'Total Visits',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '$_totalVisited',
              style: const TextStyle(
                fontSize: 48,
                fontWeight: FontWeight.bold,
                color: Colors.green,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${_overallPercentage.toStringAsFixed(1)}% coverage',
              style: const TextStyle(
                fontSize: 16,
                color: Colors.grey,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBadgesSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Badges',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        if (_earnedBadges.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16.0),
              child: Center(
                child: Text(
                  'No badges earned yet. Keep exploring!',
                  style: TextStyle(color: Colors.grey),
                ),
              ),
            ),
          )
        else
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: VisitBadge.values.map((badge) {
              final isEarned = _earnedBadges.contains(badge);
              return _buildBadgeCard(badge, isEarned);
            }).toList(),
          ),
      ],
    );
  }

  Widget _buildBadgeCard(VisitBadge badge, bool isEarned) {
    return Card(
      elevation: isEarned ? 4 : 1,
      color: isEarned ? null : Colors.grey[200],
      child: Container(
        width: 100,
        padding: const EdgeInsets.all(12.0),
        child: Column(
          children: [
            Icon(
              _getBadgeIcon(badge),
              size: 40,
              color: isEarned ? Colors.amber : Colors.grey,
            ),
            const SizedBox(height: 8),
            Text(
              badge.name,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: isEarned ? null : Colors.grey,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 4),
            Text(
              '${badge.visitCount} visits',
              style: TextStyle(
                fontSize: 12,
                color: isEarned ? Colors.grey[600] : Colors.grey,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCountryBreakdownSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Country Breakdown',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        if (_countryBreakdown.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16.0),
              child: Center(
                child: Text(
                  'No regions loaded yet',
                  style: TextStyle(color: Colors.grey),
                ),
              ),
            ),
          )
        else
          ..._countryBreakdown.map((stats) => _buildCountryCard(stats)),
      ],
    );
  }

  Widget _buildCountryCard(CountryStats stats) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8.0),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  stats.countryCode,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  '${stats.visitedCount} / ${stats.totalCount}',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: stats.totalCount > 0
                  ? stats.visitedCount / stats.totalCount
                  : 0.0,
              backgroundColor: Colors.grey[300],
              valueColor: const AlwaysStoppedAnimation<Color>(Colors.green),
            ),
            const SizedBox(height: 4),
            Text(
              '${stats.percentage.toStringAsFixed(1)}% coverage',
              style: TextStyle(
                fontSize: 14,
                color: Colors.grey[600],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLastSyncedInfo() {
    final connectivityState = context.watch<ConnectivityState>();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            Row(
              children: [
                Icon(
                  _isSyncing ? Icons.sync : Icons.sync,
                  color: _isSyncing ? Colors.blue : Colors.grey,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Last synced',
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.grey,
                        ),
                      ),
                      Text(
                        _formatLastSynced(),
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                if (_pendingPhotoCount > 0)
                  Chip(
                    label: Text('$_pendingPhotoCount pending'),
                    backgroundColor: Colors.orange[100],
                  ),
              ],
            ),
            if (_pendingPhotoCount > 0 && connectivityState.isOnline) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _isSyncing ? null : _manualSync,
                  icon: _isSyncing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            valueColor:
                                AlwaysStoppedAnimation<Color>(Colors.white),
                          ),
                        )
                      : const Icon(Icons.cloud_upload),
                  label: Text(_isSyncing ? 'Syncing...' : 'Sync Now'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue,
                    foregroundColor: Colors.white,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
