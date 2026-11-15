package app.trippainting.maptransportqa;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.TextView;
import org.maplibre.android.maps.MapView;
import org.maplibre.android.maps.Style;

public final class FixtureMapActivity extends Activity {
  private MapView mapView;
  private boolean fixtureStyleLoaded;
  private boolean reopening;
  private boolean started;
  private boolean resumed;
  private final MapView.OnDidFinishRenderingFrameListener renderedFrame = (fully, encodingTime, renderTime) -> {
    if (fully && fixtureStyleLoaded && mapView != null) reportRenderedFrame();
  };

  private void reportRenderedFrame() {
    mapView.removeOnDidFinishRenderingFrameListener(renderedFrame);
    Log.i(FixtureApplication.LOG_TAG, "FRAME_RENDERED fully=true");
    if (reopening) {
      FixtureApplication app = (FixtureApplication) getApplication();
      new Handler(Looper.getMainLooper()).postDelayed(app::reportReopenTransport, 3_000);
    }
  }

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    FixtureApplication app = (FixtureApplication) getApplication();
    if (app.styleUrl() == null) {
      TextView failed = new TextView(this);
      failed.setText("시험 지도 연결을 시작할 수 없습니다.");
      setContentView(failed);
      return;
    }
    if (getIntent().getBooleanExtra("fixture-offline-pack", false)) {
      FixtureOfflinePack.start(this, app.styleUrl());
      return;
    }
    long reopenId = getIntent().getLongExtra("fixture-reopen-pack", 0);
    if (reopenId > 0) {
      reopening = true;
      FixtureOfflinePack.reopen(this, app.styleUrl(), reopenId, () -> openMap(app, state));
    } else {
      openMap(app, state);
    }
  }

  private void openMap(FixtureApplication app, Bundle state) {
    mapView = new MapView(this);
    mapView.onCreate(state);
    mapView.addOnDidFinishRenderingFrameListener(renderedFrame);
    mapView.addOnDidFailLoadingMapListener(message -> Log.e(FixtureApplication.LOG_TAG, "STYLE_LOAD_FAILED"));
    setContentView(mapView);
    if (started) mapView.onStart();
    if (resumed) mapView.onResume();
    mapView.getMapAsync(map -> map.setStyle(new Style.Builder().fromUri(app.styleUrl()), style -> {
      if (style.getLayer("fixture-background") != null && (!reopening || style.getLayer("fixture-raster") != null)) {
        app.reportStyleLoaded();
        fixtureStyleLoaded = true;
      } else {
        Log.e(FixtureApplication.LOG_TAG, "STYLE_LAYER_MISSING");
      }
    }));
  }

  @Override protected void onStart() {
    super.onStart();
    started = true;
    if (mapView != null) mapView.onStart();
  }

  @Override protected void onResume() {
    super.onResume();
    resumed = true;
    if (mapView != null) mapView.onResume();
  }

  @Override protected void onPause() {
    resumed = false;
    if (mapView != null) mapView.onPause();
    super.onPause();
  }

  @Override protected void onStop() {
    started = false;
    if (mapView != null) mapView.onStop();
    super.onStop();
  }

  @Override protected void onSaveInstanceState(Bundle state) {
    if (mapView != null) mapView.onSaveInstanceState(state);
    super.onSaveInstanceState(state);
  }

  @Override public void onLowMemory() {
    super.onLowMemory();
    if (mapView != null) mapView.onLowMemory();
  }

  @Override protected void onDestroy() {
    if (mapView != null) {
      mapView.removeOnDidFinishRenderingFrameListener(renderedFrame);
      mapView.onDestroy();
      mapView = null;
    }
    super.onDestroy();
  }
}
