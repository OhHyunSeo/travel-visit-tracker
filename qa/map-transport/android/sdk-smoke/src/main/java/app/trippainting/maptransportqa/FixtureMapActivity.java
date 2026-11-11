package app.trippainting.maptransportqa;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;
import org.maplibre.android.maps.MapView;
import org.maplibre.android.maps.Style;

public final class FixtureMapActivity extends Activity {
  private MapView mapView;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    FixtureApplication app = (FixtureApplication) getApplication();
    if (app.styleUrl() == null) {
      TextView failed = new TextView(this);
      failed.setText("시험 지도 연결을 시작할 수 없습니다.");
      setContentView(failed);
      return;
    }
    mapView = new MapView(this);
    mapView.onCreate(state);
    mapView.addOnDidFailLoadingMapListener(message -> Log.e(FixtureApplication.LOG_TAG, "STYLE_LOAD_FAILED"));
    setContentView(mapView);
    mapView.getMapAsync(map -> map.setStyle(new Style.Builder().fromUri(app.styleUrl()), style -> {
      if (style.getLayer("fixture-background") != null) app.reportStyleLoaded();
      else Log.e(FixtureApplication.LOG_TAG, "STYLE_LAYER_MISSING");
    }));
  }

  @Override protected void onStart() {
    super.onStart();
    if (mapView != null) mapView.onStart();
  }

  @Override protected void onResume() {
    super.onResume();
    if (mapView != null) mapView.onResume();
  }

  @Override protected void onPause() {
    if (mapView != null) mapView.onPause();
    super.onPause();
  }

  @Override protected void onStop() {
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
    if (mapView != null) mapView.onDestroy();
    super.onDestroy();
  }
}
