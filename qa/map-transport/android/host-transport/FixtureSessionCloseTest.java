package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;

public final class FixtureSessionCloseTest {
  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static FixtureBudget open(Path root) throws IOException {
    return FixtureBudget.open(root, 2, 2, 4, 8);
  }

  public static void main(String[] args) throws Exception {
    Path root = Files.createTempDirectory("trip-session-close-").toRealPath();
    HttpServer server = HttpServer.create();
    ExecutorService workers = Executors.newFixedThreadPool(2);
    CountDownLatch releaseServer = new CountDownLatch(1);
    CountDownLatch reading = new CountDownLatch(1);
    CountDownLatch cancelled = new CountDownLatch(1);
    CountDownLatch releaseCallback = new CountDownLatch(1);
    CompletableFuture<Void> callbackDone = new CompletableFuture<>();
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(workers);
      server.createContext("/", exchange -> {
        try {
          exchange.sendResponseHeaders(200, 2);
          exchange.getResponseBody().write('a');
          exchange.getResponseBody().flush();
          releaseServer.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      try (FixtureBudget budget = open(root);
           FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget)) {
        String url = "http://127.0.0.1:" + port + "/resource/tile/0_0_0";
        client.newCall(new Request.Builder().url(url).build()).enqueue(new Callback() {
          @Override public void onFailure(Call call, IOException error) { callbackDone.completeExceptionally(error); }

          @Override public void onResponse(Call call, Response response) {
            try (Response owned = response; InputStream input = owned.body().byteStream()) {
              check(input.read() == 'a', "first body byte");
              reading.countDown();
              input.read();
              callbackDone.completeExceptionally(new AssertionError("Read returned before cancel"));
              return;
            } catch (IOException expected) {
              cancelled.countDown();
            }
            try {
              if (!releaseCallback.await(10, TimeUnit.SECONDS)) throw new IOException("Callback release timed out");
              callbackDone.complete(null);
            } catch (Exception error) {
              callbackDone.completeExceptionally(error);
            }
          }
        });
        check(reading.await(2, TimeUnit.SECONDS), "active response reading");
        Future<String> close = workers.submit(() -> {
          try {
            budget.close();
            return "closed";
          } catch (IOException error) {
            return error.getMessage();
          }
        });
        check(cancelled.await(2, TimeUnit.SECONDS), "session close cancels active read");
        check(close.get(6, TimeUnit.SECONDS).contains("callbacks still active; journal lock retained"), "close timeout preserves lock");
        try (FixtureBudget unexpected = open(root)) {
          throw new AssertionError("Journal reopened while old callback was active");
        } catch (IOException expected) {
          check(expected.getMessage().contains("already in use"), "writer still excluded after timeout");
        }
        try {
          budget.reserve(FixtureRequestPolicy.Kind.TILE);
          throw new AssertionError("Closing session admitted a reservation");
        } catch (IOException expected) {
          check(expected.getMessage().contains("closed or failed"), "admission remains closed");
        }
        releaseCallback.countDown();
        callbackDone.get(2, TimeUnit.SECONDS);
        budget.close();
      }
      try (FixtureBudget restored = open(root)) {
        check(restored.snapshot().attempts == 1 && restored.snapshot().reservedBytes == 4, "close retry retained reservation");
      }
      System.out.println("FixtureSessionClose PASS: close timeout retains writer lock, callback completion enables close retry");
    } finally {
      releaseCallback.countDown();
      releaseServer.countDown();
      server.stop(0);
      workers.shutdownNow();
      try (java.util.stream.Stream<Path> paths = Files.walk(root)) {
        for (Path path : (Iterable<Path>) paths.sorted(Comparator.reverseOrder())::iterator) Files.delete(path);
      }
    }
  }
}
