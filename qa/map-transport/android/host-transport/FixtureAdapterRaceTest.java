package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.maplibre.android.http.HttpResponder;

public final class FixtureAdapterRaceTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static final class Attempt implements HttpResponder {
    final CountDownLatch started = new CountDownLatch(1);
    final CountDownLatch release = new CountDownLatch(1);
    final AtomicBoolean cancelReturned = new AtomicBoolean();
    final AtomicInteger delivered = new AtomicInteger();
    final AtomicBoolean late = new AtomicBoolean();
    final AtomicBoolean invalid = new AtomicBoolean();
    int atCancellation;

    @Override public void onResponse(int code, String etag, String modified, String cache, String expires,
        String retry, String reset, byte[] body) {
      if (cancelReturned.get()) late.set(true);
      if (code != 200 || body.length != 2 || body[0] != 'a' || body[1] != 'b') invalid.set(true);
      delivered.incrementAndGet();
    }

    @Override public void handleFailure(int type, String error) {
      invalid.set(true);
      delivered.incrementAndGet();
    }
  }

  public static void main(String[] args) throws Exception {
    HttpServer server = HttpServer.create();
    ExecutorService serverThreads = Executors.newFixedThreadPool(4);
    ExecutorService racers = Executors.newFixedThreadPool(2);
    Map<String, Attempt> attempts = new ConcurrentHashMap<>();
    List<Attempt> completed = new ArrayList<>();
    AtomicInteger requests = new AtomicInteger();
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(serverThreads);
      server.createContext("/", exchange -> {
        Attempt attempt = attempts.get(exchange.getRequestURI().getPath());
        requests.incrementAndGet();
        try {
          exchange.sendResponseHeaders(200, 2);
          exchange.getResponseBody().write('a');
          exchange.getResponseBody().flush();
          attempt.started.countDown();
          if (!attempt.release.await(3, TimeUnit.SECONDS)) throw new IOException("Race fixture timed out");
          exchange.getResponseBody().write('b');
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
        } catch (IOException peerCancelled) {
          // Cancellation may close the connection during the final byte.
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      try (FixtureBudget budget = new FixtureBudget(20, 20, 4, 80);
           FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget)) {
        for (int index = 0; index < 16; index++) {
          Attempt attempt = new Attempt();
          completed.add(attempt);
          String path = "/resource/tile/2_" + (index / 4) + "_" + (index % 4);
          attempts.put(path, attempt);
          FixtureMapLibreRequest resource = new FixtureMapLibreRequest(client);
          resource.executeRequest(attempt, 0, "http://127.0.0.1:" + port + path, "", "", "", true);
          check(attempt.started.await(2, TimeUnit.SECONDS), "server began race response");
          CyclicBarrier start = new CyclicBarrier(3);
          Future<?> cancel = racers.submit(() -> {
            start.await(2, TimeUnit.SECONDS);
            resource.cancelRequest();
            attempt.cancelReturned.set(true);
            attempt.atCancellation = attempt.delivered.get();
            return null;
          });
          Future<?> release = racers.submit(() -> {
            start.await(2, TimeUnit.SECONDS);
            attempt.release.countDown();
            return null;
          });
          start.await(2, TimeUnit.SECONDS);
          cancel.get(2, TimeUnit.SECONDS);
          release.get(2, TimeUnit.SECONDS);
        }
        budget.close();
        for (Attempt attempt : completed) {
          check(!attempt.late.get() && !attempt.invalid.get() && attempt.delivered.get() <= 1,
              "complete valid response at most once and none after cancel returns");
          check(attempt.delivered.get() == attempt.atCancellation, "delivery count stable after cancellation return");
        }
        check(requests.get() == 16 && budget.snapshot().attempts == 16 && budget.snapshot().reservedBytes == 64,
            "each race retained exactly one transmitted reservation");
      }
      System.out.println("FixtureAdapterRace PASS: 16 completion/cancellation races, no late or duplicate delivery, 64 reserved bytes");
    } finally {
      attempts.values().forEach(attempt -> attempt.release.countDown());
      server.stop(0);
      racers.shutdownNow();
      serverThreads.shutdownNow();
    }
  }
}
