// Public signatures from MapLibre Native android-v13.6.1.
// Copyright MapLibre contributors, MapTiler.com and Mapbox. See ../../../../LICENSE.maplibre.
package org.maplibre.android.http;

public interface HttpResponder {
  void onResponse(int responseCode, String eTag, String lastModified, String cacheControl,
                  String expires, String retryAfter, String xRateLimitReset, byte[] body);
  void handleFailure(int type, String errorMessage);
}
