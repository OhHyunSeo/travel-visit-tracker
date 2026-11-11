package app.trippainting.maptransportqa;

import java.io.IOException;
import java.util.Objects;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;
import org.maplibre.android.http.HttpRequest;
import org.maplibre.android.http.HttpResponder;

/** Synthetic resource adapter targeting the 13.6.1 public HTTP interface. */
final class FixtureMapLibreRequest implements HttpRequest {
  private final FixtureHttpClient client;
  private boolean executed;
  private boolean terminal;
  private Call call;

  FixtureMapLibreRequest(FixtureHttpClient client) {
    this.client = Objects.requireNonNull(client);
  }

  @Override public synchronized void executeRequest(HttpResponder responder, long nativePtr, String resourceUrl,
      String dataRange, String etag, String modified, boolean offlineUsage) {
    Objects.requireNonNull(responder);
    if (executed) throw new IllegalStateException("Use one resource request object per execution");
    executed = true;
    if (terminal) return;
    try {
      if (!dataRange.isEmpty()) throw new IllegalArgumentException("Range fixture requests are unsupported");
      FixtureRequestPolicy.Validator validator = FixtureRequestPolicy.Validator.select(etag, modified);
      call = client.newCall(new Request.Builder().url(resourceUrl)
          .tag(FixtureRequestPolicy.Validator.class, validator).build());
      call.enqueue(new Callback() {
        @Override public void onFailure(Call failed, IOException error) { failure(responder, error); }

        @Override public void onResponse(Call completed, Response response) {
          byte[] body;
          try (Response owned = response) {
            body = owned.body().bytes();
          } catch (IOException error) {
            failure(responder, error);
            return;
          }
          synchronized (FixtureMapLibreRequest.this) {
            if (terminal) return;
            terminal = true;
            responder.onResponse(response.code(), response.header("ETag"), response.header("Last-Modified"),
                response.header("Cache-Control"), response.header("Expires"), response.header("Retry-After"),
                response.header("x-rate-limit-reset"), body);
          }
        }
      });
    } catch (RuntimeException error) {
      failure(responder, new IOException("Invalid fixture resource request", error));
    }
  }

  private synchronized void failure(HttpResponder responder, IOException error) {
    if (terminal) return;
    terminal = true;
    responder.handleFailure(PERMANENT_ERROR, error.getMessage());
  }

  @Override public synchronized void cancelRequest() {
    if (terminal) return;
    terminal = true;
    if (call != null) call.cancel();
  }
}
