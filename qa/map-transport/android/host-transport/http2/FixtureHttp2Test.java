package app.trippainting.maptransportqa;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

public final class FixtureHttp2Test {
  private static final String WARM = "/resource/style/sdk";
  private static final List<String> HELD = List.of("/resource/style/mixed", "/resource/tile/h_2_0_0",
      "/resource/glyph/QA/0-255.pbf", "/resource/sprite/mixed.png");
  private static final String WAITING = "/resource/tile/h_2_0_1";
  private static final String CANCELLED = "/resource/tile/h_2_0_2";
  private static final String OVERSIZED = "/resource/style/blocked";

  private static void require(boolean condition, String description) {
    if (!condition) throw new AssertionError(description);
  }

  private static Call enqueue(FixtureHttpClient client, String url, CountDownLatch reading, CountDownLatch release,
      CompletableFuture<Integer> result) {
    Call call = client.newCall(new Request.Builder().url(url).build());
    call.enqueue(new Callback() {
      @Override public void onFailure(Call failed, IOException error) {
        result.completeExceptionally(error);
      }

      @Override public void onResponse(Call completed, Response response) {
        try (Response owned = response; InputStream body = owned.body().byteStream()) {
          if (owned.protocol() != Protocol.HTTP_2 || owned.code() != 200 || body.read() != 'a') {
            throw new IOException("Expected a valid HTTP/2 body");
          }
          if (reading != null) {
            reading.countDown();
            if (!release.await(4, TimeUnit.SECONDS)) throw new IOException("Fixture callback release timed out");
          }
          if (body.read() != 'b' || body.read() != -1) throw new IOException("Incomplete fixture body");
        } catch (IOException error) {
          result.completeExceptionally(error);
          return;
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
          result.completeExceptionally(error);
          return;
        }
        result.complete(2);
      }
    });
    return call;
  }

  public static void main(String[] args) throws Exception {
    KeyStore keys = FixtureTlsTest.keys("loopback");
    KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    managers.init(keys, "fixture-only-password".toCharArray());
    SSLContext tls = SSLContext.getInstance("TLS");
    tls.init(managers.getKeyManagers(), null, null);
    CountDownLatch reading = new CountDownLatch(4);
    CountDownLatch release = new CountDownLatch(1);
    try (MockWebServer server = new MockWebServer(); FixtureBudget budget = new FixtureBudget(8, 4, 4, 32)) {
      server.useHttps(tls.getSocketFactory(), false);
      server.setProtocols(List.of(Protocol.HTTP_2, Protocol.HTTP_1_1));
      server.setDispatcher(new Dispatcher() {
        @Override public MockResponse dispatch(RecordedRequest request) {
          return new MockResponse().setBody(OVERSIZED.equals(request.getPath()) ? "abcde" : "ab");
        }
      });
      server.start(InetAddress.getByName("127.0.0.1"), 0);
      int port = server.getPort();
      String origin = "https://127.0.0.1:" + port;
      try (FixtureHttpClient client = FixtureHttpClient.httpsWithHttp2(port, chain -> chain.proceed(chain.request()),
          budget, (X509Certificate) keys.getCertificate("fixture"))) {
        try (Response warm = client.newCall(new Request.Builder().url(origin + WARM).build()).execute()) {
          require(warm.protocol() == Protocol.HTTP_2 && warm.handshake() != null && "ab".equals(warm.body().string()),
              "TLS negotiated HTTP/2 before concurrent calls");
        }
        List<CompletableFuture<Integer>> held = new ArrayList<>();
        try {
          for (String path : HELD) {
            CompletableFuture<Integer> result = new CompletableFuture<>();
            held.add(result);
            enqueue(client, origin + path, reading, release, result);
          }
          require(reading.await(3, TimeUnit.SECONDS), "four HTTP/2 callbacks own their bodies");
          CompletableFuture<Integer> waiting = new CompletableFuture<>();
          CompletableFuture<Integer> cancelled = new CompletableFuture<>();
          enqueue(client, origin + WAITING, null, release, waiting);
          Call cancelledCall = enqueue(client, origin + CANCELLED, null, release, cancelled);
          require(client.queuedAsyncCalls() == 2 && server.getRequestCount() == 5,
              "only the warm request and four active calls have reached the server");
          cancelledCall.cancel();
          release.countDown();
          for (CompletableFuture<Integer> result : held) require(result.get(3, TimeUnit.SECONDS) == 2, "held body complete");
          require(waiting.get(3, TimeUnit.SECONDS) == 2, "waiting body complete after release");
          try {
            cancelled.get(3, TimeUnit.SECONDS);
            throw new AssertionError("cancelled queued call completed");
          } catch (ExecutionException expected) {
            require(cancelledCall.isCanceled() && expected.getCause() instanceof IOException, "queued cancellation delivered");
          }
          try (Response ignored = client.newCall(new Request.Builder().url(origin + OVERSIZED).build()).execute()) {
            throw new AssertionError("oversized HTTP/2 body accepted");
          } catch (IOException expected) {
            require(expected.getMessage().contains("exceeds reservation"), "oversized HTTP/2 body rejected by fixture guard");
          }
          Set<String> paths = new HashSet<>();
          Set<Integer> sequences = new HashSet<>();
          require(server.getRequestCount() == 7, "exact server request count");
          for (int index = 0; index < 7; index++) {
            RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
            require(request != null && "identity".equals(request.getHeader("Accept-Encoding")), "one recorded identity request");
            paths.add(request.getPath());
            sequences.add(request.getSequenceNumber());
          }
          Set<String> expectedPaths = new HashSet<>(HELD);
          expectedPaths.addAll(List.of(WARM, WAITING, OVERSIZED));
          require(paths.equals(expectedPaths) && sequences.equals(Set.of(0, 1, 2, 3, 4, 5, 6)),
              "all requests reuse one connection and cancelled path never reaches it");
          FixtureBudget.Snapshot totals = budget.snapshot();
          require(totals.attempts == 7 && totals.tileAttempts == 2 && totals.reservedBytes == 28,
              "reservation charged per transmitted call even on body rejection");
        } finally {
          release.countDown();
        }
      }
    }
    System.out.println("Fixture HTTP/2 PASS: one TLS connection, four held callbacks, one queued cancellation, seven requests and 28 reserved bytes");
  }
}
