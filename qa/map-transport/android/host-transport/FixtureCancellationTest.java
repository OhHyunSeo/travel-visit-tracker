package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
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

public final class FixtureCancellationTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static void await(CountDownLatch latch, String label) throws InterruptedException {
    check(latch.await(3, TimeUnit.SECONDS), label);
  }

  private static void serve(HttpExchange exchange, CountDownLatch release) throws IOException {
    try {
      exchange.sendResponseHeaders(200, 2);
      try (OutputStream output = exchange.getResponseBody()) {
        output.write('a');
        output.flush();
        if (release != null) await(release, "server body release");
        output.write('b');
      }
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IOException(error);
    } finally {
      exchange.close();
    }
  }

  private static final class Read implements Callback {
    final CompletableFuture<Integer> result = new CompletableFuture<>();
    final AtomicInteger callbacks = new AtomicInteger();
    final CountDownLatch reading;
    final CountDownLatch cancelled;
    final CountDownLatch finish;

    Read(CountDownLatch reading, CountDownLatch cancelled, CountDownLatch finish) {
      this.reading = reading;
      this.cancelled = cancelled;
      this.finish = finish;
    }

    @Override public void onFailure(Call call, IOException error) {
      callbacks.incrementAndGet();
      result.completeExceptionally(error);
    }

    @Override public void onResponse(Call call, Response response) {
      callbacks.incrementAndGet();
      IOException failure = null;
      try (Response owned = response; InputStream body = owned.body().byteStream()) {
        if (body.read() != 'a') throw new IOException("Unexpected first byte");
        if (reading != null) reading.countDown();
        if (body.read() != 'b' || body.read() != -1) throw new IOException("Unexpected complete body");
      } catch (IOException error) {
        failure = error;
      }
      if (failure != null && cancelled != null) {
        // The response is closed, while the callback deliberately still owns
        // the dispatcher slot until the test permits this method to return.
        cancelled.countDown();
        try {
          await(finish, "cancelled callback release");
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
          failure = new IOException(error);
        }
      }
      if (failure == null) result.complete(2);
      else result.completeExceptionally(failure);
    }
  }

  private static void scenario(boolean tls) throws Exception {
    CountDownLatch release = new CountDownLatch(1);
    CountDownLatch reading = new CountDownLatch(4);
    CountDownLatch cancelObserved = new CountDownLatch(1);
    CountDownLatch exitCallback = new CountDownLatch(1);
    CountDownLatch fifthArrived = new CountDownLatch(1);
    AtomicInteger requests = new AtomicInteger();
    ExecutorService workers = Executors.newFixedThreadPool(5);
    java.security.KeyStore keys = tls ? FixtureTlsTest.keys("loopback") : null;
    HttpServer server = tls ? FixtureTlsTest.server(keys) : HttpServer.create();
    try {
      if (!tls) server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(workers);
      server.createContext("/", exchange -> {
        requests.incrementAndGet();
        boolean fifth = exchange.getRequestURI().getPath().endsWith("2_1_0");
        if (fifth) fifthArrived.countDown();
        serve(exchange, fifth ? null : release);
      });
      server.start();
      int port = server.getAddress().getPort();
      String base = (tls ? "https" : "http") + "://127.0.0.1:" + port + "/resource/tile/h_";
      try (FixtureBudget budget = new FixtureBudget(10, 10, 4, 40);
           FixtureHttpClient client = tls
               ? FixtureHttpClient.https(port, chain -> chain.proceed(chain.request()), budget,
                   (java.security.cert.X509Certificate) keys.getCertificate("fixture"))
               : new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget)) {
        List<Read> reads = new ArrayList<>();
        List<Call> calls = new ArrayList<>();
        for (int index = 0; index < 4; index++) {
          Read read = new Read(reading, index == 0 ? cancelObserved : null, index == 0 ? exitCallback : null);
          Call call = client.newCall(new Request.Builder().url(base + "2_0_" + index).build());
          reads.add(read);
          calls.add(call);
          call.enqueue(read);
        }
        await(reading, "four active readers");
        Read fifth = new Read(null, null, null);
        client.newCall(new Request.Builder().url(base + "2_1_0").build()).enqueue(fifth);
        check(client.queuedAsyncCalls() == 1 && requests.get() == 4, "fifth waits behind active bodies");
        calls.get(0).cancel();
        calls.get(0).cancel();
        await(cancelObserved, "active body read observes cancellation");
        check(fifthArrived.getCount() == 1 && client.queuedAsyncCalls() == 1 && requests.get() == 4,
            "slot retained until cancelled callback returns");
        exitCallback.countDown();
        await(fifthArrived, "fifth dispatched after cancellation callback exits");
        check(fifth.result.get(3, TimeUnit.SECONDS) == 2, "fifth receives its complete body");
        try {
          reads.get(0).result.get(3, TimeUnit.SECONDS);
          throw new AssertionError("Cancelled body delivered success");
        } catch (ExecutionException error) {
          check(error.getCause() instanceof IOException, "cancelled read failed");
        }
        release.countDown();
        for (int index = 1; index < 4; index++) check(reads.get(index).result.get(3, TimeUnit.SECONDS) == 2, "remaining body");
        check(reads.stream().allMatch(read -> read.callbacks.get() == 1) && fifth.callbacks.get() == 1,
            "exactly one callback per Call after duplicate cancellation");
        check(requests.get() == 5, "no automatic replay after active cancellation");
        check(budget.snapshot().attempts == 5 && budget.snapshot().reservedBytes == 20, "cancelled reservation retained");
      }
      System.out.println("FixtureCancellation " + (tls ? "HTTPS" : "HTTP")
          + " PASS: active cancel closes body, slot waits for callback, fifth completes, 20 reserved");
    } finally {
      exitCallback.countDown();
      release.countDown();
      server.stop(0);
      workers.shutdownNow();
    }
  }

  public static void main(String[] args) throws Exception {
    scenario(false);
    scenario(true);
  }
}
