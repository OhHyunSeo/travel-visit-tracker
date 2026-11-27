package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;

public final class FixtureSharedSessionTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static CompletableFuture<String> enqueue(FixtureHttpClient client, String url, CountDownLatch reading) {
    CompletableFuture<String> result = new CompletableFuture<>();
    client.newCall(new Request.Builder().url(url).build()).enqueue(new Callback() {
      @Override public void onFailure(Call call, IOException error) { result.completeExceptionally(error); }

      @Override public void onResponse(Call call, Response response) {
        try (Response owned = response) {
          if (owned.body().byteStream().read() != 'a') throw new IOException("Missing first byte");
          if (reading != null) reading.countDown();
          String remaining = owned.body().string();
          if (!"b".equals(remaining)) throw new IOException("Incomplete body");
        } catch (IOException error) {
          result.completeExceptionally(error);
          return;
        }
        result.complete("ab");
      }
    });
    return result;
  }

  public static void main(String[] args) throws Exception {
    HttpServer server = HttpServer.create();
    ExecutorService workers = Executors.newFixedThreadPool(5);
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch reading = new CountDownLatch(4);
    AtomicInteger requests = new AtomicInteger();
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(workers);
      server.createContext("/", exchange -> {
        requests.incrementAndGet();
        try {
          exchange.sendResponseHeaders(200, 2);
          try (OutputStream output = exchange.getResponseBody()) {
            output.write('a');
            output.flush();
            if (!release.await(4, TimeUnit.SECONDS)) throw new IOException("Release timed out");
            output.write('b');
          }
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      String base = "http://127.0.0.1:" + port + "/resource/tile/h_2_";
      try (FixtureBudget budget = new FixtureBudget(10, 10, 4, 40);
           FixtureHttpClient first = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget);
           FixtureHttpClient second = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget)) {
        List<CompletableFuture<String>> active = new ArrayList<>();
        for (int index = 0; index < 4; index++) active.add(enqueue(first, base + "0_" + index, reading));
        check(reading.await(2, TimeUnit.SECONDS), "four first-client bodies active");
        CompletableFuture<String> cancelled = enqueue(second, base + "1_0", null);
        check(first.queuedAsyncCalls() == 1 && requests.get() == 4, "second client shares four slots");
        second.close();
        check(active.stream().noneMatch(CompletableFuture::isDone), "closing second client preserves first-client bodies");
        CompletableFuture<String> fifth = enqueue(first, base + "1_1", null);
        release.countDown();
        for (CompletableFuture<String> result : active) check("ab".equals(result.get(3, TimeUnit.SECONDS)), "first body completes");
        check("ab".equals(fifth.get(3, TimeUnit.SECONDS)), "remaining client can dispatch after other client closes");
        try {
          cancelled.get(3, TimeUnit.SECONDS);
          throw new AssertionError("Closed client sent queued request");
        } catch (ExecutionException expected) {
          check(expected.getCause() instanceof IOException, "closed client's queued callback failed");
        }
        check(requests.get() == 5 && budget.snapshot().attempts == 5 && budget.snapshot().reservedBytes == 20,
            "only transmitted requests reserved across clients");
      }
      System.out.println("FixtureSharedSession PASS: 4 shared slots, client-owned cancellation, remaining client continues");
    } finally {
      release.countDown();
      server.stop(0);
      workers.shutdownNow();
    }
  }
}
