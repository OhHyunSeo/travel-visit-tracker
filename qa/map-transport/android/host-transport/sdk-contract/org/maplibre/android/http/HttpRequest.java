// Public signatures from MapLibre Native android-v13.6.1.
// Copyright MapLibre contributors, MapTiler.com and Mapbox. See ../../../../LICENSE.maplibre.
package org.maplibre.android.http;

public interface HttpRequest {
  int CONNECTION_ERROR = 0;
  int TEMPORARY_ERROR = 1;
  int PERMANENT_ERROR = 2;
  void executeRequest(HttpResponder responder, long nativePtr, String resourceUrl,
                      String dataRange, String etag, String modified, boolean offlineUsage);
  void cancelRequest();
}
