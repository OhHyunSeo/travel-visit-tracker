package app.trippainting.maptransportqa;

import android.content.Context;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.maplibre.android.geometry.LatLngBounds;
import org.maplibre.android.offline.OfflineManager;
import org.maplibre.android.offline.OfflineRegion;
import org.maplibre.android.offline.OfflineRegionError;
import org.maplibre.android.offline.OfflineRegionStatus;
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition;

final class FixtureOfflinePack implements OfflineRegion.OfflineRegionObserver {
  private static final byte[] METADATA = "trip-painting-offline-raster-z0-v1".getBytes(StandardCharsets.US_ASCII);
  private final OfflineManager manager;
  private OfflineRegion region;
  private boolean finished;

  private FixtureOfflinePack(OfflineManager manager) {
    this.manager = manager;
  }

  static void start(Context context, String styleUrl) {
    FixtureOfflinePack trial = new FixtureOfflinePack(OfflineManager.getInstance(context));
    trial.manager.listOfflineRegions(new OfflineManager.ListOfflineRegionsCallback() {
      @Override public void onList(OfflineRegion[] regions) {
        if (regions == null || regions.length != 0) {
          trial.fail("existing region");
          return;
        }
        trial.create(styleUrl);
      }

      @Override public void onError(String error) { trial.fail("initial region listing"); }
    });
  }

  static void reopen(Context context, String styleUrl, long expectedId, Runnable ready) {
    FixtureOfflinePack trial = new FixtureOfflinePack(OfflineManager.getInstance(context));
    trial.manager.listOfflineRegions(new OfflineManager.ListOfflineRegionsCallback() {
      @Override public void onList(OfflineRegion[] regions) {
        if (regions == null || regions.length != 1 || regions[0].getId() != expectedId
            || !Arrays.equals(regions[0].getMetadata(), METADATA)
            || !styleUrl.equals(regions[0].getDefinition().getStyleURL())) {
          trial.fail("reopen region identity");
          return;
        }
        regions[0].getStatus(new OfflineRegion.OfflineRegionStatusCallback() {
          @Override public void onStatus(OfflineRegionStatus status) {
            if (!status.isComplete() || !status.isRequiredResourceCountPrecise()
                || status.getDownloadState() != OfflineRegion.STATE_INACTIVE) {
              trial.fail("reopen region status");
              return;
            }
            log("PACK_REOPENED id=" + expectedId + summary(status));
            ready.run();
          }

          @Override public void onError(String error) { trial.fail("reopen region status"); }
        });
      }

      @Override public void onError(String error) { trial.fail("reopen region listing"); }
    });
  }

  private void create(String styleUrl) {
    OfflineTilePyramidRegionDefinition definition = new OfflineTilePyramidRegionDefinition(
        styleUrl, LatLngBounds.from(1.0, 1.0, -1.0, -1.0), 0.0, 0.0, 1.0f, false);
    manager.createOfflineRegion(definition, METADATA.clone(), new OfflineManager.CreateOfflineRegionCallback() {
      @Override public void onCreate(OfflineRegion created) {
        region = created;
        log("PACK_CREATED id=" + region.getId());
        region.setObserver(FixtureOfflinePack.this);
        region.setDownloadState(OfflineRegion.STATE_ACTIVE);
      }

      @Override public void onError(String error) { fail("create region"); }
    });
  }

  @Override public void onStatusChanged(OfflineRegionStatus status) {
    if (finished || !status.isComplete() || !status.isRequiredResourceCountPrecise()) return;
    finished = true;
    log("PACK_COMPLETED id=" + region.getId() + summary(status));
    region.setDownloadState(OfflineRegion.STATE_INACTIVE);
    manager.listOfflineRegions(new OfflineManager.ListOfflineRegionsCallback() {
      @Override public void onList(OfflineRegion[] regions) {
        if (regions == null || regions.length != 1 || regions[0].getId() != region.getId()
            || !Arrays.equals(regions[0].getMetadata(), METADATA)) {
          fail("persisted region identity");
          return;
        }
        regions[0].getStatus(new OfflineRegion.OfflineRegionStatusCallback() {
          @Override public void onStatus(OfflineRegionStatus persisted) {
            if (!persisted.isComplete() || !persisted.isRequiredResourceCountPrecise()) {
              fail("persisted region progress");
              return;
            }
            log("PACK_STORED id=" + region.getId() + summary(persisted));
          }

          @Override public void onError(String error) { fail("persisted region status"); }
        });
      }

      @Override public void onError(String error) { fail("persisted region listing"); }
    });
  }

  @Override public void onError(OfflineRegionError error) { fail("region download"); }

  @Override public void mapboxTileCountLimitExceeded(long limit) { fail("tile limit"); }

  private static String summary(OfflineRegionStatus status) {
    return " resources=" + status.getCompletedResourceCount() + " tiles=" + status.getCompletedTileCount()
        + " required=" + status.getRequiredResourceCount() + " resourceBytes=" + status.getCompletedResourceSize()
        + " tileBytes=" + status.getCompletedTileSize();
  }

  private static void log(String message) { Log.i(FixtureApplication.LOG_TAG, message); }

  private void fail(String stage) {
    finished = true;
    if (region != null) region.setDownloadState(OfflineRegion.STATE_INACTIVE);
    Log.e(FixtureApplication.LOG_TAG, "PACK_FAILED stage=" + stage);
  }
}
