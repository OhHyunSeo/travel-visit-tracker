package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpsServer;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.maplibre.android.MapLibre;
import org.maplibre.android.ModuleProvider;
import org.maplibre.android.http.NativeHttpRequest;

public final class FixtureNativeRequestTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static void awaitIdle(FixtureBudget budget) throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
    while (budget.dispatcher().runningCallsCount() != 0 || budget.dispatcher().queuedCallsCount() != 0) {
      check(System.nanoTime() < deadline, "SDK request dispatcher did not drain");
      Thread.sleep(5);
    }
  }

  private static NativeHttpRequest request(Constructor<NativeHttpRequest> constructor, String url, boolean offline)
      throws Exception {
    // A zero pointer exercises the SDK Java wrapper without a JNI callback.
    return constructor.newInstance(0L, url, "", "", "", offline);
  }

  public static void main(String[] args) throws Exception {
    check(NativeHttpRequest.class.getProtectionDomain().getCodeSource().getLocation().equals(
        MapLibre.class.getProtectionDomain().getCodeSource().getLocation()), "released SDK NativeHttpRequest class");
    Constructor<NativeHttpRequest> constructor = NativeHttpRequest.class.getDeclaredConstructor(long.class,
        String.class, String.class, String.class, String.class, boolean.class);
    constructor.setAccessible(true);
    KeyStore keys = FixtureTlsTest.keys("loopback");
    HttpsServer server = FixtureTlsTest.server(keys);
    ExecutorService workers = Executors.newFixedThreadPool(3);
    CountDownLatch firstTileBody = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicInteger styles = new AtomicInteger();
    AtomicInteger tiles = new AtomicInteger();
    AtomicInteger unexpected = new AtomicInteger();
    ModuleProvider original = MapLibre.getModuleProvider();
    try {
      server.setExecutor(workers);
      server.createContext("/", exchange -> {
        String path = exchange.getRequestURI().toString();
        boolean held = false;
        if (path.equals("/resource/style/sdk")) styles.incrementAndGet();
        else if (path.equals("/resource/tile/0_0_0")) held = tiles.incrementAndGet() == 1;
        else unexpected.incrementAndGet();
        try {
          exchange.sendResponseHeaders(200, 2);
          exchange.getResponseBody().write('a');
          exchange.getResponseBody().flush();
          if (held) {
            firstTileBody.countDown();
            if (!release.await(5, TimeUnit.SECONDS)) throw new IOException("Held SDK response timed out");
          }
          exchange.getResponseBody().write('b');
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      String origin = "https://127.0.0.1:" + port;
      String tile = origin + "/resource/tile/0_0_0";
      try (FixtureBudget budget = new FixtureBudget(4, 2, 4, 16);
           FixtureHttpClient client = FixtureHttpClient.https(port, chain -> {
             okhttp3.Request outgoing = chain.request();
             if (outgoing.url().encodedPath().equals("/before")) {
               outgoing = outgoing.newBuilder().url(origin + "/resource/style/sdk").build();
             }
             return chain.proceed(outgoing);
           }, budget, (X509Certificate) keys.getCertificate("fixture"))) {
        FixtureModuleProvider.install(client);
        request(constructor, origin + "/before", false);
        awaitIdle(budget);
        check(styles.get() == 1 && budget.snapshot().attempts == 1, "SDK wrapper used the installed transform and request factory");

        NativeHttpRequest cancelled = request(constructor, tile, true);
        check(firstTileBody.await(3, TimeUnit.SECONDS), "SDK tile reached the held body");
        cancelled.cancel();
        cancelled.cancel();
        awaitIdle(budget);
        check(tiles.get() == 1 && budget.snapshot().tileAttempts == 1, "SDK cancellation releases the slot but keeps the reservation");
        release.countDown();
        request(constructor, tile, true);
        awaitIdle(budget);
        request(constructor, tile, true);
        request(constructor, "http://127.0.0.1:" + port + "/resource/style/sdk", false);
        awaitIdle(budget);
        FixtureBudget.Snapshot state = budget.snapshot();
        check(styles.get() == 1 && tiles.get() == 2 && unexpected.get() == 0, "only admitted SDK requests reached HTTPS");
        check(state.attempts == 3 && state.tileAttempts == 2 && state.reservedBytes == 12, "same tile retry charges, exhausted and downgrade refuse");
      }
      System.out.println("FixtureNativeRequest PASS: released Java wrapper, HTTPS transform, cancellation and same-tile reservation");
    } finally {
      MapLibre.setModuleProvider(original);
      release.countDown();
      server.stop(0);
      workers.shutdownNow();
    }
  }
}
