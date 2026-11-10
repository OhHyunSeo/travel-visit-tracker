package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
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

public final class FixtureBodyQueueTest {
  private static final List<String> HELD = List.of("/resource/style/mixed", "/resource/tile/h_2_0_0",
      "/resource/glyph/QA/0-255.pbf", "/resource/sprite/mixed.png");
  private static final String WAITING = "/resource/tile/h_2_0_1";
  private static final String CANCELLED = "/resource/tile/h_2_0_2";

  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static Call enqueue(FixtureHttpClient client, String base, String path,
                              CountDownLatch reading, CompletableFuture<Integer> result) {
    Call call = client.newCall(new Request.Builder().url(base + path).build());
    call.enqueue(new Callback() {
      @Override public void onFailure(Call failed, IOException error) {
        result.completeExceptionally(error);
      }

      @Override public void onResponse(Call completed, Response response) {
        try (Response owned = response; InputStream body = owned.body().byteStream()) {
          if (owned.code() != 200 || body.read() != 'a') throw new IOException("Unexpected fixture response");
          if (reading != null) reading.countDown();
          if (body.read() != 'b' || body.read() != -1) throw new IOException("Unexpected fixture body");
        } catch (IOException error) {
          result.completeExceptionally(error);
          return;
        }
        result.complete(2);
      }
    });
    return call;
  }

  private static void send(HttpExchange exchange, CountDownLatch release, boolean hold,
                           AtomicInteger opened, AtomicInteger peak) throws IOException {
    int count = opened.incrementAndGet();
    peak.accumulateAndGet(count, Math::max);
    boolean counted = true;
    try {
      exchange.sendResponseHeaders(200, 2);
      try (OutputStream output = exchange.getResponseBody()) {
        output.write('a');
        output.flush();
        if (hold && !release.await(4, TimeUnit.SECONDS)) throw new IOException("Fixture release timed out");
        // A callback cannot read the complete response before this release.
        opened.decrementAndGet();
        counted = false;
        output.write('b');
      }
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IOException("Fixture interrupted", error);
    } finally {
      if (counted) opened.decrementAndGet();
      exchange.close();
    }
  }

  public static void main(String[] args) throws Exception {
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch reading = new CountDownLatch(4);
    AtomicInteger opened = new AtomicInteger();
    AtomicInteger peak = new AtomicInteger();
    Set<String> paths = ConcurrentHashMap.newKeySet();
    AtomicInteger received = new AtomicInteger();
    ExecutorService workers = Executors.newFixedThreadPool(6);
    HttpServer server = HttpServer.create();
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(workers);
      server.createContext("/", exchange -> {
        String path = exchange.getRequestURI().getPath();
        paths.add(path);
        received.incrementAndGet();
        send(exchange, release, HELD.contains(path), opened, peak);
      });
      server.start();
      int port = server.getAddress().getPort();
      String base = "http://127.0.0.1:" + port;
      try (FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()))) {
        List<CompletableFuture<Integer>> held = HELD.stream().map(path -> {
          CompletableFuture<Integer> result = new CompletableFuture<>();
          enqueue(client, base, path, reading, result);
          return result;
        }).collect(java.util.stream.Collectors.toList());
        check(reading.await(2, TimeUnit.SECONDS), "first four callbacks read an incomplete body");
        CompletableFuture<Integer> waiting = new CompletableFuture<>();
        CompletableFuture<Integer> cancelled = new CompletableFuture<>();
        enqueue(client, base, WAITING, null, waiting);
        Call cancel = enqueue(client, base, CANCELLED, null, cancelled);
        check(client.queuedAsyncCalls() == 2, "fifth and sixth calls queued");
        check(opened.get() == 4 && received.get() == 4 && paths.equals(Set.copyOf(HELD)), "only four requests on server");
        check(held.stream().noneMatch(CompletableFuture::isDone), "none of the held callbacks completed");
        cancel.cancel();
        release.countDown();
        for (CompletableFuture<Integer> result : held) check(result.get(3, TimeUnit.SECONDS) == 2, "held body complete");
        check(waiting.get(3, TimeUnit.SECONDS) == 2, "queued fifth body completed");
        try {
          cancelled.get(3, TimeUnit.SECONDS);
          throw new AssertionError("Queued cancelled call completed successfully");
        } catch (ExecutionException error) {
          check(cancel.isCanceled() && error.getCause() instanceof IOException, "queued cancellation reached callback");
        }
        check(peak.get() == 4 && received.get() == 5 && paths.contains(WAITING) && !paths.contains(CANCELLED),
            "server saw five requests and a peak of four held bodies");
      }
      System.out.println("FixtureBodyQueue PASS: 4 held, 2 queued, 1 cancelled before send, 5 received");
    } finally {
      release.countDown();
      server.stop(0);
      workers.shutdownNow();
    }
  }
}
