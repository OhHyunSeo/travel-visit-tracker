package app.trippainting.maptransportqa;

import com.sun.net.httpserver.HttpServer;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Request;
import okhttp3.Response;

public final class FixtureCrashRecoveryTest {
  private static FixtureBudget open(Path root) throws IOException {
    return FixtureBudget.open(root, 2, 2, 4, 8);
  }

  private static void check(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }

  private static void child(String mode, Path root, String url) throws Exception {
    try (FixtureBudget budget = open(root)) {
      if (mode.equals("reserve-only")) {
        budget.reserve(FixtureRequestPolicy.Kind.TILE);
        System.out.println("RESERVED");
        System.out.flush();
        new CountDownLatch(1).await(30, TimeUnit.SECONDS);
      } else {
        int port = java.net.URI.create(url).getPort();
        try (FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), budget);
             Response response = client.newCall(new Request.Builder().url(url).build()).execute()) {
          InputStream body = response.body().byteStream();
          check(body.read() == 'a', "child first byte");
          System.out.println("READING");
          System.out.flush();
          body.read();
          throw new AssertionError("Child body unexpectedly released before termination");
        }
      }
    }
  }

  private static void scenario(boolean send) throws Exception {
    Path root = Files.createTempDirectory("trip-crash-journal-").toRealPath();
    HttpServer server = HttpServer.create();
    ExecutorService workers = Executors.newFixedThreadPool(3);
    CountDownLatch release = new CountDownLatch(1);
    AtomicInteger requests = new AtomicInteger();
    Process process = null;
    try {
      server.bind(new InetSocketAddress("127.0.0.1", 0), 0);
      server.setExecutor(workers);
      server.createContext("/", exchange -> {
        requests.incrementAndGet();
        try {
          exchange.sendResponseHeaders(200, 2);
          exchange.getResponseBody().write('a');
          exchange.getResponseBody().flush();
          if (!release.await(8, TimeUnit.SECONDS)) throw new IOException("Crash test fixture timed out");
          exchange.getResponseBody().write('b');
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
        } catch (IOException closedChild) {
          // The first peer may have been forcibly terminated.
        } finally {
          exchange.close();
        }
      });
      server.start();
      int port = server.getAddress().getPort();
      String url = "http://127.0.0.1:" + port + "/resource/tile/0_0_0";
      String java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
      process = new ProcessBuilder(java, "-cp", System.getProperty("java.class.path"),
          FixtureCrashRecoveryTest.class.getName(), send ? "send" : "reserve-only", root.toString(), url)
          .redirectErrorStream(true).start();
      Process child = process;
      String ready = workers.submit(() -> new BufferedReader(new InputStreamReader(
          child.getInputStream(), StandardCharsets.UTF_8)).readLine()).get(5, TimeUnit.SECONDS);
      check((send ? "READING" : "RESERVED").equals(ready), "child reached durable reservation: " + ready);
      check(requests.get() == (send ? 1 : 0), "child request count before termination");
      try (FixtureBudget unexpected = open(root)) {
        throw new AssertionError("Other process acquired live journal");
      } catch (IOException locked) {
        check(locked.getMessage().contains("already in use"), "cross-process lock refusal");
      }
      process.destroyForcibly();
      check(process.waitFor(3, TimeUnit.SECONDS) && process.exitValue() != 0, "child terminated and reaped");
      release.countDown();
      try (FixtureBudget restored = open(root);
           FixtureHttpClient client = new FixtureHttpClient(port, chain -> chain.proceed(chain.request()), restored)) {
        FixtureBudget.Snapshot state = restored.snapshot();
        check(state.attempts == 1 && state.tileAttempts == 1 && state.reservedBytes == 4, "crash reservation restored");
        try (Response response = client.newCall(new Request.Builder().url(url).build()).execute()) {
          check("ab".equals(response.body().string()), "same tile succeeds after lock recovery");
        }
        check(restored.snapshot().attempts == 2 && restored.snapshot().reservedBytes == 8, "new attempt preserves old reservation");
        try (Response unexpected = client.newCall(new Request.Builder().url(url).build()).execute()) {
          throw new AssertionError("Crash recovery refunded an old reservation");
        } catch (IOException exhausted) {
          check(exhausted.getMessage().contains("budget exhausted"), "crash budget exhaustion");
        }
      }
      check(requests.get() == (send ? 2 : 1), "exact server count after recovery");
      System.out.println("FixtureCrashRecovery PASS: " + (send ? "active body" : "before send")
          + ", child exit=" + process.exitValue() + ", retained reservation=4, final=8");
    } finally {
      if (process != null && process.isAlive()) {
        process.destroyForcibly();
        check(process.waitFor(3, TimeUnit.SECONDS), "failed test child cleanup");
      }
      release.countDown();
      server.stop(0);
      workers.shutdownNow();
      try (java.util.stream.Stream<Path> paths = Files.walk(root)) {
        for (Path path : (Iterable<Path>) paths.sorted(Comparator.reverseOrder())::iterator) Files.delete(path);
      }
    }
  }

  public static void main(String[] args) throws Exception {
    if (args.length == 3) {
      child(args[0], Path.of(args[1]), args[2]);
      return;
    }
    scenario(false);
    scenario(true);
  }
}
