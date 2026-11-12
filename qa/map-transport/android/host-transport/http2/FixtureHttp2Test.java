package app.trippainting.maptransportqa;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
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
          if (reading != null) reading.countDown();
          if (release != null && !release.await(4, TimeUnit.SECONDS)) throw new IOException("Fixture callback release timed out");
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

  private static MockWebServer server(SSLSocketFactory tls) {
    MockWebServer server = new MockWebServer();
    server.useHttps(tls, false);
    server.setProtocols(List.of(Protocol.HTTP_2, Protocol.HTTP_1_1));
    return server;
  }

  private static void warm(FixtureHttpClient client, String origin) throws IOException {
    try (Response warm = client.newCall(new Request.Builder().url(origin + WARM).build()).execute()) {
      require(warm.protocol() == Protocol.HTTP_2 && warm.handshake() != null && "ab".equals(warm.body().string()),
          "TLS negotiated HTTP/2 before concurrent calls");
    }
  }

  private static void checkRequests(MockWebServer server, List<String> expected) throws InterruptedException {
    require(server.getRequestCount() == expected.size(), "exact server request count");
    List<String> paths = new ArrayList<>();
    List<Integer> sequences = new ArrayList<>();
    for (int index = 0; index < expected.size(); index++) {
      RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
      require(request != null && "identity".equals(request.getHeader("Accept-Encoding")), "one recorded identity request");
      paths.add(request.getPath());
      sequences.add(request.getSequenceNumber());
    }
    List<String> sortedExpected = new ArrayList<>(expected);
    Collections.sort(sortedExpected);
    Collections.sort(paths);
    Collections.sort(sequences);
    require(paths.equals(sortedExpected), "only expected paths reached the server");
    for (int index = 0; index < sequences.size(); index++) {
      require(sequences.get(index) == index, "all requests reuse one connection");
    }
  }

  private static void queueAndBudget(SSLSocketFactory tls, X509Certificate certificate) throws Exception {
    CountDownLatch reading = new CountDownLatch(4);
    CountDownLatch release = new CountDownLatch(1);
    try (MockWebServer server = server(tls); FixtureBudget budget = new FixtureBudget(8, 4, 4, 32)) {
      server.setDispatcher(new Dispatcher() {
        @Override public MockResponse dispatch(RecordedRequest request) {
          return new MockResponse().setBody(OVERSIZED.equals(request.getPath()) ? "abcde" : "ab");
        }
      });
      server.start(InetAddress.getByName("127.0.0.1"), 0);
      int port = server.getPort();
      String origin = "https://127.0.0.1:" + port;
      try (FixtureHttpClient client = FixtureHttpClient.httpsWithHttp2(port, chain -> chain.proceed(chain.request()),
          budget, certificate)) {
        warm(client, origin);
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
          List<String> expectedPaths = new ArrayList<>(HELD);
          expectedPaths.addAll(List.of(WARM, WAITING, OVERSIZED));
          checkRequests(server, expectedPaths);
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

  private static void activeCancellation(SSLSocketFactory tls, X509Certificate certificate) throws Exception {
    String tile = "/resource/tile/h_2_0_0";
    String sibling = "/resource/style/multi";
    AtomicInteger tileRequests = new AtomicInteger();
    CountDownLatch firstByte = new CountDownLatch(1);
    try (MockWebServer server = server(tls); FixtureBudget budget = new FixtureBudget(5, 3, 4, 20)) {
      server.setDispatcher(new Dispatcher() {
        @Override public MockResponse dispatch(RecordedRequest request) {
          MockResponse response = new MockResponse().setBody("ab");
          if (tile.equals(request.getPath()) && tileRequests.incrementAndGet() == 1) {
            response.throttleBody(1, 3, TimeUnit.SECONDS);
          }
          return response;
        }
      });
      server.start(InetAddress.getByName("127.0.0.1"), 0);
      int port = server.getPort();
      String origin = "https://127.0.0.1:" + port;
      try (FixtureHttpClient client = FixtureHttpClient.httpsWithHttp2(port, chain -> chain.proceed(chain.request()),
          budget, certificate)) {
        warm(client, origin);
        CompletableFuture<Integer> cancelled = new CompletableFuture<>();
        Call first = enqueue(client, origin + tile, firstByte, null, cancelled);
        require(firstByte.await(2, TimeUnit.SECONDS), "first tile reached an incomplete body");
        CompletableFuture<Integer> other = new CompletableFuture<>();
        enqueue(client, origin + sibling, null, null, other);
        require(other.get(2, TimeUnit.SECONDS) == 2 && !cancelled.isDone(), "sibling completed while tile remained incomplete");
        first.cancel();
        first.cancel();
        try {
          cancelled.get(2, TimeUnit.SECONDS);
          throw new AssertionError("cancelled stream delivered a complete body");
        } catch (ExecutionException expected) {
          require(first.isCanceled() && expected.getCause() instanceof IOException, "active cancellation closed the tile body");
        }
        CompletableFuture<Integer> retry = new CompletableFuture<>();
        enqueue(client, origin + tile, null, null, retry);
        require(retry.get(2, TimeUnit.SECONDS) == 2, "fresh tile call completed after cancellation");
        checkRequests(server, List.of(WARM, tile, sibling, tile));
        FixtureBudget.Snapshot totals = budget.snapshot();
        require(tileRequests.get() == 2 && totals.attempts == 4 && totals.tileAttempts == 2 && totals.reservedBytes == 16,
            "cancelled and repeated tile retain separate reservations");
      }
    }
    System.out.println("Fixture HTTP/2 PASS: active tile cancellation, sibling and retry on one connection, four requests and 16 reserved bytes");
  }

  public static void main(String[] args) throws Exception {
    KeyStore keys = FixtureTlsTest.keys("loopback");
    KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    managers.init(keys, "fixture-only-password".toCharArray());
    SSLContext tls = SSLContext.getInstance("TLS");
    tls.init(managers.getKeyManagers(), null, null);
    X509Certificate certificate = (X509Certificate) keys.getCertificate("fixture");
    queueAndBudget(tls.getSocketFactory(), certificate);
    activeCancellation(tls.getSocketFactory(), certificate);
  }
}
