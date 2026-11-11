package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.maplibre.android.http.HttpRequest;
import org.maplibre.android.http.HttpResponder;

public final class FixtureMapLibreRequestTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static final class Capture implements HttpResponder {
    final AtomicInteger callbacks = new AtomicInteger();
    final CompletableFuture<String> result = new CompletableFuture<>();

    @Override public void onResponse(int code, String etag, String modified, String cache, String expires,
        String retry, String rate, byte[] body) {
      callbacks.incrementAndGet();
      result.complete(code + ":" + etag + ":" + new String(body, StandardCharsets.UTF_8));
    }

    @Override public void handleFailure(int type, String error) {
      callbacks.incrementAndGet();
      result.complete("failure:" + type);
    }
  }

  private static void execute(HttpRequest request, Capture capture, String url) {
    request.executeRequest(capture, 0, url, "", "", "", true);
  }

  public static void main(String[] args) throws Exception {
    HttpServer server = HttpServer.create();
    ExecutorService workers = Executors.newFixedThreadPool(3);
    CountDownLatch activeBody = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicInteger received = new AtomicInteger();
    Capture cancelled = new Capture();
    Capture beforeStart = new Capture();
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(workers);
      server.createContext("/", exchange -> {
        received.incrementAndGet();
        boolean tile = exchange.getRequestURI().getPath().contains("/tile/");
        try {
          exchange.getResponseHeaders().set("ETag", "qa");
          exchange.sendResponseHeaders(200, 2);
          exchange.getResponseBody().write('a');
          exchange.getResponseBody().flush();
          if (tile) {
            activeBody.countDown();
            if (!release.await(4, TimeUnit.SECONDS)) throw new IOException("Adapter fixture timed out");
          }
          exchange.getResponseBody().write('b');
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
        } catch (IOException peerCancelled) {
          // The cancelled adapter may close the first tile connection.
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      String base = "http://127.0.0.1:" + port;
      try (FixtureBudget budget = new FixtureBudget(5, 3, 4, 20);
           FixtureHttpClient client = new FixtureHttpClient(port, chain -> {
             okhttp3.Request request = chain.request();
             if (request.url().encodedPath().equals("/before")) request = request.newBuilder().url(base + "/resource/style/sdk").build();
             return chain.proceed(request);
           }, budget)) {
        Capture normal = new Capture();
        HttpRequest first = new FixtureMapLibreRequest(client);
        execute(first, normal, base + "/before");
        check("200:qa:ab".equals(normal.result.get(2, TimeUnit.SECONDS)), "adapter returns complete transformed body and header");
        first.cancelRequest();
        try {
          execute(first, new Capture(), base + "/resource/style/sdk");
          throw new AssertionError("Resource object reused");
        } catch (IllegalStateException expected) {
          check(normal.callbacks.get() == 1, "completed callback remains exactly once");
        }
        HttpRequest preCancelled = new FixtureMapLibreRequest(client);
        preCancelled.cancelRequest();
        execute(preCancelled, beforeStart, base + "/resource/style/sdk");
        for (int field = 0; field < 3; field++) {
          Capture invalid = new Capture();
          new FixtureMapLibreRequest(client).executeRequest(invalid, 0, base + "/resource/style/sdk",
              field == 0 ? "bytes=0-1" : "", field == 1 ? "etag" : "", field == 2 ? "modified" : "", false);
          check("failure:2".equals(invalid.result.get(2, TimeUnit.SECONDS)) && invalid.callbacks.get() == 1,
              "unsupported conditional/range metadata refused");
        }
        HttpRequest active = new FixtureMapLibreRequest(client);
        execute(active, cancelled, base + "/resource/tile/0_0_0");
        check(activeBody.await(2, TimeUnit.SECONDS), "active adapter tile response started");
        active.cancelRequest();
        active.cancelRequest();
        Capture replay = new Capture();
        execute(new FixtureMapLibreRequest(client), replay, base + "/resource/tile/0_0_0");
        release.countDown();
        check("200:qa:ab".equals(replay.result.get(2, TimeUnit.SECONDS)), "fresh adapter can reload same tile");
        budget.close();
        check(budget.snapshot().attempts == 3 && budget.snapshot().tileAttempts == 2 && budget.snapshot().reservedBytes == 12,
            "cancelled attempt and reload retain separate reservations");
      }
      check(received.get() == 3 && cancelled.callbacks.get() == 0 && beforeStart.callbacks.get() == 0,
          "cancelled responders never receive late callbacks");
      System.out.println("FixtureMapLibreRequest PASS: interface contract, complete body, single use, cancel suppression and charged reload");
    } finally {
      release.countDown();
      server.stop(0);
      workers.shutdownNow();
    }
  }
}
